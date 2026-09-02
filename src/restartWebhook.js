'use strict';

const http = require('http');
const crypto = require('crypto');
const config = require('./config');

/*
 * Receives scheduled-restart events relayed from the FiveM server by the
 * txadmin_restart_relay resource (fivem/txadmin_restart_relay/), which
 * listens for txAdmin's own txAdmin:events:scheduledRestart /
 * txAdmin:events:scheduledRestartSkipped events and forwards them here.
 *
 * This no longer posts anything to Discord — @everyone alerts are manual
 * now (see src/commands/scheduledRestart.js). What this module does is
 * feed two fields on the persistent status card:
 *
 * - NEXT RESTART: every scheduledRestart fire updates the countdown state
 *   below; the card reads getNextRestartSeconds() on its own refresh timer.
 *   txAdmin only fires that event starting 30 minutes before the restart
 *   though, so outside that window getNextRestartSeconds() falls back to
 *   computing the countdown directly from RESTART_SCHEDULE_TIMES — the
 *   daily schedule this bot is told about, kept in sync by hand with
 *   whatever's actually configured in txAdmin. The live event, when it's
 *   arrived recently, always wins over that estimate since it's authoritative.
 * - UPTIME: the same resource also sends a heartbeat carrying its own
 *   start time, which — since a FiveM resource reloads exactly when
 *   FXServer restarts, scheduled or not — is a reliable proxy for real
 *   server uptime, more accurate than the bot's own guess based on when
 *   it last observed the server come online.
 */

let restartState = null; // { secondsRemaining, receivedAt } | null
let heartbeatState = null; // { startedAt, receivedAt } | null

// Safety net: if txAdmin's countdown stops arriving (the restart happened,
// was skipped without us hearing about it, or the relay just stopped),
// don't let a stale countdown sit on the card forever.
const STALE_AFTER_MS = 40 * 60 * 1000;

// The relay resource heartbeats every 5 minutes; anything older than a
// couple of missed beats means the relay (or the server) is down, so the
// card should fall back to the bot's own uptime estimate instead.
const HEARTBEAT_STALE_AFTER_MS = 12 * 60 * 1000;

function handleScheduledRestart(payload) {
  const secondsRemaining = Number(payload.secondsRemaining);
  if (!Number.isFinite(secondsRemaining)) return;
  restartState = { secondsRemaining, receivedAt: Date.now() };
}

function handleRestartSkipped() {
  restartState = null;
}

function handleHeartbeat(payload) {
  const startedAt = Number(payload.startedAt);
  if (!Number.isFinite(startedAt)) return;
  heartbeatState = { startedAt, receivedAt: Date.now() };
}

/**
 * Seconds until the next occurrence of any of the "HH:MM" times in
 * RESTART_SCHEDULE_TIMES, interpreted in RESTART_SCHEDULE_UTC_OFFSET_MINUTES.
 * Always returns a value once a schedule is configured, however far off —
 * this is what lets the card show "in 2 hrs, 34 mins" long before txAdmin's
 * own countdown event would ever fire.
 */
function computeScheduledRestartSeconds(times, utcOffsetMinutes) {
  if (!times.length) return null;

  const offsetMs = utcOffsetMinutes * 60_000;
  const now = Date.now();
  const localNow = new Date(now + offsetMs);
  const localMidnight = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());

  let best = null;
  for (const time of times) {
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) continue;

    // Check both today's and tomorrow's occurrence — "now" might be past
    // today's time, in which case only tomorrow's is still ahead.
    for (const dayOffsetMs of [0, 86_400_000]) {
      const candidateUtcMs = localMidnight + dayOffsetMs + hours * 3_600_000 + minutes * 60_000 - offsetMs;
      const secondsUntil = Math.floor((candidateUtcMs - now) / 1000);
      if (secondsUntil > 0 && (best === null || secondsUntil < best)) {
        best = secondsUntil;
      }
    }
  }
  return best;
}

/**
 * Seconds until the restart. Prefers the live countdown from txAdmin's own
 * event when one has arrived recently (authoritative, accounts for the
 * restart actually running a little early/late) — falls back to the known
 * daily schedule otherwise, which is the only source available outside
 * txAdmin's 30-minutes-before firing window.
 */
function getNextRestartSeconds() {
  if (restartState) {
    const elapsedMs = Date.now() - restartState.receivedAt;
    if (elapsedMs > STALE_AFTER_MS) {
      restartState = null;
    } else {
      const remaining = restartState.secondsRemaining - Math.floor(elapsedMs / 1000);
      if (remaining > 0) return remaining;
    }
  }
  return computeScheduledRestartSeconds(config.restartScheduleTimes, config.restartScheduleUtcOffsetMinutes);
}

/** Real server uptime from the relay's own start time — or null if no recent heartbeat. */
function getServerUptimeSeconds() {
  if (!heartbeatState) return null;
  if (Date.now() - heartbeatState.receivedAt > HEARTBEAT_STALE_AFTER_MS) {
    heartbeatState = null;
    return null;
  }
  return Math.max(0, Math.floor(Date.now() / 1000 - heartbeatState.startedAt));
}

function readBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  const provided = req.headers['x-relay-secret'];
  if (typeof provided !== 'string' || !config.restartWebhookSecret) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(config.restartWebhookSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Test seam: drop in-memory countdown/heartbeat state between cases. */
function resetState() {
  restartState = null;
  heartbeatState = null;
}

function start() {
  if (!config.restartWebhookPort) {
    console.log('[restart-webhook] RESTART_WEBHOOK_PORT not set — the txAdmin relay endpoint is disabled (the status card\'s "Next Restart" field will show "Not scheduled").');
    return null;
  }
  if (!config.restartWebhookSecret) {
    console.error('[restart-webhook] RESTART_WEBHOOK_SECRET not set — refusing to start the relay endpoint unauthenticated.');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (!isAuthorized(req)) {
      res.writeHead(401).end();
      return;
    }

    let payload;
    try {
      payload = JSON.parse((await readBody(req)) || '{}');
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (req.url === '/webhook/restart-scheduled') {
      handleScheduledRestart(payload);
    } else if (req.url === '/webhook/restart-skipped') {
      handleRestartSkipped();
    } else if (req.url === '/webhook/heartbeat') {
      handleHeartbeat(payload);
    } else {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(204).end();
  });

  server.listen(config.restartWebhookPort, config.restartWebhookHost, () => {
    console.log(`[restart-webhook] listening on ${config.restartWebhookHost}:${config.restartWebhookPort}`);
  });

  return server;
}

module.exports = { start, resetState, getNextRestartSeconds, getServerUptimeSeconds };

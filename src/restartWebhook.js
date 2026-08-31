'use strict';

const http = require('http');
const crypto = require('crypto');
const config = require('./config');
const embeds = require('./embeds');
const statusWatcher = require('./statusWatcher');

/*
 * Receives scheduled-restart events relayed from the FiveM server by the
 * txadmin_restart_relay resource (fivem/txadmin_restart_relay/), which
 * listens for txAdmin's own txAdmin:events:scheduledRestart /
 * txAdmin:events:scheduledRestartSkipped events and forwards them here as
 * an authenticated HTTP POST. This is what makes /scheduled-restart
 * automatic instead of something staff have to remember to run.
 *
 * txAdmin fires scheduledRestart repeatedly as a countdown — by default at
 * 30/15/10/5/4/3/2/1 minutes before the restart — so posting on every one
 * would spam the channel with @everyone. Only the minute marks listed in
 * RESTART_WEBHOOK_MILESTONES actually produce a Discord message, once each
 * per restart cycle.
 */

let lastSecondsRemaining = null;
let postedMilestones = new Set();

function resetCycleIfNew(secondsRemaining) {
  // secondsRemaining counts down within one restart cycle; a jump back up
  // means txAdmin has moved on to a later scheduled restart.
  if (lastSecondsRemaining !== null && secondsRemaining > lastSecondsRemaining + 60) {
    postedMilestones = new Set();
  }
  lastSecondsRemaining = secondsRemaining;
}

function etaText(minutes) {
  const en = `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const ar = `خلال ${minutes} دقيقة`;
  return `${en} / ${ar}`;
}

async function handleScheduledRestart(client, payload) {
  const secondsRemaining = Number(payload.secondsRemaining);
  if (!Number.isFinite(secondsRemaining)) return;

  resetCycleIfNew(secondsRemaining);

  const minutes = Math.round(secondsRemaining / 60);
  if (!config.restartMilestoneMinutes.includes(minutes) || postedMilestones.has(minutes)) return;
  postedMilestones.add(minutes);

  await statusWatcher.postStatusMessage(
    client,
    embeds.scheduledRestart({ eta: etaText(minutes), reason: null, announcedBy: 'txAdmin' }),
    'restart-scheduled'
  );

  statusWatcher.noteScheduledRestartAnnounced();
}

async function handleRestartSkipped(client, payload) {
  postedMilestones = new Set();
  lastSecondsRemaining = null;

  await statusWatcher.postStatusMessage(
    client,
    embeds.scheduledRestartSkipped({ author: payload.author || null }),
    'restart-skipped'
  );
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
  // Buffers of different length can't go through timingSafeEqual.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Test seam: drop in-memory dedupe state between cases. */
function resetState() {
  lastSecondsRemaining = null;
  postedMilestones = new Set();
}

function start(client) {
  if (!config.restartWebhookPort) {
    console.log('[restart-webhook] RESTART_WEBHOOK_PORT not set — the txAdmin relay endpoint is disabled (/scheduled-restart still works).');
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

    try {
      if (req.url === '/webhook/restart-scheduled') {
        await handleScheduledRestart(client, payload);
      } else if (req.url === '/webhook/restart-skipped') {
        await handleRestartSkipped(client, payload);
      } else {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(204).end();
    } catch (error) {
      console.error('[restart-webhook] handler error:', error?.message || error);
      res.writeHead(500).end();
    }
  });

  server.listen(config.restartWebhookPort, config.restartWebhookHost, () => {
    console.log(`[restart-webhook] listening on ${config.restartWebhookHost}:${config.restartWebhookPort}`);
  });

  return server;
}

module.exports = { start, resetState };

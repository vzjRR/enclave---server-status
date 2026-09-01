'use strict';

const config = require('./config');
const { checkStatus } = require('./fivem');
const { getHostStatus } = require('./txadmin');

/*
 * Polls the FiveM server and tracks online/offline state, debounced in both
 * directions (FAILURE_THRESHOLD / RECOVERY_THRESHOLD) so one dropped check
 * doesn't flip the reported state. This module no longer posts anything to
 * Discord on its own — the live status card (statusCard.js) reads getState()
 * on its own timer, and the @everyone alerts are staff-triggered via slash
 * commands, not fired automatically from a detected transition.
 *
 * When TXADMIN_URL/TXADMIN_API_TOKEN are configured, txAdmin's own
 * /host/status is checked alongside the ordinary FiveM poll and — since
 * it's txAdmin's own authoritative tracking rather than an external
 * guess — wins for online/players/join-code whenever it answers. It's
 * purely additive: unset or unreachable, everything falls back to the
 * existing dynamic.json/listing poll exactly as before.
 */

let online = null; // null = not yet established (first check after boot)
let consecutiveFailures = 0;
let consecutiveSuccesses = 0;
let lastStatus = null;
let lastHostStatus = null;
let upSince = null; // when the server most recently became online
let pollTimer = null;
let lastStatusMessageId = null;

async function getStatusChannel(client) {
  if (!config.statusChannelId) return null;
  try {
    return await client.channels.fetch(config.statusChannelId);
  } catch (error) {
    console.error(`Status channel ${config.statusChannelId} could not be fetched:`, error?.message || error);
    return null;
  }
}

/**
 * Sends a message to the status channel and deletes whichever one this bot
 * posted there before it (of this kind — the manual alerts), so pings don't
 * pile up. Used by the manual /server-down, /server-up and
 * /scheduled-restart commands; the persistent status card manages its own
 * single message separately and never touches this.
 */
async function postStatusMessage(client, payload, label = 'status') {
  const channel = await getStatusChannel(client);
  if (!channel) return null;

  let sent;
  try {
    sent = await channel.send(payload);
  } catch (error) {
    console.error(`Failed to send ${label} message:`, error?.message || error);
    return null;
  }

  const previousId = lastStatusMessageId;
  lastStatusMessageId = sent.id;

  if (previousId && previousId !== sent.id) {
    channel.messages.delete(previousId).catch((error) => {
      if (error?.code !== 10008) { // Unknown Message — already gone, fine
        console.error('Failed to delete previous status message:', error?.message || error);
      }
    });
  }

  return sent;
}

/** Current known state, for the status card and /status to read. */
function getState() {
  return {
    online: online === true,
    established: online !== null,
    players: lastHostStatus?.players ?? lastStatus?.players ?? 0,
    maxPlayers: lastHostStatus?.maxPlayers ?? lastStatus?.maxPlayers ?? 0,
    hostname: lastStatus?.hostname || lastHostStatus?.projectName || '',
    joinCode: lastHostStatus?.joinCode || null,
    uptimeSeconds: online && upSince ? Math.floor((Date.now() - upSince) / 1000) : null
  };
}

async function tick() {
  const [status, hostStatus] = await Promise.all([
    checkStatus(config.fivemJoinCodes),
    getHostStatus(config.txAdminUrl, config.txAdminApiToken)
  ]);
  lastStatus = status;
  lastHostStatus = hostStatus;

  // txAdmin's own tracking wins when it answers — it's authoritative,
  // not an external guess. Falls back to the ordinary poll otherwise.
  const rawOnline = hostStatus ? hostStatus.online : status.online;

  if (rawOnline) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
  } else {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
  }

  if (online === null) {
    online = rawOnline;
    if (online) upSince = Date.now();
    console.log(`[status] baseline: server is ${online ? 'online' : 'offline'}`);
    return;
  }

  if (online && !rawOnline && consecutiveFailures >= config.failureThreshold) {
    online = false;
    upSince = null;
    console.log('[status] server went offline');
    return;
  }

  if (!online && rawOnline && consecutiveSuccesses >= config.recoveryThreshold) {
    online = true;
    upSince = Date.now();
    console.log('[status] server back online');
  }
}

// Awaits the first check before returning, so a caller that starts the
// status card right after this doesn't render one refresh of "unknown"
// state before the baseline check has actually landed.
async function start() {
  if (pollTimer) return;

  await tick().catch((error) => console.error('Status check failed:', error?.message || error));
  pollTimer = setInterval(() => {
    tick().catch((error) => console.error('Status check failed:', error?.message || error));
  }, config.checkIntervalMs);
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = { start, stop, getStatusChannel, postStatusMessage, getState };

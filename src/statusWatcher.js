'use strict';

const config = require('./config');
const { checkStatus } = require('./fivem');
const embeds = require('./embeds');

/*
 * Tracks the server's online/offline state across polls and posts an alert
 * on every transition. Debounced in both directions (FAILURE_THRESHOLD /
 * RECOVERY_THRESHOLD) so one dropped check does not cry wolf.
 *
 * A /scheduled-restart announcement opens a grace window
 * (RESTART_WINDOW_MINUTES): the next down->up cycle inside that window is
 * reported as "the announced restart" instead of an unplanned outage.
 */

let online = null; // null = not yet established (first check after boot)
let consecutiveFailures = 0;
let consecutiveSuccesses = 0;
let downSince = null;
let restartAnnouncedAt = null;
let pollTimer = null;
let lastStatusMessageId = null;

function noteScheduledRestartAnnounced() {
  restartAnnouncedAt = Date.now();
}

function isWithinRestartWindow() {
  return restartAnnouncedAt !== null && (Date.now() - restartAnnouncedAt) <= config.restartWindowMs;
}

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
 * Sends a status message to the status channel and deletes whichever one
 * this bot posted there before it, so the channel always shows exactly one
 * current status rather than accumulating a history. Shared by every
 * sender — the automatic watcher below, the txAdmin relay, and the manual
 * /scheduled-restart command — since a restart notice needs to replace a
 * down alert just as much as a down alert needs to replace an up one.
 *
 * The new message is sent before the old one is deleted, so there's never
 * a moment with nothing posted at all if the delete is slow or fails.
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
      // Unknown Message (10008) just means it's already gone — nothing to do.
      if (error?.code !== 10008) {
        console.error('Failed to delete previous status message:', error?.message || error);
      }
    });
  }

  return sent;
}

async function tick(client) {
  const status = await checkStatus(config.fivemJoinCodes);

  if (status.online) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
  } else {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
  }

  // Establish the baseline silently on the very first check — a bot restart
  // must never announce "back online" just because polling only just started.
  if (online === null) {
    online = status.online;
    if (!online) downSince = Date.now();
    console.log(`[status] baseline: server is ${online ? 'online' : 'offline'}`);
    return;
  }

  if (online && !status.online && consecutiveFailures >= config.failureThreshold) {
    online = false;
    downSince = Date.now();
    const wasScheduledRestart = isWithinRestartWindow();
    console.log(`[status] server went offline${wasScheduledRestart ? ' (scheduled restart)' : ''}`);
    await postStatusMessage(client, embeds.serverDown({ hostname: status.hostname, wasScheduledRestart }), 'server-down');
    return;
  }

  if (!online && status.online && consecutiveSuccesses >= config.recoveryThreshold) {
    online = true;
    const downtimeMs = downSince ? Date.now() - downSince : null;
    const wasScheduledRestart = isWithinRestartWindow();
    downSince = null;
    if (wasScheduledRestart) restartAnnouncedAt = null;

    console.log(`[status] server back online${wasScheduledRestart ? ' (scheduled restart complete)' : ''}`);
    await postStatusMessage(client, embeds.serverUp({
      hostname: status.hostname,
      players: status.players,
      maxPlayers: status.maxPlayers,
      downtimeMs,
      wasScheduledRestart
    }), 'server-up');
  }
}

function start(client) {
  if (pollTimer) return;

  tick(client).catch((error) => console.error('Status check failed:', error?.message || error));
  pollTimer = setInterval(() => {
    tick(client).catch((error) => console.error('Status check failed:', error?.message || error));
  }, config.checkIntervalMs);
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

module.exports = { start, stop, noteScheduledRestartAnnounced, getStatusChannel, postStatusMessage };

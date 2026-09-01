'use strict';

const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const config = require('./config');
const embeds = require('./embeds');
const statusWatcher = require('./statusWatcher');
const restartWebhook = require('./restartWebhook');

/*
 * The persistent, auto-updating status card: one message in the status
 * channel, edited in place on every refresh rather than reposted, showing
 * live status/players/connect command/uptime/next restart — same idea as
 * txAdmin's own built-in status embed, reskinned for Enclave RP.
 *
 * Separate from the manual @everyone alerts (src/commands/server*.js):
 * this never pings and tracks its own single message id, independent of
 * statusWatcher's alert-message tracking.
 *
 * A marker in the footer ("Enclave RP | Server Status • Updated every
 * minute") lets a fresh process find and resume the existing card on the
 * channel after a restart, rather than leaving a stale one behind and
 * creating a second — no on-disk state needed for that.
 */

const CARD_MARKER = 'Enclave RP | Server Status';
const BANNER_PATH = path.join(__dirname, '..', 'assets', 'enclave-banner.png');
const BANNER_ATTACHMENT_NAME = 'enclave-banner.png';

let cardMessageId = null;
let refreshTimer = null;

function connectCode(state) {
  // The live code from txAdmin's own /host/status, when available, is the
  // actual current one — more trustworthy than a hand-maintained env var.
  return state.joinCode || config.fivemJoinCodes[0] || null;
}

function buildEmbed() {
  const state = statusWatcher.getState();
  return embeds.statusCard({
    online: state.online,
    players: state.players,
    maxPlayers: state.maxPlayers,
    connectCode: connectCode(state),
    nextRestartSeconds: restartWebhook.getNextRestartSeconds(),
    // Real uptime from the relay's heartbeat wins when it's fresh; falls
    // back to the bot's own online-since estimate otherwise.
    uptimeSeconds: restartWebhook.getServerUptimeSeconds() ?? state.uptimeSeconds
  });
}

async function findExistingCard(channel, botUserId) {
  try {
    const recent = await channel.messages.fetch({ limit: 25 });
    const found = recent.find((message) =>
      message.author?.id === botUserId
      && message.embeds[0]?.footer?.text?.startsWith(CARD_MARKER));
    return found || null;
  } catch (error) {
    console.error('[status-card] failed to search for an existing card:', error?.message || error);
    return null;
  }
}

async function refresh(client) {
  const channel = await statusWatcher.getStatusChannel(client);
  if (!channel) return;

  const embed = buildEmbed();

  if (cardMessageId) {
    try {
      const message = await channel.messages.fetch(cardMessageId);
      await message.edit({ embeds: [embed] });
      return;
    } catch (error) {
      if (error?.code !== 10008) { // Unknown Message
        console.error('[status-card] failed to edit the card, will re-create it:', error?.message || error);
      }
      cardMessageId = null;
    }
  }

  // No card tracked (first run, or the previous one is gone) — adopt an
  // existing one left by an earlier process if there is one, else post new.
  const existing = await findExistingCard(channel, client.user.id);
  if (existing) {
    cardMessageId = existing.id;
    await existing.edit({ embeds: [embed] }).catch((error) => {
      console.error('[status-card] failed to edit adopted card:', error?.message || error);
    });
    return;
  }

  try {
    const attachment = new AttachmentBuilder(BANNER_PATH, { name: BANNER_ATTACHMENT_NAME });
    const sent = await channel.send({ embeds: [embed], files: [attachment] });
    cardMessageId = sent.id;
  } catch (error) {
    console.error('[status-card] failed to post the card:', error?.message || error);
  }
}

function start(client) {
  if (refreshTimer) return;

  refresh(client).catch((error) => console.error('[status-card] refresh failed:', error?.message || error));
  refreshTimer = setInterval(() => {
    refresh(client).catch((error) => console.error('[status-card] refresh failed:', error?.message || error));
  }, config.cardUpdateIntervalMs);
}

function stop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = { start, stop, refresh };

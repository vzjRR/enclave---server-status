'use strict';

require('dotenv').config();

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

// Distinct from intEnv: 0/unset means "disabled" here rather than falling
// back to a default port, since the relay endpoint is opt-in.
function portEnv(name) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Distinct from intEnv: negative/zero are meaningful UTC offsets, not invalid input.
function signedIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: (process.env.CLIENT_ID || '').trim(),
  guildId: (process.env.GUILD_ID || '').trim(),
  statusChannelId: (process.env.STATUS_CHANNEL_ID || '').trim(),
  staffRoleIds: listEnv('STAFF_ROLE_ID'),

  // Comma-separated — every configured code is checked on each poll and
  // whichever one answers wins, so a stale/wrong code alongside a good one
  // is harmless rather than something that has to be picked correctly. The
  // first one listed is also what the status card shows as the connect
  // command, so keep the current/primary code first.
  fivemJoinCodes: listEnv('FIVEM_JOIN_CODE'),

  checkIntervalMs: intEnv('CHECK_INTERVAL_MS', 60_000),
  failureThreshold: intEnv('FAILURE_THRESHOLD', 2),
  recoveryThreshold: intEnv('RECOVERY_THRESHOLD', 1),

  // The persistent live status card (src/statusCard.js).
  cardUpdateIntervalMs: intEnv('CARD_UPDATE_INTERVAL_MS', 60_000),

  // txAdmin restart relay (see fivem/txadmin_restart_relay/ + src/restartWebhook.js).
  // Feeds the card's "Next Restart" field and real uptime — it no longer
  // posts alerts itself.
  restartWebhookHost: (process.env.RESTART_WEBHOOK_HOST || '127.0.0.1').trim(),
  restartWebhookPort: portEnv('RESTART_WEBHOOK_PORT'),
  restartWebhookSecret: (process.env.RESTART_WEBHOOK_SECRET || '').trim(),

  // txAdmin's own /host/status API (see src/txadmin.js). Optional — when
  // either is unset, the card falls back to fivem.js's own poll for
  // online/players. No trailing slash on the URL.
  txAdminUrl: (process.env.TXADMIN_URL || '').trim().replace(/\/+$/, ''),
  txAdminApiToken: (process.env.TXADMIN_API_TOKEN || '').trim(),

  // Known daily restart times (24h "HH:MM", comma-separated, e.g. "06:00,18:00")
  // so the card always shows a countdown -- txAdmin's own countdown event
  // only starts firing 30 minutes before the restart, which is too late for
  // an always-visible "Next Restart" field. This is the schedule *this bot*
  // is told about; it doesn't read it from txAdmin, so keep it in sync by
  // hand if the schedule ever changes there.
  restartScheduleTimes: listEnv('RESTART_SCHEDULE_TIMES'),

  // Timezone those times are in, as minutes offset from UTC. Default +240
  // (UTC+4) matches Oman time, the convention already used elsewhere in
  // Enclave RP's bots (enclave-tickets-bot).
  restartScheduleUtcOffsetMinutes: signedIntEnv('RESTART_SCHEDULE_UTC_OFFSET_MINUTES', 4 * 60)
};

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

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: (process.env.CLIENT_ID || '').trim(),
  guildId: (process.env.GUILD_ID || '').trim(),
  statusChannelId: (process.env.STATUS_CHANNEL_ID || '').trim(),
  staffRoleIds: listEnv('STAFF_ROLE_ID'),

  fivemJoinCode: (process.env.FIVEM_JOIN_CODE || '').trim(),

  checkIntervalMs: intEnv('CHECK_INTERVAL_MS', 60_000),
  failureThreshold: intEnv('FAILURE_THRESHOLD', 2),
  recoveryThreshold: intEnv('RECOVERY_THRESHOLD', 1),
  restartWindowMs: intEnv('RESTART_WINDOW_MINUTES', 30) * 60_000
};

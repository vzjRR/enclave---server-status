'use strict';

const { REST, Routes } = require('discord.js');
const config = require('./config');
const scheduledRestart = require('./commands/scheduledRestart');
const serverDown = require('./commands/serverDown');
const serverUp = require('./commands/serverUp');
const status = require('./commands/status');

const commands = [
  scheduledRestart.data.toJSON(),
  serverDown.data.toJSON(),
  serverUp.data.toJSON(),
  status.data.toJSON()
];

async function main() {
  if (!config.token) throw new Error('DISCORD_TOKEN is not set.');
  if (!config.clientId) throw new Error('CLIENT_ID is not set.');

  const rest = new REST().setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  const result = await rest.put(route, { body: commands });
  console.log(`Registered ${result.length} slash command(s)${config.guildId ? ` to guild ${config.guildId}` : ' globally'}.`);
}

main().catch((error) => {
  console.error('Failed to register slash commands:', error);
  process.exit(1);
});

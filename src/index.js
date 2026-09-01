'use strict';

const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const config = require('./config');
const statusWatcher = require('./statusWatcher');
const restartWebhook = require('./restartWebhook');
const statusCard = require('./statusCard');
const scheduledRestart = require('./commands/scheduledRestart');
const serverDown = require('./commands/serverDown');
const serverUp = require('./commands/serverUp');
const status = require('./commands/status');

if (!config.token) {
  console.error('DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!config.statusChannelId) {
  console.error('STATUS_CHANNEL_ID is not set. The bot has nowhere to post alerts.');
  process.exit(1);
}
if (!config.fivemJoinCodes.length) {
  console.error('FIVEM_JOIN_CODE is not set. The bot has no server to watch.');
  process.exit(1);
}

const COMMANDS = new Map([
  [scheduledRestart.data.name, scheduledRestart],
  [serverDown.data.name, serverDown],
  [serverUp.data.name, serverUp],
  [status.data.name, status]
]);

// A running bot handles every guild its application is in; GUILD_ID confines
// interaction handling to the one Enclave RP guild if set, mirroring the
// pattern used by the tickets bot.
function isAllowedGuild(guildId) {
  return !config.guildId || guildId === config.guildId;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  restartWebhook.start();
  await statusWatcher.start();
  statusCard.start(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId && !isAllowedGuild(interaction.guildId)) return;

  const command = COMMANDS.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);
    const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => console.error('Discord client error:', error));
client.on(Events.Warn, (warning) => console.warn('Discord client warning:', warning));

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception, shutting down:', error);
  process.exit(1);
});

client.login(config.token);

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../embeds');
const statusWatcher = require('../statusWatcher');
const { isStaff } = require('./authorize');

const data = new SlashCommandBuilder()
  .setName('server-down')
  .setDescription('Announce the server is down to the status channel (with @everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
  if (!isStaff(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to post this. / لا تملك صلاحية النشر.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sent = await statusWatcher.postStatusMessage(interaction.client, embeds.serverDown(), 'server-down');

  await interaction.editReply({
    content: sent ? 'Announcement posted. / تم نشر الإعلان.' : 'Failed to post — is the status channel reachable?'
  });
}

module.exports = { data, execute };

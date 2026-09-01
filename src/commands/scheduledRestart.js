'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const embeds = require('../embeds');
const statusWatcher = require('../statusWatcher');
const { isStaff } = require('./authorize');

const data = new SlashCommandBuilder()
  .setName('scheduled-restart')
  .setDescription('Announce a scheduled server restart to the status channel (with @everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption((option) => option
    .setName('minutes')
    .setDescription('Minutes until the restart')
    .setRequired(true)
    .setMinValue(1)
    .setMaxValue(180));

async function execute(interaction) {
  if (!isStaff(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to announce a restart. / لا تملك صلاحية الإعلان عن إعادة تشغيل.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const minutes = interaction.options.getInteger('minutes', true);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sent = await statusWatcher.postStatusMessage(interaction.client, embeds.scheduledRestart({ minutes }), 'scheduled-restart');

  await interaction.editReply({
    content: sent ? `Announcement posted. / تم نشر الإعلان.` : 'Failed to post — is the status channel reachable?'
  });
}

module.exports = { data, execute };

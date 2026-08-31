'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const embeds = require('../embeds');
const statusWatcher = require('../statusWatcher');

const data = new SlashCommandBuilder()
  .setName('scheduled-restart')
  .setDescription('Announce a scheduled server restart to the status channel (with @everyone).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option
    .setName('eta')
    .setDescription('When it happens, shown as-is (e.g. "in 10 minutes", "at 22:00 Oman time")')
    .setRequired(true)
    .setMaxLength(100))
  .addStringOption((option) => option
    .setName('reason')
    .setDescription('Optional reason shown in the announcement (e.g. "weekly update")')
    .setRequired(false)
    .setMaxLength(300));

// setDefaultMemberPermissions is only a default — a guild admin can grant this
// command to any role, so authorization is re-checked here rather than trusted.
function isAuthorized(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!config.staffRoleIds.length) return false;
  return config.staffRoleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

async function execute(interaction) {
  if (!isAuthorized(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to announce a restart. / لا تملك صلاحية الإعلان عن إعادة تشغيل.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channel = await statusWatcher.getStatusChannel(interaction.client);
  if (!channel) {
    await interaction.reply({
      content: 'The status channel is not configured or could not be reached.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const eta = interaction.options.getString('eta', true);
  const reason = interaction.options.getString('reason') || null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await statusWatcher.postStatusMessage(interaction.client, embeds.scheduledRestart({
    eta,
    reason,
    announcedBy: interaction.user.tag
  }), 'scheduled-restart');

  statusWatcher.noteScheduledRestartAnnounced();

  await interaction.editReply({ content: `Announcement posted in <#${channel.id}>. / تم نشر الإعلان.` });
}

module.exports = { data, execute };

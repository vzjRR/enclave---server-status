'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { checkStatus } = require('../fivem');

const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Check the Enclave RP server status right now / تحقق من حالة السيرفر الآن');

async function execute(interaction) {
  await interaction.deferReply();

  const status = await checkStatus(config.fivemJoinCode);

  const embed = new EmbedBuilder()
    .setColor(status.online ? 0x57f287 : 0xed4245)
    .setTitle(status.online ? '🟢 Online — يعمل' : '🔴 Offline — متوقف')
    .setFooter({ text: 'Enclave RP | Server Status' })
    .setTimestamp();

  if (status.online) {
    embed.addFields(
      { name: 'Players / اللاعبين', value: status.maxPlayers ? `${status.players}/${status.maxPlayers}` : `${status.players}`, inline: true },
      { name: 'Hostname', value: status.hostname || '—', inline: true }
    );
  }

  await interaction.editReply({ embeds: [embed] });
}

module.exports = { data, execute };

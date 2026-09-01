'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

// setDefaultMemberPermissions on each command is only a default — a guild
// admin can grant a command to any role, so authorization is re-checked
// here rather than trusted.
function isStaff(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!config.staffRoleIds.length) return false;
  return config.staffRoleIds.some((roleId) => interaction.member?.roles?.cache?.has(roleId));
}

module.exports = { isStaff };

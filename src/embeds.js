'use strict';

const { EmbedBuilder } = require('discord.js');

const COLOR_DOWN = 0xed4245; // Discord red
const COLOR_UP = 0x57f287; // Discord green
const COLOR_RESTART = 0xfaa61a; // Discord orange

/** @everyone lives in message content, not the embed — that's what actually pings. */
const PING_CONTENT = '@everyone';

// The three manual alert messages, verbatim per the exact Arabic wording
// given for this bot — these are staff-triggered (/server-down, /server-up,
// /scheduled-restart), not auto-posted on a detected state change.

function serverDown() {
  const embed = new EmbedBuilder()
    .setColor(COLOR_DOWN)
    .setDescription(
      [
        '**الحالة:** 🔴 مغلق مؤقتًا',
        '**السبب:** 🛠️ صيانة دورية',
        '**العودة:** سيتم الإعلان عنها عند الانتهاء',
        '',
        '**ENCLAVE RP | نعمل على تقديم تجربة أفضل لكم.**'
      ].join('\n')
    );

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

function serverUp() {
  const embed = new EmbedBuilder()
    .setColor(COLOR_UP)
    .setDescription(
      [
        '🎮 **السيرفر متاح للدخول**',
        '',
        '**الحالة:** 🟢 مفتوح',
        '**الأداء:** 🟢 مستقر',
        '**الوضع:** 🟢 يعمل بكفاءة',
        '',
        '**ENCLAVE RP | نراكم داخل المدينة.**'
      ].join('\n')
    );

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

function scheduledRestart({ minutes }) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_RESTART)
    .setDescription(
      [
        '# 🟠 | إيقاف مجدول للسيرفر',
        '',
        'سيتم إيقاف السيرفر لإجراء أعمال الصيانة والتحديثات اللازمة، وسيتم إعلامكم فور الانتهاء وعودة السيرفر للعمل.',
        '',
        `**وقت الإيقاف:** 🟠 بعد ${minutes} دقيقة.`,
        '',
        '**السبب:** 🛠️ صيانة وتحديثات',
        '**العودة:** سيتم الإعلان عنها عند الانتهاء',
        '',
        '**ENCLAVE RP | نعمل باستمرار على تحسين تجربتكم.**'
      ].join('\n')
    );

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

function fmtHms(totalSeconds) {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} mins`;
  return `${hours} hrs, ${minutes} mins`;
}

/**
 * The persistent, auto-updating status card — one message, edited in place
 * on every refresh rather than reposted. Mirrors the structure of txAdmin's
 * own live status embed (title/fields/banner), reskinned for Enclave RP.
 */
function statusCard({ online, players, maxPlayers, connectCode, nextRestartSeconds, uptimeSeconds }) {
  const embed = new EmbedBuilder()
    .setColor(online ? 0x57f287 : 0xed4245)
    .setTitle('ENCLAVE RP')
    .setDescription('Server Status')
    .addFields(
      { name: 'STATUS', value: online ? '🟢 Online' : '🔴 Offline', inline: false },
      { name: 'PLAYERS', value: online ? `${players}/${maxPlayers || '?'}` : '—', inline: false },
      { name: 'F8 CONNECT COMMAND', value: connectCode ? `connect ${connectCode}` : '—', inline: false },
      { name: 'NEXT RESTART', value: nextRestartSeconds != null ? `in ${fmtHms(nextRestartSeconds)}` : 'Not scheduled', inline: false },
      { name: 'UPTIME', value: online && uptimeSeconds != null ? fmtHms(uptimeSeconds) : '—', inline: false }
    )
    .setImage('attachment://enclave-banner.png')
    .setFooter({ text: 'Enclave RP | Server Status • Updated every minute' })
    .setTimestamp();

  return embed;
}

module.exports = { serverDown, serverUp, scheduledRestart, statusCard };

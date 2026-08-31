'use strict';

const { EmbedBuilder } = require('discord.js');

const BRAND_FOOTER = 'Enclave RP | Server Status';

const COLOR_DOWN = 0xed4245; // Discord red
const COLOR_UP = 0x57f287; // Discord green
const COLOR_RESTART = 0xfaa61a; // Discord orange

function fmtDuration(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** @everyone lives in message content, not the embed — that's what actually pings. */
const PING_CONTENT = '@everyone';

function serverDown({ hostname, wasScheduledRestart }) {
  const enBody = wasScheduledRestart
    ? `The Enclave RP server${hostname ? ` (**${hostname}**)` : ''} has gone offline for the **scheduled restart** announced earlier. It should be back shortly.`
    : `The Enclave RP server${hostname ? ` (**${hostname}**)` : ''} appears to be **offline**. We are looking into it — updates will follow in this channel.`;
  const arBody = wasScheduledRestart
    ? `توقف سيرفر Enclave RP${hostname ? ` (**${hostname}**)` : ''} الآن من أجل **إعادة التشغيل المجدولة** التي تم الإعلان عنها سابقاً. سيعود قريباً.`
    : `يبدو أن سيرفر Enclave RP${hostname ? ` (**${hostname}**)` : ''} **متوقف حالياً**. الفريق يعمل على معرفة السبب، وسيتم تحديثكم في هذه القناة.`;

  const embed = new EmbedBuilder()
    .setColor(COLOR_DOWN)
    .setTitle('🔴 Server Offline — السيرفر متوقف')
    .setDescription(
      [
        `**English**`,
        enBody,
        '',
        `**العربية**`,
        arBody
      ].join('\n')
    )
    .setFooter({ text: BRAND_FOOTER })
    .setTimestamp();

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

function serverUp({ hostname, players, maxPlayers, downtimeMs, wasScheduledRestart }) {
  const playerLine = maxPlayers
    ? `👥 ${players}/${maxPlayers}`
    : `👥 ${players}`;

  const enIntro = wasScheduledRestart
    ? 'The scheduled restart is complete and the server is **back online**.'
    : 'The Enclave RP server is **back online**.';
  const arIntro = wasScheduledRestart
    ? 'اكتملت **إعادة التشغيل المجدولة** والسيرفر **يعمل الآن**.'
    : 'سيرفر Enclave RP **يعمل الآن**.';

  const downtimeLine = downtimeMs
    ? `\nDowntime: **${fmtDuration(downtimeMs)}** — مدة التوقف: **${fmtDuration(downtimeMs)}**`
    : '';

  const embed = new EmbedBuilder()
    .setColor(COLOR_UP)
    .setTitle('🟢 Server Online — السيرفر يعمل الآن')
    .setDescription(
      [
        `**English**`,
        `${enIntro} Jump back in! ${playerLine}`,
        '',
        `**العربية**`,
        `${arIntro} تفضلوا بالدخول! ${playerLine}`,
        downtimeLine
      ].join('\n').trim()
    )
    .setFooter({ text: BRAND_FOOTER })
    .setTimestamp();

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

function scheduledRestart({ eta, reason, announcedBy }) {
  const reasonLineEn = reason ? `\nReason: **${reason}**` : '';
  const reasonLineAr = reason ? `\nالسبب: **${reason}**` : '';

  const embed = new EmbedBuilder()
    .setColor(COLOR_RESTART)
    .setTitle('🛠️ Scheduled Restart — إعادة تشغيل مجدولة')
    .setDescription(
      [
        `**English**`,
        `The Enclave RP server will restart **${eta}**. You may be disconnected briefly — this is expected.${reasonLineEn}`,
        '',
        `**العربية**`,
        `سيتم إعادة تشغيل سيرفر Enclave RP **${eta}**. قد تنقطع اللعبة لفترة قصيرة، وهذا أمر طبيعي.${reasonLineAr}`
      ].join('\n')
    )
    .setFooter({ text: `${BRAND_FOOTER}${announcedBy ? ` • Announced by ${announcedBy}` : ''}` })
    .setTimestamp();

  return { content: PING_CONTENT, embeds: [embed], allowedMentions: { parse: ['everyone'] } };
}

// No @everyone here, deliberately — a cancellation is a relief, not an
// emergency, and the audience already got pinged once for the restart itself.
function scheduledRestartSkipped({ author }) {
  const byLineEn = author ? ` by **${author}**` : '';
  const byLineAr = author ? ` بواسطة **${author}**` : '';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // Discord blurple — informational, not an alert
    .setTitle('ℹ️ Restart Cancelled — تم إلغاء إعادة التشغيل')
    .setDescription(
      [
        `**English**`,
        `The upcoming scheduled restart was cancelled${byLineEn}. No action needed.`,
        '',
        `**العربية**`,
        `تم إلغاء إعادة التشغيل المجدولة القادمة${byLineAr}. لا حاجة لأي إجراء.`
      ].join('\n')
    )
    .setFooter({ text: BRAND_FOOTER })
    .setTimestamp();

  return { embeds: [embed] };
}

module.exports = { serverDown, serverUp, scheduledRestart, scheduledRestartSkipped };

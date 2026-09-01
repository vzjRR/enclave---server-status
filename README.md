# Enclave RP — Server Status

A standalone Discord bot (app id `1543975525448683580`) for the Enclave RP
FiveM server, with two independent parts in one channel:

- 🖥️ **A live status card** — one message, edited in place every minute,
  showing whether the server is online, player count, the `connect` code,
  uptime, and (when known) the next scheduled restart. Never pings anyone.
- 📣 **Manual `@everyone` alerts** — `/server-down`, `/server-up` and
  `/scheduled-restart`, run by staff, post the announcement text below.
  Nothing is posted automatically; a real down/up is only reflected on the
  live card unless a staff member explicitly announces it.

## The live status card

Mirrors the structure of txAdmin's own built-in status embed (title,
STATUS/PLAYERS/CONNECT/UPTIME/NEXT RESTART fields, banner image), reskinned
with Enclave RP's branding (`assets/enclave-banner.png`).

It's one message that gets **edited**, never reposted — including across a
bot restart: on boot it searches the channel's recent messages for one it
already posted (a footer marker), adopts it if found, and only creates a
new one if there truly isn't one yet. Refresh interval is
`CARD_UPDATE_INTERVAL_MS` (default 60s, matching "Updated every minute").

Where each field comes from:

| Field | Source |
| --- | --- |
| STATUS / PLAYERS | Polled from the FiveM server itself — see [How the server is watched](#how-the-server-is-watched) below |
| F8 CONNECT COMMAND | The first code in `FIVEM_JOIN_CODE` |
| UPTIME | Tracked internally from the last online→offline transition this bot observed — not the game server's actual process uptime, which isn't exposed by the endpoints this bot polls |
| NEXT RESTART | Fed by the optional txAdmin relay (below) — shows "Not scheduled" without it |

## Manual alerts

Nothing posts to Discord automatically anymore — these three commands are
the only way an `@everyone` alert goes out, and each one **replaces**
whichever of the three was posted most recently (only one alert is ever
visible in the channel at a time; the card is untouched by this, it's a
separate message).

| Command | Posts |
| --- | --- |
| `/server-down` | The maintenance/down announcement |
| `/server-up` | The back-online announcement |
| `/scheduled-restart minutes:<N>` | The scheduled-restart announcement, with "بعد N دقيقة" |

All three require **Manage Server**, or a role listed in `STAFF_ROLE_ID`.
The exact text posted (Arabic, as specified):

**`/server-down`**
```
الحالة: 🔴 مغلق مؤقتًا
السبب: 🛠️ صيانة دورية
العودة: سيتم الإعلان عنها عند الانتهاء

ENCLAVE RP | نعمل على تقديم تجربة أفضل لكم.
```

**`/server-up`**
```
🎮 السيرفر متاح للدخول

الحالة: 🟢 مفتوح
الأداء: 🟢 مستقر
الوضع: 🟢 يعمل بكفاءة

ENCLAVE RP | نراكم داخل المدينة.
```

**`/scheduled-restart minutes:15`**
```
🟠 | إيقاف مجدول للسيرفر

سيتم إيقاف السيرفر لإجراء أعمال الصيانة والتحديثات اللازمة، وسيتم إعلامكم فور الانتهاء وعودة السيرفر للعمل.

وقت الإيقاف: 🟠 بعد 15 دقيقة.

السبب: 🛠️ صيانة وتحديثات
العودة: سيتم الإعلان عنها عند الانتهاء

ENCLAVE RP | نعمل باستمرار على تحسين تجربتكم.
```

## `/status`

A separate, on-demand, non-pinging check — usable in any channel, shows
current online/offline + players + hostname. Independent of the card.

## How the server is watched

Same approach as the `enclaverp.cc` homepage (`enclave-home/lib/fivem.js`):
each `FIVEM_JOIN_CODE` (`cfx.re/join/<code>`) is resolved to the server's
current address via Cfx.re's `x-citizenfx-url` header, then polled directly
(`/dynamic.json`) with the public Cfx.re server listing as a fallback for a
network that blocks the game port. Multiple codes can be listed
(comma-separated) and are checked in parallel — whichever answers wins.

Every check (`CHECK_INTERVAL_MS`, default 60s) updates an in-memory
online/offline state, debounced in both directions
(`FAILURE_THRESHOLD` / `RECOVERY_THRESHOLD`) so one dropped check doesn't
flip the card. This state feeds the card only — it no longer triggers any
Discord post on its own.

## Optional: automatic "Next Restart" from txAdmin

If the FiveM server runs txAdmin — it does, txAdmin ships with FXServer —
its own **Restart Scheduler** (Settings → General → Scheduled Restarts)
fires internal events on a countdown before every restart it runs. The
[`txadmin_restart_relay`](fivem/txadmin_restart_relay) FiveM resource
listens for those and forwards them to this bot's relay endpoint
(`src/restartWebhook.js`), which feeds the card's **NEXT RESTART** field —
it does **not** post anything to Discord itself. Entirely optional: without
it, NEXT RESTART just always shows "Not scheduled."

See [`fivem/txadmin_restart_relay/README.md`](fivem/txadmin_restart_relay/README.md)
for the game-server-side install and [Configuration](#configuration) below
for the bot side (`RESTART_WEBHOOK_*`).

## Setup

```bash
npm ci
cp .env.example .env      # fill in DISCORD_TOKEN (see below)
npm run deploy            # register slash commands
npm start
```

For a Linux host running this alongside other Enclave bots, see
[`deploy/README.md`](deploy/README.md) (systemd unit, updates, permissions).

### Getting `DISCORD_TOKEN`

This bot already exists (application id `1543975525448683580`) — get its
token from the **Bot** tab at
<https://discord.com/developers/applications>, under that application, and
put it in `.env`. `CLIENT_ID`, `GUILD_ID`, `STATUS_CHANNEL_ID` and
`FIVEM_JOIN_CODE` in `.env.example` are already the real Enclave RP values.

### Bot permissions

**View Channel**, **Send Messages**, **Embed Links**, **Attach Files** (for
the card's banner image), and — critically — **Mention Everyone** on the
status channel, or `/server-down` etc.'s `@everyone` silently fails to
notify anyone. See `deploy/README.md` for a ready invite link. The bot
never needs `Administrator` or `Manage Messages` — it only ever edits or
deletes messages it posted itself, which needs no special permission.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Bot token. Required. |
| `CLIENT_ID` | `1543975525448683580` | This bot's application id. |
| `GUILD_ID` | Enclave RP guild | Register commands instantly to one guild; the bot ignores interactions from any other. |
| `STATUS_CHANNEL_ID` | `1536824170720133150` | Where the card lives and alerts are posted. |
| `STAFF_ROLE_ID` | empty | Role(s), comma-separated, additionally allowed to run the three alert commands. |
| `FIVEM_JOIN_CODE` | `zjjp6m4,dggpkvq` | The `cfx.re/join/<code>`(s) for the server being watched; first one is shown as the connect command. |
| `CHECK_INTERVAL_MS` | `60000` | How often the server is polled. |
| `FAILURE_THRESHOLD` | `2` | Consecutive failed checks before the card flips to offline. |
| `RECOVERY_THRESHOLD` | `1` | Consecutive successful checks before the card flips to online. |
| `CARD_UPDATE_INTERVAL_MS` | `60000` | How often the live status card is refreshed. |
| `RESTART_WEBHOOK_PORT` | unset (disabled) | Port for the optional txAdmin relay endpoint. |
| `RESTART_WEBHOOK_HOST` | `127.0.0.1` | Interface the relay endpoint binds. Only widen if the game server is on a different host. |
| `RESTART_WEBHOOK_SECRET` | empty | Shared secret the relay resource authenticates with. Required for the endpoint to start. |

## Notes

- **Stateless.** Everything (debounce counters, the card's message id, the
  relay's countdown) is in-memory; nothing is written to disk. A bot
  restart re-establishes its baseline on the next poll and re-adopts the
  existing card message rather than duplicating it (see [The live status
  card](#the-live-status-card)).
- **`@everyone` is deliberate here**, per the brief — unlike some of the
  other Enclave bots, which avoid it because ticket creation is
  member-triggered. Since it's manual-only now, every ping is a staff
  member's explicit decision, which is exactly what `@everyone` exists for.
- **Runs alongside other Enclave bots.** `GUILD_ID` scopes interaction
  handling to the one guild, the same convention `enclave-tickets-bot` uses,
  so this token never needs to be the only bot in the server.
- **The relay endpoint is unauthenticated-off by design.** If
  `RESTART_WEBHOOK_SECRET` isn't set, `restartWebhook.start()` refuses to
  bind the port at all rather than listening without auth.

## Scripts

| Script | |
| --- | --- |
| `npm start` | Run the bot |
| `npm run deploy` | Register slash commands |
| `npm run check` | Syntax-check every source file |

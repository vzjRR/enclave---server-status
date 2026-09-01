# txadmin_restart_relay

FiveM server-side resource that listens for txAdmin's own
`txAdmin:events:scheduledRestart` / `txAdmin:events:scheduledRestartSkipped`
events and relays them, over a shared-secret-authenticated HTTP POST, to the
Server Status Discord bot's relay endpoint (`../../src/restartWebhook.js`)
— which uses them to keep the bot's live status card's **NEXT RESTART**
field accurate. It does not post anything to Discord by itself; the
`@everyone` alerts are manual, staff-triggered commands (`/server-down`,
`/server-up`, `/scheduled-restart`).

## Install

1. Copy this folder into your server's `resources/` directory.
2. Edit `config.lua`'s `Config.RelayUrl` if the bot isn't reachable at
   `127.0.0.1:8787` (same box as the bot, the default `RESTART_WEBHOOK_PORT`).
3. Add to `server.cfg` (**not** to `config.lua` — see the comment above
   `Config.SharedSecret` for why):
   ```
   ensure txadmin_restart_relay
   set txadmin_restart_relay_secret CHANGE_ME
   ```
   The same value goes in the bot's `.env` as `RESTART_WEBHOOK_SECRET`.
4. Restart the server (or `refresh` + `ensure txadmin_restart_relay`).

That's it — no configuration on the txAdmin side. txAdmin's restart
scheduler (Settings → General → Scheduled Restarts) already fires the
events this resource listens for; nothing about how you configure restart
times needs to change.

## What this actually does

Every `scheduledRestart` fire updates an in-memory countdown; the status
card reads it on its own refresh and shows "in X hrs, Y mins" instead of
"Not scheduled" once a restart is imminent. A `scheduledRestartSkipped`
event (an admin cancels the restart from the txAdmin panel) clears that
countdown back to "Not scheduled." Nothing here posts a message, pings
anyone, or touches the manual alert commands — it only ever changes what
one field on the card shows.

## Notes

- The shared secret is a plain header compare, not HMAC-signed like
  `enclave_stats`'s calls to the ServerStats backend. That resource moves
  moderation actions (bans, kicks); this one only forwards a restart
  countdown, so the lighter scheme is a deliberate scope call, not an
  oversight — worst case of a replayed/spoofed request here is a spurious
  restart notice, not an unauthorized action.
- If the relay endpoint (`RESTART_WEBHOOK_PORT`) isn't configured in the
  bot's `.env`, this resource still runs fine — every relay attempt just
  logs a failed-request warning to the server console and nothing else
  happens. `/scheduled-restart` in Discord keeps working either way.

# Handover — Enclave RP Discord Server Status Bot

This document is written for a new AI coding assistant (or human developer) picking up
this project with **zero prior context**. It covers architecture, every module, the two
production deployments this bot integrates with, every hard-won operational lesson from
building and debugging it, and everything currently left open. Read it fully before
touching code or the servers.

The previous work on this project was done with Claude Code. The project owner has asked
to move off Claude Code going forward — this file is the complete transfer of context.

---

## 1. What this project is

A Discord bot (`enclave-server-status`, Discord application id `1543975525448683580`) that
watches an **Enclave RP** FiveM (GTA V roleplay) game server and:

- Maintains a single, persistent, auto-refreshing Discord embed ("the card") showing live
  status: online/offline, player count, F8 connect code, next scheduled restart countdown,
  and current uptime.
- Lets staff manually post `@everyone` alert messages (server down, server back up,
  scheduled restart warning) via slash commands — **not automatic**, by explicit design
  (see §4.3, this was a deliberate redesign partway through the project).
- Exposes a small internal HTTP webhook so a custom FiveM/txAdmin-side Lua resource can
  push live restart-countdown and heartbeat/uptime data into the bot in near-real-time.

A sibling repository, `vzjrr/enclave-home` (the project's public website,
`enclaverp.cc`), was extended in parallel to show the same "next restart" countdown on
the website's live server board, reusing the exact same schedule computation and env var
names so the two stay in sync. See §7.

---

## 2. Runtime architecture

```
┌─────────────────────┐        polls dynamic.json / listing API
│  fivem.js            │◄────────────────────────────────────────┐
└──────────┬───────────┘                                          │
           │                                                       │
┌──────────▼───────────┐   optional, richer source    ┌───────────┴─────────┐
│  statusWatcher.js     │◄──────────────────────────────│  txadmin.js          │
│  (debounced online/   │   GET /host/status             │  (official txAdmin   │
│   offline state)      │                                 │   REST API poll)     │
└──────────┬───────────┘                                 └──────────────────────┘
           │
           │ getState()
           │
┌──────────▼───────────┐        ┌────────────────────────┐   POST /webhook/*
│  statusCard.js        │        │  restartWebhook.js       │◄──────────────────┐
│  (persistent embed,   │        │  (HTTP server, shared-   │                    │
│   refresh every 60s)  │        │   secret auth)           │                    │
└───────────┬───────────┘        └───────────┬──────────────┘                    │
            │                                  │ getNextRestartSeconds()          │
            │                                  │ getServerUptimeSeconds()         │
            ▼                                  ▼                                  │
       Discord embed                    consumed by statusCard.js         FiveM Lua resource
                                                                          txadmin_restart_relay
                                                                          (on the game server,
                                                                           listens to txAdmin's
                                                                           internal restart events
                                                                           + sends a heartbeat)
```

Two **independent, optional** integrations feed richer data into the bot. Either, both, or
neither can be configured — everything degrades gracefully to the base FiveM poll when
unconfigured or unreachable:

1. **txAdmin's official `/host/status` REST API** (`src/txadmin.js`) — direct HTTP GET
   against txAdmin's built-in port (40120 by default), authenticated with a per-server
   env token (`TXHOST_API_TOKEN`, set on the FXServer/txAdmin process itself, not this
   bot). Gives live player count/slots/status/join-code straight from txAdmin.

2. **A custom FiveM Lua resource, `txadmin_restart_relay`** (`fivem/txadmin_restart_relay/`)
   — installed as a normal FXServer resource on the game server. It listens for txAdmin's
   *internal* Lua events (`txAdmin:events:scheduledRestart`,
   `txAdmin:events:scheduledRestartSkipped`) and relays them, plus a periodic heartbeat,
   via authenticated HTTP POST to this bot's `restartWebhook.js`. This is what actually
   powers the live "next restart" countdown and uptime shown on the card — txAdmin's own
   `/host/status` API does not expose a restart countdown.

Slash commands are pure manual actions, gated by a staff check (`src/commands/authorize.js`):
Manage Guild permission OR membership in one of the roles listed in `STAFF_ROLE_IDS`.

---

## 3. Module-by-module reference (`src/`)

- **`index.js`** — Bootstraps the Discord client, registers the 4 slash command handlers,
  and on `ClientReady`: starts `restartWebhook` (doesn't need the Discord client), awaits
  `statusWatcher.start()`, then starts `statusCard.start(client)`.

- **`config.js`** — All environment variable parsing lives here; nothing else reads
  `process.env` directly except `restartSchedule`-equivalent logic embedded in
  `restartWebhook.js`. Key exports: `token`, `clientId`, `guildId`, `statusChannelId`,
  `staffRoleIds`, `fivemJoinCodes` (comma-separated, tried in parallel), `checkIntervalMs`,
  `failureThreshold`, `recoveryThreshold`, `cardUpdateIntervalMs`,
  `restartWebhookHost/Port/Secret`, `txAdminUrl`, `txAdminApiToken`,
  `restartScheduleTimes`, `restartScheduleUtcOffsetMinutes` (default `240`, i.e. UTC+4 /
  Oman time — matches the game server's real-world timezone).

- **`fivem.js`** — `checkStatus(joinCodes)`. For each configured join code (in parallel),
  resolves the current server address via `cfx.re/join/<code>` (following the
  `x-citizenfx-url` header), then polls that address's `/dynamic.json` directly; falls
  back to the public Cfx.re server-listing API if the direct poll fails. Returns whichever
  join code answers "online" first. **Never throws** — always resolves to a status object
  or an offline/unknown one.

- **`txadmin.js`** — `getHostStatus(baseUrl, token)`. See §2.1. **Contains the most
  recently fixed bug** — full detail in §6.6. Returns `null` (meaning "no opinion, fall
  back to the ordinary poll") whenever unconfigured, unreachable, or the response isn't a
  genuine status payload.

- **`statusWatcher.js`** — Polls `fivem.checkStatus()` (and, if configured,
  `txadmin.getHostStatus()`) on a timer via an internal `tick()`. Tracks debounced
  online/offline state using `FAILURE_THRESHOLD`/`RECOVERY_THRESHOLD` consecutive-poll
  counts (avoids flapping the card on a single dropped poll). Exposes `getState()` for
  `statusCard.js` to read. **When `hostStatus` (from txAdmin) is non-null, its `.online`
  value wins over the ordinary poll's `.online` value** — this priority is exactly what
  made the §6.6 bug user-visible (a wrong `hostStatus` overrode a correct poll). Also
  exposes `postStatusMessage()`, used only by the 3 manual alert slash commands (not by
  automatic polling — alerts are manual-only by design, see §4.3) — sends a new alert
  and deletes the previous alert of the same kind, so the channel doesn't fill up with
  stale pings.

- **`restartWebhook.js`** — Opt-in HTTP server (only starts if `RESTART_WEBHOOK_PORT` is
  set; refuses to start without `RESTART_WEBHOOK_SECRET` configured — never starts an
  unauthenticated listener). Routes:
  - `POST /webhook/restart-scheduled` — relay reports txAdmin scheduled a restart with
    N seconds remaining.
  - `POST /webhook/restart-skipped` — relay reports a scheduled restart was skipped/reset.
  - `POST /webhook/heartbeat` — periodic liveness ping from the relay resource, also used
    to derive uptime (see below).

  Auth: shared-secret via `X-Relay-Secret` header, compared with
  `crypto.timingSafeEqual` (not `===`, to avoid timing side-channels).

  `getNextRestartSeconds()` — prefers a **live, fresh** txAdmin countdown event received
  via the webhook; falls back to `computeScheduledRestartSeconds(restartScheduleTimes,
  restartScheduleUtcOffsetMinutes)`, which deterministically computes seconds until the
  next daily `HH:MM` occurrence in the configured UTC offset. Once
  `RESTART_SCHEDULE_TIMES` is set, this **always** returns a value, live event or not —
  that's what makes the card show a real countdown even before/without the Lua relay
  being installed.

  `getServerUptimeSeconds()` — derived from the relay's periodic heartbeat: the relay
  resource records its own `os.time()` once, when the resource itself loads. Because a
  FiveM resource is reloaded exactly when FXServer restarts, "time since resource load"
  == "time since FXServer restart" == server uptime. No direct OS-level uptime query is
  involved.

- **`statusCard.js`** — The persistent card. Refreshes every `CARD_UPDATE_INTERVAL_MS`
  (default 60000ms / 60s). On boot, scans recent messages in the status channel for a
  footer marker (`CARD_MARKER = 'Enclave RP | Server Status'`) to **adopt** an existing
  card instead of posting a duplicate on every bot restart; if none found, posts a new
  one with `assets/enclave-banner.png` attached as the embed image. Exports `refresh()`
  directly (used by the test suite to avoid the fire-and-forget race in `start()`).

- **`embeds.js`** — Builds all Discord embeds/messages:
  - `serverDown()`, `serverUp()`, `scheduledRestart({minutes})` — return the **exact**
    Arabic message templates the project owner specified verbatim (see git history /
    `src/embeds.js` for the literal text — do not paraphrase or "improve" the wording
    without asking; these are final, owner-approved copy). Each is wrapped with
    `content: '@everyone'` and `allowedMentions: { parse: ['everyone'] }`.
  - `statusCard({online, players, maxPlayers, connectCode, nextRestartSeconds,
    uptimeSeconds})` — builds the live card embed. Field values (STATUS, PLAYERS, F8
    CONNECT COMMAND, NEXT RESTART, UPTIME) are wrapped in `codeChip()`, which renders as
    inline-code backticks in Discord, to match the "chip" look from the reference
    screenshot the owner provided.

- **`commands/authorize.js`** — `isStaff(interaction)`: Manage Guild permission OR a role
  ID present in `config.staffRoleIds`. Shared by all 3 manual alert commands.

- **`commands/scheduledRestart.js`** — `/scheduled-restart minutes:<1-180>`, staff-only,
  posts the Arabic restart-warning template with the minute count filled in.

- **`commands/serverDown.js`** / **`commands/serverUp.js`** — `/server-down`,
  `/server-up`, staff-only, post the respective Arabic templates.

- **`commands/status.js`** — `/status`, open to everyone, on-demand non-pinging status
  check (ephemeral or plain reply — check the file for current visibility).

- **`deploy-commands.js`** — One-shot script, registers the 4 slash commands with
  Discord's REST API for the configured guild. Run manually after adding/changing any
  command definition; slash command registration is not automatic on bot boot.

### `fivem/txadmin_restart_relay/` (Lua, deployed on the *game server*, not this bot)

- `fxmanifest.lua` — FiveM resource manifest.
- `config.lua` — `Config.RelayUrl` (this bot's webhook base URL), `Config.SharedSecret`
  (read from convar `txadmin_restart_relay_secret` — must match
  `RESTART_WEBHOOK_SECRET` on the bot), `Config.HeartbeatIntervalMs = 5 * 60000`.
- `server/main.lua` — Subscribes to txAdmin's internal restart events, posts them to the
  bot via `PerformHttpRequest`; runs a heartbeat thread on the configured interval.
- `README.md` — Installation instructions for the game server operator.

### Other repo-root items

- `assets/enclave-banner.png` — Enclave RP logo, 1600×900, used as the card embed image.
- `deploy/enclave-server-status.service`, `deploy/README.md` — systemd unit + setup docs
  for running this bot as a service.
- `.env.example` — Documents every config var (placeholders only — **this repo is
  public; never commit real secrets**). Includes `FIVEM_JOIN_CODE=dggpkvq`,
  `RESTART_SCHEDULE_TIMES=06:00,18:00`, `RESTART_SCHEDULE_UTC_OFFSET_MINUTES=240`,
  `TXADMIN_URL`, `TXADMIN_API_TOKEN`, `RESTART_WEBHOOK_*`.
- `README.md` — User-facing project documentation, kept in sync with every architectural
  change; treat it as the second source of truth alongside this file.

---

## 4. Design history / decisions worth knowing

1. **Bilingual → Arabic-only pivot.** The alert message templates were originally
   drafted bilingually, then the owner supplied exact final Arabic-only wording for all
   three alert types. Do not translate them back or alter wording without explicit
   instruction — treat the current `embeds.js` text as frozen copy.

2. **Visual redesign to match a reference screenshot.** The owner shared a screenshot of
   a different community's txAdmin-native status card and asked for this bot's card to
   match that look (including the Enclave RP logo as the embed image and inline-code
   "chip" styling for field values) — that's why `codeChip()` and
   `assets/enclave-banner.png` exist.

3. **Alerts became manual-only.** Originally the plan was for `@everyone` alerts to fire
   automatically on every state transition. The owner explicitly changed this mid-project:
   *"the current @everyone ping is now manual only, no more auto update"* — automatic
   polling only drives the quiet, no-ping status card; pinging alerts are strictly staff
   slash commands now. Do not wire automatic pinging back in without being asked.

4. **Restart schedule feature.** Added after the owner reported the real server's daily
   6am/6pm restarts weren't reflected anywhere in the bot, despite `txadmin_restart_relay`
   already existing. Two complementary sources feed the countdown: a live txAdmin event
   (immediate, exact) and a static daily-schedule fallback (`RESTART_SCHEDULE_TIMES`,
   always available once configured, even before/without the relay resource being
   installed or the FXServer having emitted an event yet).

---

## 5. Production deployment topology

Both services run on the same Oracle Cloud Infrastructure (OCI) box (referred to in
shell prompts as `enrp`). There are **7 systemd services total** on that box (confirmed
via `systemctl list-units`); the two relevant to this project:

### 5.1 This bot — `enclave-server-status`

- Path: `/opt/enclave-server-status` (owned by a dedicated `discordbots` system user).
- Service: `enclave-server-status.service`.
- Config: a real `.env` file directly in that directory (not templated elsewhere).
- Deploy loop: `git pull` in that directory, then `systemctl restart
  enclave-server-status.service`. There is no CI/CD — deploys are manual on the box.

### 5.2 The website — `enclave-home`

- **Gotcha:** `/opt/enclave-home` itself is **not** a git repository — it's just a parent
  folder. The actual checkout is one level down, at **`/opt/enclave-home/app`**. (Earlier
  in this project a stray `.git` was accidentally created at the outer `/opt/enclave-home`
  level and had to be removed with `rm -rf /opt/enclave-home/.git` before working
  correctly inside `app/`. If you ever see git behaving strangely at the outer path,
  check for this again.)
- Service: `enclave-home.service`.
- **Gotcha:** config is **not** a `.env` file inside `app/`. It's loaded via
  `EnvironmentFile=/etc/enclave-home.env` in the systemd unit itself. Confirm with
  `sudo systemctl cat enclave-home.service` before assuming `.env` conventions apply.
- The `enclave-home` repo's branch `claude/next-restart-countdown` (adds the "Next
  Restart" row to the website, see §7) was merged directly into this production checkout
  via `git merge`, but as of the end of the previous session **it had NOT been merged
  into `main` on GitHub** — it's still sitting as an unmerged branch on the
  `vzjrr/enclave-home` repo. Someone should either open/merge a PR for it or explicitly
  decide to leave production ahead of `main` (not recommended long-term).

### 5.3 The game server (separate machine, **Windows**, not the OCI box)

Runs FXServer.exe directly (confirmed via `Get-CimInstance` — no wrapper batch file, no
Windows service; it's launched some other way, e.g. manually or via a scheduled task not
yet identified). This is where txAdmin itself runs (port 40120) and where
`txadmin_restart_relay` must be installed as a FiveM resource. All PowerShell operations
against this box use `Invoke-WebRequest`/`ConvertTo-Json`, not `curl.exe` — see §6.3.

---

## 6. Hard-won operational lessons (read before debugging anything similar)

1. **OCI has (at least) two independent firewall layers, both must be opened.**
   - The **Security List** (cloud-level, subnet-scoped) — check via the OCI console,
     confirm which subnet the actual VNIC is on before editing rules (there can be more
     than one Security List; editing the wrong one does nothing).
   - Raw **`iptables`** (OS-level) — the box has a default-REJECT `INPUT` policy with
     explicit ACCEPT rules only for ports 22/80/443. This is **invisible to `ufw` and
     `firewalld`** (neither is installed/active) — you must inspect `iptables -L -n`
     directly. Fix pattern: `sudo iptables -I INPUT -p tcp --dport <PORT> -j ACCEPT`
     then `netfilter-persistent save` (or the rules won't survive reboot).
   - Port 8787 (an earlier webhook port) was blocked by **both** layers simultaneously;
     fixing only one still produced a timeout, which is misleading if you stop after the
     first fix.

2. **My own sandbox (whatever assistant/agent environment you're running in) may not be
   able to make arbitrary plain-HTTP connections at all.** During this project, repeated
   "connection timed out" results from the agent's own `curl` against the bot's public
   IP were initially treated as proof of a broken firewall — but the agent's sandbox
   turned out to likely only support HTTPS through a specific pre-configured proxy, not
   arbitrary plain HTTP to arbitrary hosts/ports. **Always verify "unreachable" findings
   by having the actual server operator test from a real, unconstrained network** (e.g.
   from the Windows game server itself) before spending more time on firewall changes.
   If you're Codex running in a similarly sandboxed/proxied environment, assume the same
   trap applies to you and sanity-check early.

3. **PowerShell + `curl.exe` quoting corrupts JSON bodies.** `curl.exe -d
   '{"secondsRemaining": 900}'` run from PowerShell gets its quotes mangled by
   PowerShell's own parser before `curl.exe` ever sees them (visible as a stray `>>`
   continuation prompt appearing in the terminal — a sure sign the quoting broke).
   This produces invalid JSON that the receiving server correctly 400s. **Always use
   native PowerShell HTTP** on Windows instead:
   ```powershell
   Invoke-WebRequest -Uri $url -Method Post -Headers @{ 'X-Relay-Secret' = $secret } `
     -Body (@{ secondsRemaining = 900 } | ConvertTo-Json) -ContentType 'application/json'
   ```

4. **Windows environment variables set via `setx ... /M` do not activate for
   already-running processes, nor for children spawned by an already-running launcher.**
   `TXHOST_API_TOKEN` was set this way but `/host/status` kept returning `{"error":"token
   not configured"}` even after a scheduled 6am in-game restart passed. Root cause:
   scheduled txAdmin restarts likely only recycle the internal game-server child process,
   not the top-level `FXServer.exe` launcher process that actually reads the OS
   environment at startup. **A full close-and-relaunch of `FXServer.exe` itself is
   required**, not just an in-game/txAdmin-triggered restart. **This is still unresolved
   as of this handover** — see §8.

5. **Diffing a feature branch against a local `main` ref can lie if that local ref is
   stale.** `git diff main --stat` on the production `enclave-home` checkout showed 16
   changed files, appearing to *revert* unrelated features (like a position map) that
   the feature branch never touched. Root cause: the **local** `main` branch ref on that
   box was one PR behind the real `origin/main`. Always `git fetch origin <base-branch>`
   and diff against `origin/<base-branch>` explicitly before trusting a diff — the
   correct diff was only 6 files. **Never merge a branch onto a server based on a diff
   against a possibly-stale local ref.**

6. **The most recent bug fix — txAdmin's error envelope masquerading as a valid
   response (commit `c95fef7`).** Symptom reported by the owner: *"card showing the
   server is offline in discord but in website is on and in fivem is online."*

   Root cause, in `src/txadmin.js`'s `getHostStatus()`: the function only checked
   `response.ok` (i.e. HTTP 2xx) before trusting the JSON body. But txAdmin's own
   authentication failures (bad or missing token, or the host-status endpoint not
   enabled) come back as **HTTP 200 OK** with a body like
   `{"error":"token not configured","desc":"...","docs":"..."}` — confirmed directly via
   `curl -i` against the real endpoint. Since `response.ok` was `true`, the old code
   proceeded to read `data.status`, which was `undefined`, and evaluated
   `undefined === 'ONLINE'` as `false` — producing a fully-formed-looking `{online:
   false, players: 0, ...}` object. Because `statusWatcher.js` prioritizes txAdmin's
   reading over the ordinary FiveM poll whenever it's non-null (§3, `statusWatcher.js`),
   this **incorrect "offline" reading silently overrode the correct "online" reading**
   from the direct poll — exactly matching the symptom (website + game server correct,
   Discord card wrong).

   Fix: added an explicit guard before trusting the body —
   ```js
   if (typeof data.error === 'string' || typeof data.status !== 'string') return null;
   ```
   Returning `null` here means "no opinion" and correctly falls back to the ordinary
   poll's (correct) reading. Verified via two isolated Node scripts (error-body → `null`;
   valid body → correctly parsed object) before committing. This is the current
   `src/txadmin.js` on disk/in git — no further code change needed here, but **deployment
   was not yet confirmed** — see §8.

---

## 7. Companion change in `enclave-home` (separate repo)

Repo: `vzjrr/enclave-home`, branch `claude/next-restart-countdown` (pushed to GitHub, not
yet merged to `main` on GitHub, but merged directly into the production checkout at
`/opt/enclave-home/app`). Adds a "Next Restart" countdown to the public website's live
server board, reusing the exact same computation and env var names as this bot so the two
displays never disagree:

- **`lib/restartSchedule.js`** (new) — `getNext()` reads `RESTART_SCHEDULE_TIMES` /
  `RESTART_SCHEDULE_UTC_OFFSET_MINUTES` from `process.env` on every call (not cached, so
  it always reflects the current schedule); `getNextRestartSeconds(times,
  utcOffsetMinutes)` is the pure computation, algorithmically identical to this bot's own
  restart-schedule fallback in `restartWebhook.js`.
- **`server.js`** — `/api/server` now includes `nextRestartSeconds:
  restartSchedule.getNext()`.
- **`index.html`** — new `#serverNextRestartRow` (`hidden` by default) inside
  `.board-meta`, Arabic label "إعادة التشغيل القادمة".
- **`js/home.js`** — `formatDuration(totalSeconds)` (Arabic "بعد X ساعة و Y دقيقة"
  phrasing) and logic in `paintServer()` to show/hide the row based on
  `stats.nextRestartSeconds`.
- **`.env.example`** — documents the two new vars (same names/defaults as this bot).
- **`test/smoke.js`** — asserts `nextRestartSeconds` is positive and ≤ 12h; suite went
  from 129 → 131 passing tests.

**Open item:** get this branch merged into `enclave-home`'s `main` on GitHub (it's real,
tested, and already running in production — just not reflected on `main`).

---

## 8. Currently open items (do these first)

1. **Confirm the txAdmin-fix deploy actually happened.** `c95fef7` (§6.6) was pushed to
   this repo but, as of the end of the previous session, the owner had not confirmed
   running `git pull && sudo systemctl restart enclave-server-status.service` on
   `/opt/enclave-server-status`. Verify the card is showing correct status; if not,
   deploy this fix first — it's the single most impactful open item.

2. **`TXHOST_API_TOKEN` still hasn't activated on the Windows game server.** Needs a full
   close-and-relaunch of `FXServer.exe` (not just an in-game/txAdmin restart) per §6.4.
   Until then, `/host/status` keeps returning the auth-error body, `getHostStatus()`
   correctly returns `null` (post-fix), and the bot gracefully uses the ordinary
   dynamic.json poll instead — this is expected, not broken, but the richer txAdmin data
   source won't be live until someone restarts the actual process.

3. **Merge `enclave-home`'s `claude/next-restart-countdown` branch into `main` on
   GitHub.** It's live in production already; get the repo's `main` branch caught up.

4. **This branch (`claude/discord-server-status-bot-8lv0p9`) has never been merged to a
   `main`/default branch on `vzjrr/enclave---server-status` either** — there is no
   `main` branch visible in this local checkout at all. Confirm with the owner whether a
   `main` branch exists on GitHub and, if so, get this branch merged in (or ask whether
   this branch itself should simply become the default).

---

## 9. Configuration reference (names only — never commit real values)

See `.env.example` in this repo for the authoritative, currently-documented list. As of
this handover it includes: Discord bot token/client id/guild id, `STATUS_CHANNEL_ID`,
`STAFF_ROLE_IDS`, `FIVEM_JOIN_CODE(S)` (e.g. `dggpkvq`, and previously also `zjjp6m4` —
confirm current values are all still valid join codes with the owner), poll/threshold
intervals, `CARD_UPDATE_INTERVAL_MS`, `RESTART_WEBHOOK_HOST/PORT/SECRET`, `TXADMIN_URL`,
`TXADMIN_API_TOKEN`, `RESTART_SCHEDULE_TIMES`, `RESTART_SCHEDULE_UTC_OFFSET_MINUTES`.

**This repository is public.** Never commit a populated `.env`, a real Discord token, or
a real shared secret in any commit, PR description, or code comment. Always use
placeholders in examples.

---

## 10. Suggested first steps for whoever picks this up

1. Read this file fully, then skim `README.md` for the user-facing framing.
2. Check item 1 in §8 (confirm the txAdmin fix is actually deployed) — that's the
   currently-known production-facing bug, already fixed in code but possibly not live.
3. Ask the project owner directly about item 4 in §8 (does a `main` branch exist on
   GitHub for this repo, and if not, should this branch become it).
4. Don't re-litigate the manual-only-alerts decision (§4.3) or the Arabic message
   wording (§4.1) without being asked — both were explicit, deliberate owner decisions.

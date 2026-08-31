# Deploying to a Linux server

These steps assume the box already runs other Enclave bots, so everything is
scoped to its own directory, user and systemd unit and touches nothing else —
same pattern as `enclave-tickets-bot`.

## 1. Install

```bash
sudo useradd -r -s /usr/sbin/nologin discordbots 2>/dev/null || true

sudo mkdir -p /opt/enclave-server-status
sudo chown "$USER":"$USER" /opt/enclave-server-status
git clone https://github.com/vzjRR/enclave---server-status.git /opt/enclave-server-status
cd /opt/enclave-server-status
npm ci --omit=dev
```

Node 18 or newer is required (`node -v`).

## 2. Configure

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Fill in `DISCORD_TOKEN` for the bot (application id `1543975525448683580`).
`CLIENT_ID`, `GUILD_ID`, `STATUS_CHANNEL_ID` and `FIVEM_JOIN_CODE` are already
pre-filled for Enclave RP — only override them if something moved.

`.env` holds the bot token. `chmod 600` matters: anyone who can read it
controls the bot.

Set `STAFF_ROLE_ID` (comma-separated for more than one) if staff who run
`/scheduled-restart` do not already have the **Manage Server** permission.

## 3. Bot permissions

Invite the bot with, at minimum, **View Channel**, **Send Messages**,
**Embed Links** and **Mention Everyone** on the status channel — the last one
is required or the `@everyone` in every alert silently fails to notify
anyone. It never needs `Administrator`.

```
https://discord.com/oauth2/authorize?client_id=1543975525448683580&permissions=150528&scope=bot+applications.commands
```

## 4. Register the slash commands

Once, and again whenever the commands change:

```bash
npm run deploy
```

Leaving `GUILD_ID` empty registers globally, which works but can take up to
an hour to appear. With it set (the default), registration is instant for
that one guild.

## 5. Run it under systemd

```bash
sudo cp deploy/enclave-server-status.service /etc/systemd/system/
sudo chown -R discordbots:discordbots /opt/enclave-server-status

sudo systemctl daemon-reload
sudo systemctl enable --now enclave-server-status
```

Check it came up:

```bash
systemctl status enclave-server-status
journalctl -u enclave-server-status -f
```

You are looking for:

```
Logged in as <bot tag>
[status] baseline: server is online
```

The very first check only establishes the baseline silently — it never
announces "back online" just because the bot itself started polling.

## Operating it

| | |
| --- | --- |
| Logs | `journalctl -u enclave-server-status -f` |
| Restart | `sudo systemctl restart enclave-server-status` |
| Stop | `sudo systemctl stop enclave-server-status` |

A restart only loses in-memory state: the up/down debounce counters and the
current `/scheduled-restart` grace window. Both rebuild within a couple of
checks; nothing is written to disk.

### Updating

```bash
cd /opt/enclave-server-status
sudo -u discordbots git pull
sudo npm ci --omit=dev
sudo chown -R discordbots:discordbots /opt/enclave-server-status
sudo chmod 600 .env
sudo systemctl restart enclave-server-status
```

The checkout is owned by the service user, so git run as anyone else refuses
it as "dubious ownership" — either pull as that user, as above, or allow it
once with `sudo git config --system --add safe.directory /opt/enclave-server-status`.

### If the box runs other bots under their own users

The unit ships with `User=discordbots`. Where the convention is one user per
bot:

```bash
sudo useradd -r -s /usr/sbin/nologin enclave-server-status
sudo sed -i 's/^User=discordbots/User=enclave-server-status/;s/^Group=discordbots/Group=enclave-server-status/' \
  /etc/systemd/system/enclave-server-status.service
```

The unit restarts the bot automatically if it exits, capped at 10 restarts in
5 minutes so a genuinely broken build does not spin forever.

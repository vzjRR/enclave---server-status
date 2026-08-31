Config = {}

-- Where the Server Status bot's relay endpoint is reachable from this game
-- server. No trailing slash. If the bot runs on the same box, this is
-- 127.0.0.1 plus RESTART_WEBHOOK_PORT from its .env (default 8787);
-- otherwise point this at wherever it is reachable (put a reverse proxy
-- with TLS in front for anything other than a loopback/private link).
Config.RelayUrl = 'http://127.0.0.1:8787'

-- Must match RESTART_WEBHOOK_SECRET in the bot's .env exactly. Deliberately
-- NOT a literal here, same reason enclave_stats's SharedSecret isn't:
-- config.lua is tracked in this repo, and a secret pasted into it gets
-- committed the moment anyone pushes a config change. Read from a server
-- convar instead, set in server.cfg (a file that is never committed):
--
--   set txadmin_restart_relay_secret CHANGE_ME
--
-- Generate a value with:
--   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
Config.SharedSecret = GetConvar('txadmin_restart_relay_secret', 'CHANGE_ME')

if Config.SharedSecret == 'CHANGE_ME' then
    print('^1[txadmin_restart_relay] txadmin_restart_relay_secret is not set in server.cfg — every relay request will be rejected (401) until it is.^7')
end

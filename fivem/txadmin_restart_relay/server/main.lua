--[[
    Feeds two fields on the Server Status bot's live status card:

    1. NEXT RESTART -- listens for txAdmin's own scheduled-restart events
       and relays them. txAdmin:events:scheduledRestart fires repeatedly as
       a countdown (at 30/15/10/5/4/3/2/1 minutes before the restart);
       every fire is forwarded, and the bot extrapolates the live countdown
       from whichever one arrived last.
    2. UPTIME -- a heartbeat sent every few minutes carrying this
       resource's own start time. A resource reloads exactly when FXServer
       restarts (scheduled or not), so that timestamp is a reliable stand-in
       for real server uptime -- more accurate than the bot guessing from
       when it last observed the server respond.

    Fire-and-forget throughout: a failed relay (bot offline, wrong URL) is
    logged to the server console and otherwise ignored -- none of this
    affects the game server itself.
]]

local SERVER_STARTED_AT = os.time()

local function relay(path, bodyTable)
    PerformHttpRequest(Config.RelayUrl .. path, function(status, body, headers)
        if status == 0 or status >= 400 then
            print(('^1[txadmin_restart_relay] relay to %s failed (status %s)^7'):format(path, tostring(status)))
        end
    end, 'POST', json.encode(bodyTable or {}), {
        ['Content-Type'] = 'application/json',
        ['X-Relay-Secret'] = Config.SharedSecret
    })
end

AddEventHandler('txAdmin:events:scheduledRestart', function(payload)
    relay('/webhook/restart-scheduled', {
        secondsRemaining = payload and payload.secondsRemaining
    })
end)

AddEventHandler('txAdmin:events:scheduledRestartSkipped', function(payload)
    relay('/webhook/restart-skipped', {
        secondsRemaining = payload and payload.secondsRemaining,
        temporary = payload and payload.temporary,
        author = payload and payload.author
    })
end)

CreateThread(function()
    while true do
        relay('/webhook/heartbeat', { startedAt = SERVER_STARTED_AT })
        Wait(Config.HeartbeatIntervalMs)
    end
end)

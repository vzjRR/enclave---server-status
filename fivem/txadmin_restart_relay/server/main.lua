--[[
    Listens for txAdmin's own scheduled-restart events and relays them to
    the Server Status Discord bot, which turns them into a bilingual
    @everyone announcement in the status channel.

    txAdmin:events:scheduledRestart fires repeatedly as a countdown (at
    30/15/10/5/4/3/2/1 minutes before the restart) -- every fire is
    forwarded here; the bot decides which of those actually become a
    Discord message (RESTART_WEBHOOK_MILESTONES in its .env), so this
    resource does not need to know or duplicate that filtering logic.

    Fire-and-forget: a failed relay (bot offline, wrong URL) is logged to
    the server console and otherwise ignored -- it never affects the
    restart itself.
]]

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

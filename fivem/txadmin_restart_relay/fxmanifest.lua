fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'txadmin_restart_relay'
author 'Enclave RP'
description 'Relays txAdmin scheduled-restart events to the Server Status Discord bot.'
version '0.1.0'

server_scripts {
    'config.lua',
    'server/main.lua'
}

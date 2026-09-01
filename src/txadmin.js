'use strict';

/* ---------------------------------------------------------------
   Direct read from txAdmin's own official host-status API
   (GET /host/status, header x-txadmin-envtoken) — this is txAdmin's
   real internal tracking of the server: live player count, slot count,
   health, and the current join code, straight from the same process
   that manages FXServer. See the txAdmin resource's README for how to
   enable it on the game server side (TXHOST_API_TOKEN).

   Optional and additive: when unconfigured or unreachable this returns
   null and the bot falls back to the existing dynamic.json/listing poll
   (src/fivem.js) for online/players — nothing here is required to make
   the bot work.
--------------------------------------------------------------- */

const TIMEOUT_MS = 6000;

async function getHostStatus(baseUrl, token) {
  if (!baseUrl || !token) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/host/status`, {
      signal: controller.signal,
      headers: {
        'x-txadmin-envtoken': token,
        'User-Agent': 'EnclaveRP-ServerStatus/1.0'
      }
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      online: data.status === 'ONLINE',
      players: Number(data.playerCount) || 0,
      maxPlayers: Number(data.playerSlots) || 0,
      joinCode: typeof data.joinLink === 'string' ? data.joinLink.split('/').pop() : null,
      projectName: data.projectName || ''
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getHostStatus };

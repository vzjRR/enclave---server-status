'use strict';

/* ---------------------------------------------------------------
   Live FiveM server status, adapted from the same approach the
   enclaverp.cc homepage uses (enclave-home/lib/fivem.js):

   1. The server itself — /dynamic.json on the address the join code
      resolves to. Authoritative and real-time, but only reachable if the
      game port is open to wherever this bot runs.
   2. The Cfx.re listing API — servers-frontend.fivem.net. Plain HTTPS, so
      it survives a network that blocks the game port, but it only
      answers for a server currently listed in the public browser.

   The direct answer wins when both arrive; the listing is what keeps
   status accurate when the game port itself is not reachable from here.
   Nothing here throws — an unreachable server is an ordinary result to
   report, not an error for the caller to handle.
--------------------------------------------------------------- */

const TIMEOUT_MS = 6000;
const ADDRESS_TTL_FALLBACK_MS = 5 * 60 * 1000;

const JOIN_BASE = process.env.FIVEM_JOIN_BASE || 'https://cfx.re/join';
const LIST_BASE = process.env.FIVEM_LIST_BASE
  || 'https://servers-frontend.fivem.net/api/servers/single';

let addressCache = { url: null, expiresAt: 0 };

async function getJson(url, { headers } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EnclaveRP-ServerStatus/1.0', ...(headers || {}) }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a join code to the server's current base URL (cached per Cfx.re's own TTL). */
async function resolveAddress(joinCode) {
  if (addressCache.url && Date.now() < addressCache.expiresAt) {
    return addressCache.url;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${JOIN_BASE}/${encodeURIComponent(joinCode)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EnclaveRP-ServerStatus/1.0' }
    });
    const url = response.headers.get('x-citizenfx-url');
    if (!url) return null;

    const maxAge = Number(/max-age=(\d+)/.exec(
      response.headers.get('cache-control') || ''
    )?.[1]);
    const ttl = Number.isFinite(maxAge) && maxAge > 0
      ? maxAge * 1000
      : ADDRESS_TTL_FALLBACK_MS;

    addressCache = { url: url.replace(/\/+$/, ''), expiresAt: Date.now() + ttl };
    return addressCache.url;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function emptyStatus(reason) {
  return {
    online: false,
    reason,
    players: 0,
    maxPlayers: 0,
    hostname: '',
    source: null,
    checkedAt: new Date().toISOString()
  };
}

/** Poll the server's own endpoint. Returns null unless /dynamic.json answers. */
async function fetchDirect(baseUrl) {
  if (!baseUrl) return null;

  const dynamic = await getJson(`${baseUrl}/dynamic.json`);
  if (!dynamic) return null;

  return {
    online: true,
    reason: null,
    players: Number(dynamic.clients) || 0,
    maxPlayers: Number(dynamic.sv_maxclients ?? dynamic.svMaxclients) || 0,
    hostname: String(dynamic.hostname ?? ''),
    source: 'direct',
    checkedAt: new Date().toISOString()
  };
}

/** Ask the public Cfx.re listing. Returns null when the server is unlisted. */
async function fetchListing(joinCode) {
  const body = await getJson(`${LIST_BASE}/${encodeURIComponent(joinCode)}`);
  const data = body?.Data;
  if (!data) return null;

  return {
    online: true,
    reason: null,
    players: Number(data.clients) || 0,
    maxPlayers: Number(data.svMaxclients ?? data.sv_maxclients) || 0,
    hostname: String(data.hostname ?? ''),
    source: 'listing',
    checkedAt: new Date().toISOString()
  };
}

/** One status check. Not cached — the caller (the poll loop) controls cadence. */
async function checkStatus(joinCode) {
  if (!joinCode) return emptyStatus('not-configured');

  const address = await resolveAddress(joinCode);

  const [direct, listing] = await Promise.all([
    fetchDirect(address),
    fetchListing(joinCode)
  ]);

  const status = direct || listing;
  if (!status) {
    return emptyStatus(address ? 'unreachable' : 'unresolved');
  }
  return status;
}

module.exports = { checkStatus, resolveAddress };

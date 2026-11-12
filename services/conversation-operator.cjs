'use strict';
const { createConversationService, createConversationTransport } = require('./conversation.cjs');

const walletPattern = /^0x[0-9a-f]{40}$/i;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function list(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map(item => item.trim());
}

function parseOrigins(value) {
  const entries = list(value);
  if (entries.length > 16 || entries.some(entry => !entry)) throw Error();
  return [...new Set(entries.map(entry => {
    const url = new URL(entry);
    const local = url.protocol === 'http:' && localHosts.has(url.hostname);
    if ((!local && url.protocol !== 'https:') || url.origin !== entry || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw Error();
    return url.origin;
  }))];
}

function parseLimit(value, fallback, minimum = 1, maximum = 100) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) throw Error();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw Error();
  return number;
}

function createConversationOperator(env = process.env, loadSdk = () => require('livekit-server-sdk')) {
  let allowedOrigins = [], livekitOrigin = '';
  try {
    allowedOrigins = parseOrigins(env.DLANG_CONVERSATION_ORIGINS);
    const rawUrl = env.DLANG_LIVEKIT_URL || '';
    if (rawUrl) {
      const url = new URL(rawUrl);
      if (url.protocol !== 'wss:' || url.username || url.password || url.pathname !== '/' ||
          url.search || url.hash) throw Error();
      livekitOrigin = url.origin;
    }
    const configured = [env.DLANG_CONVERSATION_ORIGINS, env.DLANG_CONVERSATION_WALLETS,
      env.DLANG_LIVEKIT_URL, env.DLANG_LIVEKIT_API_KEY, env.DLANG_LIVEKIT_API_SECRET]
      .some(value => typeof value === 'string' && value.trim());
    if (!configured) return { service: null, allowedOrigins, livekitOrigin, configured: false, reason: 'not configured' };

    const wallets = list(env.DLANG_CONVERSATION_WALLETS);
    if (allowedOrigins.length === 0 || wallets.length < 2 || wallets.length > 100 ||
        wallets.some(wallet => !walletPattern.test(wallet)) ||
        new Set(wallets.map(wallet => wallet.toLowerCase())).size !== wallets.length ||
        !livekitOrigin || !env.DLANG_LIVEKIT_API_KEY || !env.DLANG_LIVEKIT_API_SECRET ||
        env.DLANG_LIVEKIT_API_KEY.length > 256 || env.DLANG_LIVEKIT_API_SECRET.length > 512 ||
        /\s/.test(env.DLANG_LIVEKIT_API_KEY) || /\s/.test(env.DLANG_LIVEKIT_API_SECRET)) {
      return { service: null, allowedOrigins, livekitOrigin, configured: false, reason: 'incomplete or invalid configuration' };
    }

    const maxRooms = parseLimit(env.DLANG_CONVERSATION_MAX_ROOMS, 1, 1, 100);
    const maxSessions = parseLimit(env.DLANG_CONVERSATION_MAX_SESSIONS, 2, 2, 100);
    const maxRoomsPerDay = parseLimit(env.DLANG_CONVERSATION_MAX_ROOMS_PER_DAY, 20, 1, 100);
    const transport = createConversationTransport({
      sdk: loadSdk(), url: livekitOrigin, apiKey: env.DLANG_LIVEKIT_API_KEY,
      apiSecret: env.DLANG_LIVEKIT_API_SECRET
    });
    const service = createConversationService({
      allowedOrigins, allowedWallets: wallets, maxRooms, maxSessions, maxRoomsPerDay, transport
    });
    return { service, allowedOrigins, livekitOrigin, configured: service.configured, reason: '' };
  } catch {
    return { service: null, allowedOrigins, livekitOrigin, configured: false, reason: 'invalid configuration or LiveKit SDK unavailable' };
  }
}

module.exports = { createConversationOperator };

'use strict';
const { createServer } = require('./index');
const { createConversationOperator } = require('./services/conversation-operator.cjs');
const { createWordService } = require('./services/community-words.cjs');
const { createVoiceRewardService } = require('./services/voice-rewards.cjs');
const { verifyVoiceFunding } = require('./services/voice-pool-verification.cjs');
const { JsonRpcProvider, FetchRequest } = require('ethers');
const fs = require('node:fs/promises');
function start({ env = process.env, logger = console } = {}) {
  const conversation = createConversationOperator(env);
  const rpc = url => { const request = new FetchRequest(url); request.timeout = 8000; return new JsonRpcProvider(request); };
  const ensProvider = rpc(env.DLANG_ENS_RPC || 'https://ethereum-rpc.publicnode.com');
  const baseProvider = env.DLANG_VOICE_FUNDING_MANIFEST ? rpc(env.DLANG_BASE_RPC || 'https://mainnet.base.org') : null;
  const wordService = env.DLANG_WORD_STORE && env.DLANG_WORD_ORIGIN
    ? createWordService({ storePath: env.DLANG_WORD_STORE, origin: env.DLANG_WORD_ORIGIN,
      roster: require('./public/dlang/pilot-roster.json'),
      ensProvider,
      reviewers: JSON.parse(env.DLANG_WORD_REVIEWERS || '[]') })
      .catch(error => { logger.warn(`DLang WORD service disabled: ${error.message}`); return null; })
    : null;
  const voiceRewardService = env.DLANG_VOICE_REWARD_STORE && env.DLANG_VOICE_FUNDING_MANIFEST && wordService
    ? Promise.resolve(wordService).then(async words => createVoiceRewardService({
      storePath: env.DLANG_VOICE_REWARD_STORE, origin: env.DLANG_WORD_ORIGIN, words, ensProvider,
      roster: require('./public/dlang/pilot-roster.json'),
      funding: JSON.parse(await fs.readFile(env.DLANG_VOICE_FUNDING_MANIFEST, 'utf8')),
      verifyFunding: funding => verifyVoiceFunding(baseProvider, funding)
    })).catch(error => { logger.warn(`DLang voice rewards disabled: ${error.message}`); return null; })
    : null;
  const server = createServer({
    wordService, voiceRewardService, wordOrigin: env.DLANG_WORD_ORIGIN,
    conversationService: conversation.service,
    conversationOrigins: conversation.allowedOrigins,
    conversationLivekitOrigin: conversation.livekitOrigin || undefined
  });
  if (!conversation.configured) logger.warn(`DLang private conversation disabled: ${conversation.reason}.`);
  server.once('close', () => { ensProvider.destroy(); baseProvider?.destroy(); void conversation.service?.close().catch(() => {}); });
  server.listen(Number(env.PORT || 8888), env.HOST || '127.0.0.1', () =>
    console.log(`DLang: http://127.0.0.1:${server.address().port}/`));
  return server;
}
module.exports = { start };
if (require.main === module) start();

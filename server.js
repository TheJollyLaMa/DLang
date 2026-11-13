'use strict';
const { createServer } = require('./index');
const { createConversationOperator } = require('./services/conversation-operator.cjs');
const { createWordService } = require('./services/community-words.cjs');
function start({ env = process.env, logger = console } = {}) {
  const conversation = createConversationOperator(env);
  const wordService = env.DLANG_WORD_STORE && env.DLANG_WORD_ORIGIN
    ? createWordService({ storePath: env.DLANG_WORD_STORE, origin: env.DLANG_WORD_ORIGIN,
      roster: require('./public/dlang/pilot-roster.json'),
      reviewers: JSON.parse(env.DLANG_WORD_REVIEWERS || '[]') })
      .catch(error => { logger.warn(`DLang WORD service disabled: ${error.message}`); return null; })
    : null;
  const server = createServer({
    wordService, wordOrigin: env.DLANG_WORD_ORIGIN,
    conversationService: conversation.service,
    conversationOrigins: conversation.allowedOrigins,
    conversationLivekitOrigin: conversation.livekitOrigin || undefined
  });
  if (!conversation.configured) logger.warn(`DLang private conversation disabled: ${conversation.reason}.`);
  server.once('close', () => { void conversation.service?.close().catch(() => {}); });
  server.listen(Number(env.PORT || 8888), env.HOST || '127.0.0.1', () =>
    console.log(`DLang: http://127.0.0.1:${server.address().port}/`));
  return server;
}
module.exports = { start };
if (require.main === module) start();

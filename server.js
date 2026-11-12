'use strict';
const { createServer } = require('./index');
const { createConversationOperator } = require('./services/conversation-operator.cjs');
function start({ env = process.env, logger = console } = {}) {
  const conversation = createConversationOperator(env);
  const server = createServer({
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

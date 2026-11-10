'use strict';
const { createServer } = require('./index');
function start() {
  const server = createServer();
  server.listen(Number(process.env.PORT || 8888), process.env.HOST || '127.0.0.1', () =>
    console.log(`DLang: http://127.0.0.1:${server.address().port}/`));
  return server;
}
module.exports = { start };
if (require.main === module) start();

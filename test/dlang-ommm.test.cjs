const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');

async function setup(t) {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 375, height: 900 } });
  const base = `http://127.0.0.1:${server.address().port}`, errors = [], external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dlang.html');
  await page.locator('#study-scene [data-target]').first().waitFor({ state: 'attached' });
  await page.locator('#history-open').click();
  await page.evaluate(async () => {
    const { mountOmmm, OMMM_ABI, BASE_USDC } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers();
    const root = document.querySelector('#ommm-profile');
    const address = '0x' + '1'.repeat(40), contract = '0x' + '2'.repeat(40), hash = '0x' + '3'.repeat(64);
    const iface = new ethers.Interface(OMMM_ABI);
    window.__reads = 0; window.__writes = 0; window.__simulations = 0; window.__block = 100;
    window.__balance = ethers.parseEther('1'); window.__received = [];
    window.__config = { chainId: 8453, funded: true, contract, asset: BASE_USDC, runtimeCodeHash: hash };
    const provider = {
      send: async () => '0x2105', getTransactionCount: async () => 0,
      getSigner: async () => ({ getAddress: async () => address }),
      getTransactionReceipt: async () => null
    };
    window.__wallet = { connected: false, address, chainId: '0x2105', provider };
    const redeem = async (units, minimum) => {
      window.__writes++;
      if (window.__reject) throw Object.assign(Error('Rejected'), { code: 'ACTION_REJECTED' });
      if (window.__ambiguous) throw Error('Wallet transport disconnected');
      const event = iface.encodeEventLog(iface.getEvent('Redeemed'), [address, units, minimum]);
      return { hash, wait: async confirmations => {
        window.__confirmations = confirmations;
        if (window.__holdReceipt) await new Promise(resolve => { window.__release = resolve; });
        window.__balance -= units;
        return { status: 1, logs: [{ address: contract, ...event }] };
      } };
    };
    redeem.staticCall = async () => { window.__simulations++; };
    const pool = {
      connect: () => pool, redeem, interface: iface,
      filters: { Transfer: () => 'received' }, queryFilter: async () => window.__received
    };
    window.__ui = mountOmmm({
      root, getWallet: () => window.__wallet,
      loadConfig: async () => window.__config,
      connect: async () => {
        window.__reads++;
        if (window.__readError) throw Error('RPC unavailable');
        if (window.__holdRead) await new Promise(resolve => { window.__resolveRead = resolve; });
        return { ethers, pool, provider, block: window.__block, balance: window.__balance,
          reserve: 440000n, supply: ethers.parseEther('4400') };
      }
    });
  });
  return { page, errors, external };
}
const selector = name => `[data-ommm="${name}"]`;
async function connect(page) {
  await page.evaluate(() => { window.__wallet.connected = true; });
  await page.click(selector('refresh'));
  await page.locator(selector('balance')).filter({ hasText: '1.0 Ommm' }).waitFor();
}

test('notebook gems are opt-in reads; exact reserve quote and gas warning, never an invented dollar peg', async t => {
  const { page, errors, external } = await setup(t);
  assert.equal(await page.evaluate(() => window.__reads), 0);
  await page.click(selector('refresh'));
  assert.match(await page.locator(selector('status')).textContent(), /Connect a wallet/);
  assert.equal(await page.evaluate(() => window.__reads), 0);
  await connect(page);
  assert.match(await page.locator(selector('rate')).textContent(), /0.0001 USDC \/ 1 Ommm/);
  await page.fill(selector('amount'), '1');
  assert.equal(await page.locator(selector('redeem')).isDisabled(), false);
  assert.match(await page.locator(selector('quote')).textContent(), /0.0001 USDC before network gas/);
  for (const value of ['2', '-1', '0', '0.000000000000000001', 'cat']) {
    await page.fill(selector('amount'), value);
    assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
  }
  assert.equal(await page.locator(selector('sound')).isChecked(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});

test('redemption simulates, records transaction, verifies exact burn event and waits three confirmations', async t => {
  const { page, errors } = await setup(t);
  await connect(page); await page.fill(selector('amount'), '1');
  await page.click(selector('redeem'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Redemption confirmed'));
  assert.equal(await page.evaluate(() => window.__writes), 1);
  assert.equal(await page.evaluate(() => window.__simulations), 1);
  assert.equal(await page.evaluate(() => window.__confirmations), 3);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
  assert.match(await page.locator(selector('balance')).textContent(), /0.0 Ommm/);
  assert.deepEqual(errors, []);
});

test('wallet changes invalidate a pending read and cannot display another steward balance', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => { window.__wallet.connected = true; window.__holdRead = true; });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => !!window.__resolveRead);
  await page.evaluate(() => {
    window.__wallet.address = '0x' + '4'.repeat(40);
    window.dispatchEvent(new CustomEvent('dlang:wallet')); window.__resolveRead();
  });
  assert.equal(await page.locator(selector('balance')).textContent(), '—');
  assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
});

test('duplicate submissions stay blocked while pending; ambiguous wallet failures persist an intent', async t => {
  const { page } = await setup(t);
  await connect(page); await page.fill(selector('amount'), '1');
  await page.evaluate(() => { window.__ambiguous = true; });
  await page.click(selector('redeem'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('No automatic retry'));
  const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1')));
  assert.equal(intent.hash, null);
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('automatic resubmission is blocked'));
  assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__writes), 1);
});

test('rejected signatures clear only an unsent intent; RPC errors hide stale balances', async t => {
  const { page } = await setup(t);
  await connect(page); await page.fill(selector('amount'), '1');
  await page.evaluate(() => { window.__reject = true; });
  await page.click(selector('redeem'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('No automatic retry'));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
  await page.evaluate(() => { window.__readError = true; });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('RPC unavailable'));
  assert.equal(await page.locator(selector('balance')).textContent(), '—');
  assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
});

test('receipt animation requires a newly confirmed on-chain transfer and honors reduced motion', async t => {
  const { page } = await setup(t);
  await connect(page);
  assert.equal(await page.locator('#ommm-profile').evaluate(root => root.classList.contains('gem-received')), false);
  await page.evaluate(() => {
    window.__block++; window.__received = [{ args: { value: 1n } }];
  });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Ommm received'));
  assert.equal(await page.locator('#ommm-profile').evaluate(root => root.classList.contains('gem-received')), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { window.__block++; });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('#ommm-profile').classList.contains('gem-received'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');
const fs = require('node:fs');
const path = require('node:path');
const { keccak256 } = require('ethers');

test('public Ommm evidence matches source, exact bootstrap and reconciled successful receipts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/dlang/ommm-deployment.json'), 'utf8'));
  const source = fs.readFileSync(path.join(__dirname, '../contracts/dlang/OmmmReserve.sol'));
  assert.equal(manifest.chainId, 8453);
  assert.equal(manifest.funded, true);
  assert.equal(manifest.bridged, false);
  assert.equal(manifest.initialSupply, '4400000000000000000000');
  assert.equal(manifest.initialAssets, '440000');
  assert.equal(manifest.sourceHash, keccak256(source));
  assert.match(manifest.runtimeCodeHash, /^0x[0-9a-f]{64}$/);
  assert.notEqual(manifest.contract.toLowerCase(), '0xd0f666df2dd23437f5e4d7eb975295b5885ee15e');
  assert.deepEqual(Object.keys(manifest.transactions), ['deploy', 'approve', 'bootstrap']);
  let total = 0n, block = 0;
  for (const receipt of Object.values(manifest.transactions)) {
    assert.equal(receipt.receiptStatus, 1);
    assert.match(receipt.hash, /^0x[0-9a-f]{64}$/);
    assert.ok(receipt.blockNumber > block); block = receipt.blockNumber;
    assert.ok(BigInt(receipt.actualTotalWei) > 0n); total += BigInt(receipt.actualTotalWei);
    assert.equal(receipt.capWei, undefined, 'local signing journal is not a public receipt');
  }
  assert.equal(String(total), manifest.actualGasTotalWei);
});

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
    const { mountOmmm, STAIRCASE_ABI, BASE_USDC } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers();
    const root = document.querySelector('#ommm-profile');
    const address = '0x' + '1'.repeat(40), contract = '0x' + '2'.repeat(40), hash = '0x' + '3'.repeat(64);
    const iface = new ethers.Interface(STAIRCASE_ABI);
    window.__reads = 0; window.__writes = 0; window.__simulations = 0; window.__block = 100;
    window.__balance = ethers.parseEther('1'); window.__received = [];
    window.__config = { chainId: 8453, funded: true, contract, asset: BASE_USDC, runtimeCodeHash: hash };
    window.__successor = { ...window.__config, contract: '0x' + '5'.repeat(40),
      format: 'dlang-staircase-deployment', version: 1, prototypeRecovery: true, steward: address,
      weekly: { contract: '0x' + '6'.repeat(40), runtimeCodeHash: hash, steward: address,
        members: [address], staircase: '0x' + '5'.repeat(40), roundCount: 0, paymentsEnabled: false } };
    window.__claimable = 100000n; window.__reserve = 440000n;
    const provider = {
      send: async () => '0x2105', getTransactionCount: async () => 0,
      getSigner: async () => ({ getAddress: async () => address }),
      getTransactionReceipt: async () => {
        if (window.__holdReceiptRead) await new Promise(resolve => { window.__releaseReceiptRead = resolve; });
        return window.__receipt || null;
      },
      getTransaction: async () => window.__submitted
    };
    window.__wallet = { connected: false, address, chainId: '0x2105', provider };
    const redeem = async (units, minimum) => {
      window.__writes++; window.__lastMinimum = String(minimum);
      if (window.__reject) throw Object.assign(Error('Rejected'), { code: 'ACTION_REJECTED' });
      if (window.__ambiguous) throw Error('Wallet transport disconnected');
      const event = iface.encodeEventLog(iface.getEvent('Redeemed'), [address, units, minimum]);
      return { hash, wait: async confirmations => {
        window.__confirmations = confirmations;
        if (window.__holdReceipt) await new Promise(resolve => { window.__release = resolve; });
        window.__balance -= units;
        return { status: 1, logs: [{ address: window.__activeContract, ...event }] };
      } };
    };
    redeem.staticCall = async () => { window.__simulations++; };
    const action = method => {
      const call = async (...args) => {
        window.__writes++; window.__method = method; window.__args = args;
        if (window.__reject) throw Object.assign(Error('Rejected'), { code: 'ACTION_REJECTED' });
        if (window.__ambiguous) throw Error('Wallet transport disconnected');
        const event = method === 'claimDividendFor'
          ? iface.encodeEventLog(iface.getEvent('DividendClaimed'), [address, window.__claimable]) : null;
        window.__submitted = { to: window.__activeContract, from: address, nonce: 0,
          data: iface.encodeFunctionData(method, method === 'claimDividendFor' ? [address] : []) };
        return { hash, wait: async confirmations => {
          window.__confirmations = confirmations;
          if (window.__holdReceipt) await new Promise(resolve => { window.__release = resolve; });
          if (method === 'claimDividendFor') window.__claimable = 0n;
          if (method === 'checkpoint' && window.__resetDue) {
            window.__resetDue = false; window.__claimable += 1000000n; window.__reserve = 4400000000n;
          }
          return { status: 1, logs: event ? [{ address: window.__activeContract, ...event }] : [] };
        } };
      };
      call.staticCall = async () => { window.__simulations++; if (window.__staticError) throw Error(window.__staticError); };
      return call;
    };
    const pool = {
      connect: () => pool, redeem, claimDividendFor: action('claimDividendFor'), checkpoint: action('checkpoint'), interface: iface,
      filters: { Transfer: () => 'received' }, queryFilter: async () => window.__received
    };
    window.__ui = mountOmmm({
      root, getWallet: () => window.__wallet,
      loadConfig: async version => version === 'staircase' ? window.__successor : window.__config,
      connect: async config => {
        window.__reads++;
        window.__activeContract = config.contract;
        if (window.__readError) throw Error('RPC unavailable');
        if (window.__holdRead) await new Promise(resolve => { window.__resolveRead = resolve; });
        return { ethers, pool, provider, block: window.__block, balance: window.__balance,
          reserve: window.__reserve, supply: ethers.parseEther('4400'),
          ...(config === window.__successor ? {
            retired: !!window.__retired, recoveryDisabled: !!window.__recoveryDisabled,
            resetDue: !!window.__resetDue, step: 100n, resets: 0n, claimable: window.__claimable,
            weeklyRetired: !!window.__weeklyRetired, weeklyRecoveryDisabled: false, rounds: 0n
          } : {}) };
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

async function successor(page) {
  await page.evaluate(() => { window.__wallet.connected = true; });
  await page.selectOption(selector('version'), 'staircase');
  await page.click(selector('refresh'));
  await page.locator(selector('balance')).filter({ hasText: 'Staircase successor' }).waitFor();
}

test('successor is explicitly selected, separately labeled, and warns about full terminal recovery and custody', async t => {
  const { page, errors } = await setup(t);
  assert.equal(await page.inputValue(selector('version')), 'original');
  await connect(page);
  assert.equal(await page.locator(selector('successor')).isVisible(), false);
  await page.selectOption(selector('version'), 'staircase');
  assert.equal(await page.locator(selector('balance')).textContent(), '—');
  assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__reads), 1, 'selection alone never reads a wallet balance');
  await page.click(selector('refresh'));
  assert.match(await page.locator(selector('balance')).textContent(), /Staircase successor/);
  assert.match(await page.locator(selector('pool')).textContent(), /0x5555/);
  assert.match(await page.locator(selector('risk')).textContent(), /recover all staircase USDC.*holder backing and dividends.*permanently retiring/);
  assert.match(await page.locator(selector('risk')).textContent(), /stakes, refunds and credits/);
  assert.match(await page.locator(selector('risk')).textContent(), /group-custody handoff.*on-chain authority transfers/);
  await page.selectOption(selector('version'), 'original');
  await page.click(selector('refresh'));
  assert.match(await page.locator(selector('balance')).textContent(), /Original pool/);
  assert.match(await page.locator(selector('pool')).textContent(), /0x2222/);
  assert.deepEqual(errors, []);
});

test('missing successor manifest is explicitly not configured, never original-pool success', async t => {
  const { page } = await setup(t);
  await page.route('**/dlang/staircase-deployment.json', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.evaluate(async () => {
    const { mountOmmm } = await import('./dlang/ommm.mjs');
    window.__ui = mountOmmm({ root: document.querySelector('#ommm-profile'), getWallet: () => window.__wallet,
      connect: async () => { throw Error('Must not connect without successor evidence'); } });
  });
  await page.selectOption(selector('version'), 'staircase');
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('not configured'));
  assert.equal(await page.locator(selector('balance')).textContent(), '—');
  for (const action of ['redeem', 'claim', 'checkpoint']) assert.equal(await page.locator(selector(action)).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__reads), 0);
});

test('pending reset quotes retained backing, not pre-reset surplus; checkpoint exposes newly allocated dividend', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => { window.__resetDue = true; window.__reserve = 8800000000n; window.__claimable = 0n; });
  await successor(page);
  await page.fill(selector('amount'), '1');
  assert.match(await page.locator(selector('rate')).textContent(), /1.0 USDC.*after pending reset/);
  assert.match(await page.locator(selector('quote')).textContent(), /^1.0 USDC/);
  assert.match(await page.locator(selector('staircase')).textContent(), /Reset pending/);
  assert.equal(await page.locator(selector('claim')).isDisabled(), true);
  await page.click(selector('checkpoint'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Checkpoint confirmed'));
  assert.equal(await page.evaluate(() => window.__method), 'checkpoint');
  assert.equal(await page.evaluate(() => window.__simulations), 1);
  assert.equal(await page.evaluate(() => window.__confirmations), 3);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
  assert.match(await page.locator(selector('claimable')).textContent(), /1.0 USDC claimable now/);
  assert.equal(await page.locator(selector('claim')).isDisabled(), false);
});

test('redemption submits the reset-adjusted minimum rather than the old backingQuote overquote', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => { window.__resetDue = true; window.__reserve = 8800000000n; });
  await successor(page); await page.fill(selector('amount'), '1'); await page.click(selector('redeem'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Redemption confirmed'));
  assert.equal(await page.evaluate(() => window.__lastMinimum), '1000000');
});

test('claimDividendFor targets the connected holder, verifies dividend event, keeps gems and blocks duplicates', async t => {
  const { page } = await setup(t);
  await successor(page);
  assert.match(await page.locator(selector('claimable')).textContent(), /0.1 USDC/);
  await page.evaluate(() => { window.__holdReceipt = true; });
  await page.click(selector('claim'));
  await page.waitForFunction(() => !!window.__release);
  for (const action of ['redeem', 'claim', 'checkpoint']) assert.equal(await page.locator(selector(action)).isDisabled(), true);
  assert.equal(await page.locator(selector('version')).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__method), 'claimDividendFor');
  assert.equal(await page.evaluate(() => window.__args[0]), '0x' + '1'.repeat(40));
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1')).action), 'claim');
  await page.evaluate(() => { window.__holdReceipt = false; window.__release(); });
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Dividend confirmed'));
  assert.match(await page.locator(selector('balance')).textContent(), /1.0 Ommm/);
  assert.match(await page.locator(selector('claimable')).textContent(), /0.0 USDC/);
  assert.equal(await page.locator(selector('claim')).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__writes), 1);
  assert.equal(await page.evaluate(() => window.__confirmations), 3);
});

test('retired successor preserves historical balance but forbids every payout and checkpoint; latest retirement simulation also blocks signing', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => { window.__retired = true; window.__weeklyRetired = true; });
  await successor(page);
  await page.fill(selector('amount'), '1');
  assert.match(await page.locator(selector('balance')).textContent(), /1.0 Ommm/);
  assert.match(await page.locator(selector('claimable')).textContent(), /0.0 USDC/);
  assert.match(await page.locator(selector('risk')).textContent(), /Permanently retired.*Historical balances remain.*payouts have stopped/);
  assert.match(await page.locator(selector('staircase')).textContent(), /retired; payouts stopped/);
  for (const action of ['redeem', 'claim', 'checkpoint']) assert.equal(await page.locator(selector(action)).isDisabled(), true);
  await page.evaluate(() => { window.__retired = false; window.__staticError = 'Contract retired after the confirmed block'; });
  await page.click(selector('refresh'));
  await page.click(selector('claim'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Contract retired'));
  assert.equal(await page.evaluate(() => window.__writes), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
});

test('old redemption intent is not cleared or reconciled against a successor or another holder', async t => {
  const { page } = await setup(t);
  const intent = { contract: '0x' + '2'.repeat(40), address: '0x' + '1'.repeat(40),
    units: '1000000000000000000', minimum: '100', nonce: 0, hash: '0x' + '3'.repeat(64) };
  await page.evaluate(value => {
    sessionStorage.setItem('dlang-ommm-pending-v1', JSON.stringify(value));
    window.__receipt = { status: 0, blockNumber: 90 };
    window.__wallet.connected = true;
  }, intent);
  await page.selectOption(selector('version'), 'staircase');
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('earlier submission'));
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1'))), intent);
  await page.selectOption(selector('version'), 'original');
  await page.evaluate(() => { window.__wallet.address = '0x' + '4'.repeat(40); });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('earlier submission'));
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1'))), intent);
  await page.evaluate(() => { window.__wallet.address = '0x' + '1'.repeat(40); });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('reverted'));
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
});

test('wallet changes during receipt reconciliation preserve intent and cannot reveal the previous holder balance', async t => {
  const { page } = await setup(t);
  await page.evaluate(() => {
    window.__wallet.connected = true; window.__holdReceiptRead = true;
    sessionStorage.setItem('dlang-ommm-pending-v1', JSON.stringify({
      contract: window.__config.contract, address: window.__wallet.address,
      units: '1000000000000000000', minimum: '100', nonce: 0, hash: '0x' + '3'.repeat(64)
    }));
    window.__receipt = { status: 0, blockNumber: 90 };
  });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => !!window.__releaseReceiptRead);
  await page.evaluate(() => {
    window.__wallet.address = '0x' + '4'.repeat(40);
    window.dispatchEvent(new CustomEvent('dlang:wallet')); window.__releaseReceiptRead();
  });
  assert.equal(await page.locator(selector('balance')).textContent(), '—');
  assert.notEqual(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
  assert.equal(await page.locator(selector('redeem')).isDisabled(), true);
});

test('claim ambiguous submission survives session switching and refresh, with no silent retry', async t => {
  const { page } = await setup(t);
  await successor(page);
  await page.evaluate(() => { window.__ambiguous = true; });
  await page.click(selector('claim'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('No automatic retry'));
  const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1')));
  assert.equal(intent.action, 'claim'); assert.equal(intent.hash, null);
  await page.selectOption(selector('version'), 'original'); await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('earlier submission'));
  await page.selectOption(selector('version'), 'staircase'); await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('automatic resubmission is blocked'));
  assert.equal(await page.evaluate(() => window.__writes), 1);
  assert.equal(await page.locator(selector('claim')).isDisabled(), true);
});

test('confirmed legacy redemption reconciles without an action field; dividend recipient and checkpoint calldata must match', async t => {
  const { page } = await setup(t);
  await page.evaluate(async () => {
    const { STAIRCASE_ABI } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers(), iface = new ethers.Interface(STAIRCASE_ABI);
    window.__wallet.connected = true;
    const pending = { contract: window.__config.contract, address: window.__wallet.address,
      units: '1000000000000000000', minimum: '100', nonce: 0, hash: '0x' + '3'.repeat(64) };
    const event = iface.encodeEventLog(iface.getEvent('Redeemed'), [pending.address, BigInt(pending.units), 100n]);
    window.__receipt = { status: 1, blockNumber: 98, logs: [{ address: pending.contract, ...event }] };
    sessionStorage.setItem('dlang-ommm-pending-v1', JSON.stringify(pending));
  });
  await page.click(selector('refresh'));
  await page.locator(selector('balance')).filter({ hasText: 'Original pool' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
  await page.evaluate(async () => {
    const { STAIRCASE_ABI } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers(), iface = new ethers.Interface(STAIRCASE_ABI);
    const pending = { action: 'claim', contract: window.__successor.contract, address: window.__wallet.address,
      nonce: 0, hash: '0x' + '3'.repeat(64) };
    const event = iface.encodeEventLog(iface.getEvent('DividendClaimed'), ['0x' + '9'.repeat(40), 100n]);
    window.__receipt = { status: 1, blockNumber: 98, logs: [{ address: pending.contract, ...event }] };
    sessionStorage.setItem('dlang-ommm-pending-v1', JSON.stringify(pending));
  });
  await page.selectOption(selector('version'), 'staircase'); await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Pool event does not match'));
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1')).action), 'claim');
  await page.evaluate(() => {
    const pending = JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1'));
    pending.action = 'checkpoint'; sessionStorage.setItem('dlang-ommm-pending-v1', JSON.stringify(pending));
    window.__submitted = { to: pending.contract, from: pending.address, nonce: 0, data: '0xdead' };
  });
  await page.click(selector('refresh'));
  await page.waitForFunction(() => document.querySelector('[data-ommm="status"]').textContent.includes('Checkpoint transaction does not match'));
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('dlang-ommm-pending-v1')).action), 'checkpoint');
  await page.evaluate(async () => {
    const { STAIRCASE_ABI } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers();
    window.__submitted.data = new ethers.Interface(STAIRCASE_ABI).encodeFunctionData('checkpoint', []);
  });
  await page.click(selector('refresh'));
  await page.locator(selector('balance')).filter({ hasText: 'Staircase successor' }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dlang-ommm-pending-v1')), null);
});

test('reset-aware quote matches contract rounding for fractional supply and is unchanged for the original pool', async () => {
  const { backingQuote, redemptionQuote, validateStaircaseDeployment, BASE_USDC } = await import('../public/dlang/ommm.mjs');
  const supply = 10n ** 18n + 1n, units = 10n ** 18n;
  const state = { supply, reserve: 4000000n, resetDue: true };
  assert.equal(redemptionQuote(units, state), 1000000n);
  assert.equal(redemptionQuote(units, { ...state, resetDue: false }), backingQuote(units, state.reserve, supply));
  const config = { format: 'dlang-staircase-deployment', version: 1, chainId: 8453, funded: true, prototypeRecovery: true,
    contract: '0x' + '1'.repeat(40), asset: BASE_USDC, steward: '0x' + '2'.repeat(40), runtimeCodeHash: '0x' + '3'.repeat(64),
    weekly: { contract: '0x' + '4'.repeat(40), runtimeCodeHash: '0x' + '5'.repeat(64), steward: '0x' + '2'.repeat(40),
      members: ['0x' + '2'.repeat(40)], staircase: '0x' + '1'.repeat(40), roundCount: 0, paymentsEnabled: false } };
  assert.equal(validateStaircaseDeployment(config), config);
  for (const invalid of [{ ...config, version: 2 }, { ...config, prototypeRecovery: false },
    { ...config, weekly: { ...config.weekly, paymentsEnabled: true } },
    { ...config, weekly: { ...config.weekly, staircase: config.weekly.contract } }]) {
    assert.throws(() => validateStaircaseDeployment(invalid), /not configured/);
  }
});

test('real connector pins both runtimes and every state/roster read to one confirmed block, including terminal unfunded retirement', async t => {
  const { page } = await setup(t);
  const result = await page.evaluate(async () => {
    const { connectOmmm, STAIRCASE_ABI, BASE_USDC } = await import('./dlang/ommm.mjs');
    const { loadEthers } = await import('./vendor/decent-head/2.0.0/js/wallet.js');
    const ethers = await loadEthers(), code = '0x6000', hash = ethers.keccak256(code);
    const config = { ...window.__successor, runtimeCodeHash: hash,
      weekly: { ...window.__successor.weekly, runtimeCodeHash: hash } };
    const poolInterface = new ethers.Interface(STAIRCASE_ABI);
    const weeklyInterface = new ethers.Interface([
      'function token() view returns(address)', 'function steward() view returns(address)',
      'function staircase() view returns(address)', 'function memberCount() view returns(uint256)',
      'function members(uint256) view returns(address)', 'function roundCount() view returns(uint256)',
      'function prototypeRetired() view returns(bool)', 'function recoveryDisabled() view returns(bool)'
    ]);
    window.__runtimeScenario = async scenario => {
      const reads = [], codes = []; let networkReads = 0;
      const retired = scenario === 'retired';
      const provider = {
        send: async () => (++networkReads === 2 && scenario === 'network-change') ? '0x1' : '0x2105',
        getBlockNumber: async () => 102,
        getCode: async (address, block) => {
          codes.push({ address, block });
          return scenario === 'runtime-mismatch' && address === config.weekly.contract ? '0x6001' : code;
        },
        call: async transaction => {
          const weekly = transaction.to.toLowerCase() === config.weekly.contract.toLowerCase();
          const iface = weekly ? weeklyInterface : poolInterface, parsed = iface.parseTransaction(transaction);
          reads.push({ name: parsed.name, block: transaction.blockTag, weekly });
          const poolValues = { asset: BASE_USDC, funded: !retired, balanceOf: ethers.parseEther('1'),
            reserveAssets: retired ? 0n : 440000n, totalSupply: ethers.parseEther('4400'),
            owner: config.steward, prototypeRetired: retired, recoveryDisabled: false, resetDue: false,
            currentStep: 100n, resetCount: 0n, claimableDividend: retired ? 0n : 100n };
          const weeklyValues = { token: BASE_USDC, steward: config.weekly.steward, staircase: config.contract,
            memberCount: 1n, members: scenario === 'roster-mismatch' ? '0x' + '9'.repeat(40) : config.weekly.members[0],
            roundCount: 0n, prototypeRetired: retired, recoveryDisabled: false };
          return iface.encodeFunctionResult(parsed.fragment, [(weekly ? weeklyValues : poolValues)[parsed.name]]);
        }
      };
      try {
        const state = await connectOmmm(config, { ...window.__wallet, connected: true, provider });
        return { reads, codes, block: state.block, retired: state.retired, claimable: String(state.claimable) };
      } catch (error) { return { error: error.message, reads, codes }; }
    };
    return window.__runtimeScenario('active');
  });
  assert.equal(result.error, undefined);
  assert.equal(result.block, 100);
  assert.equal(result.codes.length, 2);
  assert.ok(result.codes.every(read => read.block === 100));
  assert.ok(result.reads.length >= 20);
  assert.ok(result.reads.every(read => read.block === 100), JSON.stringify(result.reads));
  const retired = await page.evaluate(() => window.__runtimeScenario('retired'));
  assert.equal(retired.error, undefined);
  assert.equal(retired.retired, true);
  assert.equal(retired.claimable, '0');
  assert.match((await page.evaluate(() => window.__runtimeScenario('runtime-mismatch'))).error, /Weekly successor runtime/);
  assert.match((await page.evaluate(() => window.__runtimeScenario('roster-mismatch'))).error, /roster check failed/);
  assert.match((await page.evaluate(() => window.__runtimeScenario('network-change'))).error, /network changed/);
});

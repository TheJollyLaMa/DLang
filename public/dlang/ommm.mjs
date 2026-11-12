export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const OMMM_ABI = [
  'function asset() view returns(address)', 'function funded() view returns(bool)',
  'function balanceOf(address) view returns(uint256)', 'function totalSupply() view returns(uint256)',
  'function reserveAssets() view returns(uint256)', 'function previewRedeem(uint256) view returns(uint256)',
  'function redeem(uint256 units,uint256 minimumAssets)',
  'event Redeemed(address indexed steward,uint256 units,uint256 assets)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
];

export function validateOmmmDeployment(config) {
  if (config?.chainId !== 8453 || config.funded !== true
    || !/^0x[0-9a-fA-F]{40}$/.test(config.contract || '')
    || !/^0x[0-9a-fA-F]{64}$/.test(config.runtimeCodeHash || '')
    || config.asset?.toLowerCase() !== BASE_USDC.toLowerCase()) {
    throw Error('A confirmed, funded Base Ommm deployment is not configured.');
  }
  return config;
}

export function backingQuote(units, reserve, supply) {
  if (units < 0n || reserve < 0n || supply <= 0n || units > supply) throw Error('Invalid reserve quote.');
  return units * reserve / supply;
}

export async function connectOmmm(config, wallet) {
  validateOmmmDeployment(config);
  if (!wallet?.connected || !wallet.provider || BigInt(wallet.chainId) !== 8453n) throw Error('Connect your wallet on Base.');
  const { loadEthers } = await import('../vendor/decent-head/2.0.0/js/wallet.js');
  const ethers = await loadEthers(), provider = wallet.provider;
  if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Wallet network changed; select Base.');
  const block = await provider.getBlockNumber();
  const confirmedBlock = Math.max(0, block - 2);
  const options = { blockTag: confirmedBlock };
  if (ethers.keccak256(await provider.getCode(config.contract, confirmedBlock)) !== config.runtimeCodeHash) {
    throw Error('Ommm runtime does not match the confirmed deployment.');
  }
  const pool = new ethers.Contract(config.contract, OMMM_ABI, provider);
  const [asset, funded, balance, reserve, supply] = await Promise.all([
    pool.asset(options), pool.funded(options), pool.balanceOf(wallet.address, options),
    pool.reserveAssets(options), pool.totalSupply(options)
  ]);
  if (asset.toLowerCase() !== BASE_USDC.toLowerCase() || !funded) throw Error('Ommm reserve asset or funding check failed.');
  return { ethers, pool, provider, block: confirmedBlock, balance, reserve, supply };
}

export function mountOmmm({ root, getWallet, storage, connect = connectOmmm,
  loadConfig = async () => {
    const response = await fetch('./dlang/ommm-deployment.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Ommm deployment evidence is unavailable.');
    return validateOmmmDeployment(await response.json());
  } }) {
  const $ = name => root.querySelector(`[data-ommm="${name}"]`);
  let generation = 0, current = null, busy = false, previous = null, audio = null;
  const pendingKey = 'dlang-ommm-pending-v1';
  const pendingStorage = () => storage || globalThis.sessionStorage;
  const status = message => { $('status').textContent = message; };
  const unchanged = (wallet, version) => {
    const now = getWallet();
    return version === generation && now.connected && now.address === wallet.address
      && now.chainId === wallet.chainId && now.provider === wallet.provider;
  };
  function invalidate() {
    generation++; current = null; previous = null;
    $('balance').textContent = '—'; $('rate').textContent = '—'; $('quote').textContent = '';
    $('reserve').textContent = ''; $('pool').hidden = true;
    $('redeem').disabled = true;
    status('Connect on Base, then refresh your confirmed Ommm balance.');
  }
  function quote() {
    $('redeem').disabled = true; $('quote').textContent = '';
    if (!current || busy) return;
    try {
      const units = current.ethers.parseUnits($('amount').value, 18);
      if (units <= 0n || units > current.balance) throw Error('Choose an amount within your confirmed balance.');
      const assets = backingQuote(units, current.reserve, current.supply);
      if (assets === 0n) throw Error('Below one USDC micro-unit; keep accumulating gems.');
      $('quote').textContent = `${current.ethers.formatUnits(assets, 6)} USDC before network gas`;
      $('redeem').disabled = false;
    } catch (error) { $('quote').textContent = error.message; }
  }
  function link(hash) {
    $('transaction').href = `https://base.blockscout.com/tx/${hash}`;
    $('transaction').textContent = 'Inspect transaction'; $('transaction').hidden = false;
  }
  function received() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      root.classList.remove('gem-received'); void root.offsetWidth; root.classList.add('gem-received');
    }
    if ($('sound').checked && audio?.state === 'running') {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(528, start);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.06, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.7);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(start + 0.75);
    }
  }
  async function refresh() {
    const version = ++generation, wallet = getWallet();
    current = null; $('redeem').disabled = true;
    $('balance').textContent = '—'; $('rate').textContent = '—'; $('quote').textContent = '';
    $('reserve').textContent = ''; $('pool').hidden = true;
    status('Checking confirmed Base balances…');
    try {
      if (!wallet.connected) throw Error('Connect a wallet in the shared header first.');
      const config = await loadConfig(), state = await connect(config, wallet);
      if (!unchanged(wallet, version)) return;
      const pendingText = pendingStorage().getItem(pendingKey);
      if (pendingText) {
        const pending = JSON.parse(pendingText);
        if (pending.hash) {
          link(pending.hash);
          const receipt = await state.provider.getTransactionReceipt(pending.hash);
          if (!receipt || receipt.blockNumber > state.block) throw Error('A redemption is pending confirmation. Do not submit it again.');
          if (receipt.status !== 1) {
            pendingStorage().removeItem(pendingKey);
            throw Error('The previous redemption reverted; no gems were burned. Refresh to continue.');
          }
          verifyRedemption(receipt, state, pending);
          pendingStorage().removeItem(pendingKey);
        } else throw Error('A previous submission has no transaction hash. Check your wallet before retrying; automatic resubmission is blocked.');
      }
      if (!unchanged(wallet, version)) return;
      current = { ...state, config, wallet };
      $('balance').textContent = `${state.ethers.formatUnits(state.balance, 18)} Ommm`;
      $('rate').textContent = state.supply > 0n
        ? `${state.ethers.formatUnits(backingQuote(10n ** 18n > state.supply ? state.supply : 10n ** 18n, state.reserve, state.supply), 6)} USDC / ${state.supply < 10n ** 18n ? state.ethers.formatUnits(state.supply, 18) : '1'} Ommm`
        : 'No outstanding supply';
      const target = (state.supply * 1_000_000n + 10n ** 18n - 1n) / 10n ** 18n;
      const gap = target > state.reserve ? target - state.reserve : 0n;
      $('reserve').textContent = `${state.ethers.formatUnits(state.reserve, 6)} USDC in reserve · ${state.ethers.formatUnits(gap, 6)} USDC more would reach 1 USDC per Ommm at this supply.`;
      $('pool').href = `https://base.blockscout.com/address/${config.contract}`;
      $('pool').textContent = `Sponsor reserve · ${config.contract}`;
      $('pool').hidden = false;
      status('Confirmed reserve backing, not a market-price or $1-peg promise. Local practice alone cannot issue tokens.');
      if (previous?.address === wallet.address && previous.contract === config.contract && state.block > previous.block) {
        const events = await state.pool.queryFilter(state.pool.filters.Transfer(null, wallet.address), previous.block + 1, state.block);
        if (!unchanged(wallet, version)) return;
        if (events.some(event => event.args.value > 0n)) { received(); status('Ommm received · confirmed on Base.'); }
      }
      previous = { address: wallet.address, contract: config.contract, block: state.block };
      quote();
    } catch (error) {
      if (version === generation) {
        current = null; $('redeem').disabled = true; $('balance').textContent = '—'; $('rate').textContent = '—';
        $('reserve').textContent = ''; $('pool').hidden = true;
        status(`Ommm unavailable: ${error.message}`);
      }
    }
  }
  function verifyRedemption(receipt, state, pending) {
    const match = receipt.logs.filter(log => log.address.toLowerCase() === pending.contract.toLowerCase())
      .map(log => state.pool.interface.parseLog(log)).find(event => event?.name === 'Redeemed'
        && event.args.steward.toLowerCase() === pending.address.toLowerCase()
        && event.args.units === BigInt(pending.units) && event.args.assets >= BigInt(pending.minimum));
    if (!match) throw Error('Redemption event does not match the submitted amount and recipient. Reconcile this transaction before retrying.');
  }
  $('refresh').onclick = () => { if (!busy) void refresh(); };
  $('amount').oninput = quote;
  $('sound').onchange = async () => {
    try {
      if ($('sound').checked) {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) throw Error('Receipt sound is unavailable in this browser.');
        audio ||= new Audio(); await audio.resume();
      } else if (audio) await audio.suspend();
    } catch (error) { $('sound').checked = false; status(error.message); }
  };
  $('redeem').onclick = async () => {
    if (!current || busy) return;
    const snapshot = current, version = generation;
    let intent = null;
    busy = true; $('redeem').disabled = true; $('refresh').disabled = true;
    try {
      const units = snapshot.ethers.parseUnits($('amount').value, 18);
      if (units <= 0n || units > snapshot.balance) throw Error('Choose an amount within your confirmed balance.');
      const minimum = backingQuote(units, snapshot.reserve, snapshot.supply);
      if (minimum === 0n) throw Error('Keep accumulating: this redemption rounds to zero.');
      const signer = await snapshot.provider.getSigner(snapshot.wallet.address);
      if (!unchanged(snapshot.wallet, version)
        || (await signer.getAddress()).toLowerCase() !== snapshot.wallet.address.toLowerCase()
        || await snapshot.provider.send('eth_chainId', []) !== '0x2105') throw Error('Wallet changed; refresh before redeeming.');
      if (pendingStorage().getItem(pendingKey)) throw Error('Reconcile the previous submission before redeeming again.');
      const nonce = await snapshot.provider.getTransactionCount(snapshot.wallet.address, 'pending');
      if (nonce !== await snapshot.provider.getTransactionCount(snapshot.wallet.address, 'latest')) {
        throw Error('Your wallet has a pending transaction. Wait before redeeming.');
      }
      const pool = snapshot.pool.connect(signer);
      await pool.redeem.staticCall(units, minimum);
      if (!unchanged(snapshot.wallet, version)) throw Error('Wallet changed; refresh before redeeming.');
      intent = { contract: snapshot.config.contract, address: snapshot.wallet.address,
        units: String(units), minimum: String(minimum), nonce, hash: null };
      pendingStorage().setItem(pendingKey, JSON.stringify(intent));
      status('Confirm the redemption and network fee in your wallet. Tiny balances can wait for batching.');
      const transaction = await pool.redeem(units, minimum, { nonce });
      intent.hash = transaction.hash; pendingStorage().setItem(pendingKey, JSON.stringify(intent)); link(transaction.hash);
      const receipt = await transaction.wait(3);
      if (!receipt || receipt.status !== 1) throw Error('Redemption did not confirm successfully. Inspect the recorded transaction.');
      verifyRedemption(receipt, snapshot, intent);
      pendingStorage().removeItem(pendingKey);
      if (unchanged(snapshot.wallet, version)) {
        await refresh(); status('Redemption confirmed: Ommm burned and USDC sent to your wallet.');
      }
    } catch (error) {
      if (intent && !intent.hash && (error.code === 'ACTION_REJECTED' || error.code === 4001)) pendingStorage().removeItem(pendingKey);
      status(`Redemption stopped: ${error.shortMessage || error.message}. No automatic retry.`);
    } finally { busy = false; $('refresh').disabled = false; quote(); }
  };
  window.addEventListener('dlang:wallet', invalidate);
  invalidate();
  return { refresh, invalidate };
}

export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const OMMM_ABI = [
  'function asset() view returns(address)', 'function funded() view returns(bool)',
  'function balanceOf(address) view returns(uint256)', 'function totalSupply() view returns(uint256)',
  'function reserveAssets() view returns(uint256)', 'function previewRedeem(uint256) view returns(uint256)',
  'function redeem(uint256 units,uint256 minimumAssets)',
  'event Redeemed(address indexed steward,uint256 units,uint256 assets)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'
];
export const STAIRCASE_ABI = [...OMMM_ABI,
  'function owner() view returns(address)', 'function prototypeRetired() view returns(bool)',
  'function recoveryDisabled() view returns(bool)', 'function resetDue() view returns(bool)',
  'function currentStep() view returns(uint256)', 'function resetCount() view returns(uint256)',
  'function claimableDividend(address) view returns(uint256)',
  'function claimDividendFor(address holder)', 'function checkpoint()',
  'event DividendClaimed(address indexed holder,uint256 assets)'
];
const WEEKLY_ABI = [
  'function token() view returns(address)', 'function steward() view returns(address)',
  'function staircase() view returns(address)', 'function memberCount() view returns(uint256)',
  'function members(uint256) view returns(address)', 'function roundCount() view returns(uint256)',
  'function prototypeRetired() view returns(bool)', 'function recoveryDisabled() view returns(bool)'
];
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isSuccessor = config => config?.format === 'dlang-staircase-deployment';

export function validateOmmmDeployment(config) {
  if (config?.chainId !== 8453 || config.funded !== true
    || !/^0x[0-9a-fA-F]{40}$/.test(config.contract || '')
    || !/^0x[0-9a-fA-F]{64}$/.test(config.runtimeCodeHash || '')
    || config.asset?.toLowerCase() !== BASE_USDC.toLowerCase()) {
    throw Error('A confirmed, funded Base Ommm deployment is not configured.');
  }
  return config;
}

export function validateStaircaseDeployment(config) {
  validateOmmmDeployment(config);
  const weekly = config.weekly;
  if (!isSuccessor(config) || config.version !== 1 || config.prototypeRecovery !== true
    || !addressPattern.test(config.steward || '')
    || !addressPattern.test(weekly?.contract || '') || !hashPattern.test(weekly?.runtimeCodeHash || '')
    || !addressPattern.test(weekly?.steward || '') || !sameAddress(weekly?.staircase, config.contract)
    || sameAddress(weekly.contract, config.contract)
    || !Array.isArray(weekly?.members) || weekly.members.length < 1 || weekly.members.length > 8
    || weekly.members.some(member => !addressPattern.test(member))
    || new Set(weekly.members.map(member => member.toLowerCase())).size !== weekly.members.length
    || weekly.roundCount !== 0 || weekly.paymentsEnabled !== false) {
    throw Error('A version-1 prototype staircase and unpaid weekly successor are not configured.');
  }
  return config;
}

export function backingQuote(units, reserve, supply) {
  if (units < 0n || reserve < 0n || supply <= 0n || units > supply) throw Error('Invalid reserve quote.');
  return units * reserve / supply;
}

export function redemptionQuote(units, state) {
  const reserve = state.resetDue
    ? (state.supply * 1_000_000n + 10n ** 18n - 1n) / 10n ** 18n : state.reserve;
  return backingQuote(units, reserve, state.supply);
}

export async function connectOmmm(config, wallet) {
  const successor = isSuccessor(config);
  (successor ? validateStaircaseDeployment : validateOmmmDeployment)(config);
  if (!wallet?.connected || !wallet.provider || BigInt(wallet.chainId) !== 8453n) throw Error('Connect your wallet on Base.');
  const { loadEthers } = await import('../vendor/decent-head/2.0.0/js/wallet.js');
  const ethers = await loadEthers(), provider = wallet.provider;
  if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Wallet network changed; select Base.');
  const block = await provider.getBlockNumber();
  const confirmedBlock = Math.max(0, block - 2);
  const options = { blockTag: confirmedBlock };
  if (ethers.keccak256(await provider.getCode(config.contract, confirmedBlock)).toLowerCase() !== config.runtimeCodeHash.toLowerCase()) {
    throw Error('Ommm runtime does not match the confirmed deployment.');
  }
  const pool = new ethers.Contract(config.contract, successor ? STAIRCASE_ABI : OMMM_ABI, provider);
  const [asset, funded, balance, reserve, supply] = await Promise.all([
    pool.asset(options), pool.funded(options), pool.balanceOf(wallet.address, options),
    pool.reserveAssets(options), pool.totalSupply(options)
  ]);
  if (asset.toLowerCase() !== BASE_USDC.toLowerCase() || (!funded && !successor)) throw Error('Ommm reserve asset or funding check failed.');
  let staircase = {};
  if (successor) {
    const weeklyConfig = config.weekly;
    if (ethers.keccak256(await provider.getCode(weeklyConfig.contract, confirmedBlock)).toLowerCase() !== weeklyConfig.runtimeCodeHash.toLowerCase()) {
      throw Error('Weekly successor runtime does not match the confirmed deployment.');
    }
    const weekly = new ethers.Contract(weeklyConfig.contract, WEEKLY_ABI, provider);
    const [owner, retired, recoveryDisabled, resetDue, step, resets, claimable,
      token, steward, linkedPool, count, rounds, weeklyRetired, weeklyRecoveryDisabled] = await Promise.all([
      pool.owner(options), pool.prototypeRetired(options), pool.recoveryDisabled(options), pool.resetDue(options),
      pool.currentStep(options), pool.resetCount(options), pool.claimableDividend(wallet.address, options),
      weekly.token(options), weekly.steward(options), weekly.staircase(options), weekly.memberCount(options),
      weekly.roundCount(options), weekly.prototypeRetired(options), weekly.recoveryDisabled(options)
    ]);
    if (!sameAddress(owner, config.steward) || !sameAddress(token, config.asset)
      || !sameAddress(steward, weeklyConfig.steward) || !sameAddress(linkedPool, config.contract)
      || count !== BigInt(weeklyConfig.members.length)) throw Error('Successor authority or weekly wiring check failed.');
    const members = await Promise.all(weeklyConfig.members.map((_, index) => weekly.members(index, options)));
    if (members.some((member, index) => !sameAddress(member, weeklyConfig.members[index]))) throw Error('Weekly successor roster check failed.');
    if (!funded && !retired) throw Error('Staircase funding check failed.');
    staircase = { retired, recoveryDisabled, resetDue, step, resets, claimable, rounds, weeklyRetired, weeklyRecoveryDisabled };
  }
  if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Wallet network changed; select Base.');
  return { ethers, pool, provider, block: confirmedBlock, balance, reserve, supply, ...staircase };
}

export function mountOmmm({ root, getWallet, storage, connect = connectOmmm,
  loadConfig = async (version = 'original') => {
    const successor = version === 'staircase';
    const response = await fetch(`./dlang/${successor ? 'staircase' : 'ommm'}-deployment.json`, { cache: 'no-store' });
    if (!response.ok) throw Error(successor ? 'Staircase successor not configured. Original gems remain in the original pool.' : 'Ommm deployment evidence is unavailable.');
    return (successor ? validateStaircaseDeployment : validateOmmmDeployment)(await response.json());
  } }) {
  const $ = name => root.querySelector(`[data-ommm="${name}"]`);
  let generation = 0, current = null, busy = false, previous = null, audio = null;
  const pendingKey = 'dlang-ommm-pending-v1';
  const pendingStorage = () => storage || globalThis.sessionStorage;
  const selected = () => $('version').value;
  const label = () => selected() === 'staircase' ? 'Staircase successor' : 'Original pool';
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
    $('transaction').hidden = true;
    $('successor').hidden = selected() !== 'staircase'; $('claimable').textContent = '—';
    $('staircase').textContent = ''; $('risk').textContent = '';
    $('redeem').disabled = true; $('claim').disabled = true; $('checkpoint').disabled = true;
    status(`${label()} · Connect on Base, then refresh your confirmed Ommm balance.`);
  }
  function quote() {
    $('redeem').disabled = true; $('quote').textContent = '';
    $('claim').disabled = !current || busy || current.retired || !(current.claimable > 0n);
    $('checkpoint').disabled = !current || busy || current.retired || !isSuccessor(current.config);
    if (!current || busy || current.retired) return;
    try {
      const units = current.ethers.parseUnits($('amount').value, 18);
      if (units <= 0n || units > current.balance) throw Error('Choose an amount within your confirmed balance.');
      const assets = redemptionQuote(units, current);
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
    const prior = previous;
    invalidate();
    previous = prior;
    const version = generation, wallet = { ...getWallet() }, selection = selected();
    status('Checking confirmed Base balances…');
    try {
      const config = await loadConfig(selection);
      if (version !== generation) return;
      if ((selection === 'staircase') !== isSuccessor(config)) throw Error('Selected pool does not match its deployment evidence.');
      if (!wallet.connected) throw Error('Connect a wallet in the shared header first.');
      const state = await connect(config, wallet);
      if (!unchanged(wallet, version)) return;
      const pendingText = pendingStorage().getItem(pendingKey);
      if (pendingText) {
        const pending = JSON.parse(pendingText);
        if (!sameAddress(pending.contract, config.contract) || !sameAddress(pending.address, wallet.address)) {
          throw Error(`An earlier submission belongs to wallet ${pending.address} at pool ${pending.contract}. Select that pool and wallet to reconcile it; no automatic retry.`);
        }
        if (pending.hash) {
          link(pending.hash);
          const receipt = await state.provider.getTransactionReceipt(pending.hash);
          if (!unchanged(wallet, version)) return;
          if (!receipt || !Number.isInteger(receipt.blockNumber) || receipt.blockNumber > state.block) throw Error('A redemption or pool action is pending confirmation. Do not submit it again.');
          if (receipt.status !== 1) {
            pendingStorage().removeItem(pendingKey);
            throw Error('The previous pool action reverted. Refresh to continue.');
          }
          await verifyAction(receipt, state, pending);
          if (!unchanged(wallet, version)) return;
          pendingStorage().removeItem(pendingKey);
        } else throw Error('A previous submission has no transaction hash. Check your wallet before retrying; automatic resubmission is blocked.');
      }
      if (!unchanged(wallet, version)) return;
      current = { ...state, config, wallet };
      $('balance').textContent = `${state.ethers.formatUnits(state.balance, 18)} Ommm · ${label()}`;
      $('rate').textContent = state.supply > 0n
        ? `${state.ethers.formatUnits(redemptionQuote(10n ** 18n > state.supply ? state.supply : 10n ** 18n, state), 6)} USDC / ${state.supply < 10n ** 18n ? state.ethers.formatUnits(state.supply, 18) : '1'} Ommm${state.resetDue ? ' after pending reset' : ''}`
        : 'No outstanding supply';
      if (state.retired) $('rate').textContent = 'Retired — payouts stopped';
      const target = (state.supply * 1_000_000n + 10n ** 18n - 1n) / 10n ** 18n;
      const gap = target > state.reserve ? target - state.reserve : 0n;
      $('reserve').textContent = state.retired ? 'No active reserve. Historical ledgers do not authorize payouts.'
        : `${state.ethers.formatUnits(state.reserve, 6)} USDC in reserve · ${state.ethers.formatUnits(gap, 6)} USDC more would reach 1 USDC per Ommm at this supply.`;
      $('pool').href = `https://base.blockscout.com/address/${config.contract}`;
      $('pool').textContent = `${label()} · ${config.contract}`;
      $('pool').hidden = false;
      if (isSuccessor(config)) {
        $('claimable').textContent = `${state.ethers.formatUnits(state.retired ? 0n : state.claimable, 6)} USDC claimable now`;
        $('staircase').textContent = `Step ${state.ethers.formatUnits(state.step, 6)} USDC · ${state.resets} resets. ${state.retired ? 'Checkpoints permanently stopped.' : state.resetDue ? 'Reset pending: redemption checkpoints first; surplus becomes dividends. Checkpoint then refresh to see new claimable USDC.' : 'Checkpoint updates reserve steps and any due reset.'} Weekly successor: ${state.weeklyRetired ? 'retired; payouts stopped' : `${state.rounds} rounds; paid entry is not enabled here`}.`;
        $('risk').textContent = state.retired
          ? 'Permanently retired. Historical balances remain, but redemption and dividend payouts have stopped.'
          : `${state.recoveryDisabled ? 'Staircase recovery disabled on-chain.' : 'Prototype risk: administrator can recover all staircase USDC, including holder backing and dividends, permanently retiring payouts.'} ${state.weeklyRecoveryDisabled ? 'Weekly recovery disabled on-chain.' : 'Weekly administrator can also recover all stakes, refunds and credits, permanently retiring weekly payouts.'} Single-steward custody today; a group-custody handoff requires explicit on-chain authority transfers, not merely a member roster.`;
      }
      status(`${label()} · Confirmed at Base block ${state.block}. Reserve accounting, not a market-price or $1-peg promise. Local practice alone cannot issue tokens.`);
      if (previous?.address === wallet.address && previous.contract === config.contract && state.block > previous.block) {
        const events = await state.pool.queryFilter(state.pool.filters.Transfer(null, wallet.address), previous.block + 1, state.block);
        if (!unchanged(wallet, version)) return;
        if (events.some(event => event.args.value > 0n)) { received(); status('Ommm received · confirmed on Base.'); }
      }
      previous = { address: wallet.address, contract: config.contract, block: state.block };
      quote();
      return true;
    } catch (error) {
      if (version === generation) {
        current = null; quote(); $('balance').textContent = '—'; $('rate').textContent = '—';
        $('reserve').textContent = ''; $('pool').hidden = true; $('claimable').textContent = '—'; $('staircase').textContent = '';
        status(`Ommm unavailable: ${error.message}`);
      }
    }
  }
  async function verifyAction(receipt, state, pending) {
    if (pending.action === 'checkpoint') {
      const transaction = await state.provider.getTransaction(pending.hash);
      if (!transaction || !sameAddress(transaction.to, pending.contract)
        || !sameAddress(transaction.from, pending.address) || transaction.nonce !== pending.nonce
        || transaction.data !== state.pool.interface.encodeFunctionData('checkpoint', [])) {
        throw Error('Checkpoint transaction does not match its recorded intent. Reconcile before retrying.');
      }
      return;
    }
    const match = receipt.logs.filter(log => log.address.toLowerCase() === pending.contract.toLowerCase())
      .map(log => { try { return state.pool.interface.parseLog(log); } catch { return null; } })
      .find(event => pending.action === 'claim'
        ? event?.name === 'DividendClaimed' && sameAddress(event.args.holder, pending.address) && event.args.assets > 0n
        : event?.name === 'Redeemed' && sameAddress(event.args.steward, pending.address)
          && event.args.units === BigInt(pending.units) && event.args.assets >= BigInt(pending.minimum));
    if (!match) throw Error('Pool event does not match the submitted amount and recipient. Reconcile this transaction before retrying.');
  }
  $('version').onchange = invalidate;
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
  async function submit(action) {
    if (!current || busy || current.retired) return;
    const snapshot = current, version = generation;
    let intent = null;
    busy = true; quote(); $('refresh').disabled = true; $('version').disabled = true;
    try {
      let units, minimum, args, method;
      if (action === 'redeem') {
        units = snapshot.ethers.parseUnits($('amount').value, 18);
        if (units <= 0n || units > snapshot.balance) throw Error('Choose an amount within your confirmed balance.');
        minimum = redemptionQuote(units, snapshot);
        if (minimum === 0n) throw Error('Keep accumulating: this redemption rounds to zero.');
        method = 'redeem'; args = [units, minimum];
      } else {
        if (!isSuccessor(snapshot.config)) throw Error('Select the staircase successor first.');
        if (action === 'claim' && !(snapshot.claimable > 0n)) throw Error('No confirmed dividend to claim. Checkpoint and refresh after a reset.');
        method = action === 'claim' ? 'claimDividendFor' : 'checkpoint';
        args = action === 'claim' ? [snapshot.wallet.address] : [];
      }
      const signer = await snapshot.provider.getSigner(snapshot.wallet.address);
      if (!unchanged(snapshot.wallet, version)
        || (await signer.getAddress()).toLowerCase() !== snapshot.wallet.address.toLowerCase()
        || await snapshot.provider.send('eth_chainId', []) !== '0x2105') throw Error('Wallet changed; refresh before submitting.');
      if (pendingStorage().getItem(pendingKey)) throw Error('Reconcile the previous submission before submitting again.');
      const nonce = await snapshot.provider.getTransactionCount(snapshot.wallet.address, 'pending');
      if (nonce !== await snapshot.provider.getTransactionCount(snapshot.wallet.address, 'latest')) {
        throw Error('Your wallet has a pending transaction. Wait before submitting.');
      }
      const pool = snapshot.pool.connect(signer);
      await pool[method].staticCall(...args);
      if (!unchanged(snapshot.wallet, version)) throw Error('Wallet changed; refresh before submitting.');
      const chain = await snapshot.provider.send('eth_chainId', []);
      const signerAddress = await signer.getAddress();
      if (!unchanged(snapshot.wallet, version) || chain !== '0x2105'
        || signerAddress.toLowerCase() !== snapshot.wallet.address.toLowerCase()) throw Error('Wallet changed; refresh before submitting.');
      intent = { action, contract: snapshot.config.contract, address: snapshot.wallet.address,
        ...(action === 'redeem' ? { units: String(units), minimum: String(minimum) } : {}), nonce, hash: null };
      pendingStorage().setItem(pendingKey, JSON.stringify(intent));
      status(`Confirm ${action} and the network fee in your wallet. No automatic retry.`);
      const transaction = await pool[method](...args, { nonce });
      intent.hash = transaction.hash; pendingStorage().setItem(pendingKey, JSON.stringify(intent));
      if (unchanged(snapshot.wallet, version)) link(transaction.hash);
      const receipt = await transaction.wait(3);
      if (!receipt || receipt.status !== 1) throw Error('Pool action did not confirm successfully. Inspect the recorded transaction.');
      await verifyAction(receipt, snapshot, intent);
      pendingStorage().removeItem(pendingKey);
      if (unchanged(snapshot.wallet, version)) {
        if (await refresh()) {
          if (action === 'redeem') status('Redemption confirmed: Ommm burned and USDC sent to your wallet.');
          else status(action === 'claim' ? 'Dividend confirmed: USDC sent to your wallet; gems kept.' : 'Checkpoint confirmed. Confirmed reserve and claimable dividends refreshed.');
        }
      }
    } catch (error) {
      if (intent && !intent.hash && (error.code === 'ACTION_REJECTED' || error.code === 4001)) pendingStorage().removeItem(pendingKey);
      if (unchanged(snapshot.wallet, version)) status(`${action} stopped: ${error.shortMessage || error.message}. No automatic retry.`);
    } finally { busy = false; $('refresh').disabled = false; $('version').disabled = false; quote(); }
  }
  $('redeem').onclick = () => submit('redeem');
  $('claim').onclick = () => submit('claim');
  $('checkpoint').onclick = () => submit('checkpoint');
  window.addEventListener('dlang:wallet', invalidate);
  invalidate();
  return { refresh, invalidate };
}

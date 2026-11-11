import { Round, availability, totalScore, studyLabels, previewAccounting, KEY } from './core.mjs';
import { PACKS, LANGUAGE_NAMES } from './packs.mjs';
import { SCENES, DESCRIPTIONS, sceneSVG } from './scenes.mjs';
import { mountPersonal } from './personal.mjs';
import { mountTutorial } from './tutorial.mjs';
import { pilotEligibility } from './pilot.mjs';
const $ = id => document.getElementById(id);
const languageName = tag => LANGUAGE_NAMES[tag] || tag;
$('language').replaceChildren(...Object.keys(PACKS).map(tag => new Option(languageName(tag), tag)), new Option('Other — unsupported in this seed preview', 'other'));
$('study-languages').querySelectorAll('label').forEach(label => label.remove());
for (const tag of Object.keys(PACKS)) {
  const label = document.createElement('label'), input = document.createElement('input');
  input.type = 'checkbox'; input.value = tag; input.checked = true;
  label.append(input, document.createTextNode(` ${languageName(tag)}`)); $('study-languages').append(label);
}
let config;
try {
  const response = await fetch('./dlang/round.json');
  if (!response.ok) throw Error();
  config = await response.json();
  if (!config || typeof config !== 'object') throw Error();
} catch { config = { id: 'configuration-unavailable', level: 1 }; }
let storage;
try { storage = localStorage; } catch { storage = { getItem() { throw Error('Browser storage unavailable.'); }, setItem() { throw Error('Browser storage unavailable.'); } }; }
const engine = new Round({ config, scenes: SCENES, packs: PACKS, storage });
let walletAddress = '', eligibility = null, checking = false, selectedTarget = null, studyTarget = 'chair', recognition = null, lastAttempt = '', lastFinished = '';
const dialogFocus = new WeakMap();
function openDialog(id) {
  const dialog = $(id);
  let trigger = document.activeElement;
  while (trigger?.shadowRoot?.activeElement) trigger = trigger.shadowRoot.activeElement;
  dialogFocus.set(dialog, trigger);
  dialog.showModal();
}
globalThis.DECENT_CONFIG = {
  appName: 'DLang', subtitle: 'Notice · name · narrate',
  ens: { enabled: false }, ipfsControlsMode: 'host-only',
  providers: { default: 'unconfigured · local records only' },
  theme: { accent: '#a6e2cb', 'accent-2': '#e7bc82', 'bg-1': '#112a30', 'bg-2': '#1b383e', title: '#f5eede' },
  ipfsAdapter: {
    version: 1, label: 'DLang · local history export only',
    capabilities: { backup: { open: () => { renderHistory(); openDialog('history-dialog'); } } },
    getStatus: async () => ({ backup: { state: 'idle', detail: 'Export editable local history and ungraded stories. No upload, restore or IPFS durability claim.' } })
  },
  about: {
    host: { version: 1, open: () => openDialog('about-dialog') },
    title: 'DLang · the art of paying attention',
    summary: 'Original scenes, multilingual observation and stories shared with friends. DLang is a local learning preview, not a financial launch.',
    sections: [
      { title: 'Notice · name · narrate', body: `Seven original seek-and-find scenes with twelve targets each. Study ${Object.keys(PACKS).map(languageName).join(', ')} together; seed translations await fluent-speaker review. Stories stay separate from the 84 equally weighted object answers. No retention or pronunciation benefit has been measured.` },
      { title: 'A commitment, not an activated wager', body: 'Designed for future real $1 buy-ins, but payments are disabled pending transaction-flow and operator acceptance. The empty Base escrow is deployed and source-matched; no funded round was opened. This frontend offers no approvals, signatures or transfers. Exact qualification is 76/84. Local records and wallet UI are not financial authority; source verification is not a security audit.' },
      { title: 'Honest horizons', body: 'A Supporter token is future/planned only: not minted, available or purchased here. Future $2/$3 harder levels, voice recognition, pronunciation and dialect learning are not active curricula. All Duolingo clients and legacy watchers remain disabled.' },
      { title: 'Your records · your choice', body: 'Study is free and needs no wallet. An explicit check against the reviewed DLang pilot snapshot gates only the local pilot. Wallet connection proves neither identity nor admin authority. Attempts and ungraded stories persist in this browser; export via the right ankh. No uploads or automatic authorization or live registry synchronization.' }
    ]
  },
  links: [{ label: 'DLang source', url: 'https://github.com/TheJollyLaMa/DLang' }],
  relatedDapps: [{ label: 'DecentBusking', url: 'https://github.com/TheJollyLaMa/DecentBusking' }]
};
const { DecentHead } = await import('../vendor/decent-head/2.0.0/js/main.js');
const header = document.querySelector('decent-header');
header.addEventListener('decenthead:menu', event => {
  if (event.detail?.side === 'left') openDialog('admin-dialog');
  if (event.detail?.side === 'right') { renderHistory(); openDialog('history-dialog'); }
});
DecentHead.on('wallet', state => {
  walletAddress = state.connected ? state.address : '';
  eligibility = null;
  $('wallet-state').textContent = walletAddress ? 'Wallet connected · explicit public contributor check required' : 'Wallet optional for study · not connected';
  $('pilot-status').textContent = 'Wallet changed or disconnected: previous display eligibility cleared. No automatic authorization.';
  render();
});
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => dialog.close(); });
  dialog.addEventListener('close', () => dialogFocus.get(dialog)?.focus());
}
$('about-open').onclick = () => header.openAbout();
$('admin-open').onclick = () => openDialog('admin-dialog');
$('history-open').onclick = () => { renderHistory(); openDialog('history-dialog'); };
$('admin-config').textContent = JSON.stringify(config, null, 2);
const report = message => { $('dlang-status').textContent = message; };
mountPersonal({ storage, report });
mountTutorial({ openDialog, languages: Object.keys(PACKS).map(languageName) });
$('about-languages').textContent = Object.keys(PACKS).map(languageName).join(' · ');
function act(operation) {
  try { const result = operation(); render(); return result; }
  catch (error) { report(error.message); render(); }
}
function setTab(tab) {
  $('study').hidden = tab !== 'study'; $('week').hidden = tab !== 'week';
  $('study-tab').setAttribute('aria-pressed', String(tab === 'study'));
  $('week-tab').setAttribute('aria-pressed', String(tab === 'week'));
}
$('study-tab').onclick = () => setTab('study');
$('week-tab').onclick = () => setTab('week');
for (const name of ['study', 'daily']) {
  $(`${name}-zoom`).onclick = () => {
    const zoomed = $(`${name}-scene`).classList.toggle('zoomed');
    $(`${name}-zoom`).setAttribute('aria-pressed', String(zoomed));
    $(`${name}-zoom`).textContent = zoomed ? 'Fit whole scene' : 'Magnify scene · scroll to explore';
  };
}
$('check-pilot').onclick = async () => {
  if (!walletAddress) { $('pilot-status').textContent = 'Connect an optional wallet in the shared header first. Study needs no wallet.'; return; }
  if (checking) return;
  checking = true; $('check-pilot').disabled = true;
  const requestedWallet = walletAddress;
  eligibility = null;
  try {
    const response = await fetch('./dlang/pilot-roster.json', { signal: AbortSignal.timeout(7000), cache: 'no-store' });
    const result = pilotEligibility(await response.json(), requestedWallet);
    if (walletAddress !== requestedWallet) return;
    if (!response.ok || result.authorization !== false) throw Error();
    eligibility = { eligible: result.eligible === true, authorization: false };
    $('pilot-status').textContent = eligibility.eligible ? 'Wallet found in the reviewed DLang pilot snapshot. Local pilot display eligibility only — no financial authorization.' : 'Wallet not in the reviewed public contributor wallet list. Pilot enrollment refused; study remains free.';
  } catch {
    if (walletAddress === requestedWallet) $('pilot-status').textContent = 'Public contributor source unavailable. Pilot enrollment refused; study remains free.';
  } finally { checking = false; $('check-pilot').disabled = false; render(); }
};
$('language').onchange = () => {
  if (!PACKS[$('language').value]) report('Unsupported language — no fallback English answers or invented content.');
  else report(`${languageName($('language').value)} seed pack selected; review pending.`);
  render();
};
$('enroll').onclick = () => act(() => { engine.enroll($('language').value, eligibility); report('Enrolled locally. Answer language locked for this week. $0 charged.'); });
for (const [i, scene] of SCENES.entries()) {
  const option = new Option(`Day ${i + 1} · ${scene.title}`, String(i)); $('scene-select').add(option);
  $('story-day').add(new Option(`Day ${i + 1}`, String(i)));
}
function bindObjects(container, scene, study) {
  container.querySelectorAll('[data-target]').forEach(node => {
    const choose = () => {
      const target = scene.targets.find(t => t.id === node.dataset.target);
      if (study) {
        if (recognition) {
          $('recognition-status').textContent = target.concept === recognition.concept ? 'Recognized a different exemplar. Practice only, no graded point.' : 'Not this object. Try another; practice has unlimited retries.';
          if (target.concept !== recognition.concept) return;
          recognition = null;
        }
        studyTarget = target.concept; renderLabels();
      } else {
        selectedTarget = target.id;
        $('answer-label').textContent = `Object ${scene.targets.indexOf(target) + 1} selected. Name what you see in your locked language.`;
        $('answer').value = ''; $('answer').focus();
      }
    };
    node.onclick = choose;
    if (node.tagName.toLowerCase() === 'g') node.onkeydown = event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); choose(); }
    };
  });
}
function objectList(element, scene, study, correct = []) {
  element.replaceChildren(...scene.targets.map((target, i) => {
    const button = document.createElement('button');
    button.textContent = study ? target.concept : `Object ${i + 1}: ${DESCRIPTIONS[target.concept]}${correct.includes(target.id) ? ' · found' : ''}`;
    button.dataset.target = target.id;
    button.disabled = correct.includes(target.id);
    return button;
  }));
  bindObjects(element, scene, study);
}
function renderLabels() {
  const languages = [...$('study-languages').querySelectorAll('input:checked')].map(node => node.value);
  $('study-labels').replaceChildren(...studyLabels(studyTarget, languages, PACKS).map(({ tag, label }) => {
    const box = document.createElement('div'), title = document.createElement('span'), word = document.createElement('strong');
    box.className = 'label'; title.textContent = languageName(tag); word.textContent = label; word.lang = tag;
    box.append(title, word);
    const entry = PACKS[tag][studyTarget];
    if (entry.reading) {
      const reading = document.createElement('small'); reading.lang = entry.readingTag; reading.textContent = entry.reading; reading.className = 'reading'; box.append(reading);
    }
    return box;
  }));
  if (!languages.length) $('study-labels').textContent = 'Select supported languages to reveal labels.';
  $('exemplar-note').textContent = `Concept: ${studyTarget}. Seven distinct drawn appearances in the candidate scene bank. Language tags and curated aliases are linked by stable concept ID.`;
}
function renderStudy() {
  const scene = SCENES[+$('scene-select').value];
  $('study-scene').innerHTML = sceneSVG(scene, { study: !recognition });
  bindObjects($('study-scene'), scene, true); objectList($('study-objects'), scene, !recognition);
  // Recognition controls must still use the study handler without giving labels.
  if (recognition) {
    [...$('study-objects').children].forEach((button, i) => { button.textContent = `Object ${i + 1}`; });
    bindObjects($('study-objects'), scene, true);
  }
  if (!recognition) renderLabels();
}
$('scene-select').onchange = () => { recognition = null; $('recognition-status').textContent = ''; renderStudy(); };
$('study-languages').onchange = () => { if (!recognition) renderLabels(); };
$('recognition').onclick = () => {
  recognition = { concept: studyTarget };
  $('scene-select').value = String((+$('scene-select').value + 1) % SCENES.length);
  $('study-labels').textContent = 'Labels hidden during this ungraded fresh-exemplar check.';
  $('recognition-status').textContent = `Find another ${studyTarget} in this different scene. No time limit or grade.`;
  renderStudy();
};
$('go').onclick = () => act(() => { engine.go(); report('Timer started. Reload resumes the same attempt.'); });
$('answer-form').onsubmit = event => {
  event.preventDefault();
  act(() => {
    const result = engine.answer(selectedTarget, $('answer').value);
    $('answer-status').textContent = result.correct ? 'Found and named. Select another object.' : 'Not an accepted name for this object. Try again before the deadline. Seed ambiguities need review.';
    if (result.correct) { selectedTarget = null; $('answer').value = ''; }
  });
};
$('finish').onclick = () => act(() => { engine.finish(); report('Attempt finished. Unanswered objects score zero.'); });
$('story-day').onchange = () => act(() => { $('story').value = engine.read().stories[$('story-day').value] || ''; });
$('save-story').onclick = () => act(() => { engine.story(+$('story-day').value, $('story').value); report('Story saved separately. It is never graded or uploaded.'); });
const seconds = ms => `${Math.max(0, Math.ceil(ms / 1000))}s`;
function countdown(ms) {
  const n = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(n / 86400)}d ${Math.floor(n % 86400 / 3600)}h ${Math.floor(n % 3600 / 60)}m ${n % 60}s`;
}
function render() {
  try {
    const { state, status, now, previousState } = engine.context();
    $('schedule').textContent = status.available ? `Timezone: ${status.timezone} · starts ${new Intl.DateTimeFormat('en-US', { timeZone: status.timezone, dateStyle: 'full', timeStyle: 'short' }).format(status.boundaries[0])} (${new Date(status.boundaries[0]).toISOString()}) · enrollment cutoff ${new Date(status.cutoff).toISOString()}` : status.reason;
    $('countdown').textContent = status.next ? `${status.started ? 'Daily turnover' : 'Get Ready · next round starts'} in ${countdown(status.next - now)}${status.started ? ` · week ends in ${countdown(status.boundaries[7] - now)}` : ''}` : status.ended ? 'Week complete. No next round configured.' : 'Countdown unavailable — no schedule invented.';
    $('enroll').disabled = !status.available || !status.enrollmentOpen || !!state.language || !eligibility?.eligible || !PACKS[$('language').value];
    $('language').disabled = !!state.language;
    if (state.language) $('language').value = state.language;
    $('enrollment').textContent = state.language ? `Locally enrolled · ${languageName(state.language)} locked · $0 charged` : 'Not enrolled. Study is available now; real buy-in is disabled.';
    const day = status.day, attempt = state.attempts[day];
    const windowEnd = day >= 0 ? status.boundaries[day + 1] : null;
    $('daily-cutoff').textContent = windowEnd ? `Today closes ${new Intl.DateTimeFormat('en-US', { timeZone: status.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(windowEnd)} · ${status.timezone}. Go receives at most ${seconds(Math.min(120000, windowEnd - now))}; the timer never extends past this cutoff.` : '';
    $('go').textContent = windowEnd && windowEnd - now < 120000 ? `Go · ${seconds(windowEnd - now)} until cutoff` : 'Go · start my 120 seconds';
    $('daily-state').textContent = !status.available ? status.reason : status.ended ? 'Week complete. Missed days are zero.' : !status.started ? 'Study before the first day. Go is not available yet.' : !state.language ? 'Not enrolled before cutoff. No late enrollment.' : attempt ? `Day ${day + 1} · ${attempt.status} · ${attempt.correct.length}/12` : `Day ${day + 1} eligible · ready when you press Go.`;
    $('go').disabled = !status.available || day < 0 || !state.language || !!attempt;
    $('attempt').hidden = !attempt;
    $('finish').disabled = !attempt || attempt.status !== 'running';
    $('answer').disabled = !attempt || attempt.status !== 'running';
    $('answer-form').querySelector('button').disabled = !attempt || attempt.status !== 'running';
    if (attempt) {
      $('timer').textContent = `${seconds(attempt.deadline - now)} remaining`;
      $('daily-title').textContent = SCENES[day].title;
      const signature = JSON.stringify([day, attempt.correct, attempt.status]);
      if (signature !== lastAttempt) {
        $('daily-scene').innerHTML = sceneSVG(SCENES[day], { correct: attempt.correct });
        bindObjects($('daily-scene'), SCENES[day], false); objectList($('daily-objects'), SCENES[day], false, attempt.correct);
        lastAttempt = signature;
      }
    }
    const finished = attempt?.status === 'finished';
    const betweenWeeks = status.phase === 'get-ready' && previousState?.language;
    $('finishline').hidden = !finished && !status.ended && !betweenWeeks;
    if (finished || status.ended || betweenWeeks) {
      const score = totalScore(betweenWeeks ? previousState : state);
      $('finish-heading').textContent = score.qualifies ? 'Preview Win · FinishLine' : 'FinishLine · you noticed something new';
      $('finish-result').textContent = `${betweenWeeks ? 'Previous week complete. Get Ready for the next round. ' : finished ? `Today ${attempt.correct.length}/12. ` : ''}Week ${score.total}/84 · ${score.qualifies ? '76-point qualification threshold reached' : 'qualification requires 76'}. Missed/unanswered objects count zero. Local preview only — no money awarded.`;
      const key = `${status.roundId}:${day}`;
      if (key !== lastFinished) { lastFinished = key; $('finishline').focus({ preventScroll: true }); }
    }
  } catch (error) {
    report(`${error.message} Local persistence unavailable/invalid: scored starts are blocked.`);
    $('go').disabled = true; $('enroll').disabled = true; $('answer').disabled = true;
  }
}
function records() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(`${KEY}:`)) {
      try { entries.push(JSON.parse(localStorage.getItem(key))); } catch { /* Corrupt records are not treated as scores. */ }
    }
  }
  return entries.filter(value => value?.version === 1 && typeof value.round === 'string' && value.attempts && value.stories);
}
function renderHistory() {
  try {
    const entries = records();
    $('history').replaceChildren();
    for (const entry of entries) {
      const section = document.createElement('section'), heading = document.createElement('h3'), text = document.createElement('p');
      heading.textContent = entry.round; text.textContent = `${entry.language || 'Not enrolled'} · ${totalScore(entry).total}/84 · local, untrusted`;
      section.append(heading, text);
      for (let day = 0; day < 7; day++) {
        const row = document.createElement('p');
        row.textContent = `Day ${day+1}: ${entry.attempts[day]?.correct?.length || 0}/12 · story (ungraded): ${entry.stories[day] || 'none'}`;
        section.append(row);
      }
      $('history').append(section);
    }
    if (!entries.length) $('history').textContent = 'No saved weekly attempts or stories yet.';
  } catch { $('history').textContent = 'Local history unavailable.'; }
}
$('export-history').onclick = () => {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ warning: 'Editable local preview, not financial authority', records: records() }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'dlang-local-history.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { report('Local export unavailable.'); }
};
const example = previewAccounting([76, 80, 75], 1);
$('ledger-example').textContent = `2 qualifiers each recover 100¢ + ${example.shareCents}¢; ${example.unresolvedDustCents}¢ remains unresolved.`;
renderStudy(); render();
setInterval(render, 500);
window.addEventListener('storage', render);
window.addEventListener('focus', render);

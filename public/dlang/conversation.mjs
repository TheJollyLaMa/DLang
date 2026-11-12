import { PACKS } from './packs.mjs';
import { SCENES } from './scenes.mjs';
import { conversationConfig, createConversationService } from './conversation-service.mjs';
import { createConversationLiveKit } from './conversation-livekit.mjs';

const COPY = {
  en: ['What do you notice about', 'Where might you find', 'What could happen with'],
  es: ['¿Qué observas sobre', '¿Dónde podrías encontrar', '¿Qué podría pasar con'],
  fr: ['Que remarques-tu à propos de', 'Où pourrais-tu trouver', 'Que pourrait-il arriver avec'],
  hi: ['आप क्या देखते हैं:', 'आप कहाँ पाएँगे:', 'इसके साथ क्या हो सकता है:'],
  'zh-Hans': ['你注意到什么：', '你在哪里可能找到：', '可能发生什么：']
};
const FALLBACK = { sceneId: SCENES[0].id, title: SCENES[0].title, level: 1,
  language: 'en', concepts: SCENES[0].targets.map(target => target.concept) };

export function conversationPrompt(context, turn = 0) {
  if (!context || !Array.isArray(context.concepts)) return null;
  const concepts = context.concepts.filter(value => typeof value === 'string' && value.trim()).slice(0, 100);
  if (!concepts.length) return null;
  const language = Object.hasOwn(COPY, context.language) ? context.language : 'en';
  const index = Math.max(0, Number.isSafeInteger(turn) ? turn : 0);
  const concept = concepts[index % concepts.length];
  const label = PACKS[language]?.[concept]?.label || concept;
  return `${COPY[language][Math.floor(index / concepts.length) % COPY[language].length]} ${label}?`;
}

// This practice is ephemeral and deliberately has no scoring, recorder or network.
export function mountConversation({ storage, report, getSceneContext,
  config = globalThis.DLangConversationConfig, sdk = globalThis.LivekitClient,
  wallet = globalThis.ethereum, fetchImpl = globalThis.fetch } = {}) {
  const root = document.getElementById('conversation-root');
  if (!root) throw Error('Conversation root is missing.');
  root.__dlangConversation?.dispose();
  let blocked = false, disposed = false, turn = 0, context = null, key = '', live, service, heartbeat, liveGeneration = 0;
  const node = (name, text) => {
    const element = document.createElement(name);
    if (text) element.textContent = text;
    return element;
  };
  const title = node('h3', 'Scene conversation');
  const intro = node('p', 'Private typed practice, on this device. No scoring or saved transcript.');
  const scene = node('p');
  const prompt = node('p');
  prompt.setAttribute('aria-live', 'polite');
  const form = node('form');
  const label = node('label', 'Your turn');
  const answer = node('textarea');
  answer.maxLength = 500; answer.rows = 3;
  label.append(answer);
  const submit = node('button', 'Next turn'); submit.type = 'submit';
  const reset = node('button', 'Clear'); reset.type = 'button';
  form.append(label, submit, reset);
  const historyLabel = node('h4', 'Your turns');
  const history = node('ol');
  const voice = node('p', 'Private live conversation is unavailable: no service is configured.');
  voice.setAttribute('role', 'status');
  const narration = node('p', 'For reviewed asynchronous listening and responses, use Scene narration.');
  root.replaceChildren(title, intro, scene, prompt, form, historyLabel, history, voice, narration);
  const livePanel = node('fieldset'), legend = node('legend', 'Private invited audio');
  const destination = node('p'), consentLabel = node('label');
  const consent = node('input'); consent.type = 'checkbox';
  consentLabel.append(consent, document.createTextNode(' I consent to private audio through this operator and LiveKit. Provider retention applies; no app recording.'));
  const micLabel = node('label'), mic = node('input'); mic.type = 'checkbox';
  micLabel.append(mic, document.createTextNode(' Enable microphone (otherwise listen only).'));
  const guestLabel = node('label', 'Invited wallet'), guest = node('input'); guest.placeholder = '0x…';
  guest.maxLength = 42; guestLabel.append(guest);
  const idLabel = node('label', 'Private room ID'), roomId = node('input'); roomId.maxLength = 77; idLabel.append(roomId);
  const durationLabel = node('label', 'Minutes (1–15)'), duration = node('input');
  duration.type = 'number'; duration.min = '1'; duration.max = '15'; duration.value = '5'; durationLabel.append(duration);
  const create = node('button', 'Create private room'), join = node('button', 'Join private room');
  const mute = node('button', 'Mute / interrupt'), leave = node('button', 'Leave');
  for (const button of [create, join, mute, leave]) button.type = 'button';
  const remoteAudio = node('audio'); remoteAudio.controls = true;
  remoteAudio.setAttribute('aria-label', 'Private partner audio');
  remoteAudio.style.maxWidth = '100%';
  livePanel.append(legend, destination, consentLabel, node('br'), micLabel, node('br'),
    guestLabel, node('br'), idLabel, node('br'), durationLabel, node('br'), create, join, mute, leave, remoteAudio);
  root.append(livePanel);
  let trusted, busy = false;
  const liveStatus = text => { if (!disposed) voice.textContent = text; };
  try {
    trusted = conversationConfig(config);
    if (trusted) {
      service = createConversationService({ config: trusted, wallet, fetchImpl });
      live = createConversationLiveKit({ sdk, audio: remoteAudio, livekitOrigin: trusted.livekitOrigin,
        onStatus: text => {
          liveStatus(text);
          if (/expired|disconnected|could not|unavailable/.test(text)) service?.stop();
        } });
      destination.textContent = `Operator: ${new URL(trusted.endpoint).origin} · media: ${trusted.livekitOrigin}. Two invited wallets, at most 15 minutes. No transcript or recording by this app.`;
      liveStatus('Private audio configured. Consent and a wallet signature are required. No transaction.');
    }
  } catch { service?.stop(); service = null; liveStatus('Private audio unavailable: configuration, wallet or SDK missing.'); }
  function stopLive(message = 'Private audio stopped.') {
    ++liveGeneration; busy = false; clearInterval(heartbeat); heartbeat = null;
    create.disabled = join.disabled = false;
    live?.stop(message); service?.stop();
  }
  function liveControls() { livePanel.disabled = blocked || !context || !trusted || !live || !service; }
  async function connect(action) {
    if (blocked || disposed || busy || !live || !service || !getCurrentContext()) return;
    if (!consent.checked) { liveStatus('Consent is required before connecting.'); return; }
    stopLive(); const own = liveGeneration; busy = true;
    const microphone = mic.checked;
    create.disabled = join.disabled = true;
    liveStatus('Awaiting wallet authorization…');
    try {
      const grant = await service.authorize({ action, guest: guest.value.trim(), id: roomId.value.trim(),
        minutes: Number(duration.value), microphone, consent: consent.checked });
      if (!grant || own !== liveGeneration || blocked || disposed) return;
      roomId.value = grant.id;
      await live.start({ grant, consent: true, microphone });
      if (own !== liveGeneration || blocked || disposed) { live.stop(); return; }
      heartbeat = setInterval(() => {
        void service.heartbeat().catch(() => { if (own === liveGeneration) stopLive('Control connection lost; private audio stopped.'); });
      }, 10000);
    } catch { if (own === liveGeneration) stopLive('Private audio unavailable; check wallet, invitation, quota or permission.'); }
    finally { if (own === liveGeneration) { busy = false; create.disabled = join.disabled = false; } }
  }
  create.onclick = () => { void connect('create'); };
  join.onclick = () => { void connect('join'); };
  mute.onclick = () => { void live?.mute(); };
  leave.onclick = () => stopLive();
  consent.onchange = () => { if (!consent.checked) stopLive('Consent withdrawn; private audio stopped.'); };
  const accountChange = () => { stopLive('Wallet changed; sign consent again.'); consent.checked = false; };
  const pageHide = () => stopLive();
  globalThis.addEventListener?.('dlang:wallet', accountChange);
  globalThis.addEventListener?.('pagehide', pageHide);
  wallet?.on?.('accountsChanged', accountChange);
  function getCurrentContext() {
    try { return getSceneContext ? getSceneContext() : FALLBACK; } catch { return null; }
  }

  function clear() { turn = 0; answer.value = ''; history.replaceChildren(); }
  function render() {
    const available = !blocked && !!context && !!conversationPrompt(context, turn);
    scene.textContent = available ? `${context.title || context.sceneId || 'Scene'} · ${context.language || 'en'} · level ${context.level ?? 1}` : 'Scene practice unavailable.';
    prompt.textContent = available ? conversationPrompt(context, turn) : blocked ? 'Unavailable during a scored round.' : 'Choose a scene to practise.';
    answer.disabled = submit.disabled = reset.disabled = !available;
    liveControls();
  }
  function refreshContext() {
    if (disposed || blocked) return;
    const next = getCurrentContext();
    const nextKey = next ? JSON.stringify([next.sceneId, next.sceneVersion, next.level, next.language, next.concepts]) : '';
    if (nextKey !== key) { clear(); stopLive(); key = nextKey; }
    context = next; render();
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (blocked || disposed) return;
    refreshContext();
    const value = answer.value.trim();
    if (!context || !value || !conversationPrompt(context, turn)) return;
    const item = node('li');
    item.append(node('p', conversationPrompt(context, turn)), node('p', value));
    history.append(item);
    while (history.children.length > 12) history.firstChild.remove();
    answer.value = ''; turn++; render(); answer.focus();
  });
  reset.addEventListener('click', () => { clear(); render(); });
  function stop() { clear(); stopLive(); render(); }
  function setBlocked(value) {
    blocked = !!value;
    if (blocked) { clear(); stopLive(); context = null; key = ''; render(); }
    else refreshContext();
  }
  function dispose() {
    if (disposed) return;
    stopLive(); live?.dispose();
    globalThis.removeEventListener?.('dlang:wallet', accountChange);
    globalThis.removeEventListener?.('pagehide', pageHide);
    wallet?.removeListener?.('accountsChanged', accountChange);
    disposed = true; clear(); root.replaceChildren();
    if (root.__dlangConversation === api) delete root.__dlangConversation;
  }
  const api = { setBlocked, refreshContext, stop, dispose };
  root.__dlangConversation = api;
  refreshContext();
  return api;
}

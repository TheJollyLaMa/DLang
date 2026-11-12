export function mountLanding() {
  const workspace = document.getElementById('learning-workspace');
  const definitions = [
    ['practice', 'Daily discoveries', ['#practice'], 'left'],
    ['library', 'Words & worlds', ['#scene-library', '#family-wordmap'], 'left'],
    ['voices', 'Listen. Answer. Tell a story.', ['#narration-root', '#conversation-root'], 'right'],
    ['week', 'Our observation week', ['.notice', '.tabs', '.round', '#study', '#week', '.economics'], 'right']
  ];
  const panels = new Map();
  let active = null, opener = null;
  const triggers = [...document.querySelectorAll('[data-open-panel]')];
  for (const [name, title, selectors, side] of definitions) {
    const panel = document.createElement('aside');
    panel.id = `panel-${name}`;
    panel.className = `learning-panel panel-${side}`;
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('aria-labelledby', `${panel.id}-title`);
    const bar = document.createElement('div'), heading = document.createElement('h2'), close = document.createElement('button');
    bar.className = 'panel-bar';
    heading.id = `${panel.id}-title`;
    heading.textContent = title;
    close.textContent = '×';
    close.className = 'panel-close';
    close.setAttribute('aria-label', `Close ${title}`);
    close.onclick = () => hide();
    bar.append(heading, close);
    panel.append(bar);
    for (const selector of selectors) {
      const content = workspace.querySelector(selector);
      if (!content) throw Error(`Learning panel content missing: ${selector}`);
      panel.append(content);
    }
    document.body.append(panel);
    panels.set(name, panel);
  }
  function announce() {
    window.dispatchEvent(new CustomEvent('dlang:panel', { detail: { name: active } }));
  }
  function hide() {
    if (!active) return;
    panels.get(active).hidden = true;
    active = null;
    triggers.forEach(button => button.setAttribute('aria-expanded', 'false'));
    announce();
    opener?.focus();
  }
  function show(name, trigger) {
    const panel = panels.get(name);
    if (!panel) throw Error('Unknown learning panel.');
    if (active) panels.get(active).hidden = true;
    active = name;
    opener = trigger;
    panel.hidden = false;
    triggers.forEach(button => button.setAttribute('aria-expanded', String(button.dataset.openPanel === name)));
    announce();
    panel.focus({ preventScroll: true });
  }
  for (const button of triggers) {
    button.setAttribute('aria-controls', `panel-${button.dataset.openPanel}`);
    button.setAttribute('aria-expanded', 'false');
    button.onclick = () => active === button.dataset.openPanel ? hide() : show(button.dataset.openPanel, button);
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      hide();
    }
  });
  document.getElementById('notebook-launch').onclick = () => document.getElementById('history-open').click();
  mountFilm();
  return { show: name => show(name, triggers.find(button => button.dataset.openPanel === name)), hide, get active() { return active; } };
}

function mountFilm() {
  const video = document.getElementById('landing-video'), button = document.getElementById('landing-motion');
  const mobile = matchMedia('(max-width: 650px)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let desired = !reduced.matches, source = '';
  video.muted = true;
  function state() {
    const playing = !video.paused;
    button.textContent = playing ? 'Pause animation' : 'Play animation';
    button.setAttribute('aria-label', button.textContent);
    button.setAttribute('aria-pressed', String(playing));
    if (playing) video.classList.add('has-frame');
  }
  async function update() {
    if (!desired || document.hidden) { video.pause(); state(); return; }
    const next = mobile.matches ? './dlang/media/landing-mobile.mp4' : './dlang/media/landing-desktop.mp4';
    if (source !== next) { source = next; video.classList.remove('has-frame'); video.src = next; video.load(); }
    try { await video.play(); }
    catch { state(); }
  }
  button.onclick = () => { desired = video.paused; void update(); };
  video.addEventListener('playing', state);
  video.addEventListener('pause', state);
  video.addEventListener('error', () => {
    desired = false;
    video.classList.remove('has-frame');
    button.textContent = 'Animation unavailable · still image shown';
    button.setAttribute('aria-label', button.textContent);
    button.setAttribute('aria-pressed', 'false');
  });
  mobile.addEventListener('change', () => { video.pause(); void update(); });
  reduced.addEventListener('change', () => { desired = !reduced.matches; void update(); });
  document.addEventListener('visibilitychange', () => void update());
  window.addEventListener('pagehide', () => video.pause());
  void update();
}

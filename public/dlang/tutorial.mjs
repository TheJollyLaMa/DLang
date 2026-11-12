export function mountTutorial({ openDialog, languages, showPanel }) {
  const $ = id => document.getElementById(id);
  const steps = [
    { title: 'Your first little discovery', text: 'No wallet, payment or perfect streak needed. Open Discover, choose a language, then press Begin when you are ready for a two-minute practice. Point at an object, listen, and say what you see. Mark Remembered or Again honestly. Nothing in this tour starts your timer.', area: 'practice' },
    { title: 'Many languages can share one picture', text: `Select an object to reveal ${languages.join(', ')} together. Pinyin is a pronunciation reading aid only; scored Mandarin answers use Chinese characters. All packs are seed content awaiting fluent-speaker review.`, area: 'study' },
    { title: 'Small words grow into a world', text: 'Words opens six growing levels: home objects, the wider world, numbers, feelings, colors and first verbs. Explore 72 concepts across the family word map and preview another day of scenes. Your imported word library stays in your browser. Three free practices per local day leave room to come back tomorrow.', area: 'library' },
    { title: 'Listen, echo, then tell the story', text: 'Voices holds scene narration and typed conversations. Start with “I see a bird,” echo it, then build a longer description yourself. Device speech is labeled synthesis; native-speaker contributions need two approvals from three assigned language-qualified reviewers. Record and Publish are separate choices. This tour never activates your microphone or shares a recording.', area: 'voices' },
    { title: 'Our first week: rehearse before money', text: 'No paid round is open. Together shows the local weekly rehearsal: choose a supported language and inspect the schedule. Explicit Go starts at most 120 seconds for twelve object names per day; reloading keeps the deadline. The weekly model qualifies at 76 of 84 answers. Local enrollment and scores are not an on-chain entry or payment authority.', area: 'week' },
    { title: 'Half for friends, half for the staircase', text: 'The tested weekly successor splits each finalized nonqualifier’s 1 USDC: 0.50 to survivors and 0.50 to the gem reserve. Survivors also recover their own principal. If nobody qualifies, their half carries forward without another split. Cancelled or timed-out unsettled rounds refund full principal. These new terms are not active in the old escrow; this rehearsal costs nothing.', area: 'week' },
    { title: 'Gems climb, then share the surplus', text: 'The staircase model climbs through 0.0001, 0.001, 0.01, 0.10 and 1 USDC backing per Ommm. At 2, a checkpoint turns surplus into claimable USDC dividends while backing returns to 1; holders keep their gems. Earned dividends survive transfers and burns while active. Prototype risk: administrators can recover all funds, including holder backing, dividends and weekly refunds, permanently retiring payouts. Historical ledgers remain. This is reserve accounting, not a promised market price.', area: 'personal' },
    { title: 'What is live, and what is waiting', text: 'The original Base pool bootstrapped 4,400 Ommm with 0.44 USDC and has no staircase dividends. The notebook keeps original and successor pools separate despite their shared Ommm symbol: choose a version, connect on Base and refresh to verify its manifest, runtime and confirmed balances. Missing successor evidence shows not configured, never a successful fallback. No automatic migration occurs. Free practice does not automatically award gems. No paid round is activated by this tour.', area: 'personal' },
    { title: 'A story is more than a score', text: 'Your notebook keeps actual browser-local practice statistics, optional profile artwork and private stories. Stories are never graded. Connecting a wallet triggers read-only ENS artwork lookup; public IPFS publishing is always a separate explicit action. Return through any white rabbit whenever you want another tour. You are a steward, not a score: the point is to find words you can take into the world.', area: 'personal' }
  ];
  let step = 0;
  const render = () => {
    $('rabbit-progress').textContent = `Hop ${step + 1} of ${steps.length}`;
    $('rabbit-title').textContent = steps[step].title;
    $('rabbit-body').textContent = steps[step].text;
    $('rabbit-back').disabled = step === 0;
    $('rabbit-next').textContent = step === steps.length - 1 ? 'Finish orientation' : 'Next hop';
    const labels = {
      personal: 'Open my personal notebook', week: 'Show the observation week',
      study: 'Try this in the study scene', practice: 'Show free Discover practice',
      library: 'Explore Words and levels', voices: 'Explore Voices and conversations'
    };
    $('rabbit-try').textContent = labels[steps[step].area];
  };
  const launch = () => {
    for (const id of ['about-dialog', 'history-dialog']) if ($(id).open) $(id).close();
    step = 0; render(); openDialog('rabbit-dialog');
  };
  for (const id of ['rabbit-open', 'about-rabbit', 'profile-rabbit']) $(id).onclick = launch;
  $('rabbit-back').onclick = () => { if (step > 0) { step--; render(); } };
  $('rabbit-next').onclick = () => {
    if (step === steps.length - 1) $('rabbit-dialog').close();
    else { step++; render(); }
  };
  $('rabbit-try').onclick = () => {
    const area = steps[step].area;
    // Let the dialog's normal focus restoration finish before moving to the selected tool.
    $('rabbit-dialog').addEventListener('close', () => {
      if (area === 'personal') $('history-open').click();
      else {
        showPanel(area === 'study' ? 'week' : area);
        if (area === 'study' || area === 'week') $(`${area}-tab`).click();
        const target = area === 'study' ? $('study-scene')
          : area === 'library' ? $('scene-library')
          : area === 'voices' ? $('panel-voices') : $(area);
        target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    }, { once: true });
    $('rabbit-dialog').close();
  };
}

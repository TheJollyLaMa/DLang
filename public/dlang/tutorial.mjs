export function mountTutorial({ openDialog, languages }) {
  const $ = id => document.getElementById(id);
  const steps = [
    { title: 'Follow a detail, not a streak', text: 'Explore seven original DLang scenes: the same twelve concepts, new visual versions. Study is free and does not need a wallet.', area: 'study' },
    { title: 'Many languages can share one picture', text: `Select an object to reveal ${languages.join(', ')} together. Pinyin is a pronunciation reading aid only; scored Mandarin answers use Chinese characters. All packs are seed content awaiting fluent-speaker review.`, area: 'study' },
    { title: 'Look again in a fresh scene', text: 'Try a fresh exemplar to practice recognition with labels hidden. Use keyboard Enter/Space, large object-list buttons or magnification. This practice is untimed, ungraded and retryable.', area: 'study' },
    { title: 'Go means the clock starts', text: 'The scheduled local pilot uses one attempt per day and your locked enrollment language. Explicit Go gives at most 120 seconds, shortened at the visible daily cutoff. Reload keeps the original deadline. Missed answers are zero; 76 of 84 qualifies in the model. Real buy-ins remain disabled.', area: 'week' },
    { title: 'A story is more than a score', text: 'Stories are private local notes, never graded. Three flexible free practices per local day add spaced self-review and tap-to-hear audio. The right ankh opens actual browser statistics, ENS avatar/banner and your own image overrides. Wallet connection triggers read-only ENS lookup. Voice recording and public IPFS publishing are separate explicit actions; community voices require steward review. The left ankh explains pilot gates, not administrator authority.', area: 'personal' }
  ];
  let step = 0;
  const render = () => {
    $('rabbit-progress').textContent = `Hop ${step + 1} of ${steps.length}`;
    $('rabbit-title').textContent = steps[step].title;
    $('rabbit-body').textContent = steps[step].text;
    $('rabbit-back').disabled = step === 0;
    $('rabbit-next').textContent = step === steps.length - 1 ? 'Finish orientation' : 'Next hop';
    $('rabbit-try').textContent = steps[step].area === 'personal' ? 'Open my personal notebook' : steps[step].area === 'week' ? 'Show the observation week' : 'Try this in the study scene';
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
    $('rabbit-dialog').close();
    const area = steps[step].area;
    if (area === 'personal') $('history-open').click();
    else {
      $(`${area}-tab`).click();
      const target = area === 'study' ? $('study-scene') : $('week');
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    }
  };
}

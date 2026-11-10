export const KEY = 'dlang-local-preview-v1';
export { LANGUAGE_TAGS as LANGUAGES } from './packs.mjs';
export const LEVELS = [{ id: 1, cents: 100, active: true }, { id: 2, cents: 200, active: false }, { id: 3, cents: 300, active: false }];
export const PAYMENTS_ENABLED = false;
const DAY = 86400000;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const dateIn = (ms, timezone) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
function calendarOrdinal(ms, timezone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const get = type => parts.find(part => part.type === type).value;
  return Date.UTC(+get('year'), +get('month') - 1, +get('day')) / DAY;
}
function shiftWeeks(ms, weeks, timezone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const get = type => +parts.find(part => part.type === type).value;
  const wall = Date.UTC(get('year'), get('month') - 1, get('day') + 7 * weeks, get('hour'), get('minute'), get('second'));
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const observed = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
    const value = type => +observed.find(part => part.type === type).value;
    guess += wall - Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  }
  return guess;
}
export function configuration(config) {
  try {
    if (!config || typeof config.id !== 'string' || !config.id || config.level !== 1) throw Error();
    new Intl.DateTimeFormat('en', { timeZone: config.timezone }).format();
    if (!config.timezone || !['recurring-12', 'distinct-84'].includes(config.conceptPolicy)) throw Error();
    const boundaries = config.dayStarts.map(instant);
    const cutoff = instant(config.enrollmentCutoff);
    if (boundaries.length !== 8 || boundaries.some(n => !Number.isFinite(n)) || !Number.isFinite(cutoff) || cutoff > boundaries[0]) throw Error();
    for (let i = 1; i < 8; i++) {
      const days = calendarOrdinal(boundaries[i], config.timezone) - calendarOrdinal(boundaries[i - 1], config.timezone);
      if (boundaries[i] <= boundaries[i - 1] || (i < 7 ? days !== 1 : days < 0 || days > 1)) throw Error();
    }
    return { available: true, boundaries, cutoff, timezone: config.timezone };
  } catch { return { available: false, reason: 'Round unavailable: timezone, cutoff, seven daily windows and concept policy require explicit configuration.' }; }
}
export function availability(config, now) {
  const c = configuration(config);
  if (!c.available) return c;
  let roundId = config.id, previousRoundId = null, previousEnd = null;
  if (config.repeatWeekly) {
    let week = Math.max(0, Math.floor((calendarOrdinal(now, c.timezone) - calendarOrdinal(c.boundaries[0], c.timezone)) / 7));
    const boundaries = week => c.boundaries.map(n => shiftWeeks(n, week, c.timezone));
    if (now >= boundaries(week)[7]) week++;
    const selected = boundaries(week);
    if (week > 0) {
      previousRoundId = `${config.id}:${dateIn(boundaries(week - 1)[0], c.timezone)}`;
      previousEnd = boundaries(week - 1)[7];
    }
    roundId = `${config.id}:${dateIn(selected[0], c.timezone)}`;
    c.cutoff = shiftWeeks(c.cutoff, week, c.timezone);
    c.boundaries = selected;
  }
  const day = c.boundaries.findIndex((start, i) => i < 7 && now >= start && now < c.boundaries[i + 1]);
  return { ...c, roundId, previousRoundId, previousEnd, phase: now < c.boundaries[0] ? 'get-ready' : now >= c.boundaries[7] ? 'finishline' : 'observation', day, enrollmentOpen: now < c.cutoff, started: now >= c.boundaries[0], ended: now >= c.boundaries[7], next: c.boundaries.find(n => n > now) ?? null, date: dateIn(now, c.timezone) };
}
export const normalize = value => String(value).normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export function accepted(pack, concept, value) {
  const entry = pack?.[concept];
  return Boolean(entry && [entry.label, ...(entry.aliases || [])].some(alias => normalize(alias) === normalize(value)));
}
export function studyLabels(concept, selected, packs) {
  return selected.map(tag => {
    if (!packs[tag]?.[concept]) throw Error(`Unsupported language/content: ${tag}`);
    return { tag, label: packs[tag][concept].label };
  });
}
export function totalScore(state) {
  const daily = Array.from({ length: 7 }, (_, i) => state.attempts[i]?.correct?.length || 0);
  const total = daily.reduce((a, b) => a + b, 0);
  return { daily, total, denominator: 84, qualifies: total >= 76 };
}
export function previewAccounting(scores, carryCents = 0) {
  if (!Array.isArray(scores) || !Number.isSafeInteger(carryCents) || carryCents < 0 || scores.some(n => !Number.isInteger(n) || n < 0 || n > 84)) throw Error('Invalid integer preview ledger');
  const qualified = scores.filter(n => n >= 76).length;
  const forfeitures = BigInt(scores.length - qualified) * 100n;
  const pool = forfeitures + BigInt(carryCents);
  return { principalCents: qualified ? '100' : '0', qualifiers: qualified, shareCents: qualified ? String(pool / BigInt(qualified)) : '0', unresolvedDustCents: qualified ? String(pool % BigInt(qualified)) : '0', carryoverCents: qualified ? '0' : String(pool), settlementBlocked: true, gates: ['Payments disabled', 'Asset/network/custody/security review', 'Dust policy unresolved', 'Cancellation/refunds unresolved', 'Outage/dispute policy unresolved', 'Trusted eligibility and scoring authority required'] };
}
export class Round {
  constructor({ config, scenes, packs, storage, clock = Date.now }) {
    Object.assign(this, { config, scenes, packs, storage, clock });
  }
  get roundId() { return availability(this.config, this.clock()).roundId || this.config.id; }
  get storageKey() { return `${KEY}:${this.roundId}`; }
  read(roundId = this.roundId) {
    const raw = this.storage.getItem(`${KEY}:${roundId}`);
    if (!raw) return { version: 1, round: roundId, language: null, enrolledAt: null, attempts: {}, stories: {} };
    let value;
    try { value = JSON.parse(raw); } catch { throw Error('Local record corrupt; restore or explicitly clear it. No new attempt allowed.'); }
    if (value.version !== 1 || value.round !== roundId || !value.attempts || !value.stories || (value.language !== null && !this.packs[value.language])) throw Error('Invalid local record; no new attempt allowed.');
    for (const [day, a] of Object.entries(value.attempts)) {
      if (!/^[0-6]$/.test(day) || !Number.isFinite(a.startedAt) || !Number.isFinite(a.deadline) || a.deadline <= a.startedAt || a.deadline > a.startedAt + 120000 || !Array.isArray(a.correct) || new Set(a.correct).size !== a.correct.length || a.correct.some(id => !this.scenes[day].targets.some(t => t.id === id)) || !['running', 'finished'].includes(a.status)) throw Error('Invalid attempt record; no retry allowed.');
    }
    return value;
  }
  write(state) { this.storage.setItem(`${KEY}:${state.round}`, JSON.stringify(state)); return state; }
  context() {
    const state = this.read(), now = this.clock(), status = availability(this.config, now);
    if (status.available && (this.scenes.length !== 7 || this.scenes.some(s => s.targets.length !== 12) || (this.config.conceptPolicy === 'distinct-84' && new Set(this.scenes.flatMap(s => s.targets.map(t => t.concept))).size !== 84))) {
      status.available = false;
      status.reason = 'Round unavailable: configured concept policy does not match the reviewed scene bank.';
    }
    let changed = false;
    for (const attempt of Object.values(state.attempts)) {
      if (attempt.status === 'running' && now >= attempt.deadline) { attempt.status = 'finished'; changed = true; }
    }
    if (changed) this.write(state);
    let previousState = null;
    if (status.previousRoundId) {
      previousState = this.read(status.previousRoundId);
      for (const attempt of Object.values(previousState.attempts)) {
        if (attempt.status === 'running' && now >= attempt.deadline) { attempt.status = 'finished'; this.write(previousState); }
      }
    }
    return { state, status, now, previousState };
  }
  enroll(language, eligibility) {
    const { state, status, now } = this.context();
    if (!status.available || !status.enrollmentOpen) throw Error('Enrollment closed or round unavailable.');
    if (!this.packs[language]) throw Error('Unsupported language; no English fallback.');
    if (!eligibility?.eligible || eligibility.authorization !== false) throw Error('Explicit public contributor eligibility check required; not financial authorization.');
    if (state.language) throw Error('Weekly language is locked.');
    state.language = language; state.enrolledAt = now;
    return this.write(state);
  }
  go() {
    const { state, status, now } = this.context();
    if (!status.available || status.day < 0 || !state.language) throw Error('Not eligible today; enroll before cutoff.');
    if (state.attempts[status.day]) throw Error('One attempt per day; resume existing attempt.');
    state.attempts[status.day] = { startedAt: now, deadline: Math.min(now + 120000, status.boundaries[status.day + 1]), correct: [], status: 'running' };
    return this.write(state);
  }
  answer(targetId, text) {
    const { state, status, now } = this.context();
    const attempt = state.attempts[status.day];
    if (!attempt || attempt.status !== 'running' || now >= attempt.deadline) throw Error('Attempt closed.');
    const target = this.scenes[status.day].targets.find(t => t.id === targetId);
    if (!target || attempt.correct.includes(targetId)) throw Error('Choose an unanswered target.');
    if (!accepted(this.packs[state.language], target.concept, text)) return { correct: false, state };
    attempt.correct.push(targetId);
    if (attempt.correct.length === 12) attempt.status = 'finished';
    this.write(state);
    return { correct: true, state };
  }
  finish() {
    const { state, status } = this.context();
    const attempt = state.attempts[status.day];
    if (!attempt || attempt.status !== 'running') throw Error('No running attempt.');
    attempt.status = 'finished';
    return this.write(state);
  }
  story(day, text) {
    if (!Number.isInteger(day) || day < 0 || day > 6 || typeof text !== 'string' || text.length > 4000) throw Error('Story must be at most 4000 characters.');
    const { state } = this.context();
    state.stories[day] = text;
    return this.write(state);
  }
}

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState, validateBackup, isValidDay, isValidMetric } = require('../state.js');

const validDay = { date: '2026-01-01', code: 'OFF', times: [], airports: [], kind: 'rest', report: null, release: null };
const validMetric = { date: '2026-01-01', fat: 20, weight: 75 };

test('normalizeState: corrupted top-level JSON resets to defaults and flags corrupted', () => {
  const { state, corrupted } = normalizeState('{not valid json!!');
  assert.equal(corrupted, true);
  assert.equal(state.mode, '16');
  assert.equal(state.context, 'auto');
  assert.equal(state.goal, 'fat');
  assert.deepEqual(state.days, []);
  assert.deepEqual(state.metrics, []);
});

test('normalizeState: missing key (fresh install) is not treated as corrupted', () => {
  const { state, corrupted } = normalizeState(null);
  assert.equal(corrupted, false);
  assert.equal(state.mode, '16');
});

test('normalizeState: valid JSON with bad individual fields is fixed silently', () => {
  const raw = JSON.stringify({
    mode: '99', context: 'bogus', goal: 12345,
    days: 'not-an-array',
    metrics: [{ fat: 999, weight: 70, date: '2026-01-01' }, validMetric],
    bf: 'nope', notify: 'yes', fired: [1, 2, 3],
    fastStart: 'not-a-date',
  });
  const { state, corrupted } = normalizeState(raw);
  assert.equal(corrupted, false, 'field-level issues are not full corruption');
  assert.equal(state.mode, '16');
  assert.equal(state.context, 'auto');
  assert.equal(state.goal, 'fat');
  assert.deepEqual(state.days, []);
  assert.equal(state.metrics.length, 1, 'out-of-range metric dropped, valid one kept');
  assert.equal(state.bf.on, true);
  assert.equal(state.notify, true);
  assert.deepEqual(state.fired, {});
  assert.equal('fastStart' in state, false, 'unparseable fastStart is dropped, not kept as Invalid Date');
});

test('normalizeState: a single malformed day is dropped without discarding the rest', () => {
  const raw = JSON.stringify({ days: [validDay, { date: 'not-a-date', code: 'X' }, { ...validDay, date: '2026-01-02' }] });
  const { state } = normalizeState(raw);
  assert.equal(state.days.length, 2);
});

test('isValidDay / isValidMetric: sanity checks used by normalizeState and validateBackup', () => {
  assert.equal(isValidDay(validDay), true);
  assert.equal(isValidDay({ ...validDay, kind: 'bogus' }), false);
  assert.equal(isValidDay({ ...validDay, date: '01-01-2026' }), false);
  assert.equal(isValidMetric(validMetric), true);
  assert.equal(isValidMetric({ ...validMetric, fat: 999 }), false);
  assert.equal(isValidMetric({ ...validMetric, weight: 5 }), false);
  assert.equal(isValidMetric({ ...validMetric, weight: null }), true, 'weight is optional');
});

function goodBackup(overrides = {}) {
  return {
    app: 'fuel-window', v: 1, saved: new Date().toISOString(),
    state: { mode: '16', context: 'auto', goal: 'fat', days: [validDay], metrics: [validMetric], ...overrides },
  };
}

test('validateBackup: accepts a well-formed backup', () => {
  assert.doesNotThrow(() => validateBackup(goodBackup()));
});

test('validateBackup: accepts a backup missing newer fields (e.g. parserWarnings)', () => {
  // No parserWarnings key at all - simulates a pre-this-release backup.
  const backup = goodBackup();
  assert.equal('parserWarnings' in backup.state, false);
  assert.doesNotThrow(() => validateBackup(backup));
});

test('validateBackup: rejects wrong app identifier', () => {
  const backup = goodBackup();
  backup.app = 'something-else';
  assert.throws(() => validateBackup(backup), /не копия Fuel Window/);
});

test('validateBackup: rejects unsupported version', () => {
  for (const v of [0, 2, '1', undefined]) {
    const backup = goodBackup();
    backup.v = v;
    assert.throws(() => validateBackup(backup), /версия/);
  }
});

test('validateBackup: rejects invalid mode/context/goal enums', () => {
  assert.throws(() => validateBackup(goodBackup({ mode: '99' })), /режим/);
  assert.throws(() => validateBackup(goodBackup({ context: 'bogus' })), /контекст/);
  assert.throws(() => validateBackup(goodBackup({ goal: 'bogus' })), /цель/);
});

test('validateBackup: rejects the whole file when even one day is malformed', () => {
  const backup = goodBackup({ days: [validDay, { date: 'not-a-date', code: 'X' }] });
  assert.throws(() => validateBackup(backup), /ростер/);
});

test('validateBackup: rejects the whole file when even one metric is out of range', () => {
  const backup = goodBackup({ metrics: [validMetric, { date: '2026-01-01', fat: 999 }] });
  assert.throws(() => validateBackup(backup), /замеры/);
});

test('validateBackup: rejects a missing/non-object state', () => {
  const backup = goodBackup();
  delete backup.state;
  assert.throws(() => validateBackup(backup));
});

test('isValidDay: a well-formed but impossible date is rejected - it makes Circadian.get() throw', () => {
  assert.equal(isValidDay({ ...validDay, date: '2026-99-99' }), false);
  assert.equal(isValidDay({ ...validDay, date: '2026-13-01' }), false);
  assert.equal(isValidDay({ ...validDay, date: '2026-00-10' }), false);
});

test('isValidDay: a date that silently rolls over to the next month is rejected', () => {
  assert.equal(isValidDay({ ...validDay, date: '2026-02-31' }), false, 'Date.parse turns this into 3 March');
  assert.equal(isValidDay({ ...validDay, date: '2026-02-29' }), false, '2026 is not a leap year');
  assert.equal(isValidDay({ ...validDay, date: '2024-02-29' }), true, '2024 is');
});

test('validateBackup: a backup carrying an impossible day is rejected whole', () => {
  const backup = { app: 'fuel-window', v: 1, state: { mode: '16', context: 'auto', goal: 'fat', days: [{ ...validDay, date: '2026-99-99' }], metrics: [] } };
  assert.throws(() => validateBackup(backup), /ростер/);
});

test('normalizeState: an impossible selected day is dropped - it would throw in drawDay() at startup', () => {
  const { state } = normalizeState(JSON.stringify({ date: '2026-99-99' }));
  assert.equal(state.date, undefined);
});

test('normalizeState: a real selected day is kept even when no roster is loaded', () => {
  const { state } = normalizeState(JSON.stringify({ date: '2026-01-01' }));
  assert.equal(state.date, '2026-01-01');
});

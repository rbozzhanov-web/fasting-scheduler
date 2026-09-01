const test = require('node:test');
const assert = require('node:assert/strict');
const { dur, computeFastState, actionLabel, closeNotificationBody } = require('../timer.js');

test('dur() formats a millisecond delta as HH:MM:SS', () => {
  assert.equal(dur(0), '00:00:00');
  assert.equal(dur(2 * 3600e3 + 15 * 60e3 + 34e3), '02:15:34');
  assert.equal(dur(59e3), '00:00:59');
});

test('phase: idle when no fastStart is set', () => {
  const r = computeFastState(null, '16', new Date('2026-03-10T12:00:00Z'));
  assert.equal(r.phase, 'idle');
});

test('phase: fasting before the window opens', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-11T04:00:00Z'); // 8h into a 16h fast
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'fast');
  assert.ok(Math.abs(r.pct - 50) < 0.01);
});

test('phase: eating after the window opens, with elapsed-time pct', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  // 16h fast ends 2026-03-11T12:00:00Z; 2h15m34s into the 8h eating window.
  const now = new Date('2026-03-11T14:15:34Z');
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'eat');
  assert.equal(dur(now - r.end), '02:15:34');
  // pct reflects % of the eating window elapsed, not remaining.
  const expectedPct = (2 * 3600e3 + 15 * 60e3 + 34e3) / (8 * 3600e3) * 100;
  assert.ok(Math.abs(r.pct - expectedPct) < 0.01);
});

test('phase: closed (over) once the eating window has passed', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-12T00:00:00Z'); // well past the 24h cycle
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'over');
});

test('all four modes produce a consistent 24h fast+eat split', () => {
  for (const mode of ['12', '14', '16', '18']) {
    const start = new Date('2026-03-10T20:00:00Z');
    const r = computeFastState(start.toISOString(), mode, start);
    assert.equal(r.fastMs, +mode * 3600e3);
    assert.equal(r.eatMs, (24 - +mode) * 3600e3);
    assert.equal(r.fastMs + r.eatMs, 24 * 3600e3);
  }
});

test('manual start entry is just another fastStart value - same phase logic applies', () => {
  // Simulates #applyStart writing an ISO string for "16 hours ago".
  const manualStart = new Date(Date.now() - 16.5 * 3600e3).toISOString();
  const r = computeFastState(manualStart, '16', new Date());
  assert.equal(r.phase, 'eat');
});

test('changing mode with the same fastStart re-derives the phase from scratch', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-11T09:00:00Z'); // 13h after start
  // Under 16h mode, 13h in is still fasting (fast window is 16h).
  assert.equal(computeFastState(start.toISOString(), '16', now).phase, 'fast');
  // Switching to 12h mode with the same start/now, 13h in is now eating (fast window is only 12h).
  assert.equal(computeFastState(start.toISOString(), '12', now).phase, 'eat');
});

test('midnight crossing does not disturb phase derivation', () => {
  // Fast starts at 22:00 on day 1, crosses midnight; 16h fast ends 14:00 day 2.
  const start = new Date('2026-03-10T22:00:00Z');
  const beforeMidnight = new Date('2026-03-10T23:30:00Z');
  const afterMidnight = new Date('2026-03-11T00:30:00Z');
  assert.equal(computeFastState(start.toISOString(), '16', beforeMidnight).phase, 'fast');
  assert.equal(computeFastState(start.toISOString(), '16', afterMidnight).phase, 'fast');
});

test('elapsed counter reaches its maximum just before transitioning to "over"', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const r = computeFastState(start.toISOString(), '16', start); // just to get eatMs
  const justBeforeOver = new Date(r.end.getTime() + r.eatMs - 1000);
  const state = computeFastState(start.toISOString(), '16', justBeforeOver);
  assert.equal(state.phase, 'eat');
  assert.equal(dur(justBeforeOver - state.end), '07:59:59');
});

test('active fast action is described as cancellation, matching current state behavior', () => {
  assert.equal(actionLabel('fast'), 'Отменить голодание');
  assert.equal(actionLabel('eat'), 'Начать голодание');
  assert.equal(actionLabel('over'), 'Начать голодание');
});

test('close notification does not claim a new fast started automatically', () => {
  assert.equal(
    closeNotificationBody('Начинается голодание 16 ч.'),
    'Запустите новое голодание, когда будете готовы.'
  );
  assert.equal(closeNotificationBody('Другой текст'), 'Другой текст');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { dur, computeFastState, actionLabel, closeNotificationBody, validEarlyEnd, cycleEventTimes, patchActiveIcs } = require('../timer.js');

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
  const now = new Date('2026-03-11T04:00:00Z');
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'fast');
  assert.ok(Math.abs(r.pct - 50) < 0.01);
});

test('phase: eating after the window opens, with elapsed-time pct', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-11T14:15:34Z');
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'eat');
  assert.equal(dur(now - r.end), '02:15:34');
  const expectedPct = (2 * 3600e3 + 15 * 60e3 + 34e3) / (8 * 3600e3) * 100;
  assert.ok(Math.abs(r.pct - expectedPct) < 0.01);
});

test('phase: closed (over) once the eating window has passed', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-12T00:00:00Z');
  const r = computeFastState(start.toISOString(), '16', now);
  assert.equal(r.phase, 'over');
});

test('all four modes produce a consistent planned split when not ended early', () => {
  for (const mode of ['12', '14', '16', '18']) {
    const start = new Date('2026-03-10T20:00:00Z');
    const r = computeFastState(start.toISOString(), mode, start);
    assert.equal(r.fastMs, +mode * 3600e3);
    assert.equal(r.plannedFastMs, +mode * 3600e3);
    assert.equal(r.eatMs, (24 - +mode) * 3600e3);
  }
});

test('manual start entry uses the same phase logic', () => {
  const manualStart = new Date(Date.now() - 16.5 * 3600e3).toISOString();
  const r = computeFastState(manualStart, '16', new Date());
  assert.equal(r.phase, 'eat');
});

test('changing mode with the same fastStart re-derives the phase', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const now = new Date('2026-03-11T09:00:00Z');
  assert.equal(computeFastState(start.toISOString(), '16', now).phase, 'fast');
  assert.equal(computeFastState(start.toISOString(), '12', now).phase, 'eat');
});

test('midnight crossing does not disturb phase derivation', () => {
  const start = new Date('2026-03-10T22:00:00Z');
  assert.equal(computeFastState(start.toISOString(), '16', new Date('2026-03-10T23:30:00Z')).phase, 'fast');
  assert.equal(computeFastState(start.toISOString(), '16', new Date('2026-03-11T00:30:00Z')).phase, 'fast');
});

test('elapsed counter reaches maximum just before transitioning to over', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const r = computeFastState(start.toISOString(), '16', start);
  const justBeforeOver = new Date(r.end.getTime() + r.eatMs - 1000);
  const state = computeFastState(start.toISOString(), '16', justBeforeOver);
  assert.equal(state.phase, 'eat');
  assert.equal(dur(justBeforeOver - state.end), '07:59:59');
});

test('early completion immediately opens the eating window', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const earlyEnd = new Date('2026-03-11T08:00:00Z');
  const now = new Date('2026-03-11T08:30:00Z');
  const r = computeFastState(start.toISOString(), '16', now, earlyEnd.toISOString());
  assert.equal(r.phase, 'eat');
  assert.equal(r.endedEarly, true);
  assert.equal(r.actualFastMs, 12 * 3600e3);
  assert.equal(r.fastMs, 12 * 3600e3);
  assert.equal(r.end.toISOString(), earlyEnd.toISOString());
  assert.equal(r.eatEnd.toISOString(), '2026-03-11T16:00:00.000Z');
  assert.equal(dur(now - r.end), '00:30:00');
});

test('early completion preserves the configured eating-window duration', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  for (const mode of ['12', '14', '16', '18']) {
    const earlyEnd = new Date(start.getTime() + 6 * 3600e3);
    const r = computeFastState(start.toISOString(), mode, earlyEnd, earlyEnd.toISOString());
    assert.equal(r.phase, 'eat');
    assert.equal(r.eatEnd - r.end, (24 - +mode) * 3600e3);
  }
});

test('event times use the actual early end, not the nominal fasting end', () => {
  const start = '2026-03-10T20:00:00.000Z';
  const earlyEnd = '2026-03-11T08:00:00.000Z';
  const t = cycleEventTimes(start, '16', earlyEnd);
  assert.equal(new Date(t.open).toISOString(), earlyEnd);
  assert.equal(new Date(t.close).toISOString(), '2026-03-11T16:00:00.000Z');
  assert.equal(t.actualFastMs, 12 * 3600e3);
  assert.equal(t.endedEarly, true);
});

test('event times remain nominal when there is no early completion', () => {
  const t = cycleEventTimes('2026-03-10T20:00:00.000Z', '16');
  assert.equal(new Date(t.open).toISOString(), '2026-03-11T12:00:00.000Z');
  assert.equal(new Date(t.close).toISOString(), '2026-03-11T20:00:00.000Z');
  assert.equal(t.endedEarly, false);
});

test('active calendar pair is moved to actual early open/close', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:fw-active-open@fuelwindow',
    'DTSTART:20260311T120000Z',
    'DTEND:20260311T121500Z',
    'DESCRIPTION:Окно питания открыто, голодание 16 ч завершено',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fw-active-close@fuelwindow',
    'DTSTART:20260311T200000Z',
    'DTEND:20260311T201500Z',
    'DESCRIPTION:Окно питания закрыто, начинается голодание 16 ч',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
  const state = { fastStart: '2026-03-10T20:00:00.000Z', fastEnd: '2026-03-11T08:00:00.000Z', mode: '16' };
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-03-11T09:00:00Z');
  try {
    const out = patchActiveIcs(ics, state);
    assert.match(out, /DTSTART:20260311T080000Z/);
    assert.match(out, /DTSTART:20260311T160000Z/);
    assert.doesNotMatch(out, /DTSTART:20260311T120000Z/);
    assert.doesNotMatch(out, /начинается голодание 16 ч/);
  } finally {
    Date.now = originalNow;
  }
});

test('expired early-finished active calendar pair is removed', () => {
  const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fw-active-open@fuelwindow\r\nDTSTART:20260311T120000Z\r\nDTEND:20260311T121500Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:fw-active-close@fuelwindow\r\nDTSTART:20260311T200000Z\r\nDTEND:20260311T201500Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const state = { fastStart: '2026-03-10T20:00:00.000Z', fastEnd: '2026-03-11T08:00:00.000Z', mode: '16' };
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-03-11T17:00:00Z');
  try {
    const out = patchActiveIcs(ics, state);
    assert.doesNotMatch(out, /fw-active-open/);
    assert.doesNotMatch(out, /fw-active-close/);
  } finally {
    Date.now = originalNow;
  }
});

test('invalid or late fastEnd is ignored', () => {
  const start = new Date('2026-03-10T20:00:00Z');
  const nominal = new Date('2026-03-11T12:00:00Z');
  assert.equal(validEarlyEnd(start, nominal, 'bad'), null);
  assert.equal(validEarlyEnd(start, nominal, '2026-03-10T19:00:00Z'), null);
  assert.equal(validEarlyEnd(start, nominal, '2026-03-11T13:00:00Z'), null);
  const r = computeFastState(start.toISOString(), '16', new Date('2026-03-11T11:00:00Z'), '2026-03-11T13:00:00Z');
  assert.equal(r.phase, 'fast');
  assert.equal(r.endedEarly, false);
});

test('active fast action is real completion now', () => {
  assert.equal(actionLabel('fast'), 'Завершить голодание');
  assert.equal(actionLabel('eat'), 'Начать голодание');
  assert.equal(actionLabel('over'), 'Начать голодание');
});

test('close notification does not claim a new fast started automatically', () => {
  assert.equal(closeNotificationBody('anything'), 'Запустите новое голодание, когда будете готовы.');
});

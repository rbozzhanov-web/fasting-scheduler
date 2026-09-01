const test = require('node:test');
const assert = require('node:assert/strict');
const Circadian = require('../circadian.js');

test('off(): DST transition - Europe/London is UTC+0 in winter, UTC+1 in summer', () => {
  assert.equal(Circadian.off('Europe/London', '2026-01-15'), 0);
  assert.equal(Circadian.off('Europe/London', '2026-07-15'), 1);
});

test('off(): fractional UTC offset - Asia/Kolkata is UTC+5:30', () => {
  assert.equal(Circadian.off('Asia/Kolkata', '2026-01-01'), 5.5);
});

test('off(): year transition does not disturb a non-DST zone offset', () => {
  assert.equal(Circadian.off('Asia/Almaty', '2025-12-31'), 5);
  assert.equal(Circadian.off('Asia/Almaty', '2026-01-01'), 5);
});

test('off(): throws on an invalid zone', () => {
  assert.throws(() => Circadian.off('Not/AZone', '2026-01-01'));
});

test('stateAt(): flight day remains in departure station timezone until the next roster day', () => {
  const days = [
    { date: '2026-09-02', kind: 'early', times: ['06:00', '14:00'], airports: ['FRA'] },
    { date: '2026-09-03', kind: 'rest', times: [], airports: [] },
  ];
  const departure = Circadian.stateAt(days[0], days);
  const layover = Circadian.stateAt(days[1], days);
  assert.equal(departure.station, 'ALA');
  assert.equal(departure.zone, 'Asia/Almaty');
  assert.equal(layover.station, 'FRA');
  assert.equal(layover.zone, 'Europe/Berlin');
});

test('get(): report time on ALA to FRA duty is interpreted in departure local time', () => {
  const days = [
    { date: '2026-09-02', kind: 'early', times: ['06:00', '14:00'], airports: ['FRA'] },
    { date: '2026-09-03', kind: 'rest', times: [], airports: [] },
  ];
  const p = Circadian.get(days[0], days, 'auto', 16, { goal: 'keep' });
  assert.equal(p.zone, 'Asia/Almaty');
  assert.equal(p.dest, 'ALA');
  assert.equal(p.report, 360);
  assert.equal(p.start, 450, '06:00 report produces 07:30 opening in Almaty, not Frankfurt');
});

test('stateAt(): a short layover (<=2 days) does not adapt the body clock to local time', () => {
  const days = [
    { date: '2026-01-01', airports: ['LHR'] },
    { date: '2026-01-02', airports: ['ALA'] },
  ];
  const st = Circadian.stateAt(days[1], days);
  assert.equal(st.station, 'LHR');
  assert.equal(st.shortStay, true);
  assert.equal(st.bodyZone, st.homeOff, 'body clock stays on home-base time for a short stay');
});

test('stateAt(): long stay adapts before return, jet lag appears after arrival home', () => {
  const days = [
    { date: '2026-01-01', airports: ['LHR'] },
    { date: '2026-01-10', airports: ['ALA'] },
    { date: '2026-01-11', airports: [] },
  ];
  const returnDuty = Circadian.stateAt(days[1], days);
  assert.equal(returnDuty.station, 'LHR', 'return duty still starts in London');
  assert.equal(returnDuty.bodyZone, 0, 'body clock adapted to London during long stay');
  const homeDay = Circadian.stateAt(days[2], days);
  assert.equal(homeDay.station, 'ALA');
  assert.notEqual(homeDay.body, 0, 'body remains misaligned on the first day back home');
});

test('stateAt(): roster spanning a year boundary processes station changes correctly', () => {
  const days = [
    { date: '2025-12-30', airports: ['ALA'] },
    { date: '2025-12-31', airports: ['LHR'] },
    { date: '2026-01-02', airports: ['ALA'] },
  ];
  assert.doesNotThrow(() => Circadian.stateAt({ date: '2026-01-03' }, days));
  const st = Circadian.stateAt({ date: '2026-01-03' }, days);
  assert.equal(st.station, 'ALA');
});

test('get(): early duty places the eating window after report time', () => {
  const day = { date: '2026-01-01', kind: 'early', times: ['06:00', '14:00'], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'early');
  assert.ok(p.start > 6 * 60);
});

test('get(): night duty places the eating window before report and does not promise a 21:00 close', () => {
  const day = { date: '2026-01-01', kind: 'night', times: ['22:00', '06:00'], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 12, { goal: 'fat' });
  assert.equal(p.kind, 'night');
  assert.ok(p.start < 22 * 60);
  assert.ok(p.start + p.h * 60 > 21 * 60, 'night duty is intentionally exempt from the fat-goal close cap');
  assert.match(p.note, /начинается до report time/);
  assert.doesNotMatch(p.note, /завершено не позже 21:00/);
});

test('get(): fat goal caps non-night windows at 21:00 for every fasting mode', () => {
  for (const fast of [12, 14, 16, 18]) {
    const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
    const p = Circadian.get(day, [day], 'auto', fast, { goal: 'fat' });
    assert.ok(p.start + p.h * 60 <= 21 * 60, `${fast}:${24-fast} must close by 21:00`);
  }
});

test('get(): keep goal does not impose the 21:00 cap', () => {
  const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 12, { goal: 'keep' });
  assert.equal(p.start, 720);
  assert.equal(p.start + p.h * 60, 1440);
});

test('get(): rest day at home with no travel opens at noon before optional goal cap', () => {
  const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'keep' });
  assert.equal(p.kind, 'rest');
  assert.equal(p.start, 720);
});

test('get(): hotel breakfast can move an away rest-day window earlier', () => {
  const days = [
    { date: '2026-01-01', kind: 'duty', times: ['09:00', '17:00'], airports: ['LHR'] },
    { date: '2026-01-10', kind: 'rest', times: [], airports: [] },
  ];
  const p = Circadian.get(days[1], days, 'auto', 16, {
    goal: 'keep', breakfast: { on: true, from: 390, to: 600 },
  });
  assert.equal(p.away, true);
  assert.equal(p.hotel, true);
  assert.ok(p.start >= 390 && p.start <= 540, 'opening is moved into the breakfast-compatible range');
});

test('get(): hotel breakfast does not alter a home-base day', () => {
  const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, {
    goal: 'keep', breakfast: { on: true, from: 390, to: 600 },
  });
  assert.equal(p.away, false);
  assert.equal(p.hotel, false);
  assert.equal(p.start, 720);
});

test('get(): hotel breakfast never shifts a night-duty window', () => {
  const days = [
    { date: '2026-01-01', airports: ['LHR'] },
    { date: '2026-01-02', kind: 'night', times: ['22:00', '06:00'], airports: [] },
  ];
  const base = Circadian.get(days[1], days, 'auto', 16, { goal: 'keep' });
  const withBreakfast = Circadian.get(days[1], days, 'auto', 16, {
    goal: 'keep', breakfast: { on: true, from: 390, to: 600 },
  });
  assert.equal(withBreakfast.start, base.start);
  assert.equal(withBreakfast.hotel, false);
  assert.match(withBreakfast.note, /ночное окно не сдвигается/);
});

test('get(): overnight release is represented after midnight without corrupting report', () => {
  const day = { date: '2026-01-01', kind: 'night', times: ['22:00', '06:00'], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'keep' });
  assert.equal(p.report, 1320);
  assert.equal(p.release, 1800);
});

test('get(): rest day after a long stay away follows adapted body time instead of snapping to noon', () => {
  const days = [
    { date: '2026-01-01', kind: 'duty', times: ['09:00', '17:00'], airports: ['LHR'] },
    { date: '2026-01-12', kind: 'rest', times: [], airports: [] },
  ];
  const p = Circadian.get(days[1], days, 'auto', 16, { goal: 'keep' });
  assert.equal(p.kind, 'rest');
  assert.notEqual(p.body, 0);
  assert.notEqual(p.start, 720);
});

test('instants(): both endpoints keep their local wall-clock time across a spring-forward DST change', () => {
  const w = Circadian.instants({ date: '2026-03-28' }, { zone: 'Europe/London', start: 23 * 60, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '28/03/2026, 23:00');
  assert.equal(local(w.to), '29/03/2026, 07:00');
  assert.equal(w.to - w.from, 7 * 36e5);
});

test('instants(): both endpoints keep their local wall-clock time across a fall-back DST change', () => {
  const w = Circadian.instants({ date: '2026-10-24' }, { zone: 'Europe/London', start: 23 * 60, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '24/10/2026, 23:00');
  assert.equal(local(w.to), '25/10/2026, 07:00');
  assert.equal(w.to - w.from, 9 * 36e5);
});

test('instants(): a window before the transition on transition day is not given the post-transition offset', () => {
  const w = Circadian.instants({ date: '2026-03-29' }, { zone: 'Europe/London', start: 0, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '29/03/2026, 00:00');
});

test('instants(): a zone without DST is unaffected on the day destinations change clocks', () => {
  const w = Circadian.instants({ date: '2026-03-29' }, { zone: 'Asia/Almaty', start: 12 * 60, h: 8 });
  assert.equal(w.to - w.from, 8 * 36e5);
  assert.equal(w.from, Date.parse('2026-03-29T07:00:00Z'));
});

test('offAt(): resolves the offset at a moment, not for a whole day', () => {
  assert.equal(Circadian.offAt('Europe/London', Date.parse('2026-03-29T00:30:00Z')), 0);
  assert.equal(Circadian.offAt('Europe/London', Date.parse('2026-03-29T01:30:00Z')), 1);
});

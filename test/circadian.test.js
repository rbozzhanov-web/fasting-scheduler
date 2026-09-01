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

test('off(): year transition does not disturb a non-DST zone\'s offset', () => {
  assert.equal(Circadian.off('Asia/Almaty', '2025-12-31'), 5);
  assert.equal(Circadian.off('Asia/Almaty', '2026-01-01'), 5);
});

test('off(): throws on an invalid zone - callers (e.g. index.html\'s zoneOff) are responsible for the fallback', () => {
  assert.throws(() => Circadian.off('Not/AZone', '2026-01-01'));
});

test('stateAt(): a short layover (<=2 days) does not adapt the body clock to local time', () => {
  const days = [
    { date: '2026-01-01', airports: ['LHR'] },
    { date: '2026-01-02', airports: ['ALA'] },
  ];
  const st = Circadian.stateAt(days[0], days);
  assert.equal(st.station, 'LHR');
  assert.equal(st.shortStay, true);
  assert.equal(st.bodyZone, st.homeOff, 'body clock stays on home-base time for a short stay');
});

test('stateAt(): a long stay away from home fully adapts the body clock, causing jet lag on return', () => {
  const days = [
    { date: '2026-01-01', airports: ['LHR'] },
    { date: '2026-01-10', airports: ['ALA'] },
  ];
  const st = Circadian.stateAt(days[1], days);
  assert.equal(st.station, 'ALA');
  assert.equal(st.shortStay, false);
  assert.equal(st.bodyZone, 0, 'body clock adapted to London time (UTC+0) during the long stay');
  assert.notEqual(st.body, 0, 'now misaligned with home local time on return');
});

test('stateAt(): roster spanning a year boundary sorts and processes correctly', () => {
  const days = [
    { date: '2025-12-30', airports: ['ALA'] },
    { date: '2025-12-31', airports: ['LHR'] },
    { date: '2026-01-02', airports: ['ALA'] },
  ];
  assert.doesNotThrow(() => Circadian.stateAt(days[2], days));
  const st = Circadian.stateAt(days[2], days);
  assert.equal(st.station, 'ALA');
});

test('get(): early duty places the eating window after report time', () => {
  const day = { date: '2026-01-01', kind: 'early', times: ['06:00', '14:00'], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'early');
  assert.ok(p.start > 6 * 60, 'window opens after the 06:00 report time');
});

test('get(): night duty places the eating window before the report time', () => {
  const day = { date: '2026-01-01', kind: 'night', times: ['22:00', '06:00'], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'night');
  assert.ok(p.start < 22 * 60, 'window opens before the 22:00 report time');
});

test('get(): rest day at home with no travel opens at noon', () => {
  const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'rest');
  assert.equal(p.start, 720, 'no body-clock offset from home means the window stays at noon');
});

test('get(): rest day after a long stay away follows the adapted body clock instead of snapping to noon', () => {
  const days = [
    { date: '2026-01-01', kind: 'duty', times: ['09:00', '17:00'], airports: ['LHR'] },
    { date: '2026-01-12', kind: 'rest', times: [], airports: ['ALA'] },
  ];
  const p = Circadian.get(days[1], days, 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'rest');
  assert.notEqual(p.body, 0, 'body clock is still adapted to London time on return');
  assert.notEqual(p.start, 720, 'window shifts away from noon to follow the misaligned body clock');
});

test('instants(): both endpoints keep their local wall-clock time across a spring-forward DST change', () => {
  // Europe/London moves 01:00 GMT -> 02:00 BST on 2026-03-29. A window opening
  // at 23:00 the evening before used to close at 08:00 local instead of 07:00,
  // because one noon-derived offset was applied to both ends.
  const w = Circadian.instants({ date: '2026-03-28' }, { zone: 'Europe/London', start: 23 * 60, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '28/03/2026, 23:00');
  assert.equal(local(w.to), '29/03/2026, 07:00');
  assert.equal(w.to - w.from, 7 * 36e5, 'the lost hour shortens the real window, the local hours stay put');
});

test('instants(): both endpoints keep their local wall-clock time across a fall-back DST change', () => {
  const w = Circadian.instants({ date: '2026-10-24' }, { zone: 'Europe/London', start: 23 * 60, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '24/10/2026, 23:00');
  assert.equal(local(w.to), '25/10/2026, 07:00');
  assert.equal(w.to - w.from, 9 * 36e5, 'the repeated hour lengthens the real window');
});

test('instants(): a window before the transition on the transition day is not given the post-transition offset', () => {
  // off() samples noon, by which point the change has happened - so the early
  // hours of that date would otherwise be shifted by an hour.
  const w = Circadian.instants({ date: '2026-03-29' }, { zone: 'Europe/London', start: 0, h: 8 });
  const local = ms => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
  assert.equal(local(w.from), '29/03/2026, 00:00');
});

test('instants(): a zone without DST is unaffected on the day its destinations change clocks', () => {
  const w = Circadian.instants({ date: '2026-03-29' }, { zone: 'Asia/Almaty', start: 12 * 60, h: 8 });
  assert.equal(w.to - w.from, 8 * 36e5);
  assert.equal(w.from, Date.parse('2026-03-29T07:00:00Z'), 'Almaty is UTC+5 year round');
});

test('offAt(): resolves the offset at a moment, not for a whole day', () => {
  assert.equal(Circadian.offAt('Europe/London', Date.parse('2026-03-29T00:30:00Z')), 0);
  assert.equal(Circadian.offAt('Europe/London', Date.parse('2026-03-29T01:30:00Z')), 1);
});

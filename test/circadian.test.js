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

test('get(): rest day gives a plain, roomy daytime window', () => {
  const day = { date: '2026-01-01', kind: 'rest', times: [], airports: [] };
  const p = Circadian.get(day, [day], 'auto', 16, { goal: 'fat' });
  assert.equal(p.kind, 'rest');
});

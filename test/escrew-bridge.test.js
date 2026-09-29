const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../state.js');
const { daysFromEscrew, loadEscrewRoster, KEY } = require('../escrew-bridge.js');

const roster = {
  duties: [
    { date: '2026-10-02', report: '2026-10-02T18:10', release: '2026-10-03T09:00', flights: [
      { flightNumber: 'KC187', origin: 'ALA', destination: 'CAN', departure: '20:40', arrival: '05:35' },
      { flightNumber: 'KC188', origin: 'CAN', destination: 'ALA', departure: '07:00', arrival: '08:30' }] },
    { date: '2026-10-05', flights: [{ flightNumber: 'KC855', origin: 'ALA', destination: 'NQZ', departure: '07:40', arrival: '09:25' }] },
    { date: '2026-10-07', flights: [] },
  ],
  absences: [{ code: 'VAC', date: '2026-10-09' }, { code: 'VAC', date: '2026-10-02' }],
  activities: [{ date: '2026-10-04', code: 'OFF', type: '' }, { date: '2026-10-05', code: 'OFF', type: '' },
    { date: '2026-10-11', code: 'SIM', title: 'Simulator', type: 'x', start: '2026-10-11T09:00', end: '2026-10-11T13:00' },
    { date: '2026-10-12', code: 'HOTEL', type: 'x' }],
};

test('daysFromEscrew: duty, rest, absence and timed activity become valid Fuel Window days', () => {
  const days = daysFromEscrew(roster);
  assert.deepEqual(days.map(d => d.date), ['2026-10-02', '2026-10-04', '2026-10-05', '2026-10-09', '2026-10-11']);
  assert.ok(days.every(State.isValidDay));
  const [d1, off, d2, vac, sim] = days;
  assert.deepEqual([d1.code, d1.kind, d1.report, d1.release, d1.airports], ['187', 'night', '18:10', '09:00', ['ALA', 'CAN', 'ALA']]);
  assert.equal(off.kind, 'rest');
  assert.deepEqual([d2.kind, d2.report, d2.release], ['early', '07:40', '09:25']);  // flights beat OFF on the same date
  assert.equal(vac.code, 'VAC');
  assert.equal(sim.kind, 'duty');
});

test('daysFromEscrew: absence on a duty date loses to the duty; garbage gives nothing', () => {
  assert.equal(daysFromEscrew(roster).find(d => d.date === '2026-10-02').code, '187');
  assert.deepEqual(daysFromEscrew(null), []);
  assert.deepEqual(daysFromEscrew({}), []);
});

test('loadEscrewRoster: reads the shared key, tolerates absence and junk', () => {
  const store = v => ({ getItem: k => (k === KEY ? v : null) });
  assert.equal(loadEscrewRoster(store(null)), null);
  assert.equal(loadEscrewRoster(store('{nope')), null);
  assert.equal(loadEscrewRoster(store(JSON.stringify(roster))).duties.length, 3);
});

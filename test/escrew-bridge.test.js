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

const { parseLinkCode, mailbox, fetchLinkedRoster, saveLink, loadLink } = require('../escrew-bridge.js');
const SECRET = Buffer.alloc(32, 7).toString('base64url');

test('parseLinkCode: finds the code inside other words, rejects the rest', () => {
  assert.equal(parseLinkCode('here: fuel-' + SECRET + ' thanks'), SECRET);
  assert.equal(parseLinkCode('pair-' + SECRET), null);
  assert.equal(parseLinkCode('fuel-short'), null);
  assert.equal(parseLinkCode(null), null);
});

test('fetchLinkedRoster: opens what was sealed under the same labels eScrew uses', async () => {
  const subtle = crypto.subtle, enc = new TextEncoder();
  const hk = info => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) });
  const base = await subtle.importKey('raw', Buffer.from(SECRET, 'base64url'), 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey(hk('pwaplog fuel key'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = new Uint8Array(12).fill(1);
  const sent = { app: 'pwaplog-fuel', version: 1, importedAt: 'x', duties: roster.duties, absences: [], activities: [] };
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(sent))));
  const body = new Uint8Array([...iv, ...sealed]);
  const { id } = await mailbox(SECRET);
  assert.match(id, /^[0-9a-f]{64}$/);
  let asked;
  const got = await fetchLinkedRoster(SECRET, async url => { asked = url; return new Response(body); });
  assert.equal(asked, '/api/schedule/' + id);
  assert.equal(daysFromEscrew(got)[0].code, '187');
  assert.equal(await fetchLinkedRoster(SECRET, async () => new Response('', { status: 404 })), null);
  const other = Buffer.alloc(32, 9).toString('base64url');
  await assert.rejects(fetchLinkedRoster(other, async () => new Response(body)), /заново/);
});

test('saveLink/loadLink round-trip and clear', () => {
  const m = new Map(), st = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  saveLink(SECRET, st); assert.equal(loadLink(st), SECRET);
  saveLink(null, st); assert.equal(loadLink(st), null);
});

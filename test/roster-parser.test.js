const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPeriod, computePeriodDays, isCompleteEnough, columnDate, parseDutyText, collectWarnings,
} = require('../roster-parser.js');

const KNOWN_AIRPORTS = { ALA: 'Asia/Almaty', LHR: 'Europe/London', DXB: 'Asia/Dubai' };

test('extractPeriod: reads a DD/MM/YYYY - DD/MM/YYYY header', () => {
  const p = extractPeriod('some header text 01/01/2026 - 25/01/2026 more text');
  assert.equal(p.start, '2026-01-01');
  assert.equal(p.end, '2026-01-25');
});

test('extractPeriod: throws a clear error when no period header is found (unsupported PDF)', () => {
  assert.throws(() => extractPeriod('this PDF has no recognizable period header'), /период/);
});

test('computePeriodDays: inclusive day count between two dates', () => {
  assert.equal(computePeriodDays('2026-01-01', '2026-01-25'), 25);
  assert.equal(computePeriodDays('2026-01-01', '2026-01-01'), 1);
});

test('computePeriodDays: never returns less than 1, even for a malformed/reversed range', () => {
  assert.equal(computePeriodDays('2026-01-25', '2026-01-01'), 1);
});

test('isCompleteEnough: threshold is 50% of the declared period', () => {
  assert.equal(isCompleteEnough(0, 30), false, 'an empty PDF is always incomplete');
  assert.equal(isCompleteEnough(14, 30), false);
  assert.equal(isCompleteEnough(15, 30), true);
  assert.equal(isCompleteEnough(30, 30), true);
});

test('columnDate: derives the date from a DD/MM token, wrapping the year at the period boundary', () => {
  // Header period 20/12/2025 - 10/01/2026: a "05" month token should resolve to 2026, not 2025.
  const date = columnDate('05/01', '12', '2025', '2026', '2025-12-20', '2026-01-10');
  assert.equal(date, '2026-01-05');
});

test('columnDate: returns null for a date outside the declared period', () => {
  const date = columnDate('15/02', '01', '2026', '2026', '2026-01-01', '2026-01-25');
  assert.equal(date, null);
});

test('parseDutyText: recognizes a flight code, times, and a known airport', () => {
  const d = parseDutyText('1234 06:00 LHR 14:00', KNOWN_AIRPORTS);
  assert.equal(d.code, '1234');
  assert.deepEqual(d.times, ['06:00', '14:00']);
  assert.deepEqual(d.airports, ['LHR']);
  assert.equal(d.report, '06:00');
  assert.equal(d.release, '14:00');
  assert.equal(d.kind, 'early');
  assert.equal(d.rest, false);
});

test('parseDutyText: rest-day codes are classified as kind "rest" with no report time', () => {
  for (const code of ['OFF', 'DOFF', 'ROFF', 'VAC']) {
    const d = parseDutyText(code, KNOWN_AIRPORTS);
    assert.equal(d.kind, 'rest');
    assert.equal(d.rest, true);
    assert.equal(d.report, null);
  }
});

test('parseDutyText: classifies night vs early vs generic duty by report hour', () => {
  assert.equal(parseDutyText('1234 22:00', KNOWN_AIRPORTS).kind, 'night');
  assert.equal(parseDutyText('1234 04:00', KNOWN_AIRPORTS).kind, 'night');
  assert.equal(parseDutyText('1234 07:00', KNOWN_AIRPORTS).kind, 'early');
  assert.equal(parseDutyText('1234 12:00', KNOWN_AIRPORTS).kind, 'duty');
});

test('parseDutyText: flags an airport code that is not in the known whitelist', () => {
  const d = parseDutyText('ZZZ Duty', KNOWN_AIRPORTS);
  assert.deepEqual(d.airports, []); // whitelist-only extraction finds nothing
  assert.deepEqual(d.unknownAirports, ['ZZZ']); // generic scan flags the candidate
});

test('parseDutyText: does not flag known airports or duty-code vocabulary as unknown', () => {
  const d = parseDutyText('LHR OFF MED123', KNOWN_AIRPORTS);
  assert.deepEqual(d.unknownAirports, []);
});

test('collectWarnings: flags duty days missing a report time (but not rest days)', () => {
  const days = [
    { date: '2026-01-01', rest: false, report: null, unknownAirports: [] },
    { date: '2026-01-02', rest: true, report: null, unknownAirports: [] },
  ];
  const warnings = collectWarnings(days);
  assert.deepEqual(warnings, [{ date: '2026-01-01', code: 'no_report_time' }]);
});

test('collectWarnings: flags duplicate and out-of-sequence dates', () => {
  const days = [
    { date: '2026-01-01', rest: true, report: null, unknownAirports: [] },
    { date: '2026-01-01', rest: true, report: null, unknownAirports: [] }, // duplicate
    { date: '2026-01-05', rest: true, report: null, unknownAirports: [] },
    { date: '2026-01-03', rest: true, report: null, unknownAirports: [] }, // out of order
  ];
  const warnings = collectWarnings(days).map(w => w.code);
  assert.deepEqual(warnings, ['duplicate_date', 'out_of_sequence']);
});

test('collectWarnings: reports each unknown airport once even if it recurs across days', () => {
  const days = [
    { date: '2026-01-01', rest: true, report: null, unknownAirports: ['ZZZ'] },
    { date: '2026-01-02', rest: true, report: null, unknownAirports: ['ZZZ', 'YYY'] },
  ];
  const warnings = collectWarnings(days).filter(w => w.code === 'unknown_airport');
  assert.equal(warnings.length, 2);
  assert.deepEqual(warnings.map(w => w.value).sort(), ['YYY', 'ZZZ']);
});

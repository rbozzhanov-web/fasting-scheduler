# Spec: PDF Import & Roster Parser Robustness

**Part of:** [spec-overview.md](./spec-overview.md) — phase 3 of 7
**Captured at commit:** `a4c0921`

## Overview

Covers `roster-parser.js` (`window.FuelParser.parse()`) and its caller in `index.html` (`#pdf` handler). No new UI screens — the expanded preview/review screen for parser warnings is explicitly deferred to a future round.

## 1. PDF Storage

### Current Behavior

`index.html:824-837`:
```js
q("#pdf").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  q("#status").textContent="Разбираю PDF на устройстве…";
  try{
    s.days=await FuelParser.parse(file);
    s.date=s.days[0].date;                         // unguarded, no length check
    s.file={name:file.name,count:s.days.length};
    s.icsStale=true;
    const r=indexedDB.open("fuel-pdf",1);
    r.onupgradeneeded=()=>r.result.createObjectStore("f");
    r.onsuccess=()=>r.result.transaction("f","readwrite").objectStore("f").put(file,"roster");
    save();drawStatus();drawAll();
  }catch(x){q("#status").textContent="Ошибка: "+x.message}
};
```

The full PDF `File` blob is stored in IndexedDB (`fuel-pdf` → store `f` → key `roster`) but is **never read back anywhere** in the codebase — confirmed dead, write-only storage.

### Changes

- (D7) Stop writing the PDF blob to IndexedDB. Persist only `{name, count}` in `s.file` (already the existing approach) plus the recognized `s.days`.
- (D7) On next app load for all existing users, run `indexedDB.deleteDatabase("fuel-pdf")` once to purge any previously-stored PDF binaries.

## 2. Zero/Failed Import Handling

### Current Behavior

`s.days[0].date` is accessed with no length check. If `FuelParser.parse()` resolves to `[]`, step-by-step:
1. `s.days=[]` is already assigned to the **live** state object before the crash.
2. `s.days[0].date` throws `TypeError`.
3. The `catch` block only updates `#status` text — it does not revert `s.days`, and never calls `save()`.
4. The emptied `s.days=[]` stays in memory for the rest of the session. Any later, unrelated `save()` call (toggling a setting, adding a metric, etc. — nearly every handler calls `save()`) silently persists the wipe, destroying the previously-working roster with no warning.

### Changes

- Validate the parse result **before mutating any part of the live state `s`**: only assign to `s.days`/`s.date`/`s.file`/`s.parserWarnings` once the result has passed the length and completeness checks below. A failed or rejected import must leave the previous roster fully intact in both memory and `localStorage`.
- Guard `s.days[0].date` with an explicit `s.days.length` check — this becomes unreachable once the completeness check below runs first, but keep it as a defensive assertion.
- On failure, `#status` shows a clear message (e.g. "Не удалось распознать дни в PDF — предыдущий ростер сохранён") and the roster displayed in the UI is the unchanged previous one.

## 3. Roster Parser Robustness

### Current Behavior

`roster-parser.js` (single-line `window.FuelParser.parse()`): dynamically imports `vendor/pdf.mjs`, reads only page 1, hardcoded to a specific carrier's PDF layout (error message: `"Не найдена строка дат Air Astana"`). Throws only if the period-header regex doesn't match or `row.length<20`. Silently drops any date-column outside the header-derived `[start,end]` range via `.filter(Boolean)`, with no accounting of how many were dropped. `report=times[0]||null` can be silently null. Airport extraction is a whitelist-only regex against `Circadian.Z` (~45 IATA codes); anything outside the whitelist is simply invisible — not flagged.

### Changes

- **Return shape** (D8): `FuelParser.parse()` returns `{days: Day[], warnings: Warning[]}` instead of a plain array. The caller persists `warnings` to `s.parserWarnings` (new state field). **No UI surfaces this yet** — it's a technical field for the future expanded preview screen.
- **Completeness threshold** (D9): compute the declared period length from the header date range (`end - start` in days). If `days.length / periodDays < 0.5`, treat the entire import as a **hard error** (throw), not a partial success with warnings. (Zero recognized days is the extreme case of this same rule, not a separate check.)
- **Missing report time**: when a duty-kind day has `report === null` (no regex-matched start time), add a warning entry (e.g. `{date, code: "no_report_time"}`) instead of silently falling through to a generic `"duty"` classification with no signal.
- **Unknown airport codes** (D10): add a generic regex scan for 3–4 consecutive uppercase-letter tokens in the extracted PDF text near duty rows, diff the candidates against the existing `Circadian.Z` whitelist, and add any unmatched candidate to `warnings` as `{code: "unknown_airport", value: "XXX"}`. Keep the existing whitelist-only extraction for `airports[]` itself — this is additive detection, not a replacement.
- **Date sequence**: flag (via a warning) any case where two columns produce the same date or an out-of-order date — likely indicates column misalignment.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D7 | PDF storage | Stop writing PDF blob to IndexedDB; purge legacy `fuel-pdf` DB once for existing users | Write-only, never-read, potentially sensitive dead data | Interview | 2026-09-01 |
| D8 | Parser return shape | `{days, warnings}`, persisted silently to `s.parserWarnings` | Technical groundwork without a new preview screen | Interview | 2026-09-01 |
| D9 | Import completeness threshold | `<50%` of the declared period's days recognized → hard error | An explicitly incomplete result must not read as success | Interview | 2026-09-01 |
| D10 | Unknown airport detection | Generic 3–4 uppercase-letter regex scan diffed against `Circadian.Z` whitelist | A whitelist alone can't report what it doesn't contain | Interview | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 3 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Depends on [spec-data-safety.md](./spec-data-safety.md) (phase 2) for the state-normalization contract this spec's parser output must satisfy (`s.days` shape, `s.parserWarnings` field).

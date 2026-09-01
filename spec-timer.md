# Spec: Eating-Window Elapsed Counter

**Part of:** [spec-overview.md](./spec-overview.md) — phase 1 of 7
**Captured at commit:** `a4c0921`

## Overview

During fasting (`fast` phase), the main timer already shows a countdown to the eating window opening. Once the window opens (`eat` phase), the same `#timer` element should switch to showing elapsed time since the window opened, formatted the same way (`HH:MM:SS`, e.g. `02:15:34`). The window-close time stays exactly where it already is.

## Current Behavior

`index.html`, `drawFast()` (lines ~409–484). Phase derivation:

```js
let phase="idle",pct=0;
if(start&&now<end)phase="fast";
else if(start&&now<eatEnd)phase="eat";
else if(start)phase="over";
```

The `eat`-phase render block (lines ~428–434):

```js
}else if(phase==="eat"){
  pct=(now-end)/eatMs*100;
  q("#fastPhase").textContent="Окно питания открыто";
  q("#timer").textContent=dur(eatEnd-now);      // countdown to close
  q("#fastSub").textContent=Math.floor(pct)+"% окна";
  q("#endLabel").textContent="Окно закроется";
  q("#ends").textContent=clock(eatEnd);          // close time, existing bottom line
}
```

`dur()` (line ~382) formats any millisecond delta as `HH:MM:SS` — it works identically for a countdown or an elapsed duration.

Mode config: `<select id="mode">` (4 discrete values: 12/14/16/18, i.e. 12:12, 14:10, 16:8, 18:6), consumed as `+s.mode` throughout (`fastMs=+s.mode*36e5`, `eatMs=(24-+s.mode)*36e5`). Manual start-time entry (`#applyStart`, lines ~756–770) always produces a valid `s.fastStart`, consumed by the same `drawFast()` phase logic as PDF-driven starts — there is no separate code path.

## Changes

1. **`#timer` in the `eat` phase**: change `dur(eatEnd-now)` → `dur(now-end)`.
2. **`#fastPhase` label in the `eat` phase**: change `"Окно питания открыто"` → `"С начала окна питания"`.
3. **`#fastSub`, `#endLabel`, `#ends`**: unchanged (see D1 below).
4. The `over` phase (window closed, next fast not yet started) is untouched — out of scope for this spec.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D1 | Timer sub-label (% окна) | Keep `#fastSub` unchanged during `eat` phase | Duplicates the same info (progress through the eating window) in a different form; minimal diff, no new UI | Interview | 2026-09-01 |

## Test Considerations (implemented in [spec-tests-ci.md](./spec-tests-ci.md))

- All four modes (12/14/16/18) during `eat` phase show elapsed time, not countdown.
- Manual-start entry produces the same elapsed-counter behavior as a PDF-derived start.
- Elapsed counter reaches its maximum (`eatMs`) right before the phase transitions to `over` — no overflow past that point.
- Midnight/timezone/DST crossings during an active eating window (see [spec-tests-ci.md](./spec-tests-ci.md) for the full timezone/DST test matrix, since `drawFast()`'s `now`/`end` comparison is timezone-sensitive).

## Dependency Graph & Implementation Order

Phase 1 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). No dependencies — display-only change, safe to implement first.

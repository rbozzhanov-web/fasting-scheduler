# Spec: Data Safety (Deletion, State Robustness, Backup Restore)

**Part of:** [spec-overview.md](./spec-overview.md) — phase 2 of 7
**Captured at commit:** `a4c0921`

## Overview

This spec covers three related surfaces: the "Удалить" (delete) button, the state load/save path, and the backup export/restore feature. All three write to `localStorage` (key `K="fuel-v4"`) and/or `IndexedDB` (`fuel-pdf`), and none currently distinguishes accidental local corruption from a potentially-adversarial imported file — a distinction this spec makes explicit.

## Goals

- Deletion never touches data outside this app's own storage.
- The app never permanently blanks itself due to corrupted `localStorage`.
- A write failure (quota exceeded, private browsing) is surfaced, not silently swallowed.
- Backup restore validates fully before writing anything, and rejects clearly on failure.
- Close the confirmed XSS sink in roster-day rendering.

## Non-Goals

- Cross-tab/multi-window write coordination (D21).
- Any cap or aggregation on `s.metrics` growth (D22).

## 1. Safe Deletion

### Current Behavior

`index.html:838-841`:
```js
q("#clear").onclick=()=>{
  if(!confirm("Удалить все локальные данные приложения?"))return;
  localStorage.clear();indexedDB.deleteDatabase("fuel-pdf");location.reload();
};
```

`localStorage.clear()` wipes the **entire origin** (`rbozzhanov-web.github.io`), which hosts other, unrelated projects. Cache Storage (`fuel-window-v24`, `fuel-ics`) is never touched, despite the confirm-dialog copy implying a full reset.

### Change

```js
localStorage.removeItem(K);indexedDB.deleteDatabase("fuel-pdf");location.reload();
```

Update the confirm-dialog/settings copy so it no longer implies Cache Storage is also cleared (D2).

## 2. State Load/Save Robustness

### Current Behavior

`index.html:366-371`:
```js
const q=s=>document.querySelector(s),K="fuel-v4",APP_VERSION="v24";
let s=JSON.parse(localStorage.getItem(K)||"{}");
s.mode=s.mode||"16";s.context=s.context||"auto";s.days=s.days||[];s.metrics=s.metrics||[];s.goal=s.goal||"fat";
s.bf=Object.assign({on:true,from:"06:30",to:"10:00"},s.bf);
s.notify=!!s.notify;s.fired=s.fired||{};
const save=()=>localStorage.setItem(K,JSON.stringify(s));
```

No `try/catch` around `JSON.parse` — a corrupted string throws at top-level script scope, aborting the entire inline `<script>` before any UI wiring runs (permanently blank page). Defaulting is truthiness-only, not type/enum-validated. `save()` is called from nearly every handler with no error handling at all.

### Changes

- **Top-level load failure** (D3): wrap `JSON.parse` in try/catch. On failure, reset `s` to the full default object and show a one-time notice in the existing status element (e.g. `#status`) that saved data was unreadable and reset.
- **Field-level normalization** (D4): validate/normalize each field's type and, where applicable, enum membership, independent of whether the top-level JSON parsed:
  - `s.mode` ∈ `{"12","14","16","18"}`, else default `"16"`.
  - `s.context` ∈ `{"auto","training","recovery"}`, else default `"auto"`.
  - `s.goal` ∈ `{"fat","keep"}`, else default `"fat"`.
  - `s.days` must be an `Array`; non-array → `[]`. Each element must have the expected shape (`date`, `code`, `kind`, `times`, `airports`, `report`, `release`); malformed elements are dropped individually, not the whole array.
  - `s.metrics` must be an `Array` of `{date, fat, weight}`-shaped entries within the existing live-entry bounds (`fat` 3–70, `weight` 30–250); out-of-bounds or malformed entries are dropped individually.
  - `s.bf` merges with defaults as today; `from`/`to` must match `HH:MM` (already degrades gracefully via `toMin()`).
  - `s.fastStart` must parse to a valid `Date`; invalid → treated as absent (phase `idle`), not a silently-wrong `Invalid Date` comparison.
  - This normalization is **silent** — no UI notice — because the rest of the state and roster typically remains usable.
- **Write failures** (D17): wrap `save()`'s `localStorage.setItem` in try/catch. On failure (quota exceeded, Safari private mode), show the same one-time UI notice used for D3 (e.g. "Не удалось сохранить — освободите место или проверьте режим браузера").

## 3. Backup Restore Validation

### Current Behavior

Export (`index.html:669-681`): `{app:"fuel-window", v:1, saved:<ISO date>, state:s}`.

Restore (`index.html:795-803`):
```js
q("#restore").onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const d=JSON.parse(await f.text());
    if(d.app!=="fuel-window"||!d.state)throw Error("это не копия Fuel Window");
    localStorage.setItem(K,JSON.stringify(d.state));
    location.reload();
  }catch(x){q("#backupHint").innerHTML='<span class="attn">Не удалось восстановить: '+esc(x.message)+"</span>"}
};
```

Only two checks exist (`d.app`, `d.state` truthy) — no version check, no per-field validation of dates/ranges/enums/roster shape.

### Confirmed XSS Sink

`drawDay()`, `index.html:688-695`, interpolates `d.date` **unescaped** into an `innerHTML` attribute (`data-d="'+d.date+'"`), while `d.code`/`d.times` on the same line correctly use `esc()`. A crafted backup with a `days[i].date` like `"2026-01-01\" onmouseover=\"alert(1)\" x=\""` breaks out of the attribute and injects arbitrary HTML/attributes — a stored DOM-XSS reachable via the restore feature (PDF-derived dates are safe by construction; the restore path is the actual exposure).

### Changes

- **Version check** (D6): require `d.v === 1` exactly; anything else (missing, `0`, `2`, non-numeric) → reject with "Неподдерживаемая версия резервной копии."
- **Full validation before write** (D5): validate, before any `localStorage.setItem` call:
  - `d.state.mode`/`context`/`goal` against the same enums as §2.
  - `d.state.days`: must be an array; every element must have a syntactically valid date (`^\d{4}-\d{2}-\d{2}$`, matching D16 below), a recognized `kind`, and well-formed `times`/`airports`.
  - `d.state.metrics`: every element within the same numeric ranges as live entry (`fat` 3–70, `weight` 30–250) with a valid date.
  - `d.state.parserWarnings` (see [spec-import.md](./spec-import.md)) and any other newer field: **absence is acceptable and defaults gracefully** (D18) — a pre-this-release backup (`v:1`, no `parserWarnings`) must still restore successfully.
  - **Any single invalid element anywhere rejects the entire file** (D5) — nothing is written to `localStorage`, current live data is untouched, and the failure message is user-readable with no stack trace (already the case via `esc(x.message)`; keep it that way for the new validation errors too).
- **XSS fix** (D16, defense in depth — two independent fixes, not one relying on the other):
  1. `drawDay()`: wrap `d.date` in `esc()` just like `d.code`, regardless of source.
  2. Backup validator: enforce the strict `^\d{4}-\d{2}-\d{2}$` regex on every `days[i].date` as part of the "full validation before write" step above.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D2 | Deletion scope | `localStorage.removeItem('fuel-v4')` + `indexedDB.deleteDatabase('fuel-pdf')` only, Cache Storage untouched | Avoids wiping other projects on the shared origin; cache isn't user data | Interview | 2026-09-01 |
| D3 | Corrupt top-level JSON on load | try/catch → reset to defaults + one-time UI notice | Otherwise the user silently loses all data with no explanation | Interview | 2026-09-01 |
| D4 | Corrupt individual fields (valid JSON) | Silent per-field normalization, no notice | Much less severe than full corruption; app stays functional | Interview | 2026-09-01 |
| D5 | Backup restore strictness | Reject the entire file on any single invalid element | Backup files are a less-trusted input than accidental local corruption | Interview | 2026-09-01 |
| D6 | Backup version check | Accept only `v === 1`, reject anything else | No other format version exists yet | Interview | 2026-09-01 |
| D16 | XSS in `drawDay()` | Add `esc(d.date)` AND a strict date-format regex in the backup validator | Defense in depth — don't rely on the validator alone | Red Team | 2026-09-01 |
| D17 | `save()` write failures | Wrap in try/catch + one-time UI notice | Symmetric with D3 — write failures are as dangerous as read failures | Red Team | 2026-09-01 |
| D18 | Backup schema vs. frozen `v=1` | Missing newer fields (e.g. `parserWarnings`) default gracefully, not rejected | Old backups shouldn't break because this release changed `s`'s shape | Red Team | 2026-09-01 |
| D21 | Cross-tab writes | Accept as a known limitation, out of scope | Single-user local app; risk is rare (needs two simultaneous tabs) | Red Team | 2026-09-01 |
| D22 | `s.metrics` growth | Acknowledged as a known limitation, no action this round | Negligible in practice | Red Team | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 2 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Depends only on phase 1 being complete (no code overlap, but keeps risk isolated). Foundational for phase 3 ([spec-import.md](./spec-import.md)), which writes into the same `s.days`/`s.parserWarnings` fields this spec normalizes and validates.

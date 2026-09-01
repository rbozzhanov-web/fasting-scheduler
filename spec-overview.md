# Fuel Window Reliability Spec — Overview

**Status:** Draft, approved for implementation
**Captured at commit:** `a4c0921` (branch `claude/fasting-timer-data-safety-0pyb6r`)
**Date:** 2026-09-01
**Preview:** https://claude.ai/code/artifact/58893079-60fc-4720-82c7-a7c73d51734b

## Problem Statement

`fasting-scheduler` ("Fuel Window") is a vanilla-JS PWA (no build step, no framework, no tests) for tracking a fasting/eating-window schedule, with PDF-based duty-roster import for airline crew. The codebase analysis backing this spec surfaced ten categories of gaps, spanning:

- A missing eating-window elapsed-time display (currently only shows a countdown to open).
- `localStorage.clear()` wiping the entire `rbozzhanov-web.github.io` origin — a shared GitHub Pages domain hosting other, unrelated projects.
- No error handling around `JSON.parse`/`localStorage` reads or writes — a single corrupted byte currently blanks the whole app permanently.
- A confirmed DOM-XSS sink in the roster day renderer, reachable through the backup-restore feature, which performs almost no validation before writing untrusted JSON into `localStorage`.
- A dead write-only IndexedDB store holding full PDF binaries that are never read back.
- A roster parser that silently drops out-of-range or incomplete data and reports success regardless.
- A service worker whose auto-update logic can force a silent page reload while the user is actively mid-edit, due to an unreachable code branch.
- Accessibility gaps: blocked pinch-zoom, a settings panel with no focus trap, no ARIA pressed-state on toggle controls.
- A README describing an "AI gateway" feature that does not exist anywhere in the code.
- Zero automated tests and zero CI.

## Goals

- Fix all ten categories above with the smallest behavior-preserving diff in each area.
- No new UI screens, cards, or settings beyond what's explicitly called for (an eating-window elapsed counter using existing UI slots, and converting the existing settings panel to a native `<dialog>`).
- Establish a minimal, dependency-free test harness (`node:test`) and CI (GitHub Actions) so the fixed logic — and future changes — stay covered.

## Non-Goals (explicitly out of scope for this round)

- Cycle history, meal logging, charts, AI features, or new notification types.
- An expanded roster-parser preview/review screen (the parser gains a technical `warnings` field now; a UI to browse it is deferred).
- Cross-tab/multi-window write coordination (D21 — accepted as a known limitation).
- A version/update policy for the vendored `pdf.js` library, or bringing its glue code under test (D22 — accepted as a known limitation).
- Choosing a license for the repository (owner's separate decision).

## Sub-Specs

| # | Spec | Scope |
|---|---|---|
| 1 | [spec-timer.md](./spec-timer.md) | Eating-window elapsed counter |
| 2 | [spec-data-safety.md](./spec-data-safety.md) | Safe deletion, state-load/save robustness, backup restore validation, XSS fix |
| 3 | [spec-import.md](./spec-import.md) | PDF storage removal, roster parser robustness & warnings |
| 4 | [spec-sw.md](./spec-sw.md) | Service worker cache scoping, response filtering, update/reload flow |
| 5 | [spec-a11y.md](./spec-a11y.md) | Pinch-zoom, modal dialog, focus management, ARIA state |
| 6 | [spec-docs.md](./spec-docs.md) | README corrections and additions |
| 7 | [spec-tests-ci.md](./spec-tests-ci.md) | Module extraction, test suite, GitHub Actions |

## How It Works (data & safety flow)

Three input sources — PDF import, manual start-time entry, and backup restore — converge on one rule: nothing reaches the live in-memory state object `s`, and nothing reaches `localStorage`, until it has been validated. A load-time or write-time storage failure gets the same one-time, plain-language UI notice; a rejected backup or PDF import leaves prior data untouched. See the [preview's "How It Works" diagram](https://claude.ai/code/artifact/58893079-60fc-4720-82c7-a7c73d51734b) for the full flow, including the deliberate asymmetry between how leniently accidental local corruption is treated (D4: salvage what's valid) versus how strictly an imported backup file is treated (D5: reject the whole file).

## Decisions Log

Full, canonical log for the entire spec (all sub-specs reference these same IDs — never renumbered). Each sub-spec repeats only the rows relevant to its own scope.

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D1 | Timer sub-label (% окна) | Keep `#fastSub` unchanged during `eat` phase | Duplicates the same info in a different form; minimal diff | Interview | 2026-09-01 |
| D2 | Deletion scope | `localStorage.removeItem('fuel-v4')` + `indexedDB.deleteDatabase('fuel-pdf')` only, Cache Storage untouched | Avoids wiping other projects on the shared origin; cache isn't user data | Interview | 2026-09-01 |
| D3 | Corrupt top-level JSON on load | try/catch → reset to defaults + one-time UI notice | Otherwise the user silently loses all data with no explanation | Interview | 2026-09-01 |
| D4 | Corrupt individual fields (valid JSON) | Silent per-field normalization, no notice | Much less severe than full corruption; app stays functional | Interview | 2026-09-01 |
| D5 | Backup restore strictness | Reject the entire file on any single invalid element | Backup files are a less-trusted input than accidental local corruption | Interview | 2026-09-01 |
| D6 | Backup version check | Accept only `v === 1`, reject anything else | No other format version exists yet | Interview | 2026-09-01 |
| D7 | PDF storage | Stop writing PDF blob to IndexedDB; purge legacy `fuel-pdf` DB once for existing users | Write-only, never-read, potentially sensitive dead data | Interview | 2026-09-01 |
| D8 | Parser return shape | `{days, warnings}`, persisted silently to `s.parserWarnings` | Technical groundwork without a new preview screen | Interview | 2026-09-01 |
| D9 | Import completeness threshold | `<50%` of the declared period's days recognized → hard error | An explicitly incomplete result must not read as success | Interview | 2026-09-01 |
| D10 | Unknown airport detection | Generic 3–4 uppercase-letter regex scan diffed against `Circadian.Z` whitelist | A whitelist alone can't report what it doesn't contain | Interview | 2026-09-01 |
| D11 | SW auto-update behavior | Auto-apply only when backgrounded/resuming; show banner + manual reload when foreground | Prevents silent reload destroying unsaved input mid-edit | Interview | 2026-09-01 |
| D12 | Settings panel | Convert to native `<dialog>` + `showModal()`, same visual styling | Native focus trap/aria-modal/Escape, less custom code | Interview | 2026-09-01 |
| D13 | README AI section | Remove entirely | No corresponding implementation anywhere in the codebase | Interview | 2026-09-01 |
| D14 | README scope | Brief backup/storage docs (purpose + location, no full schema); add PWA URL, iOS notification limits, roster format summary | Sufficient for end users; full JSON schema not needed | Interview | 2026-09-01 |
| D15 | Test strategy | Extract pure logic into plain `.js` modules; `node:test` + `node:assert`; minimal `package.json`; GitHub Actions on PR + push to main | Inline `<script>` logic can't be imported by tests directly | Interview | 2026-09-01 |
| D16 | XSS in `drawDay()` | Add `esc(d.date)` AND a strict date-format regex in the backup validator | Defense in depth — don't rely on the validator alone | Red Team | 2026-09-01 |
| D17 | `save()` write failures | Wrap in try/catch + one-time UI notice | Symmetric with D3 — write failures are as dangerous as read failures | Red Team | 2026-09-01 |
| D18 | Backup schema vs. frozen `v=1` | Missing newer fields (e.g. `parserWarnings`) default gracefully, not rejected | Old backups shouldn't break because this release changed `s`'s shape | Red Team | 2026-09-01 |
| D19 | `sw.js` reopened in phase 7 | Accept as expected follow-up work, don't reorder phases | Module extraction (phase 7) needs new files added to the SW precache list | Red Team | 2026-09-01 |
| D20 | Reload race condition | Re-check `document.hidden` immediately before the `controllerchange`-triggered reload | The check-time visibility decision (D11) can be stale by reload-time | Red Team | 2026-09-01 |
| D21 | Cross-tab writes | Accept as a known limitation, out of scope | Single-user local app; risk is rare (needs two simultaneous tabs) | Red Team | 2026-09-01 |
| D22 | `s.metrics` growth / `pdf.js` version policy | Both acknowledged as known limitations, no action this round | Negligible in practice; pdf.js updated manually as needed | Red Team | 2026-09-01 |

## Dependency Graph & Implementation Order

```
1. Timer  →  2. Data Safety  →  3. Import  →  4. SW/Offline  →  5. Accessibility  →  6. Docs  →  7. Tests & CI
                                                     ↑                                                  │
                                                     └───────────────── D19: reopens sw.js ──────────────┘
```

1. **Timer** — lowest risk, display-only, no dependencies. Good warm-up before higher-risk phases.
2. **Data Safety** — foundational; every later phase relies on robust state load/save and backup validation.
3. **Import (PDF + roster parser)** — depends on Data Safety's state-normalization contract (writes into `s.days`/`s.parserWarnings`).
4. **Service Worker / Offline** — independent of phases 1–3 in code, sequenced after them to avoid mixing with data-shape changes.
5. **Accessibility** — independent of 1–4 logically, shares `index.html` only.
6. **Documentation** — describes the shipped behavior of phases 1–5; written after behavior is finalized.
7. **Tests & CI** — extracts logic from all prior phases into modules; per D19, this reopens `sw.js`'s precache list and version a second time. Accepted, not treated as a sequencing defect.

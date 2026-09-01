# Spec: Tests & CI

**Part of:** [spec-overview.md](./spec-overview.md) — phase 7 of 7
**Captured at commit:** `a4c0921`

## Overview

Introduces automated test coverage and CI to a project that currently has neither (`git ls-files` confirms no `package.json`, no test files, no `.github/` directory). This is the final phase, since it extracts and covers logic introduced or modified by phases 1–6.

## Current State

- Pure vanilla JS/HTML/CSS, no build step, no bundler, no `node_modules`.
- All timer/state/validation logic lives in an inline `<script>` inside `index.html` — not importable by any test file as-is.
- `circadian.js` and `roster-parser.js` attach to `window` as globals (not module exports).
- Zero tests, zero CI anywhere in the repo.

## Strategy (D15)

Extract the logic that needs testing into separate plain `.js` modules, loadable **both** by `index.html` via `<script>` tag (no bundler introduced) **and** by test files:

- Timer phase derivation + duration formatting (`drawFast()`'s phase logic and `dur()`, from [spec-timer.md](./spec-timer.md)).
- State load/normalization and backup validation (from [spec-data-safety.md](./spec-data-safety.md)).
- The roster parser's pure text-analysis functions (date/kind/warning derivation), kept distinct from the PDF-byte-extraction glue that depends on `vendor/pdf.mjs` (from [spec-import.md](./spec-import.md)).

Use a dual-export pattern (attach to `window` when present, `module.exports` otherwise) or plain ES modules loaded via `<script type="module">` in `index.html` — whichever keeps `index.html` bundler-free. `circadian.js`/`roster-parser.js` need the same dual-export treatment to become importable by tests.

## Test Runner

- Node's built-in `node:test` + `node:assert` — **no** Vitest/Jest, zero external dependencies.
- A minimal `package.json` is added **only** to define an `npm test` script (e.g. `node --test`).

## Required Coverage

- Timer phases: `idle`, `fasting` (`fast`), `eating` (`eat`), `closed` (`over`).
- The new elapsed-time counter (from [spec-timer.md](./spec-timer.md)), across all four modes (12/14/16/18).
- Manual start-time entry and mode changes.
- Midnight crossing and timezone changes.
- Year transitions, DST transitions, short layovers, and fractional UTC offsets (exercises `circadian.js`'s timezone-shift math).
- Corrupted backup rejection (from [spec-data-safety.md](./spec-data-safety.md)): missing/wrong version, malformed dates, out-of-range metrics, invalid roster entries — verify the whole file is rejected and existing data is untouched.
- Empty and unsupported PDF handling (from [spec-import.md](./spec-import.md)): zero-days result, sub-50%-completeness result, previous roster preserved on failure.

## CI

A GitHub Actions workflow (`.github/workflows/test.yml`) runs `npm test` on every pull request and on every push to `main`.

## Known Trade-offs (accepted, not action items)

- **D19**: this phase's module extraction requires adding the new files to `sw.js`'s precache list and bumping its cache version — a second, expected edit to the file finalized in [spec-sw.md](./spec-sw.md) (phase 4).
- **D22**: the vendored `pdf.js` glue code (the actual PDF-byte extraction, as opposed to the pure text-analysis functions) stays outside test coverage by design; no version/update policy is introduced for the vendored library in this round.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D15 | Test strategy | Extract pure logic into plain `.js` modules; `node:test` + `node:assert`; minimal `package.json`; GitHub Actions on PR + push to main | Inline `<script>` logic can't be imported by tests directly | Interview | 2026-09-01 |
| D19 | `sw.js` reopened in phase 7 | Accept as expected follow-up work, don't reorder phases | Module extraction (phase 7) needs new files added to the SW precache list | Red Team | 2026-09-01 |
| D22 | `pdf.js` version policy | Acknowledged as a known limitation, no action this round | pdf.js updated manually as needed; formal policy not worth the overhead yet | Red Team | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 7 of 7 (final) in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Depends on phases 1–3 being implemented first (extracts their logic into modules for testing). Per D19, reopens phase 4's `sw.js` for precache-list and version updates.

# Spec: Documentation

**Part of:** [spec-overview.md](./spec-overview.md) — phase 6 of 7
**Captured at commit:** `a4c0921`

## Overview

Corrects README.md to describe what the app actually does, and adds the minimum documentation end users need. Written last among the behavior-changing phases (1–5) since it documents their shipped result.

## Current State of README.md (18 lines)

- Describes a nonexistent "AI gateway" feature in full detail (lines 9, 15-17: personal AI-gateway URL, POST JSON, expects `{text}` response, CORS/secret-handling guidance) — confirmed via full-repo grep that no such code exists anywhere (no fetch calls, no "AI"/"gateway"/"шлюз" references outside README).
- No link to the published PWA.
- No documentation of the backup format or local-storage behavior.
- No mention of iOS notification limitations, despite extensive in-code Russian comments discussing them (`drawNotify()` and comments near lines ~486-490, ~547-555, ~620-623, ~655-660).
- No description of the supported roster PDF format.

## Changes

1. **Remove the "## AI" section entirely** (D13) — no corresponding implementation anywhere in the codebase.
2. **Add a direct link to the published PWA**: `https://rbozzhanov-web.github.io/fasting-scheduler/` (standard GitHub Pages URL for this repo — **not yet confirmed by the repo owner**; correct before merging if the actual publish path differs).
3. **Add a brief backup/local-storage section** (D14): purpose and where it's stored — device-only, `localStorage` + IndexedDB, no server involved, exportable/importable as a JSON file (`{app, v, saved, state}`). One to two paragraphs; no full field-by-field JSON schema.
4. **Add an iOS notification limitations section**: summarize the constraints already documented in-code (background execution limits, calendar/`.ics` fallback behavior, PWA install requirements for reliable notifications on iOS).
5. **Add a short roster-format description**: the parser expects a specific carrier's PDF layout (Air Astana), a `DD/MM/YYYY - DD/MM/YYYY` header date range, and a specific duty-code vocabulary (`OFF|DOFF|ROFF|HOMS|HOMX|AVLB|VAC|CSH|MED\d+`). Frame this as "currently supports" rather than a general-purpose roster importer.
6. **License**: leave as a separate decision for the repository owner — no change in this round.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D13 | README AI section | Remove entirely | No corresponding implementation anywhere in the codebase | Interview | 2026-09-01 |
| D14 | README scope | Brief backup/storage docs (purpose + location, no full schema); add PWA URL, iOS notification limits, roster format summary | Sufficient for end users; full JSON schema not needed | Interview | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 6 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Depends on phases 1–5 being implemented first, since it documents their resulting behavior (elapsed counter, backup format, notification behavior).

# Spec: Accessibility (No Visual Changes)

**Part of:** [spec-overview.md](./spec-overview.md) — phase 5 of 7
**Captured at commit:** `a4c0921`

## Overview

Improves accessibility without changing how the app looks. No new cards, screens, or settings.

## 1. Pinch-Zoom

### Current Behavior

`index.html:5`:
```html
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
```
Both `maximum-scale=1` and `user-scalable=no` block pinch-to-zoom (WCAG 1.4.4 violation).

### Change

Remove `maximum-scale=1` and `user-scalable=no`, keeping `width=device-width,initial-scale=1,viewport-fit=cover`.

## 2. Settings Panel as a Modal Dialog

### Current Behavior

`<div class="sheet" id="sheet" aria-hidden="true">` (markup lines ~298-359; CSS `.sheet` lines ~69-74, a `position:fixed;inset:0` bottom-sheet with `transform:translateY(100%)`/`.open` toggle). `openSheet()` (lines ~786-791) toggles `aria-hidden` on the sheet itself but never moves focus into it on open, never restores focus on close, and never marks the background `<main class="wrap">` `inert`/`aria-hidden` — a keyboard/screen-reader user can still reach content underneath. Escape-to-close is wired but is the only keyboard affordance; there's no focus trap.

### Change (D12)

Convert `<div class="sheet" id="sheet">` to a native `<dialog id="sheet">`, opened with `.showModal()` and closed with `.close()`. Keep the existing CSS as-is — a native `<dialog>` only adds default border/padding/backdrop, both fully overridden by the current `.sheet` rules, so the visual result is unchanged. This is a deliberate trade: native `<dialog>` provides, for free, from the browser:
- A built-in focus trap (Tab/Shift+Tab stay inside the dialog).
- `aria-modal` semantics.
- Escape-to-close (replaces the manual keydown listener).
- Top-layer rendering that excludes background content from the accessibility tree — no manual `inert`/`aria-hidden` toggling on `<main>` needed.

Additionally:
- On close, return focus explicitly to the "Настройки" gear button (`#openSet`) that opened the dialog.
- Wire the existing open/close triggers (`#openSet`, `#closeSet`, backdrop click if any) to `.showModal()`/`.close()` instead of the current class-toggle + manual `aria-hidden` logic.

## 3. ARIA State on Toggle Controls

### Current Behavior

Zero occurrences of `aria-pressed`, `aria-current`, or `inert` anywhere in `index.html`. Affected controls rely purely on a CSS `.on` class:
- `#ctxSeg` segmented buttons (auto/training/recovery), state toggled at `index.html:699`.
- Day-strip selector buttons (`#days .day`), built dynamically in `drawDay()`.

### Change

Add `aria-pressed="true"/"false"` to the context-segment buttons and the roster day-selector buttons, kept in sync with the existing `.on` class toggle (same code path, no new state to track).

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D12 | Settings panel | Convert to native `<dialog>` + `showModal()`, same visual styling | Native focus trap/aria-modal/Escape, less custom code | Interview | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 5 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Not logically dependent on phases 1–4 — shares only the `index.html` file, no shared state or behavior.

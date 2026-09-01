# Spec: Service Worker & Offline

**Part of:** [spec-overview.md](./spec-overview.md) — phase 4 of 7
**Captured at commit:** `a4c0921`

## Overview

Covers `sw.js` and the update-checking logic in `index.html` (lines ~858-873). Note: this spec's precache list and cache version will be touched again in phase 7 ([spec-tests-ci.md](./spec-tests-ci.md)) once module extraction adds new files — see D19.

## 1. Cache Scoping & Response Filtering

### Current Behavior

`sw.js`:
```js
const C="fuel-window-v24";
const A=["./","./index.html","./roster-parser.js","./circadian.js","./icon.svg","./icon-180.png","./icon-512.png","./manifest.webmanifest","./vendor/pdf.mjs","./vendor/pdf.worker.mjs","./vendor/PDFJS-LICENSE.txt","./sw.js"];
self.addEventListener("install",e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C&&k!=="fuel-ics").map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
...
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  if(new URL(e.request.url).pathname.endsWith("/reminders.ics")){...return}
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)))
});
```

The `activate` cleanup is **already correctly scoped** (only deletes cache keys that aren't `C` or `"fuel-ics"` — no cross-project risk). The generic `fetch` handler, however, caches **every** successful network response unconditionally — no `r.ok`/status/type guard, so a 404, redirect, or opaque cross-origin response would be cached and served as if valid. `install`/`activate` are correctly `waitUntil`-wrapped already.

`APP_VERSION="v24"` in `index.html:366` and `C="fuel-window-v24"` in `sw.js` are two separately-maintained literals with no single source of truth.

### Changes

- Add a guard to the `fetch` handler: only `caches.put()` when the response is same-origin, `r.ok` (2xx), and `r.type === "basic"` (excludes opaque cross-origin responses). Non-matching responses still pass through to the client normally — just not cached.
- Bump the cache version (`C` in `sw.js` and `APP_VERSION` in `index.html`) as part of this release. Keep both literals manually in sync (no build step exists to unify them) — document this as a release-checklist item, not a code change.

## 2. Update / Reload Flow

### Current Behavior

`index.html:855-873`:
```js
/* iOS восстанавливает свёрнутый PWA из памяти: страница не грузится заново,
   поэтому обновление само не проверялось. Проверяем при запуске и каждый раз,
   когда приложение возвращается на экран, и применяем найденное сразу. */
if("serviceWorker"in navigator){
  let reloading=false;
  navigator.serviceWorker.register("./sw.js").then(r=>{
    const apply=()=>{if(!r.waiting)return false;r.waiting.postMessage("SKIP_WAITING");return true};
    const check=()=>{if(!apply())r.update().catch(()=>{})};
    check();
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)check()});
    r.addEventListener("updatefound",()=>r.installing?.addEventListener("statechange",()=>{
      if(r.waiting&&!apply())q("#update").classList.add("show");
    }));
    q("#reload").onclick=()=>apply();
  });
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloading)return;reloading=true;location.reload();
  });
}
```

The auto-apply-and-reload behavior is **intentional**, per the comment — it exists for iOS PWA resume-from-background (iOS doesn't reload the page on backgrounded-app resume). But a logic bug makes this fire unconditionally: `apply()` itself is what makes `r.waiting` resolve, so in `if(r.waiting&&!apply())`, `!apply()` is always `false` whenever `r.waiting` was truthy — the `#update` banner branch is dead code. Every detected update, including one detected while the app is actively open and the user is mid-edit (e.g. typing a manual start time or a settings field), triggers an immediate silent `location.reload()` via the unconditional `controllerchange` listener — risking silent loss of unsaved input.

### Changes (D11, D20)

- **Foreground vs. background** (D11): auto-apply (post `SKIP_WAITING`) only when the update check was triggered by the app being hidden/backgrounded, or by a `visibilitychange` transition *from* hidden (matching the original iOS-resume rationale). When an update is detected while the app is **currently visible/foreground**, show the `#update` banner (now made reachable — see fix below) and require the user to click the existing `#reload` button before applying.
- **Fix the unreachable branch**: capture `r.waiting`'s truthiness once, before calling `apply()`, so the banner condition can actually evaluate `true`. Combine with the foreground/background gate above — the banner shows specifically for the foreground case.
- **Reload-time race** (D20): the actual page reload fires later and asynchronously, via `controllerchange`, with no visibility check at all — so a background-triggered auto-apply (correctly classified per D11) can still complete and fire `location.reload()` after the user has returned to the foreground and started typing. Re-check `document.hidden` immediately before calling `location.reload()` inside the `controllerchange` handler; if the app has become visible in the meantime, defer to the banner (show `#update`, do not reload) instead of reloading unconditionally.

## Decisions Log

| ID | Topic | Decision | Rationale | Source | Date |
|---|---|---|---|---|---|
| D11 | SW auto-update behavior | Auto-apply only when backgrounded/resuming; show banner + manual reload when foreground | Prevents silent reload destroying unsaved input mid-edit | Interview | 2026-09-01 |
| D19 | `sw.js` reopened in phase 7 | Accept as expected follow-up work, don't reorder phases | Module extraction (phase 7) needs new files added to the SW precache list | Red Team | 2026-09-01 |
| D20 | Reload race condition | Re-check `document.hidden` immediately before the `controllerchange`-triggered reload | The check-time visibility decision (D11) can be stale by reload-time | Red Team | 2026-09-01 |

## Dependency Graph & Implementation Order

Phase 4 of 7 in [spec-overview.md](./spec-overview.md#dependency-graph--implementation-order). Independent of phases 1–3 in code, sequenced after them to avoid mixing with data-shape changes. **Will be reopened in phase 7** ([spec-tests-ci.md](./spec-tests-ci.md)) per D19 — plan for a second small edit to `sw.js`'s precache list and cache version at that point, not a full re-review.

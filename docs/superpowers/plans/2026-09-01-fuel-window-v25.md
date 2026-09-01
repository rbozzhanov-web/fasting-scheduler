# Fuel Window v25 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the elapsed eating-window timer and deliver the approved reliability, privacy, parser, service-worker, accessibility, documentation, and CI improvements without adding new user-facing sections.

**Architecture:** Keep the application as a build-free static PWA. Extract pure timer/state/backup logic into `app-core.js`, expose the existing circadian and parser logic to Node tests, and leave DOM orchestration in `index.html`. Use only Node's built-in test runner and GitHub Actions; add no runtime dependencies.

**Tech Stack:** HTML/CSS/vanilla JavaScript, Service Worker, PDF.js already vendored, Node.js 22, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-fuel-window-v25-design.md`

## Global Constraints

- Preserve the existing `localStorage` key `fuel-v4`.
- Keep the application serverless and build-free.
- Add no runtime dependencies or framework.
- Add no new cards, settings, history, AI, food log, or server-side Web Push.
- Support backup versions 1 and 2.
- Never clear storage or caches owned by another application on the shared GitHub Pages origin.
- Keep current Russian UI copy except where this plan specifies a replacement.
- Work only on `codex/fuel-window-v25`; do not update `main` directly.

## File Map

- Create `app-core.js`: pure phase calculation, state normalization, backup validation, constants, and browser/Node export.
- Create `tests/app-core.test.js`: timer, state, and backup tests.
- Modify `index.html`: consume FuelCore, update timer UI, transactional import, safe DOM rendering, scoped data deletion, and accessible settings.
- Modify `circadian.js`: preserve browser API and add Node-compatible export.
- Create `tests/circadian.test.js`: rollover, duty, layover, fractional offset, and DST coverage.
- Modify `roster-parser.js`: pure page-item parser, multi-page extraction, warnings, and browser/Node export.
- Create `tests/roster-parser.test.js`: synthetic page-item fixtures and parser validation.
- Modify `sw.js`: scoped cache cleanup and safe network-first caching.
- Create `tests/service-worker.test.js`: static source assertions for destructive/cache regressions.
- Create `package.json`: built-in Node test command and project metadata.
- Create `.github/workflows/test.yml`: read-only CI on PRs and pushes to main.
- Modify `README.md`: deployed link, storage/backup/parser/notification facts, and test commands.

---

### Task 1: Test foundation and pure timer core

**Files:**
- Create: `package.json`
- Create: `app-core.js`
- Create: `tests/app-core.test.js`
- Modify: `index.html:363-484`
- Modify: `sw.js:1`

**Interfaces:**
- Produces: `FuelCore.cycle(nowMs, startIso, fastingHours) -> {phase, fastMs, eatMs, endMs, eatEndMs, remainingMs, elapsedEatMs, progress}`
- Produces: `FuelCore.duration(ms) -> "HH:MM:SS"`
- Consumes: no earlier task interfaces.

- [ ] **Step 1: Add the failing timer tests**

Create `tests/app-core.test.js` with Node's built-in runner:

```js
const test=require("node:test");
const assert=require("node:assert/strict");
const FuelCore=require("../app-core.js");

const start="2026-09-01T00:00:00.000Z";

test("cycle reports fasting time remaining",()=>{
  const c=FuelCore.cycle(Date.parse("2026-09-01T08:00:00Z"),start,16);
  assert.equal(c.phase,"fast");
  assert.equal(c.remainingMs,8*36e5);
});

test("cycle reports elapsed eating-window time",()=>{
  const c=FuelCore.cycle(Date.parse("2026-09-01T18:15:34Z"),start,16);
  assert.equal(c.phase,"eat");
  assert.equal(c.elapsedEatMs,2*36e5+15*6e4+34e3);
  assert.equal(FuelCore.duration(c.elapsedEatMs),"02:15:34");
});

test("cycle changes phase at exact boundaries",()=>{
  assert.equal(FuelCore.cycle(Date.parse("2026-09-01T16:00:00Z"),start,16).phase,"eat");
  assert.equal(FuelCore.cycle(Date.parse("2026-09-02T00:00:00Z"),start,16).phase,"over");
});

test("cycle works for every supported mode",()=>{
  for(const mode of [12,14,16,18]){
    const c=FuelCore.cycle(Date.parse(start)+mode*36e5,start,mode);
    assert.equal(c.phase,"eat");
    assert.equal(c.eatMs,(24-mode)*36e5);
  }
});
```

- [ ] **Step 2: Add the test command and verify RED**

Create `package.json`:

```json
{
  "name":"fuel-window",
  "version":"25.0.0",
  "private":true,
  "scripts":{"test":"node --test tests/*.test.js"},
  "engines":{"node":">=22"}
}
```

Run: `npm test`  
Expected: FAIL because `app-core.js` does not exist.

- [ ] **Step 3: Implement the minimal pure cycle API**

Create `app-core.js` as an IIFE assigned to `FuelCore`. Clamp negative durations to zero, accept only finite timestamps and modes 12/14/16/18, and export with:

```js
const FuelCore=(()=>{
  const MODES=new Set([12,14,16,18]);
  const duration=ms=>[ms/36e5,ms/6e4%60,ms/1e3%60]
    .map(x=>String(Math.floor(Math.max(0,x))).padStart(2,"0")).join(":");
  function cycle(nowMs,startIso,fastingHours){
    const startMs=Date.parse(startIso||"");
    const mode=Number(fastingHours);
    if(!Number.isFinite(nowMs)||!Number.isFinite(startMs)||!MODES.has(mode))
      return{phase:"idle",fastMs:mode*36e5||0,eatMs:(24-mode)*36e5||0,endMs:null,eatEndMs:null,remainingMs:0,elapsedEatMs:0,progress:0};
    const fastMs=mode*36e5,eatMs=(24-mode)*36e5,endMs=startMs+fastMs,eatEndMs=endMs+eatMs;
    const phase=nowMs<endMs?"fast":nowMs<eatEndMs?"eat":"over";
    return{phase,fastMs,eatMs,endMs,eatEndMs,
      remainingMs:phase==="fast"?endMs-nowMs:phase==="eat"?eatEndMs-nowMs:0,
      elapsedEatMs:phase==="eat"?nowMs-endMs:0,
      progress:Math.max(0,Math.min(1,(nowMs-startMs)/(fastMs+eatMs)))};
  }
  return{cycle,duration};
})();
if(typeof window!=="undefined")window.FuelCore=FuelCore;
if(typeof module!=="undefined"&&module.exports)module.exports=FuelCore;
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test`  
Expected: 4 timer tests PASS.

- [ ] **Step 5: Wire the existing hero to FuelCore**

Load `app-core.js` before the inline app script and add it to the service-worker shell. Replace duplicated phase calculation in `drawFast()` with `FuelCore.cycle(Date.now(),s.fastStart,+s.mode)`.

For phase `eat` set:

```js
q("#fastPhase").textContent="Окно питания открыто";
q("#timer").textContent=FuelCore.duration(c.elapsedEatMs);
q("#fastSub").textContent="С начала окна питания";
q("#endLabel").textContent="Окно закроется";
q("#ends").textContent=clock(new Date(c.eatEndMs));
```

Keep fasting and over copy unchanged. Use `c.progress*100` for the full-cycle fill.

- [ ] **Step 6: Run tests and smoke-check the page**

Run: `npm test`  
Expected: all tests PASS.

Open the page, set a start older than the fasting duration, and verify the main number increases once per second while the close time remains fixed.

- [ ] **Step 7: Commit**

```bash
git add package.json app-core.js tests/app-core.test.js index.html sw.js
git commit -m "feat: show elapsed eating-window time"
```

---

### Task 2: State normalization and backup validation

**Files:**
- Modify: `app-core.js`
- Modify: `tests/app-core.test.js`
- Modify: `index.html:366-371,657-681,795-803`

**Interfaces:**
- Consumes: `FuelCore` module from Task 1.
- Produces: `FuelCore.defaultState()`
- Produces: `FuelCore.normalizeState(value) -> canonical state`
- Produces: `FuelCore.parseStoredState(raw) -> canonical state`
- Produces: `FuelCore.parseBackup(rawText) -> canonical state`
- Produces: `FuelCore.makeBackup(state, nowIso) -> {app:"fuel-window",v:2,saved,state}`

- [ ] **Step 1: Write failing state and backup tests**

Add tests covering malformed JSON, partial state, v1/v2 imports, unsupported versions, invalid dates, malicious date strings, metric bounds, and non-mutation:

```js
test("stored corruption falls back to defaults",()=>{
  const state=FuelCore.parseStoredState("{broken");
  assert.deepEqual(state.days,[]);
  assert.equal(state.mode,"16");
});

test("normalization drops invalid nested records",()=>{
  const state=FuelCore.normalizeState({
    mode:"99",
    days:[{date:'" onclick="alert(1)',code:"X"}, {date:"2026-09-01",code:"OFF",times:[],airports:[],kind:"rest"}],
    metrics:[{fat:18,weight:77,date:"2026-09-01T10:00:00.000Z"},{fat:200}]
  });
  assert.equal(state.mode,"16");
  assert.equal(state.days.length,1);
  assert.equal(state.metrics.length,1);
});

test("backup v1 migrates and unsupported versions fail",()=>{
  const ok=FuelCore.parseBackup(JSON.stringify({app:"fuel-window",v:1,state:{mode:"14"}}));
  assert.equal(ok.mode,"14");
  assert.throws(()=>FuelCore.parseBackup(JSON.stringify({app:"fuel-window",v:99,state:{}})),/версия/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/app-core.test.js`  
Expected: FAIL because the new APIs are undefined.

- [ ] **Step 3: Implement canonical validators**

Implement explicit allowlists and regexes:

```js
const DATE=/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/;
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const MODES_TEXT=new Set(["12","14","16","18"]);
const GOALS=new Set(["fat","keep"]);
const CONTEXTS=new Set(["auto","training","recovery"]);
const KINDS=new Set(["rest","duty","early","night"]);
```

Validate real calendar dates by round-tripping year/month/day. Limit string lengths, arrays, airports, and details. Rebuild every accepted object rather than spreading untrusted input.

`parseBackup` must parse and validate before returning. It must never write storage.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/app-core.test.js`  
Expected: all state and backup tests PASS.

- [ ] **Step 5: Use the canonical state in the UI**

Replace direct startup `JSON.parse` with:

```js
let s=FuelCore.parseStoredState(localStorage.getItem(K));
const save=()=>localStorage.setItem(K,JSON.stringify(FuelCore.normalizeState(s)));
```

Export with `FuelCore.makeBackup(s,new Date().toISOString())`. Restore into a local variable, write only after `parseBackup` succeeds, and leave the existing state untouched on error.

- [ ] **Step 6: Run full tests and manually import v1 plus malformed backup**

Run: `npm test`  
Expected: all tests PASS.

Verify a v1 backup reloads; verify malformed JSON shows an error and current data remains.

- [ ] **Step 7: Commit**

```bash
git add app-core.js tests/app-core.test.js index.html
git commit -m "fix: validate local state and backups"
```

---

### Task 3: Safe roster rendering and scoped deletion

**Files:**
- Modify: `index.html:683-726,838-841`
- Modify: `tests/app-core.test.js`

**Interfaces:**
- Consumes: canonical `state.days` from Task 2.
- Produces: `clearFuelWindowData() -> Promise<void>` scoped to Fuel Window resources.

- [ ] **Step 1: Add a source regression test**

Read `index.html` in the test and assert it contains no `localStorage.clear(` and no roster `data-d` HTML concatenation. Assert it contains `localStorage.removeItem(K)`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/app-core.test.js`  
Expected: FAIL on current destructive/rendering source.

- [ ] **Step 3: Render roster buttons with DOM APIs**

Replace `box.innerHTML=s.days.map(...)` with `replaceChildren()`, `document.createElement("button")`, `button.dataset.d=d.date`, and child spans whose `textContent` contains weekday, date, and code.

Set `aria-pressed` and `aria-current` while creating each button.

- [ ] **Step 4: Scope deletion**

Implement:

```js
async function clearFuelWindowData(){
  localStorage.removeItem(K);
  indexedDB.deleteDatabase("fuel-pdf");
  if("caches"in window){
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("fuel-window-")).map(k=>caches.delete(k)));
  }
}
```

The click handler awaits this function after the existing confirmation, then reloads.

- [ ] **Step 5: Verify GREEN and manual isolation**

Run: `npm test`  
Expected: all tests PASS.

Create an unrelated localStorage key and unrelated cache in a test browser, delete Fuel Window data, and verify both remain.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/app-core.test.js
git commit -m "fix: scope data deletion and render roster safely"
```

---

### Task 4: Transactional multi-page roster parsing

**Files:**
- Modify: `roster-parser.js`
- Create: `tests/roster-parser.test.js`
- Modify: `index.html:824-845`

**Interfaces:**
- Produces: `FuelParser.parsePages(pages) -> {days:Array<RosterDay>,warnings:string[]}`
- Produces: `FuelParser.parse(file) -> Promise<{days,warnings}>`
- Consumes: `Circadian.Z`.
- Produces for Task 7: warning copy documented in README.

- [ ] **Step 1: Write synthetic parser fixtures and failing tests**

Build item factories matching PDF.js `{str,transform:[0,0,0,0,x,y]}`. Cover one page, two date rows across pages, New Year, no dates, duty without report, and an incomplete period.

Assert returned days are unique and sorted, warnings are present where required, and empty documents throw `Не найдены дни roster`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/roster-parser.test.js`  
Expected: FAIL because `parsePages` is missing and current module is browser-only.

- [ ] **Step 3: Extract pure parsing and add compatible exports**

Use a module wrapper that obtains zones from `Circadian.Z` in the browser or `require("../circadian.js")` in tests. Keep PDF.js import inside `parse(file)`.

`parse(file)` must loop from page 1 through `pdf.numPages`, map every page to normalized text items, then call `parsePages(pages)`.

`parsePages` must:

- find the report range across page headers;
- process date rows per page so identical y coordinates on different pages do not collide;
- infer years across New Year;
- deduplicate by date;
- sort ascending;
- emit warnings for missing report time and suspicious/incomplete periods;
- throw if no valid days remain.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/roster-parser.test.js`  
Expected: parser tests PASS.

- [ ] **Step 5: Make import transactional and remove PDF persistence**

Change the input handler:

```js
const parsed=await FuelParser.parse(file);
if(!parsed.days.length)throw Error("Не найдены дни roster");
const nextDays=parsed.days;
s.days=nextDays;
s.date=nextDays[0].date;
s.file={name:file.name,count:nextDays.length,warnings:parsed.warnings};
```

Do not open IndexedDB or store the file. Do not assign `s.days` until parsing and validation finish. Display warning count in `drawStatus()`.

- [ ] **Step 6: Run full tests and manually test failure preservation**

Run: `npm test`  
Expected: all tests PASS.

Import a valid roster, then an invalid PDF; verify the original roster remains and the status reports the error.

- [ ] **Step 7: Commit**

```bash
git add roster-parser.js tests/roster-parser.test.js index.html
git commit -m "fix: validate multi-page roster imports"
```

---

### Task 5: Circadian regression suite

**Files:**
- Modify: `circadian.js`
- Create: `tests/circadian.test.js`

**Interfaces:**
- Preserves browser API: `window.Circadian={get,Z,off,instants,stateAt}`.
- Produces Node API: `require("../circadian.js")` with the same object.
- Consumes: no changes to call sites.

- [ ] **Step 1: Write failing Node import and regression tests**

Test:

- ALA offset `+5`;
- DEL offset `+5.5`;
- Europe/Berlin winter/summer offsets;
- duty release after midnight;
- a two-day away stay keeps the home body clock;
- a longer stay adapts progressively;
- a December-to-January sequence remains ordered;
- an unknown airport falls back safely.

Use fixed ISO dates and assert exact offsets plus bounded start minutes.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/circadian.test.js`  
Expected: FAIL because `window` is undefined in Node.

- [ ] **Step 3: Add environment-neutral export**

Build the object into a local `Circadian` constant, then:

```js
if(typeof window!=="undefined")window.Circadian=Circadian;
if(typeof module!=="undefined"&&module.exports)module.exports=Circadian;
```

Do not change public function names or current scheduling behavior unless a regression test demonstrates a defect.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/circadian.test.js`  
Expected: all circadian tests PASS.

- [ ] **Step 5: Run all tests and commit**

Run: `npm test`  
Expected: all tests PASS.

```bash
git add circadian.js tests/circadian.test.js
git commit -m "test: cover circadian scheduling edge cases"
```

---

### Task 6: Scoped and durable service worker

**Files:**
- Modify: `sw.js`
- Create: `tests/service-worker.test.js`
- Modify: `index.html:854-873`

**Interfaces:**
- Consumes: shell files including `app-core.js`.
- Produces: cache names `fuel-window-v25` and `fuel-window-ics`.

- [ ] **Step 1: Write failing source-level regression tests**

Assert that `sw.js`:

- defines `PREFIX="fuel-window-"`;
- deletes only keys satisfying `startsWith(PREFIX)`;
- checks `response.ok`;
- checks `new URL(request.url).origin===self.location.origin`;
- includes `app-core.js` in shell assets;
- does not use the old exception `k!=="fuel-ics"`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/service-worker.test.js`  
Expected: FAIL against v24 source.

- [ ] **Step 3: Rewrite lifecycle and fetch promises**

Use readable multi-line source. In activate, delete only old prefixed caches excluding current cache and `fuel-window-ics`.

For GET requests, return the cache-write promise as part of `respondWith`:

```js
const response=await fetch(request);
if(response.ok&&new URL(request.url).origin===self.location.origin){
  const cache=await caches.open(CACHE);
  await cache.put(request,response.clone());
}
return response;
```

Use `caches.match(request)` only as the network failure fallback. Keep the ICS special route scoped to the exact pathname under the service-worker scope.

- [ ] **Step 4: Fix update UI control flow**

Make `apply()` return whether a waiting worker was messaged. On `updatefound`, show the banner only if a waiting worker exists and immediate apply cannot be completed. Ensure `controllerchange` reloads once.

- [ ] **Step 5: Verify GREEN and offline behavior**

Run: `npm test`  
Expected: all tests PASS.

Load once online, switch offline, reload, and verify the shell renders. Confirm an unrelated cache survives worker activation.

- [ ] **Step 6: Commit**

```bash
git add sw.js tests/service-worker.test.js index.html
git commit -m "fix: scope and harden offline caching"
```

---

### Task 7: Accessible settings and selection state

**Files:**
- Modify: `index.html:5,204-350,683-726,785-794`
- Modify: `tests/app-core.test.js`

**Interfaces:**
- Consumes: DOM roster rendering from Task 3.
- Produces: `openSheet(on)` with focus save/restore and inert background.

- [ ] **Step 1: Add failing HTML source assertions**

Assert viewport does not contain `user-scalable=no` or `maximum-scale=1`; settings contains `role="dialog"` and `aria-modal="true"`; open/close code references `inert`, `focus()`, and saved focus.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/app-core.test.js`  
Expected: accessibility assertions FAIL.

- [ ] **Step 3: Implement dialog semantics and focus management**

Give the sheet `role="dialog" aria-modal="true" aria-labelledby="settingsTitle"`. Add `id="settingsTitle"` to its heading.

Wrap header/main in a stable container or mark both inert while open. Store `document.activeElement` before opening, focus `#closeSet`, and on close restore focus after removing inert. Escape only closes an open sheet.

- [ ] **Step 4: Expose selection state**

Set `aria-pressed` on context buttons whenever `drawDay()` runs. Roster-day buttons already receive `aria-pressed` and `aria-current` from Task 3.

- [ ] **Step 5: Verify GREEN and keyboard behavior**

Run: `npm test`  
Expected: all tests PASS.

Keyboard check: Settings → focus moves to «Готово»; Tab cannot reach background; Escape closes; focus returns to «Настройки».

- [ ] **Step 6: Commit**

```bash
git add index.html tests/app-core.test.js
git commit -m "fix: make settings dialog keyboard accessible"
```

---

### Task 8: Documentation and CI

**Files:**
- Modify: `README.md`
- Create: `.github/workflows/test.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: final behavior and warning copy from Tasks 1-7.
- Produces: CI status for PRs and main pushes.

- [ ] **Step 1: Add GitHub Actions workflow**

Create:

```yaml
name: test
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm test
```

Because there are no dependencies or lockfile, remove `cache: npm` if setup-node rejects missing dependency metadata during the first workflow run.

- [ ] **Step 2: Rewrite README to match the application**

Include:

- live URL `https://rbozzhanov-web.github.io/fasting-scheduler/`;
- local-only PDF parsing and statement that source PDF is not retained;
- backup v2 and v1 compatibility;
- supported Air Astana-style roster limitation;
- ICS as the serverless closed-app reminder path on iOS;
- `npm test` command;
- deployment instructions;
- medical disclaimer.

Remove all AI gateway claims.

- [ ] **Step 3: Run the complete local verification**

Run: `npm test`  
Expected: every test file PASS with zero failures.

Search:

```bash
rg -n "localStorage\.clear|fuel-ics|AI-шлюз|user-scalable=no|maximum-scale=1" index.html sw.js README.md
```

Expected: no destructive or stale matches; permitted new `fuel-window-ics` references may appear.

- [ ] **Step 4: Browser smoke test**

Verify:

- initial idle screen;
- manual start;
- fast countdown;
- elapsed eating-window timer;
- settings focus flow;
- backup export/import;
- invalid backup rejection;
- roster import error preservation;
- delete-data isolation;
- online and offline reload;
- no console errors.

- [ ] **Step 5: Commit**

```bash
git add README.md .github/workflows/test.yml package.json
git commit -m "ci: test Fuel Window v25"
```

---

### Task 9: Final verification and pull request

**Files:**
- Review: all changed files
- No new implementation files expected.

**Interfaces:**
- Consumes: all earlier task deliverables.
- Produces: one reviewable pull request from `codex/fuel-window-v25` to `main`.

- [ ] **Step 1: Re-read the approved spec**

Check every acceptance criterion in `docs/superpowers/specs/2026-09-01-fuel-window-v25-design.md` against the implementation and test evidence. Record any unmet item and fix it before continuing.

- [ ] **Step 2: Run fresh verification**

Run:

```bash
npm test
git diff --check main...HEAD
git status --short
```

Expected: tests exit 0, diff check has no output, and status is clean.

- [ ] **Step 3: Inspect branch changes**

Run: `git diff --stat main...HEAD` and `git log --oneline main..HEAD`.

Confirm only approved files changed and commits are task-scoped.

- [ ] **Step 4: Check GitHub Actions**

Push the branch if needed, wait for the workflow, and require the `test` job to pass. Do not merge.

- [ ] **Step 5: Create the pull request**

Title: `Fuel Window v25: elapsed eating timer and reliability hardening`

Body must summarize the timer behavior, storage/cache isolation, backup migration, parser changes, accessibility, tests, manual checks, and known limitation that local scheduled notifications remain browser-dependent.

- [ ] **Step 6: Request code review**

Use the requesting-code-review workflow against the complete branch diff. Address valid findings, rerun `npm test`, and update the PR.

- [ ] **Step 7: Hand off**

Report the PR URL, CI status, exact test count, and any manual iOS checks that still require the user’s device. Do not merge without explicit user approval.

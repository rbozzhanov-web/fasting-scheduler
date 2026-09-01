const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chromePath = () => chromeCandidates.find(candidate => fs.existsSync(candidate));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPage(port, pageUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find(candidate => candidate.type === "page" && candidate.url === pageUrl);
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

function cdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;

  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function withPage(run) {
  const executable = chromePath();
  assert.ok(executable, "Chrome or Chromium is required for visual style tests");

  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fuel-window-style-"));
  const pageUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
  const chrome = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    pageUrl,
  ], { stdio: "ignore" });

  try {
    const page = await waitForPage(port, pageUrl);
    const client = cdp(page.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Runtime.enable");
    await client.send("Runtime.evaluate", {
      expression: "document.readyState === 'complete' || new Promise(resolve => addEventListener('load', resolve, {once:true}))",
      awaitPromise: true,
    });
    const evaluate = async expression => {
      const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result.value;
    };
    await run({ evaluate, send: (method, params) => client.send(method, params) });
    client.close();
  } finally {
    if (chrome.exitCode === null) {
      chrome.kill();
      await once(chrome, "exit");
    }
    /* Chromium may leave profile files briefly locked after its parent exits.
       Cleanup is housekeeping, not part of the assertion: never turn a green
       browser test red solely because /tmp could not be removed immediately. */
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
    } catch {}
  }
}

test("content cards stay in the content layer instead of becoming Liquid Glass", async () => {
  await withPage(async ({ evaluate }) => {
    const backdrop = await evaluate("getComputedStyle(document.querySelector('main .card')).backdropFilter");
    assert.equal(backdrop, "none");
  });
});

test("functional controls use iOS 26 concentric capsule geometry", async () => {
  await withPage(async ({ evaluate }) => {
    const radii = await evaluate(`(() => {
      const radius = selector => getComputedStyle(document.querySelector(selector)).borderRadius;
      return {
        gear: radius('.gear'),
        button: radius('.btn'),
        mini: radius('.btn.mini'),
        segment: radius('.seg'),
        segmentButton: radius('.seg button'),
      };
    })()`);
    assert.deepEqual(radii, {
      gear: "21px",
      button: "24px",
      mini: "19px",
      segment: "22px",
      segmentButton: "18px",
    });
  });
});

test("reduced motion removes decorative transitions", async () => {
  await withPage(async ({ evaluate, send }) => {
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    const durations = await evaluate(`(() => {
      const duration = selector => getComputedStyle(document.querySelector(selector)).transitionDuration;
      return {
        gear: duration('.gear'),
        sheet: duration('.sheet'),
        progress: duration('.cyc-fill'),
      };
    })()`);
    assert.deepEqual(durations, { gear: "0s", sheet: "0s", progress: "0s" });
  });
});

test("functional glass controls have a specular edge without decorating content cards", async () => {
  await withPage(async ({ evaluate }) => {
    const styles = await evaluate(`(() => {
      const pick = selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow };
      };
      return { gear: pick('.gear'), quiet: pick('.btn-quiet'), card: pick('main .card') };
    })()`);
    assert.match(styles.gear.backgroundImage, /linear-gradient/);
    assert.match(styles.gear.boxShadow, /inset/);
    assert.match(styles.quiet.backgroundImage, /linear-gradient/);
    assert.match(styles.quiet.boxShadow, /inset/);
    assert.equal(styles.card.backgroundImage, "none");
  });
});

test("main screen and settings stay within 320, 390, and 430 pixel iPhone viewports", async () => {
  await withPage(async ({ evaluate, send }) => {
    for (const width of [320, 390, 430]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 430 ? 932 : 844,
        deviceScaleFactor: 1,
        mobile: true,
      });

      const main = await evaluate(`(() => {
        const selectors = ['.hdr','.hero','main .card','#fastBtn','#editStart'];
        const rects = selectors.map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, width: rect.width };
        });
        return { innerWidth, scrollWidth: document.documentElement.scrollWidth, rects };
      })()`);
      assert.equal(main.innerWidth, width);
      assert.ok(main.scrollWidth <= width, `main screen overflows at ${width}px`);
      for (const rect of main.rects) {
        assert.ok(rect.width > 0, `${rect.selector} collapses at ${width}px`);
        assert.ok(rect.left >= 0 && rect.right <= width, `${rect.selector} escapes ${width}px viewport`);
      }

      await evaluate(`(async () => {
        document.querySelector('#openSet').click();
        await new Promise(resolve => setTimeout(resolve, 350));
      })()`);
      const settings = await evaluate(`(() => {
        const sheet = document.querySelector('#sheet');
        const selectors = ['.sheet-hd','.sheet .card','#closeSet','#mode','#goal','#bfOn','#bfFrom','#bfTo'];
        const rects = selectors.map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, width: rect.width };
        });
        const bounds = sheet.getBoundingClientRect();
        return {
          open: sheet.open,
          innerWidth,
          scrollWidth: sheet.scrollWidth,
          clientWidth: sheet.clientWidth,
          bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
          rects,
        };
      })()`);
      assert.equal(settings.open, true);
      assert.equal(settings.innerWidth, width);
      assert.ok(settings.scrollWidth <= settings.clientWidth, `settings overflow at ${width}px`);
      assert.deepEqual(settings.bounds, { left: 0, right: width, top: 0, bottom: width === 430 ? 932 : 844 });
      for (const rect of settings.rects) {
        assert.ok(rect.width > 0, `${rect.selector} collapses at ${width}px`);
        assert.ok(rect.left >= 0 && rect.right <= width, `${rect.selector} escapes ${width}px viewport`);
      }
      await evaluate("document.querySelector('#sheet').close()");
    }
  });
});

test("the visual release advances the installed PWA cache and visible version together", async () => {
  let install;
  let openedCache;
  const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  vm.runInNewContext(source, {
    self: {
      addEventListener(type, listener) {
        if (type === "install") install = listener;
      },
    },
    caches: {
      async open(name) {
        openedCache = name;
        return { async addAll() {} };
      },
    },
    URL,
    Request,
    Response,
  });

  let installJob;
  install({ waitUntil(job) { installJob = job; } });
  await installJob;
  assert.equal(openedCache, "fuel-window-v31");

  await withPage(async ({ evaluate }) => {
    assert.equal(await evaluate("document.querySelector('#ver').textContent"), "v31");
  });
});
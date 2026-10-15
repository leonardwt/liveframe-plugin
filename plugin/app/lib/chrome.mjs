// Chrome on this Mac, headless, with its own profile, spoken to over the DevTools protocol (so
// Liveframe needs no packages). Used for pictures of screens (lib/pictures.mjs) and for Publish's
// saved pages (lib/snapshot.mjs). It quits a few seconds after the last page closes.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { STATE_DIR, CHROME } from "./config.mjs";

const PROFILE = path.join(STATE_DIR, "chrome-profile");
const SETTLE_MS = 1200; // no request for this long: the page has loaded its data
const AFTER_MS = 1500; // then charts and layout settle
const MAX_MS = 60_000; // a page that never settles is taken as it is

let browser = null; // a promise of { send, on, quit, quitSoon }
let chrome = null; // its process
let open = 0;

/**
 * Open `url` at w×h in a fresh tab, wait until it has loaded its data and drawn something, and
 * return { page(method, params), cookie, close() }. `cookies`: [{ name, value }] for the page's origin.
 */
export async function openPage(url, { width, height, cookies = [], mobile = width < 768 }) {
  const b = await (browser ??= launch());
  open++;
  const { browserContextId } = await b.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await b.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => b.send(method, params, sessionId);
  const close = async () => {
    await b.send("Target.closeTarget", { targetId }).catch(() => {});
    await b.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    if (--open === 0) b.quitSoon();
  };
  try {
    await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page("Network.enable");
    await page("Page.enable");
    for (const c of cookies) await page("Network.setCookie", { name: c.name, value: c.value, url });
    const inflight = new Set();
    let last = Date.now();
    let loaded = false;
    const off = b.on(sessionId, (method, params) => {
      if (method === "Network.requestWillBeSent") {
        // Hot reload and other long-lived requests never finish: don't wait for them.
        if (/\/_next\/webpack-hmr|\/__nextjs|\/hot-update|eventsource/i.test(params.request.url)) return;
        inflight.add(params.requestId);
        last = Date.now();
      } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
        if (inflight.delete(params.requestId)) last = Date.now();
      } else if (method === "Page.loadEventFired") loaded = true;
    });
    const start = Date.now();
    await page("Page.navigate", { url });
    while (Date.now() - start < MAX_MS && !(loaded && inflight.size === 0 && Date.now() - last > SETTLE_MS)) await sleep(150);
    // A page that has drawn has text on it: a picture of a blank page is worse than none.
    const drew = async () => (await page("Runtime.evaluate", { expression: `(document.body?.innerText || "").trim().length`, returnByValue: true })).result?.value >= 20;
    while (!(await drew())) {
      if (Date.now() - start > MAX_MS) throw new Error("the page drew nothing");
      await sleep(500);
    }
    await sleep(AFTER_MS);
    off();
    // Development-only overlays aren't part of the design (Next.js's badge and error toasts).
    await evaluate(page, `document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; }" }))`);
    await sleep(100);
    return { page, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Run JavaScript in the page and return its value (awaited, JSON-able). */
export async function evaluate(page, expression) {
  const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

export function quitChrome() {
  chrome?.kill("SIGTERM");
}

async function launch() {
  if (!fs.existsSync(CHROME)) throw new Error(`No Chrome at ${CHROME} (set LIVEFRAME_CHROME)`);
  fs.mkdirSync(PROFILE, { recursive: true });
  const portFile = path.join(PROFILE, "DevToolsActivePort");
  fs.rmSync(portFile, { force: true });
  const proc = spawn(CHROME, [
    "--headless", "--remote-debugging-port=0", `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "about:blank",
  ], { stdio: "ignore" });
  chrome = proc;
  const gone = new Promise((resolve) => proc.once("exit", resolve));
  const quitNow = () => {
    browser = null;
    if (chrome === proc) chrome = null;
    try {
      proc.kill("SIGTERM");
    } catch {}
  };
  try {
    let lines = null;
    for (let i = 0; i < 100 && !lines; i++) {
      await sleep(100);
      try {
        lines = fs.readFileSync(portFile, "utf8").trim().split("\n");
      } catch {}
      if (proc.exitCode != null) throw new Error("Chrome quit as it started");
    }
    if (!lines) throw new Error("Chrome didn't open its DevTools port");
    const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
    await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = () => reject(new Error("couldn't reach Chrome")))));

    let next = 0;
    const waiting = new Map();
    const listeners = new Set();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id != null) {
        const p = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result);
      } else for (const fn of listeners) fn(msg);
    };
    ws.onclose = () => {
      for (const p of waiting.values()) p.reject(new Error("Chrome went away"));
      waiting.clear();
      quitNow();
    };
    gone.then(() => ws.close());

    let idle = null;
    return {
      send(method, params = {}, sessionId) {
        clearTimeout(idle);
        const id = ++next;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject });
          setTimeout(() => waiting.delete(id) && reject(new Error(`${method} timed out`)), 90_000).unref();
        });
      },
      /** Events for one page: fn(method, params). Returns a way to stop listening. */
      on(sessionId, fn) {
        const l = (msg) => msg.sessionId === sessionId && fn(msg.method, msg.params);
        listeners.add(l);
        return () => listeners.delete(l);
      },
      quit: quitNow,
      /** Quit unless it's used again within a few seconds (pages often come in a batch). */
      quitSoon() {
        clearTimeout(idle);
        idle = setTimeout(quitNow, 5000);
        idle.unref();
      },
    };
  } catch (e) {
    quitNow();
    throw e;
  }
}

process.on("exit", () => chrome?.kill("SIGKILL"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

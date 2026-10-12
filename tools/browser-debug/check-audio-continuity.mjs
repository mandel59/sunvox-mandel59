import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const browserName = option("browser", "firefox");
const url = option("url", "https://sunvox-projects.ryusei.dev/");
const project = option("project", "generated/music/midnight-loop-line.sunvox");
const seconds = Number(option("seconds", "125"));
const intervalMs = Number(option("interval-ms", "0"));
const executablePath = option("executable", undefined);
const probeWorker = !args.includes("--no-worker-probe") && (intervalMs > 0 || args.includes("--worker-probe"));
assert.ok(seconds > 0 && Number.isFinite(seconds));
assert.ok(intervalMs >= 0 && Number.isFinite(intervalMs));
assert.ok(!args.includes("--no-worker-probe") || intervalMs === 0, "interval override requires Worker instrumentation");
assert.ok(["firefox", "chromium"].includes(browserName));
const browser = await ({ firefox, chromium })[browserName].launch({ executablePath });
let page;
const errors = [];
const logs = [];
try {
  const context = await browser.newContext();
  // Only this test's Worker is instrumented; the served application is unchanged.
  if (probeWorker) await context.route(/\/sunvox-audio-worker[^/]*\.js(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const probe = `
const probeInterval = self.setInterval.bind(self);
self.setInterval = (callback, delay, ...args) => {
  if (delay !== 2) return probeInterval(callback, delay, ...args);
  let previous = performance.now(), gaps = [], renderMs = [];
  return probeInterval(() => {
    const now = performance.now(); gaps.push(now - previous); previous = now;
    callback(...args); renderMs.push(performance.now() - now);
    if (gaps.length >= 50) {
      self.postMessage({type: "sunvox-timing-probe", gaps, renderMs});
      gaps = []; renderMs = [];
    }
  }, Math.max(delay, ${intervalMs}));
};
`;
    const headers = { ...response.headers() };
    // APIResponse.text() is decoded; Firefox must receive matching body headers.
    delete headers["content-encoding"];
    delete headers["content-length"];
    await route.fulfill({ response, headers, body: probe + await response.text() });
  });
  await context.addInitScript(() => {
    window.__continuity = { gaps: [], renderMs: [], control: null };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "sunvox-timing-probe") {
            window.__continuity.gaps.push(...data.gaps);
            window.__continuity.renderMs.push(...data.renderMs);
          }
        });
      }
      postMessage(message, ...args) {
        if (message.payload?.type === "configureAudio" && message.payload.sharedAudio) {
          window.__continuity.control = new Int32Array(message.payload.sharedAudio.controlBuffer);
        }
        return super.postMessage(message, ...args);
      }
    };
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
  const target = new URL(url);
  target.hash = `file=${encodeURIComponent(project)}`;
  await page.goto(target.href, { waitUntil: "networkidle" });
  await page.locator("#topbar-controls button").first().click();
  await page.waitForFunction((project) => window.getPlayerState?.().isPlaying && window.getPlayerState().loadedPath === project, project);
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => {
    const control = window.__continuity.control;
    if (!control) throw new Error("This continuity probe requires shared audio (COOP/COEP)");
    return { underruns: Atomics.load(control, 6), consumed: Atomics.load(control, 7) };
  });
  await page.waitForTimeout(seconds * 1000);
  const result = await page.evaluate(({ seconds, before }) => {
    const { control, gaps, renderMs } = window.__continuity;
    const summary = (values) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return { count: sorted.length, max: sorted.at(-1), p99: sorted[Math.floor(sorted.length * 0.99)], mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
    };
    return {
      transport: window.getAudioTransportState(), state: window.getPlayerState(), seconds,
      startupUnderruns: before.underruns,
      underruns: Atomics.load(control, 6) - before.underruns,
      droppedFrames: Atomics.load(control, 8),
      consumedSeconds: (Atomics.load(control, 7) - before.consumed) / 44100,
      workerGapsMs: summary(gaps), renderMs: summary(renderMs),
    };
  }, { seconds, before });
  await page.locator("#topbar-controls button").nth(1).click();
  console.log(JSON.stringify({ browser: browserName, version: browser.version(), intervalMs, workerInstrumented: probeWorker, url: target.href, ...result, errors }, null, 2));
  assert.equal(result.underruns, 0, "audio ran out of buffered frames");
  assert.equal(result.droppedFrames, 0);
  assert.ok(result.consumedSeconds >= seconds * 0.95, "audio must advance in real time");
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors, logs, diagnostics: await page?.evaluate(() => ({
    state: window.getPlayerState?.(), transport: window.getAudioTransportState?.(),
    control: window.__continuity?.control ? Array.from(window.__continuity.control) : null,
  })).catch(() => null) }));
  throw error;
} finally {
  await browser.close();
}

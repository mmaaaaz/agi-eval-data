// Verify the-review-gate.html over CDP: true 390px layout, live behaviour, console errors.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const PAGE = "file:///C:/Users/Maaz/AppData/Local/hermes/cache/scratch/anatomy/the-review-gate.html";
const OUT = "C:/Users/Maaz/AppData/Local/hermes/cache/scratch/anatomy/shots/";
const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
const proc = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function version() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json(); } catch {}
    await sleep(250);
  }
  throw new Error("no cdp endpoint");
}

const v = await version();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method) events.push({ method: msg.method, params: msg.params });
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const P = (m, p = {}) => send(m, p, sessionId);

await P("Page.enable");
await P("Runtime.enable");
await P("Log.enable");
await P("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

const evalJs = async (expression) => {
  const r = await P("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const shot = async (name) => {
  const { data } = await P("Page.captureScreenshot", { format: "png" });
  writeFileSync(OUT + name, Buffer.from(data, "base64"));
};
const keyPress = async (key, code, vk) => {
  for (const type of ["keyDown", "keyUp"])
    await P("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

const probe = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) }; };
  const card = q(".iso-plate");
  const corner = (n) => q('.iso-plate-corner[data-corner="' + n + '"]');
  return {
    innerWidth, innerHeight,
    scrollW: document.scrollingElement.scrollWidth,
    dpr: devicePixelRatio,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    readout: q("[data-readout]").textContent,
    readoutFont: getComputedStyle(q("[data-readout]")).fontSize,
    cornerFont: getComputedStyle(corner("hint")).fontSize,
    legendFont: getComputedStyle(q(".iso-legend")).fontSize,
    card: rect(card),
    title: rect(corner("title")), fig: rect(corner("fig")),
    hint: rect(corner("hint")), readoutRect: rect(corner("readout")),
    svg: rect(q(".iso-svg")),
    ariaNow: q(".iso-stage").getAttribute("aria-valuenow"),
    ariaText: q(".iso-stage").getAttribute("aria-valuetext"),
    litParts: document.querySelectorAll("[data-lit]").length,
    plateTransforms: [...document.querySelectorAll("[data-plate]")].slice(0, 3).map((p) => p.getAttribute("transform")),
  };
})()`;

// ---- phone pass -----------------------------------------------------------
await P("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await P("Page.navigate", { url: PAGE });
await sleep(3000);
const phone0 = await evalJs(probe);
await shot("light-fix2-390.png");

// arrow keys
await keyPress("ArrowRight", "ArrowRight", 39);
await sleep(2600);
const afterRight = await evalJs(`document.querySelector("[data-readout]").textContent`);
await keyPress("ArrowLeft", "ArrowLeft", 37);
await sleep(2600);
const afterLeft = await evalJs(`document.querySelector("[data-readout]").textContent`);
// crank press
await evalJs(`document.querySelector('[data-part="crank"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await sleep(2600);
const afterCrank = await evalJs(`document.querySelector("[data-readout]").textContent`);
await shot("light-fix2-390-motion.png");
const phone1 = await evalJs(probe);
// idle tour: wait and see if it advances on its own (last input was >6s ago)
await sleep(9200);
const afterTour = await evalJs(`document.querySelector("[data-readout]").textContent`);

// ---- desktop pass ---------------------------------------------------------
await P("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 2, mobile: false });
await P("Page.navigate", { url: PAGE });
await sleep(2600);
await shot("light-fix2.png");
const desk = await evalJs(probe);

const errors = events
  .filter((e) => (e.method === "Log.entryAdded" && ["error", "warning"].includes(e.params.entry.level))
    || e.method === "Runtime.exceptionThrown")
  .map((e) => e.method === "Runtime.exceptionThrown" ? e.params.exceptionDetails.text + " " + JSON.stringify(e.params.exceptionDetails.exception?.description ?? "") : e.params.entry.text);

console.log(JSON.stringify({ phone0, afterRight, afterLeft, afterCrank, afterTour, phone1, desk, errors }, null, 1));
proc.kill();
process.exit(0);

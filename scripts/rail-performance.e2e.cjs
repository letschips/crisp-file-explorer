"use strict";

// Failure cases: unchanged ticks still mutate; a held pointer spins forever;
// pointer movement or edge scrolling stops after pausing; resizing/replacing
// rows leaves stale geometry; dropped frames destabilize the spring; release
// never settles; teardown leaves frames.
// Runs the shipped rail in the real renderer with isolated DOM and fake files.
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createHash } = require("node:crypto");

async function probe() {
  const plugin = app.plugins.plugins["crisp-file-explorer"];
  const exemplar = [...plugin.controllers.values()][0];
  if (!exemplar) throw Error("An activated File Explorer rail is required");
  const doc = exemplar.ownerDocument;
  const win = doc.defaultView;
  const root = doc.createElement("div");
  root.className = "workspace-leaf-content";
  root.dataset.type = "file-explorer";
  root.dataset.crispPerformanceE2e = "true";
  root.style.cssText = "position:fixed;left:20px;top:20px;width:420px;height:560px;z-index:-1;";
  const container = root.appendChild(doc.createElement("div"));
  container.className = "nav-files-container";
  container.style.cssText = "height:560px;overflow-y:auto;";
  const content = container.appendChild(doc.createElement("div"));
  const rows = [];
  for (let i = 0; i < 160; i++) {
    const row = content.appendChild(doc.createElement("div"));
    row.className = "nav-file-title tree-item-self";
    row.dataset.path = `fixture/note-${i}.md`;
    row.style.cssText = "height:28px;min-height:28px;";
    const label = row.appendChild(doc.createElement("div"));
    label.className = "tree-item-inner nav-file-title-content";
    label.textContent = `Fixture note ${i}`;
    rows.push(row);
  }
  const fake = Object.create(plugin);
  fake.settings = { ...plugin.settings, openOnDragRelease: false, soundEnabled: false,
    releaseSoundEnabled: false, frequentMagnetsEnabled: false, autoExpandFoldersOnDrag: false };
  fake.app = { workspace: { getActiveFile: () => ({ path: rows[10].dataset.path }) } };
  fake.getTodayPathSet = fake.getFrequentPathSet = fake.getPinnedPathSet = () => new Set();
  fake.enableDocument = fake.scheduleRefresh = () => {};
  const wait = ms => new Promise(resolve => win.setTimeout(resolve, ms));
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  let rail, observer;
  const refreshTimes = [];
  let renders = 0;
  const pointer = (target, type, y) => target.dispatchEvent(new win.PointerEvent(type,
    { pointerId: 12345, isPrimary: true, button: 0, clientY: y, bubbles: true, cancelable: true }));
  doc.body.appendChild(root);
  try {
    rail = new exemplar.constructor(fake, container);
    const originalRender = rail.render;
    rail.render = function (...args) { renders++; return originalRender.apply(this, args); };
    await wait(350);
    rail.refresh({ immediate: true });
    await wait(200);
    const records = [];
    observer = new win.MutationObserver(mutations => records.push(...mutations));
    observer.observe(rail.ticks, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const tick = rail.tickEls[30];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      rail.refresh({ immediate: true });
      refreshTimes.push(performance.now() - start);
      await wait(30);
    }
    check("stable refresh keeps tick nodes and does not rewrite tick attributes",
      rail.tickEls[30] === tick && records.length === 0,
      { attributeMutations: records.length, refreshTimes });
    observer.disconnect();
    const rect = container.getBoundingClientRect();
    pointer(rail.orb, "pointerdown", rect.top + 240);
    await wait(80);
    const before = renders;
    await wait(300);
    check("holding a stationary pointer has no continuous render loop", renders === before && rail.frame === null,
      { extraRenders: renders - before, framePending: rail.frame !== null });
    const heldY = rail.displayY;
    pointer(win, "pointermove", rect.top + 310);
    await wait(80);
    check("pointer movement wakes rendering after a pause", rail.displayY > heldY + 50 && renders > before,
      { previousY: heldY, nextY: rail.displayY });
    const scrollBefore = container.scrollTop;
    pointer(win, "pointermove", rect.bottom - 2);
    await wait(180);
    check("holding the pointer at an edge continues scrolling and moves the orb",
      container.scrollTop > scrollBefore + 20 && rail.displayY > heldY,
      { previousScroll: scrollBefore, nextScroll: container.scrollTop });
    pointer(win, "pointercancel", rect.top + 310);
    await wait(120);
    check("cancelling releases pointer listeners and both frame loops", !rail.isDragging && !rail.dragOwnerWindow && !rail.dragScrollFrame && !rail.frame);
    rail.targetY = rail.items[8].center;
    rail.requestFrame();
    await wait(1600);
    check("spring motion still reaches its target and stops", rail.isSettled() && rail.frame === null,
      { target: rail.targetY, display: rail.displayY, velocity: rail.velocity });
    for (const [name, deltas] of [["30fps", [1000 / 30]], ["dropped frames", [1000 / 120, 80, 1000 / 60, 1000 / 30]]]) {
      win.cancelAnimationFrame(rail.frame);
      rail.frame = null;
      rail.lastFrameTime = undefined;
      rail.displayY = rail.items[2].center;
      rail.targetY = rail.items[15].center;
      rail.velocity = 0;
      const low = rail.displayY, high = rail.targetY;
      let timestamp = 1000, bounded = true;
      for (let i = 0; i < 180; i++) {
        timestamp += deltas[i % deltas.length];
        rail.animate(timestamp);
        win.cancelAnimationFrame(rail.frame);
        rail.frame = null;
        bounded &&= Number.isFinite(rail.displayY) && rail.displayY >= low - 1 && rail.displayY <= high + 1;
        if (rail.isSettled()) break;
      }
      check(`spring remains bounded and settles at ${name}`, bounded && rail.isSettled(),
        { target: rail.targetY, display: rail.displayY, velocity: rail.velocity, bounded });
      rail.lastFrameTime = undefined;
    }
    const oldCenter = rail.items[20].center;
    rows[0].style.height = "56px";
    await wait(200);
    check("content resize still remeasures row centres", Math.abs(rail.items[20].center - oldCenter - 28) < 1,
      { previous: oldCenter, next: rail.items[20].center });
    const replacement = rows[20].cloneNode(true);
    rows[20].replaceWith(replacement);
    await wait(200);
    check("tree replacement still refreshes item and tick topology", rail.items[20].el === replacement && !rail.items.some(item => item.el === rows[20]));
    container.scrollTop = 0;
    rail.refresh({ immediate: true });
    await wait(180);
    check("ordinary scroll preserves document-relative tick geometry", Math.abs(rail.tickMarks.find(t => t.itemIndex === 20).y - rail.items[20].center) < 0.01);
  } finally {
    observer?.disconnect();
    rail?.destroy();
    root.remove();
  }
  check("teardown removes fixture and pending frames", !root.isConnected && !rail.frame && !rail.measureFrame && !rail.dragScrollFrame);
  return JSON.stringify({ version: plugin.manifest.version, rows: rows.length, refreshTimes, checks, pass: checks.every(value => value.pass) });
}

const vault = process.env.CRISP_E2E_VAULT;
const output = process.argv.find(value => value.startsWith("--output="))?.slice(9);
const stdout = execFileSync("obsidian", [...(vault ? [`vault=${vault}`] : []), "eval", `code=(${probe.toString()})()`],
  { encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
const line = stdout.split("\n").find(value => value.startsWith("=> "));
if (!line) throw Error(stdout.trim() || "No renderer result");
const result = JSON.parse(line.slice(3));
result.sourceSha256 = createHash("sha256").update(readFileSync(resolve(__dirname, "../main.js"))).digest("hex");
result.checkedAt = new Date().toISOString();
if (output) {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.pass ? 0 : 1;

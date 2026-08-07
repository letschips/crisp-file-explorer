"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPluginRuntime(overrides = {}) {
  const sourcePath = path.join(__dirname, "..", "main.js");
  const source = `${fs.readFileSync(sourcePath, "utf8")}\nmodule.exports.__test = {
    nearestIndex,
    indexRangeAround: typeof indexRangeAround === "function" ? indexRangeAround : undefined,
    mutationTouchesFileTree: typeof mutationTouchesFileTree === "function" ? mutationTouchesFileTree : undefined,
    hasStableTickTopology: typeof hasStableTickTopology === "function" ? hasStableTickTopology : undefined,
    resolveOrbTarget: typeof resolveOrbTarget === "function" ? resolveOrbTarget : undefined,
    rewriteActivityPaths: typeof rewriteActivityPaths === "function" ? rewriteActivityPaths : undefined,
    dispatchMouseSequence: typeof dispatchMouseSequence === "function" ? dispatchMouseSequence : undefined,
    FileExplorerRail,
    CrispAudio,
    IMAGE_ORB_ASSETS,
    RANDOM_DAILY_ORB_STYLES,
    STATIC_ORB_STYLES,
    renderAboutCard: typeof renderAboutCard === "function" ? renderAboutCard : undefined,
  };`;
  const clearedTimers = [];
  const scheduledTimers = new Map();
  let nextTimerId = 1;
  const scheduledFrames = new Map();
  let nextFrameId = 1;

  const fakeWindow = {
    matchMedia: () => ({ matches: false }),
    setTimeout(callback) {
      const id = nextTimerId++;
      scheduledTimers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      clearedTimers.push(id);
      scheduledTimers.delete(id);
    },
    ...overrides.window,
  };

  const context = {
    module: { exports: {} },
    exports: {},
    require(id) {
      if (id !== "obsidian") return require(id);
      return {
        Plugin: class Plugin {},
        PluginSettingTab: class PluginSettingTab {},
        Setting: class Setting {},
        normalizePath: (value) => value,
      };
    },
    window: fakeWindow,
    performance,
    console,
    Date,
    Math,
    Map,
    Set,
    Promise,
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      scheduledFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      scheduledFrames.delete(id);
    },
    ...overrides.context,
  };

  vm.runInNewContext(source, context, { filename: sourcePath });
  return {
    PluginClass: context.module.exports,
    ...context.module.exports.__test,
    clearedTimers,
    scheduledTimers,
    scheduledFrames,
  };
}

function readStyles() {
  return fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
}

function createAboutCardFixture() {
  const createElement = (tagName) => ({
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  });
  const ownerDocument = { createElement };
  return {
    ownerDocument,
    children: [],
    append(...children) {
      this.children.push(...children);
    },
  };
}

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return undefined;
}

test("settings About card exposes the plugin purpose and author", () => {
  const { renderAboutCard } = loadPluginRuntime();
  assert.equal(typeof renderAboutCard, "function");
  const container = createAboutCardFixture();

  renderAboutCard(
    container,
    "Crisp File Explorer",
    "用更清晰、更有质感的文件导航，让笔记库浏览轻快而有序。"
  );

  const card = findByClass(container, "crisp-fe-about");
  const title = findByClass(container, "crisp-fe-about__title");
  const description = findByClass(container, "crisp-fe-about__description");
  const author = findByClass(container, "crisp-fe-about__author-link");
  assert.equal(title.textContent, "About Crisp File Explorer");
  assert.equal(
    description.textContent,
    "用更清晰、更有质感的文件导航，让笔记库浏览轻快而有序。"
  );
  assert.equal(author.textContent, "小红书 letschips");
  assert.equal(author.href, "https://xhslink.cn/m/3MwtKu4822b");
  assert.equal(author.target, "_blank");
  assert.equal(author.rel, "noopener noreferrer");
  assert.equal(card.children.includes(author), false);
});

function fakeClassList() {
  const values = new Set();
  return {
    values,
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function fakeTickElement(initialClasses, options = {}) {
  const classList = fakeClassList();
  classList.add(...initialClasses.split(/\s+/).filter(Boolean));
  return {
    classList,
    style: {
      top: options.top || "120px",
      width: options.width || "28px",
      transform: options.transform || "",
    },
    get className() {
      return [...classList.values].join(" ");
    },
    set className(value) {
      classList.values.clear();
      classList.add(...value.split(/\s+/).filter(Boolean));
    },
  };
}

test("nearestIndex keeps earlier ties and scales logarithmically", () => {
  const { nearestIndex } = loadPluginRuntime();
  const source = Array.from({ length: 4096 }, (_, index) => ({ center: index * 10 }));
  let reads = 0;
  const items = new Proxy(source, {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  assert.equal(nearestIndex(items, 20485), 2048);
  assert.ok(reads < 100, `expected fewer than 100 indexed reads, received ${reads}`);
});

test("dynamic range lookup stays logarithmic on very large trees", () => {
  const { indexRangeAround } = loadPluginRuntime();
  assert.equal(typeof indexRangeAround, "function");

  const source = Array.from({ length: 4096 }, (_, index) => ({ center: index * 10 }));
  let reads = 0;
  const items = new Proxy(source, {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  assert.deepEqual(Array.from(indexRangeAround(items, 20480, 35)), [2045, 2051]);
  assert.ok(reads < 160, `expected fewer than 160 indexed reads, received ${reads}`);
});

test("orb rotation follows viewport movement, not scroll-coordinate changes", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const ball = { style: { transform: "" } };
  const controller = {
    orb: {
      dataset: { orbStyle: "soccer" },
      querySelector: () => ball,
    },
    container: { scrollTop: 50 },
    displayY: 100,
    orbRotation: 0,
    lastRenderY: undefined,
  };

  FileExplorerRail.prototype.renderOrbBall.call(controller);
  controller.container.scrollTop = 70;
  controller.displayY = 120;
  FileExplorerRail.prototype.renderOrbBall.call(controller);

  assert.equal(ball.style.transform, "rotate(0deg)");
});

test("spring motion starts on the first animation frame", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const controller = {
    displayY: 0,
    targetY: 100,
    velocity: 0,
    isDragging: false,
    lastFrameTime: undefined,
    frame: 1,
    render() {},
    isSettled: FileExplorerRail.prototype.isSettled,
  };

  FileExplorerRail.prototype.animate.call(controller, 1000);

  assert.ok(controller.displayY > 0, "the orb should move immediately instead of waiting one frame");
});

test("successful active reveal cancels retries and avoids a second reveal scroll", () => {
  const { PluginClass, clearedTimers } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  const refreshOptions = [];
  let cancelledFrames = 0;
  plugin.activeRevealRunId = 7;
  plugin.activeRevealFrame = 21;
  plugin.activeRevealTimers = [11, 12, 13];
  plugin.revealActiveFileInExplorer = () => true;
  plugin.cancelActiveRevealFrame = () => {
    cancelledFrames += 1;
    plugin.activeRevealFrame = null;
  };
  plugin.scheduleRefresh = (options = {}) => refreshOptions.push(options);

  const result = plugin.runActiveRevealAttempt(7);

  assert.equal(result, true);
  assert.equal(plugin.activeRevealTimers.length, 0);
  assert.deepEqual(clearedTimers, [11, 12, 13]);
  assert.equal(cancelledFrames, 1);
  assert.equal(plugin.activeRevealFrame, null);
  assert.equal(refreshOptions.length, 1);
  assert.equal(refreshOptions[0].reveal, true);
});

test("active reveal does not request controller scrolling before the target is ready", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  plugin.unloading = false;
  plugin.pendingRefreshReveal = false;
  plugin.activeRevealRunId = 0;
  plugin.activeRevealTimers = [];
  plugin.isInteractionLocked = () => false;
  plugin.isMarkdownActiveLeaf = () => true;

  plugin.scheduleActiveReveal();

  assert.equal(plugin.pendingRefreshReveal, false);
});

test("file activity persistence is truly debounced during rapid document switching", async () => {
  const { PluginClass, clearedTimers, scheduledTimers } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  let saveCount = 0;
  plugin.settings = {
    todayTrailEnabled: true,
    frequentMagnetsEnabled: true,
    activity: { todayKey: "", todayPaths: [], fileStats: {} },
  };
  plugin.activitySaveTimer = null;
  plugin.saveSettings = async () => {
    saveCount += 1;
  };
  plugin.scheduleRefresh = () => {};

  plugin.recordFileActivity({ path: "one.md" });
  plugin.recordFileActivity({ path: "two.md" });

  assert.equal(saveCount, 0);
  assert.equal(scheduledTimers.size, 1);
  assert.equal(clearedTimers.length, 1, "the second file-open should restart the debounce window");
  const callback = [...scheduledTimers.values()][0];
  await callback();
  assert.equal(saveCount, 1);
});

test("settings writes stay ordered when activity and UI saves overlap", async () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  const calls = [];
  const resolvers = [];
  plugin.saveQueue = Promise.resolve();
  plugin.settings = { value: 1 };
  plugin.saveData = (snapshot) => {
    calls.push(snapshot.value);
    return new Promise((resolve) => resolvers.push(resolve));
  };

  const first = plugin.saveSettings();
  await Promise.resolve();
  plugin.settings.value = 2;
  const second = plugin.saveSettings();
  await Promise.resolve();

  assert.deepEqual(calls, [1]);
  resolvers.shift()();
  await first;
  await Promise.resolve();
  assert.deepEqual(calls, [1, 2]);
  resolvers.shift()();
  await second;
});

test("empty file trees hide the rail instead of leaving an orphan orb", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const classList = fakeClassList();
  const controller = { rail: { classList } };

  FileExplorerRail.prototype.syncEmptyState.call(controller, 0);
  assert.equal(classList.contains("is-empty"), true);
  FileExplorerRail.prototype.syncEmptyState.call(controller, 2);
  assert.equal(classList.contains("is-empty"), false);
});

test("an empty tree cancels an in-progress drag and clears stale orb motion", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const classList = fakeClassList();
  let cancellations = 0;
  const controller = {
    rail: { classList },
    isDragging: true,
    displayY: 140,
    targetY: 180,
    velocity: 12,
    hasOrbPosition: true,
    lastRenderViewportY: 100,
    cancelDragInteraction() {
      cancellations += 1;
      this.isDragging = false;
    },
  };

  FileExplorerRail.prototype.syncEmptyState.call(controller, 0);

  assert.equal(cancellations, 1);
  assert.equal(controller.displayY, 0);
  assert.equal(controller.targetY, 0);
  assert.equal(controller.velocity, 0);
  assert.equal(controller.hasOrbPosition, false);
  assert.equal(controller.lastRenderViewportY, undefined);
});

test("a transient missing active file preserves the current orb target", () => {
  const { resolveOrbTarget } = loadPluginRuntime();
  assert.equal(typeof resolveOrbTarget, "function");
  const items = [{ center: 30 }, { center: 110 }, { center: 190 }];

  assert.equal(resolveOrbTarget(items, null, true, 125), 125);
  assert.equal(resolveOrbTarget(items, null, true, 260), 190);
  assert.equal(resolveOrbTarget(items, null, false, 125), 30);
  assert.equal(resolveOrbTarget(items, { center: 110 }, true, 125), 110);
});

test("queued plugin refreshes are ignored after unload starts", () => {
  const { PluginClass, scheduledFrames } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  plugin.unloading = true;
  plugin.refreshQueued = false;
  plugin.pendingRefreshReveal = false;

  plugin.scheduleRefresh({ reveal: true });

  assert.equal(scheduledFrames.size, 0);
  assert.equal(plugin.refreshQueued, false);
});

test("audio resources are closed when the plugin unloads", async () => {
  const { CrispAudio } = loadPluginRuntime();
  let closeCount = 0;
  const mockWindow = {};
  const mockContext = {
    state: "running",
    close: async () => {
      closeCount += 1;
    },
  };
  const audio = Object.create(CrispAudio.prototype);
  audio.contexts = new WeakMap();
  audio.contextList = new Set([mockContext]);
  audio.contexts.set(mockWindow, mockContext);

  await audio.destroy();

  assert.equal(closeCount, 1);
  assert.equal(audio.contextList.size, 0);
});

test("audio creates a separate AudioContext per owner window", () => {
  const { CrispAudio } = loadPluginRuntime();
  const created = [];
  const mainWindow = {
    AudioContext: class MainAudioContext {
      constructor() { created.push("main"); this.state = "running"; }
      resume() { return Promise.resolve(); }
    },
  };
  const popoutWindow = {
    AudioContext: class PopoutAudioContext {
      constructor() { created.push("popout"); this.state = "running"; }
      resume() { return Promise.resolve(); }
    },
  };
  const audio = Object.create(CrispAudio.prototype);
  audio.contexts = new WeakMap();
  audio.contextList = new Set();
  audio.currentOwnerWindow = null;

  const mainCtx = audio.ensureContext(mainWindow);
  const mainCtxAgain = audio.ensureContext(mainWindow);
  const popoutCtx = audio.ensureContext(popoutWindow);

  assert.equal(created.length, 2);
  assert.deepEqual(created, ["main", "popout"]);
  assert.equal(mainCtx, mainCtxAgain);
  assert.notEqual(mainCtx, popoutCtx);
  assert.ok(audio.contexts instanceof WeakMap);
  assert.equal(audio.contextList.size, 2);
});

test("stable far-away rows are not rewritten on every animation frame", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let propertyWrites = 0;
  let translateWrites = 0;
  const itemStyle = {
    _translate: "",
    set translate(value) {
      translateWrites += 1;
      this._translate = value;
    },
    get translate() {
      return this._translate;
    },
    setProperty() {
      propertyWrites += 1;
    },
  };
  const item = {
    center: 0,
    active: false,
    el: {
      style: itemStyle,
      classList: fakeClassList(),
    },
  };
  const controller = {
    displayY: 1000,
    isDragging: false,
    tickSideMap: new Map(),
    tickMarks: [],
    tickEls: [],
    items: [item],
    orb: {
      style: {},
      classList: fakeClassList(),
      dataset: { orbStyle: "default" },
      querySelector: () => null,
    },
    container: { scrollTop: 0 },
    updateRailLineFocus() {},
    renderOrbBall: FileExplorerRail.prototype.renderOrbBall,
  };

  FileExplorerRail.prototype.render.call(controller);
  controller.displayY = 1001;
  FileExplorerRail.prototype.render.call(controller);

  assert.equal(propertyWrites, 0, "file rows should not animate through CSS variables");
  assert.equal(translateWrites, 0, "far rows outside the dynamic range should not be rewritten");
  assert.equal(itemStyle.translate, "");
});

test("tick motion uses scaleX without per-frame width writes", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let widthWrites = 0;
  const tickStyle = {
    top: "0px",
    _width: "28px",
    transform: "",
    set width(value) {
      widthWrites += 1;
      this._width = value;
    },
    get width() {
      return this._width;
    },
  };
  const tickEl = { className: "", style: tickStyle, classList: fakeClassList() };
  const controller = {
    displayY: 0,
    isDragging: false,
    tickSideMap: new Map(),
    tickMarks: [{ y: 0, kind: "long", isFile: true }],
    tickEls: [tickEl],
    items: [],
    plugin: { settings: { soundEnabled: false } },
    orb: {
      style: {},
      classList: fakeClassList(),
      dataset: { orbStyle: "default" },
      querySelector: () => null,
    },
    container: { scrollTop: 0 },
    updateRailLineFocus() {},
    renderOrbBall: FileExplorerRail.prototype.renderOrbBall,
  };

  FileExplorerRail.prototype.render.call(controller);
  FileExplorerRail.prototype.render.call(controller);

  assert.equal(widthWrites, 0);
  assert.match(tickStyle.transform, /scaleX\(/);
});

test("stable activity ticks keep their live line state during document refreshes", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const dynamicTransform = "translate3d(22px, -50%, 0) scaleX(0.9)";
  const tickEl = fakeTickElement(
    "crisp-fe-tick is-long is-file is-today is-magnet is-line is-nearest",
    {
      transform: dynamicTransform,
    },
  );
  const controller = {
    container: {},
    ticks: { appendChild() {} },
    tickSideMap: new Map(),
    tickMarks: [{
      y: 120,
      kind: "long",
      isFile: true,
      isToday: true,
      isMagnet: true,
    }],
    tickEls: [tickEl],
  };

  FileExplorerRail.prototype.syncTickElements.call(controller, { preserveMotion: true });

  assert.equal(tickEl.classList.contains("is-line"), true);
  assert.equal(tickEl.classList.contains("is-nearest"), true);
  assert.equal(tickEl.style.transform, dynamicTransform);
});

test("activity-only changes preserve tick topology while tree changes reset it", () => {
  const { hasStableTickTopology } = loadPluginRuntime();
  const previousItems = [
    { path: "notes/a.md", type: "file", today: false, magnet: false },
    { path: "notes/b.md", type: "file", today: true, magnet: false },
  ];
  const nextItems = [
    { path: "notes/a.md", type: "file", today: true, magnet: true },
    { path: "notes/b.md", type: "file", today: true, magnet: false },
  ];
  const previousTicks = [
    { kind: "long", itemIndex: 0 },
    { kind: "short" },
    { kind: "long", itemIndex: 1 },
  ];
  const nextTicks = [
    { kind: "long", itemIndex: 0 },
    { kind: "short" },
    { kind: "long", itemIndex: 1 },
  ];

  assert.equal(
    hasStableTickTopology(previousItems, nextItems, previousTicks, nextTicks),
    true,
  );
  assert.equal(
    hasStableTickTopology(
      previousItems,
      [{ path: "notes/c.md", type: "file" }, nextItems[1]],
      previousTicks,
      nextTicks,
    ),
    false,
  );
});

test("an animation frame touches only rows near the orb", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const count = 4096;
  let itemReads = 0;
  let tickReads = 0;
  const rawItems = Array.from({ length: count }, (_, index) => ({
    center: index * 10,
    el: { style: { translate: "" }, classList: fakeClassList() },
  }));
  const rawTicks = Array.from({ length: count }, (_, index) => ({
    y: index * 10,
    kind: "long",
    isFile: true,
  }));
  const items = new Proxy(rawItems, {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) itemReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const tickMarks = new Proxy(rawTicks, {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) tickReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const controller = {
    displayY: 20480,
    isDragging: false,
    tickSideMap: new Map(),
    tickMarks,
    tickEls: Array.from({ length: count }, () => ({ style: { transform: "" }, classList: fakeClassList() })),
    items,
    dynamicTickRange: [0, -1],
    dynamicItemRange: [0, -1],
    nearestTickIndex: -1,
    plugin: { settings: { soundEnabled: false } },
    orb: {
      style: {},
      dataset: { orbStyle: "default" },
      querySelector: () => null,
    },
    container: { scrollTop: 0 },
    updateRailLineFocus() {},
    renderOrbBall: FileExplorerRail.prototype.renderOrbBall,
  };

  FileExplorerRail.prototype.render.call(controller);

  assert.ok(itemReads < 300, `expected bounded item reads, received ${itemReads}`);
  assert.ok(tickReads < 300, `expected bounded tick reads, received ${tickReads}`);
});

test("file-tree mutation filtering ignores the plugin's own rail DOM", () => {
  const { mutationTouchesFileTree } = loadPluginRuntime();
  assert.equal(typeof mutationTouchesFileTree, "function");

  const railTarget = { closest: (selector) => selector === ".crisp-fe-rail" ? {} : null };
  const fileTarget = { closest: () => null };
  assert.equal(mutationTouchesFileTree([{ target: railTarget, addedNodes: [{}], removedNodes: [] }]), false);
  assert.equal(mutationTouchesFileTree([{ target: fileTarget, addedNodes: [{}], removedNodes: [] }]), true);
});

test("resetItem removes only the plugin-owned individual translate", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const removed = [];
  const el = {
    classList: fakeClassList(),
    style: { removeProperty: (name) => removed.push(name) },
  };

  FileExplorerRail.prototype.resetItem.call({}, el);

  assert.ok(removed.includes("translate"));
  assert.equal(removed.includes("transform"), false, "theme-owned transforms must be preserved");
  assert.equal(removed.includes("--crisp-fe-push"), false);
});

test("rows leaving the motion range release their inline translate", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const removed = [];
  let zeroWrites = 0;
  const item = {
    center: 0,
    renderedX: 12,
    el: {
      style: {
        removeProperty: (name) => removed.push(name),
        set translate(value) {
          if (value === "0px 0px") zeroWrites += 1;
        },
      },
    },
  };
  const controller = {
    displayY: 1000,
    isDragging: false,
    tickSideMap: new Map(),
    tickMarks: [],
    tickEls: [],
    items: [item],
    dynamicTickRange: [0, -1],
    dynamicItemRange: [0, 0],
    nearestTickIndex: -1,
    orb: { style: {}, dataset: { orbStyle: "default" }, querySelector: () => null },
    container: { scrollTop: 0 },
    updateRailLineFocus() {},
    renderOrbBall: FileExplorerRail.prototype.renderOrbBall,
  };

  FileExplorerRail.prototype.render.call(controller);

  assert.deepEqual(removed, ["translate"]);
  assert.equal(zeroWrites, 0);
});

test("pointer movement reads the container layout only once", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let rectReads = 0;
  let appliedY = null;
  const controller = {
    items: [{ center: 0 }, { center: 300 }],
    container: {
      scrollTop: 20,
      getBoundingClientRect() {
        rectReads += 1;
        return { top: 10 };
      },
    },
    applyMagnet: (value) => value,
    applyDragY: (value) => { appliedY = value; },
    scheduleDragScroll() {},
  };

  FileExplorerRail.prototype.updateDrag.call(controller, { clientY: 90 });

  assert.equal(rectReads, 1);
  assert.equal(appliedY, 100);
});

test("drag selection updates only the previous and next rows", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let toggles = 0;
  const items = Array.from({ length: 1000 }, (_, index) => ({
    center: index * 10,
    type: "file",
    el: {
      classList: {
        toggle() { toggles += 1; },
      },
    },
  }));
  const controller = {
    items,
    displayY: 0,
    targetY: 0,
    velocity: 0,
    hasOrbPosition: false,
    lastDragIndex: 20,
    visualActiveIndex: 20,
    queueFolderAutoExpand() {},
    requestFrame() {},
  };

  FileExplorerRail.prototype.applyDragY.call(controller, 300);

  assert.ok(toggles <= 2, `expected at most two class toggles, received ${toggles}`);
  assert.equal(controller.visualActiveIndex, 30);
});

test("normal scrolling updates the rotation baseline without remeasuring the tree", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  assert.equal(typeof FileExplorerRail.prototype.handleScroll, "function");
  let refreshes = 0;
  const controller = {
    displayY: 180,
    container: { scrollTop: 40 },
    scheduleRefresh() { refreshes += 1; },
    requestFrame() {},
  };

  FileExplorerRail.prototype.handleScroll.call(controller);

  assert.equal(refreshes, 0);
  assert.equal(controller.lastRenderViewportY, 140);
});

test("hiding the file explorer clears transient row translations", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const removed = [];
  const controller = {
    enabled: true,
    frame: null,
    measureFrame: 42,
    measureQueued: true,
    pendingReveal: true,
    dragScrollFrame: null,
    items: Array.from({ length: 4 }, (_, index) => ({
      renderedX: index > 0 && index < 3 ? 12 : 0,
      el: { style: { removeProperty: (name) => removed.push([index, name]) } },
    })),
    dynamicItemRange: [1, 2],
    dynamicTickRange: [0, -1],
    rail: {},
    container: { classList: fakeClassList() },
    orb: { classList: fakeClassList() },
    tickSideMap: new Map(),
    autoExpandedFolderPaths: new Set(),
    clearAutoExpandTimer() {},
    releasePointerCapture() {},
    cleanupDragListeners() {},
    setDragging: FileExplorerRail.prototype.setDragging,
  };

  FileExplorerRail.prototype.setEnabled.call(controller, false);

  assert.deepEqual(removed, [[1, "translate"], [2, "translate"]]);
  assert.equal(controller.measureQueued, false);
  assert.equal(controller.pendingReveal, false);
});

test("dragging state is shared by the orb and file-tree container", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const controller = {
    isDragging: false,
    orb: { classList: fakeClassList() },
    container: { classList: fakeClassList() },
  };

  FileExplorerRail.prototype.setDragging.call(controller, true);
  assert.equal(controller.isDragging, true);
  assert.equal(controller.orb.classList.contains("is-dragging"), true);
  assert.equal(controller.container.classList.contains("crisp-fe-is-dragging"), true);

  FileExplorerRail.prototype.setDragging.call(controller, false);
  assert.equal(controller.container.classList.contains("crisp-fe-is-dragging"), false);
});

test("theme compatibility keeps active feedback plugin-owned without vertical markers or row geometry changes", () => {
  const css = readStyles();

  assert.match(css, /--crisp-fe-active-bg:\s*color-mix\(in srgb, var\(--crisp-fe-accent\) 12%, transparent\)/);
  assert.match(
    css,
    /\.nav-files-container\.crisp-fe-container[\s\S]*?\.crisp-fe-item\.is-active\s*\{[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important;/,
  );
  assert.match(
    css,
    /\.crisp-fe-item\.crisp-fe-active\s*\{[\s\S]*?color:\s*var\(--text-normal\) !important;[\s\S]*?background:\s*transparent !important;/,
  );
  assert.match(
    css,
    /\.crisp-fe-item\.crisp-fe-active[\s\S]*?:is\(\.nav-file-title-content,\s*\.nav-folder-title-content\)\s*\{[\s\S]*?padding:\s*0 !important;[\s\S]*?box-shadow:\s*0 0 0 5px var\(--crisp-fe-active-bg\) !important;/,
  );
  assert.doesNotMatch(css, /\.crisp-fe-item\.crisp-fe-active::before\s*\{/);
  assert.doesNotMatch(css, /crisp-fe-active-marker-in/);
});

test("theme styles cannot replace plugin motion transitions", () => {
  const css = readStyles();
  const itemRule = css.match(
    /\.nav-files-container\.crisp-fe-container[\s\S]*?:is\(\.nav-file-title,\s*\.nav-folder-title\)\.crisp-fe-item\s*\{([^}]*)\}/,
  );

  assert.ok(itemRule);
  assert.match(itemRule[1], /translate 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(itemRule[1], /!important/);
  assert.doesNotMatch(itemRule[1], /\btransform\s*:/);
  assert.match(
    css,
    /\.crisp-fe-container\.crisp-fe-is-dragging[\s\S]*?\.crisp-fe-item[\s\S]*?\{[\s\S]*?transition:\s*none !important;/,
  );
});

test("orb press feedback uses an interruptible individual scale", () => {
  const css = readStyles();

  assert.match(css, /\.crisp-fe-orb-ball\s*\{[\s\S]*?transition:\s*scale 110ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.match(css, /\.crisp-fe-orb\.is-dragging \.crisp-fe-orb-ball\s*\{[\s\S]*?scale:\s*0\.97/);
});

test("character breathing is hover-only and fine-pointer gated", () => {
  const css = readStyles();
  const hoverMedia = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/);

  assert.ok(hoverMedia, "expected a fine-pointer hover media query");
  assert.match(hoverMedia[1], /data-orb-style="character1"\]:hover/);
  assert.match(hoverMedia[1], /animation:\s*crisp-fe-character-breathe/);
  assert.doesNotMatch(hoverMedia[1], /data-orb-style="fear"\]:hover/);
  assert.doesNotMatch(hoverMedia[1], /data-orb-style="devil"\]:hover/);
  assert.doesNotMatch(hoverMedia[1], /data-orb-style="fan"\]:hover/);
  assert.doesNotMatch(css, /data-orb-style="character1"\][^{]*\.is-dragging[^}]*crisp-fe-character-breathe/);
  assert.match(css, /@keyframes crisp-fe-character-breathe[\s\S]*?scale:\s*1\.06/);
});

test("reduced motion removes orb scale and character motion", () => {
  const css = readStyles();
  const reducedMotion = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .find((match) => match[1].includes(".crisp-fe-orb-ball"));

  assert.ok(reducedMotion);
  assert.match(reducedMotion[1], /\.crisp-fe-orb\s*\{[\s\S]*?transition:\s*none/);
  assert.match(reducedMotion[1], /\.crisp-fe-orb-ball[\s\S]*?transition:\s*none/);
  assert.match(reducedMotion[1], /\.crisp-fe-orb\.is-dragging \.crisp-fe-orb-ball\s*\{[\s\S]*?scale:\s*1/);
});

test("reduced motion also disables settings accordion transitions", () => {
  const css = readStyles();
  const reducedMotionBlocks = [
    ...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g),
  ].map((match) => match[1]).join("\n");

  assert.match(reducedMotionBlocks, /\.crisp-fe-setting-card/);
  assert.match(reducedMotionBlocks, /\.crisp-fe-setting-card__content-wrapper/);
  assert.match(reducedMotionBlocks, /\.crisp-fe-setting-card__body/);
  assert.match(reducedMotionBlocks, /transition:\s*none !important/);
});

test("frequent magnets avoid persistent paint-heavy glow", () => {
  const css = readStyles();
  const magnetBlock = css.match(/\.crisp-fe-tick\.is-magnet\s*\{([^}]*)\}/);
  const magnetDotBlock = css.match(/\.crisp-fe-tick\.is-magnet::after\s*\{([^}]*)\}/);

  assert.ok(magnetBlock);
  assert.ok(magnetDotBlock);
  assert.doesNotMatch(magnetBlock[1], /box-shadow/);
  assert.doesNotMatch(magnetDotBlock[1], /box-shadow/);
});

test("active file discovery expands parents without scrolling the DOM element", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  let expanded = 0;
  let scrolled = 0;
  const itemEl = {
    isConnected: true,
    getBoundingClientRect: () => ({ height: 24 }),
    scrollIntoView: () => {
      scrolled += 1;
    },
  };
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [{
        view: {
          fileItems: {
            folder: { collapsed: true, setCollapsed: () => { expanded += 1; } },
            "folder/note.md": { selfEl: itemEl },
          },
        },
      }],
    },
  };

  const result = plugin.revealFileExplorerItem({ path: "folder/note.md" });

  assert.equal(result, true);
  assert.equal(expanded, 1);
  assert.equal(scrolled, 0);
});

test("active file discovery leaves already-expanded parents alone", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  let expanded = 0;
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [{
        view: {
          fileItems: {
            folder: { collapsed: false, setCollapsed: () => { expanded += 1; } },
            "folder/note.md": {
              selfEl: { isConnected: true, getBoundingClientRect: () => ({ height: 24 }) },
            },
          },
        },
      }],
    },
  };

  assert.equal(plugin.revealFileExplorerItem({ path: "folder/note.md" }), true);
  assert.equal(expanded, 0);
});

test("activity marker sets are cached until activity changes", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  plugin.settings = {
    todayTrailEnabled: true,
    frequentMagnetsEnabled: true,
    activity: {
      todayKey,
      todayPaths: ["one.md"],
      fileStats: { "one.md": { count: 4, lastOpened: 1 } },
    },
  };
  plugin.todayPathSetCache = null;
  plugin.frequentPathSetCache = null;
  let frequentBuilds = 0;
  const originalGetFrequentPaths = plugin.getFrequentPaths.bind(plugin);
  plugin.getFrequentPaths = () => {
    frequentBuilds += 1;
    return originalGetFrequentPaths();
  };

  const todayFirst = plugin.getTodayPathSet();
  const todaySecond = plugin.getTodayPathSet();
  const frequentFirst = plugin.getFrequentPathSet();
  const frequentSecond = plugin.getFrequentPathSet();

  assert.equal(todayFirst, todaySecond);
  assert.equal(frequentFirst, frequentSecond);
  assert.equal(frequentBuilds, 1);
});

test("activity state follows folder renames and removes deleted paths", () => {
  const { rewriteActivityPaths } = loadPluginRuntime();
  assert.equal(typeof rewriteActivityPaths, "function");
  const original = {
    todayKey: "2026-07-28",
    todayPaths: [
      "Projects/A.md",
      "Keep.md",
      "Archive/A.md",
      "Projects/Sub/B.md",
    ],
    fileStats: {
      "Projects/A.md": { count: 2, lastOpened: 20 },
      "Archive/A.md": { count: 3, lastOpened: 30 },
      "Projects/Sub/B.md": { count: 4, lastOpened: 40 },
      "Keep.md": { count: 1, lastOpened: 10 },
    },
  };

  const renamed = rewriteActivityPaths(original, "Projects", "Archive");
  assert.deepEqual(JSON.parse(JSON.stringify(renamed)), {
    todayKey: "2026-07-28",
    todayPaths: ["Keep.md", "Archive/A.md", "Archive/Sub/B.md"],
    fileStats: {
      "Archive/A.md": { count: 5, lastOpened: 30 },
      "Archive/Sub/B.md": { count: 4, lastOpened: 40 },
      "Keep.md": { count: 1, lastOpened: 10 },
    },
  });
  assert.deepEqual(original.todayPaths, [
    "Projects/A.md",
    "Keep.md",
    "Archive/A.md",
    "Projects/Sub/B.md",
  ]);

  const deleted = rewriteActivityPaths(renamed, "Archive", null);
  assert.deepEqual(JSON.parse(JSON.stringify(deleted)), {
    todayKey: "2026-07-28",
    todayPaths: ["Keep.md"],
    fileStats: {
      "Keep.md": { count: 1, lastOpened: 10 },
    },
  });
});

test("runtime workspace listeners start once, after layout ready", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(source, /onLayoutReady\(\(\)\s*=>\s*\{[\s\S]*?this\.startRuntime\(\)/);
  assert.match(source, /startRuntime\(\)\s*\{[\s\S]*?if \(this\.runtimeStarted/);
  assert.match(source, /workspace\.on\("window-open",\s*\(\)\s*=>\s*this\.scheduleRefresh\(\)\)/);
  assert.match(source, /workspace\.on\("window-close",\s*\(\)\s*=>\s*this\.scheduleRefresh\(\)\)/);
  const onload = source.match(/async onload\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*onunload\(\)/);
  assert.ok(onload);
  const beforeReady = onload[1].split("onLayoutReady")[0];
  assert.doesNotMatch(beforeReady, /workspace\.on\("(?:layout-change|active-leaf-change|file-open)"/);
});

test("explorer discovery includes file explorer leaves from secondary windows", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  const mainContainer = { id: "main" };
  const secondaryContainer = { id: "secondary" };
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [{
        view: {
          containerEl: {
            querySelectorAll: () => [secondaryContainer],
          },
        },
      }],
      containerEl: {
        querySelectorAll: () => [mainContainer],
      },
    },
  };

  const containers = plugin.getFileExplorerContainers();

  assert.deepEqual(Array.from(containers), [secondaryContainer, mainContainer]);
});

test("controller animation and drag listeners use the file explorer owner window", () => {
  const ownerEvents = [];
  const ownerWindow = {
    requestAnimationFrame() {
      return 73;
    },
    addEventListener(type) {
      ownerEvents.push(type);
    },
  };
  const { FileExplorerRail } = loadPluginRuntime({
    window: {
      addEventListener() {
        throw new Error("global window should not receive secondary-window drag listeners");
      },
    },
  });
  const controller = {
    container: { ownerDocument: { defaultView: ownerWindow } },
    destroyed: false,
    enabled: true,
    frame: null,
    animate() {},
    isDragging: false,
    items: [{ center: 100 }],
    cleanupDragListeners() {},
    setDragging(active) { this.isDragging = active; },
    orb: { setPointerCapture() {} },
    updateDrag() {},
    requestFrame: FileExplorerRail.prototype.requestFrame,
    tickSideMap: new Map(),
  };
  const event = {
    pointerId: 4,
    button: 0,
    isPrimary: true,
    preventDefault() {},
    stopPropagation() {},
  };

  FileExplorerRail.prototype.handlePointerDown.call(controller, event);

  assert.equal(controller.frame, 73);
  assert.deepEqual(ownerEvents, ["pointermove", "pointerup", "pointercancel", "blur"]);
});

test("drag release dispatches mouse events from the target window", () => {
  const ownerEvents = [];
  const ownerWindow = {
    MouseEvent: class OwnerMouseEvent {
      constructor(type, options) {
        this.type = type;
        this.options = options;
        this.realm = "owner";
      }
    },
  };
  const { dispatchMouseSequence } = loadPluginRuntime({
    context: {
      MouseEvent: class MainMouseEvent {
        constructor(type, options) {
          this.type = type;
          this.options = options;
          this.realm = "main";
        }
      },
    },
  });
  const element = {
    ownerDocument: { defaultView: ownerWindow },
    dispatchEvent(event) {
      ownerEvents.push(event);
    },
  };

  dispatchMouseSequence(element);

  assert.deepEqual(ownerEvents.map((event) => event.type), [
    "mousedown",
    "mouseup",
    "click",
  ]);
  assert.deepEqual(ownerEvents.map((event) => event.realm), [
    "owner",
    "owner",
    "owner",
  ]);
  assert.ok(ownerEvents.every((event) => event.options.view === ownerWindow));
});

test("a controller rebinds observers after Obsidian adopts its file tree into another window", () => {
  const observed = [];
  let disconnected = 0;
  class OwnerResizeObserver {
    constructor() {}
    observe(element) { observed.push(["resize", element]); }
    disconnect() {}
  }
  class OwnerMutationObserver {
    constructor() {}
    observe(element) { observed.push(["mutation", element]); }
    disconnect() {}
  }
  const nextWindow = {
    ResizeObserver: OwnerResizeObserver,
    MutationObserver: OwnerMutationObserver,
  };
  const nextDocument = { defaultView: nextWindow };
  const container = { ownerDocument: nextDocument };
  const enabledDocuments = [];
  const { FileExplorerRail } = loadPluginRuntime();
  const controller = {
    container,
    ownerDocument: { defaultView: {} },
    ownerWindow: {},
    resizeObserver: { disconnect() { disconnected += 1; } },
    mutationObserver: { disconnect() { disconnected += 1; } },
    mutationDebounceTimer: null,
    scheduleRefresh() {},
    plugin: {
      enableDocument(ownerDocument) { enabledDocuments.push(ownerDocument); },
    },
    createObservers: FileExplorerRail.prototype.createObservers,
  };

  const changed = FileExplorerRail.prototype.syncOwnerContext.call(controller);

  assert.equal(changed, true);
  assert.equal(disconnected, 2);
  assert.equal(controller.ownerDocument, nextDocument);
  assert.equal(controller.ownerWindow, nextWindow);
  assert.deepEqual(observed, [["resize", container], ["mutation", container]]);
  assert.deepEqual(enabledDocuments, [nextDocument]);
});

test("each explorer document receives the plugin scope class", () => {
  const { PluginClass } = loadPluginRuntime();
  const plugin = Object.create(PluginClass.prototype);
  const classList = fakeClassList();
  const ownerDocument = { body: { classList } };

  plugin.enableDocument(ownerDocument);

  assert.equal(classList.contains("crisp-file-explorer-enabled"), true);
  assert.equal(plugin.enabledDocuments.has(ownerDocument), true);
});

test("explorer discovery does not remeasure controllers that refresh will check", () => {
  const container = {};
  let visibilityReads = 0;
  const controller = {
    enabled: true,
    isVisible() {
      visibilityReads += 1;
      return true;
    },
    setEnabled() {},
    syncOwnerContext() {},
    destroy() {},
  };
  const { PluginClass } = loadPluginRuntime({
    context: { document: { body: { contains: () => true } } },
  });
  const plugin = Object.create(PluginClass.prototype);
  plugin.unloading = false;
  plugin.controllers = new Map([[container, controller]]);
  plugin.app = {
    workspace: {
      containerEl: { querySelectorAll: () => [container] },
    },
  };

  plugin.enhanceFileExplorers();

  assert.equal(visibilityReads, 0);
});

test("controllers from closed secondary windows are removed even if their old document is retained", () => {
  const container = {};
  let destroyed = 0;
  const { PluginClass } = loadPluginRuntime({
    context: { document: { body: { contains: () => true } } },
  });
  const plugin = Object.create(PluginClass.prototype);
  plugin.unloading = false;
  plugin.controllers = new Map([[
    container,
    {
      enabled: true,
      destroy() { destroyed += 1; },
    },
  ]]);
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      containerEl: { querySelectorAll: () => [] },
    },
  };

  plugin.enhanceFileExplorers();

  assert.equal(destroyed, 1);
  assert.equal(plugin.controllers.size, 0);
});

test("rail focus is a fixed GPU-translated gradient layer", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const css = readStyles();
  assert.match(source, /lineFocus\.className\s*=\s*"crisp-fe-line-focus"/);
  assert.match(source, /this\.lineFocus\.style\.transform\s*=\s*transform/);
  assert.doesNotMatch(source, /paintRailLine\(/);
  assert.match(css, /\.crisp-fe-line-focus\s*\{[\s\S]*?height:\s*192px[\s\S]*?linear-gradient/);
});

test("all file-backed SVG orbs are bundled without machine-specific paths", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  for (const [style, { asset, label }] of Object.entries({
    soccer: { asset: "assets/soccer.svg", label: "Soccer" },
    basketball: { asset: "assets/basketball.svg", label: "Basketball" },
    tennis: { asset: "assets/tennis.svg", label: "Tennis" },
    shutup: { asset: "assets/shut-up.svg", label: "Shut Up" },
    snorlax: { asset: "assets/snorlax.svg", label: "Snorlax" },
    pikachu: { asset: "assets/pikachu.svg", label: "Pikachu" },
    pokeball: { asset: "assets/poke-ball.svg", label: "Poke Ball" },
    bracelet: { asset: "assets/bracelet.svg", label: "Bracelet" },
    snorlaxface: { asset: "assets/snorlax-face.svg", label: "Snorlax Face" },
    fear: { asset: "assets/fear.svg", label: "Fear" },
    devil: { asset: "assets/devil.svg", label: "Devil" },
    fan: { asset: "assets/fan.svg", label: "Ventilation fan" },
    gear: { asset: "assets/gear.svg", label: "Gear" },
    alfresco: { asset: "assets/alfresco.svg", label: "Alfresco" },
    mercedes: { asset: "assets/mercedes.svg", label: "Mercedes-Benz" },
    taiga: { asset: "assets/taiga.svg", label: "Taiga" },
    angry: { asset: "assets/angry.svg", label: "Angry" },
    squint: { asset: "assets/squint.svg", label: "Squint" },
    facemask: { asset: "assets/face-mask.svg", label: "Face Mask" },
    pokerface: { asset: "assets/poker-face.svg", label: "Poker Face" },
    captainshield: { asset: "assets/captain-america-shield.svg", label: "Captain America Shield" },
    batman: { asset: "assets/batman.svg", label: "Batman" },
    superman: { asset: "assets/superman.svg", label: "Superman" },
    spiderman: { asset: "assets/spider-man.svg", label: "Spider-Man" },
    character4: { asset: "assets/character4.svg", label: "Character 4" },
    character5: { asset: "assets/character5.svg", label: "Character 5" },
  })) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", asset)), `${asset} should exist`);
    assert.match(source, new RegExp(`${style}:\\s*"${asset.replace("/", "\\/")}"`));
    assert.match(source, new RegExp(`addOption\\("${style}",\\s*"${label}"\\)`));
  }
  assert.doesNotMatch(source, /\/Users\/|Downloads\/|Desktop\/|iCloud~/);
});

test("runtime assets contain no stale files or duplicate inline sports SVGs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const referencedAssets = Array.from(
    source.matchAll(/"(assets\/[^"]+\.(?:png|svg))"/g),
    (match) => match[1]
  ).sort();
  const bundledAssets = fs.readdirSync(path.join(__dirname, "..", "assets"))
    .filter((name) => /\.(?:png|svg)$/.test(name))
    .map((name) => `assets/${name}`)
    .sort();
  const inlineOrbBlock = source.match(/const ORB_SVGS\s*=\s*\{([\s\S]*?)\n\};/);

  assert.deepEqual(bundledAssets, referencedAssets);
  assert.ok(inlineOrbBlock);
  assert.doesNotMatch(inlineOrbBlock[1], /^\s*(?:soccer|basketball|tennis):/m);
});

test("new character SVGs stay upright while circular SVGs rotate", () => {
  const { IMAGE_ORB_ASSETS, RANDOM_DAILY_ORB_STYLES, STATIC_ORB_STYLES } = loadPluginRuntime();
  const staticStyles = ["snorlax", "pikachu", "snorlaxface", "batman", "superman", "spiderman", "character4", "character5"];
  const rotatingStyles = ["soccer", "basketball", "tennis", "shutup", "pokeball", "bracelet", "angry", "squint", "facemask", "pokerface", "captainshield"];

  for (const style of [...staticStyles, ...rotatingStyles]) {
    assert.ok(IMAGE_ORB_ASSETS[style], `${style} should use an owned SVG asset`);
    assert.ok(RANDOM_DAILY_ORB_STYLES.includes(style), `${style} should be available to Random per day`);
  }
  for (const style of staticStyles) assert.ok(STATIC_ORB_STYLES.has(style));
  for (const style of rotatingStyles) assert.equal(STATIC_ORB_STYLES.has(style), false);
});

test("replacement sports SVGs use transparent chrome without the legacy white ring", () => {
  const css = readStyles();
  const transparentBlock = css.match(
    /\.crisp-fe-orb\[data-orb-style="soccer"\][\s\S]*?\.crisp-fe-orb\[data-orb-style="snorlaxface"\]\s*\{([^}]*)\}/,
  );

  assert.ok(transparentBlock);
  assert.match(transparentBlock[1], /background:\s*transparent/);
  assert.match(transparentBlock[1], /box-shadow:\s*none/);
  assert.doesNotMatch(transparentBlock[1], /background:\s*#fff/);
});

test("gear orb keeps a small inset inside the shared rotating wrapper", () => {
  const css = readStyles();
  assert.match(
    css,
    /data-orb-style="gear"\] \.crisp-fe-orb-image\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?padding:\s*1px;/
  );
});

test("external SVG orbs rotate through the same fixed-center ball wrapper as inline balls", () => {
  const created = [];
  const makeElement = (tagName) => {
    const element = {
      tagName: tagName.toUpperCase(),
      className: "",
      children: [],
      style: {},
      appendChild(child) { this.children.push(child); child.parentElement = this; },
      addEventListener() {},
    };
    created.push(element);
    return element;
  };
  const { FileExplorerRail } = loadPluginRuntime({
    context: { document: { createElement: makeElement } },
  });
  const orb = {
    dataset: {},
    children: [],
    empty() { this.children = []; },
    appendChild(child) { this.children.push(child); child.parentElement = this; },
    querySelector() { return null; },
  };
  const controller = {
    plugin: {
      settings: { orbStyle: "fear" },
      getResourceUrl: (asset) => `app://${asset}`,
    },
    orb,
    displayY: 80,
    container: { scrollTop: 20 },
    requestFrame() {},
  };

  FileExplorerRail.prototype.updateOrbStyle.call(controller);

  assert.equal(orb.children.length, 1);
  const spinner = orb.children[0];
  assert.equal(spinner.tagName, "SPAN");
  assert.equal(spinner.className, "crisp-fe-orb-ball crisp-fe-orb-spinner");
  assert.equal(spinner.children.length, 1);
  assert.equal(spinner.children[0].tagName, "IMG");
  assert.equal(spinner.children[0].className, "crisp-fe-orb-image");
  assert.equal(controller.orbBall, spinner, "rotation must target the centered wrapper, not the replaced image element");
});

test("offscreen active items reposition the container without smooth scrolling", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let scrollToCalls = 0;
  const controller = {
    container: {
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTo: () => {
        scrollToCalls += 1;
      },
    },
  };

  const moved = FileExplorerRail.prototype.ensureItemVisible.call(controller, { center: 500 });

  assert.equal(moved, true);
  assert.equal(controller.container.scrollTop, 400);
  assert.equal(scrollToCalls, 0);
});

test("drag refresh derives its target from the current pointer viewport position", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let appliedY = null;
  const controller = {
    isDragging: true,
    items: [{ center: 100 }, { center: 200 }],
    container: { scrollTop: 50 },
    dragPointerViewportY: 100,
    lastDragIndex: 1,
    applyMagnet: (value) => value,
    applyDragY: (value) => {
      appliedY = value;
    },
  };

  const synced = FileExplorerRail.prototype.syncDragPositionAfterMeasure.call(controller);

  assert.equal(synced, true);
  assert.equal(controller.lastDragIndex, -1);
  assert.equal(appliedY, 150);
});

test("pointer cancellation cleans up without navigating or snapping", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let updateCount = 0;
  let cleanupCount = 0;
  const controller = {
    isDragging: true,
    dragPointerId: 9,
    items: [],
    displayY: 100,
    autoExpandedFolderPaths: new Set(),
    plugin: { settings: { releaseSoundEnabled: true, openOnDragRelease: true } },
    updateDrag: () => { updateCount += 1; },
    setDragging(active) { this.isDragging = active; },
    releasePointerCapture() {},
    cancelDragScroll() {},
    clearAutoExpandTimer() {},
    cleanupDragListeners: () => { cleanupCount += 1; },
    requestFrame() {},
  };
  const event = {
    type: "pointercancel",
    pointerId: 9,
    preventDefault() {},
    stopPropagation() {},
  };

  FileExplorerRail.prototype.handlePointerUp.call(controller, event);

  assert.equal(updateCount, 0);
  assert.equal(cleanupCount, 1);
  assert.equal(controller.isDragging, false);
});

test("window blur cancels a drag and requests a clean file-tree refresh", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let cancellations = 0;
  let refreshes = 0;
  let frames = 0;
  const controller = {
    cancelDragInteraction() {
      cancellations += 1;
      return true;
    },
    plugin: { scheduleRefresh() { refreshes += 1; } },
    requestFrame() { frames += 1; },
  };

  FileExplorerRail.prototype.handleWindowBlur.call(controller);

  assert.equal(cancellations, 1);
  assert.equal(refreshes, 1);
  assert.equal(frames, 1);
});

test("destroyed controllers ignore pointer move and up events", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  let moveCalls = 0;
  let upCalls = 0;
  const controller = {
    destroyed: true,
    isDragging: true,
    dragPointerId: 1,
    updateDrag() { moveCalls += 1; },
    setDragging() {},
    releasePointerCapture() {},
    cancelDragScroll() {},
    clearAutoExpandTimer() {},
    cleanupDragListeners() {},
    requestFrame() {},
  };
  const moveEvent = { pointerId: 1, preventDefault() {}, stopPropagation() {} };
  const upEvent = { pointerId: 1, type: "pointerup", preventDefault() {}, stopPropagation() {} };

  FileExplorerRail.prototype.handlePointerMove.call(controller, moveEvent);
  FileExplorerRail.prototype.handlePointerUp.call(controller, upEvent);

  assert.equal(moveCalls, 0);
  assert.equal(upCalls, 0);
});

test("an active drag ignores additional pointer-down events", () => {
  const { FileExplorerRail } = loadPluginRuntime({ window: { addEventListener() {} } });
  let prevented = 0;
  const controller = {
    isDragging: true,
    items: [{ center: 100 }],
    cleanupDragListeners() {},
    setDragging(active) { this.isDragging = active; },
    dragPointerId: 1,
    velocity: 0,
    lastDragIndex: -1,
    tickSideMap: new Map(),
    orb: { setPointerCapture() {} },
    updateDrag() {},
    requestFrame() {},
  };
  const event = {
    pointerId: 2,
    preventDefault: () => { prevented += 1; },
    stopPropagation() {},
  };

  FileExplorerRail.prototype.handlePointerDown.call(controller, event);

  assert.equal(prevented, 0);
});

test("secondary and non-primary pointers cannot start an orb drag", () => {
  const { FileExplorerRail } = loadPluginRuntime({ window: { addEventListener() {} } });
  let prevented = 0;
  let captures = 0;
  const controller = {
    isDragging: false,
    items: [{ center: 100 }],
    cleanupDragListeners() {},
    setDragging(active) { this.isDragging = active; },
    orb: { setPointerCapture() { captures += 1; } },
    updateDrag() {},
    requestFrame() {},
    tickSideMap: new Map(),
  };
  const event = {
    pointerId: 3,
    button: 2,
    isPrimary: true,
    preventDefault: () => { prevented += 1; },
    stopPropagation() {},
  };

  FileExplorerRail.prototype.handlePointerDown.call(controller, event);
  event.button = 0;
  event.isPrimary = false;
  FileExplorerRail.prototype.handlePointerDown.call(controller, event);

  assert.equal(prevented, 0);
  assert.equal(captures, 0);
  assert.equal(controller.isDragging, false);
});

test("destroy removes transient drag state from the file-tree container", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const containerClassList = fakeClassList();
  containerClassList.add("crisp-fe-container", "crisp-fe-container-active", "crisp-fe-is-dragging");
  const controller = {
    destroyed: false,
    frame: null,
    measureFrame: null,
    dragScrollFrame: null,
    mutationDebounceTimer: null,
    items: [],
    clearAutoExpandTimer() {},
    resizeObserver: { disconnect() {} },
    mutationObserver: { disconnect() {} },
    container: {
      classList: containerClassList,
      removeEventListener() {},
    },
    releasePointerCapture() {},
    cleanupDragListeners() {},
    rail: { remove() {} },
  };

  FileExplorerRail.prototype.destroy.call(controller);

  assert.equal(containerClassList.contains("crisp-fe-is-dragging"), false);
});

test("positioning transform is translate-only, rotation transform is rotate-only", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const ballStyle = { transform: "", _transformOrigin: "" };
  const orbStyle = { transform: "" };
  const controller = {
    displayY: 200,
    isDragging: false,
    tickSideMap: new Map(),
    tickMarks: [],
    tickEls: [],
    items: [],
    orb: {
      style: orbStyle,
      classList: fakeClassList(),
      dataset: { orbStyle: "dragonball" },
      querySelector: () => ({
        style: ballStyle,
        getBoundingClientRect: () => ({ width: 22, height: 22 }),
      }),
    },
    container: { scrollTop: 50 },
    updateRailLineFocus() {},
    renderOrbBall: FileExplorerRail.prototype.renderOrbBall,
  };

  FileExplorerRail.prototype.render.call(controller);

  // Position transform on orb: must be translate3d, must not contain rotate
  assert.match(orbStyle.transform, /^translate3d\(0/,
    "orb position transform should be translate3d (positioning only)");
  assert.doesNotMatch(orbStyle.transform, /rotate/,
    "orb position transform must not contain rotate — rotation belongs on the ball child");

  // Rotation transform on ball: must be rotate(), must not contain translate
  const ballTransform = ballStyle.transform;
  assert.ok(ballTransform === "none" || ballTransform.startsWith("rotate("),
    `ball transform should be rotate() or none, got: ${ballTransform}`);
  assert.doesNotMatch(ballTransform, /translate/,
    "ball rotation transform must not contain translate — positioning belongs on the orb parent");
});

test("ball transform-origin is self-center (50% 50%) for both inline SVG and image orbs", () => {
  const css = readStyles();

  // .crisp-fe-orb-ball must declare transform-origin: 50% 50%
  const ballRule = css.match(/\.crisp-fe-orb-ball\s*\{([^}]*)\}/);
  assert.ok(ballRule, ".crisp-fe-orb-ball rule must exist");
  assert.match(ballRule[1], /transform-origin:\s*50%\s*50%/,
    ".crisp-fe-orb-ball must set transform-origin: 50% 50% for self-center rotation");

  // .crisp-fe-orb-image must NOT set transform (it's managed inline)
  const imageRule = css.match(/\.crisp-fe-orb-image\s*\{([^}]*)\}/);
  assert.ok(imageRule, ".crisp-fe-orb-image rule must exist");
  assert.doesNotMatch(imageRule[1], /transform\s*:/,
    ".crisp-fe-orb-image must not set transform — inline rotate() from renderOrbBall() takes precedence");
  assert.match(imageRule[1], /object-fit:\s*contain/,
    ".crisp-fe-orb-image must keep object-fit: contain");
  assert.match(imageRule[1], /object-position:\s*center/,
    ".crisp-fe-orb-image must keep object-position: center");
});

test("rotating image orbs receive rotation while character image orbs stay upright", () => {
  const { FileExplorerRail } = loadPluginRuntime();

  // Helper: run renderOrbBall and return the applied ball transform
  function transformForStyle(orbStyle, displayY, scrollTop, orbRotation) {
    const styleObj = {
      _transform: "",
      get transform() { return this._transform; },
      set transform(v) { this._transform = v; },
      removeProperty(name) { if (name === "transform") this._transform = ""; },
    };
    const ball = { style: styleObj };
    const controller = {
      orb: {
        dataset: { orbStyle },
        querySelector: () => ball,
      },
      orbBall: ball,
      container: { scrollTop },
      displayY,
      orbRotation,
      lastRenderViewportY: undefined,
    };
    FileExplorerRail.prototype.renderOrbBall.call(controller);
    return ball.style.transform;
  }

  // Static orbs: no rotation
  assert.equal(transformForStyle("character1", 300, 100, 45), "",
    "static orb (character1) should not receive rotation transform");
  for (const style of ["snorlax", "pikachu", "snorlaxface", "batman", "superman", "spiderman", "character4", "character5"]) {
    assert.equal(transformForStyle(style, 300, 100, 45), "",
      `static orb (${style}) should not receive rotation transform`);
  }

  // Image orbs (fear): should receive rotation
  const fearTransform = transformForStyle("fear", 300, 100, 45);
  assert.match(fearTransform, /^rotate\(/,
    `image orb (fear) should receive rotation transform, got: "${fearTransform}"`);

  // Image orbs (devil): should receive rotation
  const devilTransform = transformForStyle("devil", 300, 100, 45);
  assert.match(devilTransform, /^rotate\(/,
    `image orb (devil) should receive rotation transform, got: "${devilTransform}"`);

  const shutupTransform = transformForStyle("shutup", 300, 100, 45);
  assert.match(shutupTransform, /^rotate\(/,
    `image orb (shutup) should receive rotation transform, got: "${shutupTransform}"`);

  // Image orbs (fan): should receive rotation
  const fanTransform = transformForStyle("fan", 300, 100, 45);
  assert.match(fanTransform, /^rotate\(/,
    `image orb (fan) should receive rotation transform, got: "${fanTransform}"`);

  const gearTransform = transformForStyle("gear", 300, 100, 45);
  assert.match(gearTransform, /^rotate\(/,
    `image orb (gear) should receive rotation transform, got: "${gearTransform}"`);

  const alfrescoTransform = transformForStyle("alfresco", 300, 100, 45);
  assert.match(alfrescoTransform, /^rotate\(/,
    `image orb (alfresco) should receive rotation transform, got: "${alfrescoTransform}"`);

  const mercedesTransform = transformForStyle("mercedes", 300, 100, 45);
  assert.match(mercedesTransform, /^rotate\(/,
    `image orb (mercedes) should receive rotation transform, got: "${mercedesTransform}"`);

  for (const style of ["soccer", "basketball", "tennis", "pokeball", "bracelet"]) {
    assert.match(transformForStyle(style, 300, 100, 45), /^rotate\(/,
      `image orb (${style}) should receive rotation transform`);
  }

  const taigaTransform = transformForStyle("taiga", 300, 100, 45);
  assert.match(taigaTransform, /^rotate\(/,
    `image orb (taiga) should receive rotation transform, got: "${taigaTransform}"`);

  for (const style of ["angry", "squint", "facemask", "pokerface", "captainshield"]) {
    assert.match(transformForStyle(style, 300, 100, 45), /^rotate\(/,
      `image orb (${style}) should receive rotation transform`);
  }

  // Inline SVG (dragonball): should receive rotation
  const dragonTransform = transformForStyle("dragonball", 300, 100, 45);
  assert.match(dragonTransform, /^rotate\(/,
    `inline SVG orb (dragonball) should receive rotation transform, got: "${dragonTransform}"`);
});

test("renderOrbBall accumulates rotation per viewport pixel, not scroll pixel", () => {
  const { FileExplorerRail } = loadPluginRuntime();
  const ball = { style: { transform: "" } };

  const controller = {
    orb: {
      dataset: { orbStyle: "fear" },
      querySelector: () => ball,
    },
    orbBall: ball,
    container: { scrollTop: 0 },
    displayY: 100,
    orbRotation: 0,
    lastRenderViewportY: undefined,
  };

  // First frame: establish viewport position
  FileExplorerRail.prototype.renderOrbBall.call(controller);
  const firstViewportY = 100 - 0; // 100

  // Move down 10px in displayY → viewport moves 10px
  controller.displayY = 110;
  FileExplorerRail.prototype.renderOrbBall.call(controller);

  // orbRotation accumulated: 10 viewport-px * 3.2 deg/px = 32 deg
  assert.ok(controller.orbRotation > 0, "orbRotation should accumulate on viewport movement");
  assert.match(ball.style.transform, /rotate\(/,
    "ball should have a rotate transform after viewport movement");

  // Now: displayY moves +10 but scrollTop also moves +10 → viewport unchanged → no rotation change
  const rotationBefore = controller.orbRotation;
  controller.container.scrollTop = 10;
  controller.displayY = 120;
  FileExplorerRail.prototype.renderOrbBall.call(controller);

  assert.equal(controller.orbRotation, rotationBefore,
    "orbRotation should not change when viewport Y is unchanged (scroll + display move together)");
});

"use strict";

// Runs the shipped browser/rail in Obsidian's renderer, with an in-memory vault.
// No real note, setting, license, activity record, or workspace tab is changed.
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const { createHash } = require("node:crypto");

async function probe(caseName) {
  const realPlugin = app.plugins.plugins["crisp-file-explorer"];
  const exemplar = [...realPlugin.folderBrowsers.values()][0];
  if (!exemplar) throw new Error("An activated File Explorer browser is required");
  const doc = exemplar.doc;
  const win = doc.defaultView;
  const originalFocus = doc.activeElement;
  const originalModals = new Set(doc.querySelectorAll(".modal-container"));
  if (originalModals.size) throw new Error("Close the existing Obsidian modal before testing; the harness will not change it");
  const root = doc.createElement("div");
  root.className = "workspace-leaf-content";
  root.dataset.type = "file-explorer";
  root.dataset.crispE2e = "true";
  root.style.cssText = "position:fixed;left:20px;top:20px;width:560px;height:620px;display:flex;flex-direction:column;z-index:-1;";
  const header = root.appendChild(doc.createElement("div"));
  header.className = "nav-header";
  header.appendChild(doc.createElement("div")).className = "nav-buttons-container";
  const native = root.appendChild(doc.createElement("div"));
  native.className = "nav-files-container";
  const files = new Map();
  function folder(path) {
    const value = { path, name: path.split("/").at(-1) || "E2E", children: [] };
    files.set(path, value);
    return value;
  }
  function note(parent, name, mtime = 0) {
    const value = { path: `${parent.path}/${name}.md`, name: `${name}.md`, basename: name, extension: "md", stat: { mtime } };
    parent.children.push(value);
    files.set(value.path, value);
    return value;
  }
  const vaultRoot = folder("");
  const a = folder("A");
  const b = folder("B");
  const empty = folder("Empty");
  vaultRoot.children.push(a, b, empty);
  for (let i = 0; i < 360; i++) note(a, `note-${String(i).padStart(3, "0")}`, i);
  for (let i = 0; i < 3; i++) note(b, `small-${i}`);
  for (let i = 0; i < 36; i++) vaultRoot.children.push(folder(`Z-${String(i).padStart(2, "0")}`));
  const actions = [];
  const fakePlugin = Object.create(realPlugin);
  fakePlugin.settings = { ...realPlugin.settings, dualPaneEnabled: true, dualPaneFollowActive: false,
    dualPaneDescendants: false, dualPaneSort: "name", dualPaneLayout: "horizontal",
    dualPaneFolderWidth: 200, soundEnabled: false, releaseSoundEnabled: false };
  fakePlugin.app = {
    scope: app.scope, keymap: app.keymap,
    vault: { getRoot: () => vaultRoot, getName: () => "E2E", getAbstractFileByPath: path => files.get(path) },
    workspace: { getActiveFile: () => null, trigger: () => {},
      getLeaf: mode => ({ openFile: file => { actions.push({ type: "open", path: file.path, mode }); return Promise.resolve(); } }) },
    fileManager: { promptForDeletion: file => actions.push({ type: "delete", path: file.path }),
      promptForFileRename: file => actions.push({ type: "rename", path: file.path }) }
  };
  fakePlugin.getTodayPathSet = fakePlugin.getFrequentPathSet = fakePlugin.getPinnedPathSet = () => new Set();
  fakePlugin.saveSettings = () => Promise.resolve();
  fakePlugin.scheduleRefresh = () => {};
  fakePlugin.enableDocument = () => {};
  fakePlugin.audio = { tick() {}, release() {} };
  fakePlugin.folderBrowsers = new Map();
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  const wait = () => new Promise(resolve => win.setTimeout(resolve, 100));
  const key = (element, value, extra = {}) => element.dispatchEvent(new win.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra }));
  const clickFolder = path => browser.treeRows.get(path).dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  let browser;
  // Background Electron windows update activeElement without emitting focus
  // events. Dispatch the same transitions for fixture nodes only, recording
  // this environment condition rather than bypassing the plugin's handlers.
  const nativeFocus = win.HTMLElement.prototype.focus;
  const backgroundFocusEmulated = !doc.hasFocus();
  if (backgroundFocusEmulated) win.HTMLElement.prototype.focus = function (...args) {
    const previous = doc.activeElement;
    const result = nativeFocus.apply(this, args);
    if (root.contains(this) && previous !== this && doc.activeElement === this) {
      if (root.contains(previous)) previous.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true, relatedTarget: this }));
      this.dispatchEvent(new win.FocusEvent("focusin", { bubbles: true, relatedTarget: previous }));
    }
    return result;
  };
  doc.body.appendChild(root);
  try {
    browser = new exemplar.constructor(fakePlugin, native);
    fakePlugin.folderBrowsers.set(native, browser);
    await wait();
    browser.selectFolder("A");
    await wait();
    if (caseName === "stale-actions" || caseName === "all") {
      browser.focusEntry("A/note-010.md");
      clickFolder("B");
      browser.list.focus();
      for (const [value, extra] of [["Delete", {}], ["F2", {}], ["Enter", {}], ["Enter", { metaKey: true }], ["Backspace", { metaKey: true }]]) key(browser.list, value, extra);
      await wait();
      check("folder change cannot act on the previous folder's file", actions.length === 0, actions.slice());
      actions.length = 0;
      browser.selectFolder("A");
      browser.focusEntry("A/note-010.md");
      browser.selectFolder("Empty");
      browser.list.focus();
      key(browser.list, "Delete"); key(browser.list, "Enter");
      await wait();
      check("empty folder cannot act on a stale file", actions.length === 0, actions.slice());
      actions.length = 0;
      browser.selectFolder("B"); browser.focusEntry("B/small-1.md");
      key(doc.activeElement, "F2"); key(doc.activeElement, "Delete"); key(doc.activeElement, "Enter", { ctrlKey: true });
      await wait();
      check("focused current row retains native actions and modifier open", actions.length === 3 && actions.every(action => action.path === "B/small-1.md") && actions.some(action => action.type === "open" && action.mode === "tab"), actions.slice());
    }
    if (caseName === "key-scope" || caseName === "all") {
      actions.length = 0;
      browser.selectFolder("B"); browser.focusEntry("B/small-1.md");
      const scopeBefore = { active: browser.keyScopeActive, matches: app.keymap.getWindowStack(win).scope === browser.keyScope, focused: doc.activeElement?.dataset.entryPath };
      key(doc.activeElement, "F2");
      await wait();
      const newModals = [...doc.querySelectorAll(".modal-container")].filter(modal => !originalModals.has(modal));
      check("F2 renames only the focused browser row, without invoking the global active-file command",
        actions.length === 1 && actions[0].type === "rename" && actions[0].path === "B/small-1.md" && newModals.length === 0,
        { actions: actions.slice(), globalModals: newModals.length, scopeBefore });
      browser.sortButton.focus();
      check("leaving the list restores native shortcut scope", !browser.keyScopeActive && app.keymap.getWindowStack(win).scope !== browser.keyScope);
      browser.focusTree();
      actions.length = 0;
      key(doc.activeElement, "F2");
      await wait();
      check("tree F2 renames the focused folder", actions.length === 1 && actions[0].type === "rename" && actions[0].path === "B", actions.slice());
      fakePlugin.settings.dualPaneEnabled = false;
      browser.refresh();
      check("disabling dual pane releases shortcut scope", !browser.keyScopeActive && app.keymap.getWindowStack(win).scope !== browser.keyScope);
      fakePlugin.settings.dualPaneEnabled = true;
      browser.refresh();
    }
    if (caseName === "sort-focus" || caseName === "all") {
      browser.selectFolder("A");
      browser.focusEntry("A/note-010.md");
      browser.sort = "modified";
      browser.renderDirectory();
      await wait();
      const focused = doc.activeElement?.dataset.entryPath;
      check("sorting keeps the focused file visible and keyboard reachable", focused === "A/note-010.md", { focused, window: browser.windowKey });
      browser.sort = "name";
      browser.renderDirectory();
    }
    if (caseName === "scroll-focus" || caseName === "all") {
      actions.length = 0;
      browser.selectFolder("A");
      browser.focusEntry("A/note-010.md");
      browser.list.scrollTop = browser.list.scrollHeight;
      browser.list.dispatchEvent(new win.Event("scroll"));
      await wait();
      key(browser.list, "Delete");
      await wait();
      check("virtual scrolling cannot delete a row no longer in view", actions.length === 0, actions.slice());
    }
    if (caseName === "rail-hide" || caseName === "all") {
      const rail = browser.rail;
      browser.tree.dataset.crispFolderPath = "A";
      rail.refresh({ immediate: true }); rail.render();
      const before = rail.tickEls.filter(el => el.classList.contains("is-nearest")).length;
      browser.shell.hidden = true;
      rail.refresh();
      browser.tree.dataset.crispFolderPath = "Z-35";
      browser.shell.hidden = false;
      rail.refresh({ immediate: true }); rail.render();
      const ghosts = rail.tickEls.flatMap((el, index) => {
        const outside = index < rail.dynamicTickRange[0] || index > rail.dynamicTickRange[1];
        return outside && (el.style.opacity || el.classList.contains("is-line") || el.classList.contains("is-nearest")) ? [index] : [];
      });
      const nearest = rail.tickEls.filter(el => el.classList.contains("is-nearest")).length;
      check("hidden rail resumes without old highlight or opacity", before === 1 && nearest === 1 && ghosts.length === 0, { before, nearest, ghosts });
    }
    if (caseName === "owner-context" || caseName === "all") {
      const frame = doc.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-1000px;width:600px;height:650px;";
      doc.body.appendChild(frame);
      const frameWin = frame.contentWindow;
      const NativeObserver = frameWin.ResizeObserver;
      const observed = new Set();
      frameWin.ResizeObserver = class extends NativeObserver {
        observe(element, options) { observed.add(element); return super.observe(element, options); }
      };
      try {
        frame.contentDocument.body.appendChild(root);
        browser.rail.syncOwnerContext();
        browser.rail.syncContentObservation();
        check("document migration observes both scroll box and retained tree content", observed.has(browser.tree) && observed.has(browser.treeContent),
          { scrollBox: observed.has(browser.tree), treeContent: observed.has(browser.treeContent) });
      } finally {
        doc.body.appendChild(root);
        browser.rail.syncOwnerContext();
        browser.rail.syncContentObservation();
        frameWin.ResizeObserver = NativeObserver;
        frame.remove();
      }
    }
    if (caseName === "layout" || caseName === "all") {
      browser.selectFolder("A");
      for (const width of [260, 389, 560, 720]) {
        root.style.width = `${width}px`;
        fakePlugin.settings.dualPaneLayout = "auto";
        browser.updateLayout();
        await wait();
        const shell = browser.shell.getBoundingClientRect();
        const right = browser.list.getBoundingClientRect();
        check(`layout at ${width}px has usable panes and no horizontal overflow`, right.width >= 99 && browser.shell.scrollWidth <= shell.width + 1,
          { layout: browser.layout, width: shell.width, scrollWidth: browser.shell.scrollWidth, rightWidth: right.width });
      }
      browser.focusList(); key(doc.activeElement, "End");
      await wait();
      check("virtual list End reaches the last item", doc.activeElement?.dataset.entryPath === "A/note-359.md", { path: doc.activeElement?.dataset.entryPath, rows: browser.fileRows.size });
      key(doc.activeElement, "Home"); await wait();
      check("virtual list Home reaches the first item", doc.activeElement?.dataset.entryPath === "A/note-000.md", { path: doc.activeElement?.dataset.entryPath });
      const selected = browser.selectedPath;
      const firstRow = browser.fileRows.get("A/note-000.md");
      browser.refresh();
      check("ordinary refresh preserves row, focus and directory", browser.fileRows.get("A/note-000.md") === firstRow && browser.selectedPath === selected && doc.activeElement === firstRow);
    }
  } finally {
    browser?.destroy();
    win.HTMLElement.prototype.focus = nativeFocus;
    root.remove();
    // A failed host-shortcut check can open a native modal. Cancel only modals
    // created by this test; never submit a rename or touch a pre-existing modal.
    for (const modal of [...doc.querySelectorAll(".modal-container")].filter(value => !originalModals.has(value))) {
      const cancel = [...modal.querySelectorAll("button")].find(button => button.textContent === "取消");
      cancel?.click();
    }
    await wait();
    if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
  }
  check("destroy removes browser shortcut scope", !browser.keyScopeActive && app.keymap.getWindowStack(win).scope !== browser.keyScope);
  return JSON.stringify({ version: realPlugin.manifest.version, case: caseName, backgroundFocusEmulated, checks,
    fixtureRemoved: !doc.querySelector('[data-crisp-e2e="true"]'), pass: checks.every(result => result.pass) });
}

const vault = process.env.CRISP_E2E_VAULT || "AI-native Knowledge System";
const caseName = process.argv.find(value => value.startsWith("--case="))?.slice(7) || "all";
const outputPath = process.argv.find(value => value.startsWith("--output="))?.slice(9);
const code = `(${probe.toString()})(${JSON.stringify(caseName)})`;
const stdout = execFileSync("obsidian", [`vault=${vault}`, "eval", `code=${code}`], { encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
const line = stdout.split("\n").find(value => value.startsWith("=> "));
if (!line) throw new Error(stdout.trim() || "Obsidian did not return a probe result; run dev:debug on first");
const result = JSON.parse(line.slice(3));
result.sourceSha256 = createHash("sha256").update(readFileSync(resolve(__dirname, "../main.js"))).digest("hex");
result.checkedAt = new Date().toISOString();
if (outputPath) {
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.pass ? 0 : 1;

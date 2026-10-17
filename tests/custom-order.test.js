"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function runtime(notices = []) {
  class Notice { constructor(message) { notices.push(message); } }
  const context = { module: { exports: {} }, require: id => id === "obsidian" ? { Plugin: class {}, PluginSettingTab: class {}, Notice, addIcon: () => {}, setIcon: () => {} } : require(id), window: { matchMedia: () => ({ matches: false }) }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8") + "\nmodule.exports.helpers = { normalizeExplorerOrder, crispOrderFolderItems, crispReorderNames, crispRenameInOrder, crispDeleteFromOrder, crispImportFlexplorer, crispDropZone, crispAvailableTarget, CrispExplorerOrder, DEFAULT_SETTINGS };", context);
  return context.module.exports.helpers;
}

// In-memory vault with Obsidian-like rename semantics; renames report back to the order like vault events do.
function harness(initialOrder, layout, options = {}) {
  const notices = [];
  const helpers = runtime(notices);
  const map = new Map();
  const saves = [];
  const moves = [];
  const make = (filePath, isFolder) => {
    const name = filePath === "/" ? "" : filePath.slice(filePath.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    const file = { path: filePath, name, parent: null, extension: !isFolder && dot > 0 ? name.slice(dot + 1) : "" };
    if (isFolder) file.children = [];
    map.set(filePath, file);
    return file;
  };
  const root = make("/", true);
  for (const entry of layout) {
    const isFolder = entry.endsWith("/");
    const filePath = isFolder ? entry.slice(0, -1) : entry;
    const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "/";
    const file = make(filePath, isFolder);
    file.parent = map.get(parentPath);
    file.parent.children.push(file);
  }
  const vault = {
    getRoot: () => root,
    getAbstractFileByPath: p => map.get(p) || null,
    getAbstractFileByPathInsensitive: p => [...map.values()].find(f => f.path.toLowerCase() === p.toLowerCase()) || null,
  };
  const view = { getSortedFolderItems: folder => folder.children.map(file => ({ file })) };
  const plugin = {
    licensed: true,
    unloading: false,
    settings: { explorerOrder: helpers.normalizeExplorerOrder(initialOrder) },
    saveSettings: async () => { saves.push(JSON.parse(JSON.stringify(plugin.settings.explorerOrder))); },
    app: {
      vault,
      plugins: { enabledPlugins: new Set() },
      workspace: { getLeavesOfType: () => [{ view }] },
      dragManager: {},
      fileManager: {
        renameFile: async (file, target) => {
          moves.push([file.path, target]);
          if (options.fail && options.fail(file, target)) throw new Error("injected failure");
          if (vault.getAbstractFileByPathInsensitive(target)) throw new Error(`exists: ${target}`);
          const old = file.path;
          map.delete(old);
          file.parent.children = file.parent.children.filter(child => child !== file);
          const parentPath = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : "/";
          file.path = target;
          file.name = target.slice(target.lastIndexOf("/") + 1);
          file.parent = map.get(parentPath);
          file.parent.children.push(file);
          map.set(target, file);
          order.onRename(file, old);
        },
      },
    },
  };
  const order = new helpers.CrispExplorerOrder(plugin);
  order.requestSort = () => {};
  order.scheduleSave = () => {};
  return { helpers, order, plugin, map, saves, moves, notices, file: p => map.get(p) };
}

const items = (parent, names) => names.map(name => ({ file: { name, path: parent === "/" ? name : `${parent}/${name}` } }));
const names = list => Array.from(list, item => item.file.name);
// Values built inside the vm context fail strict deepEqual on prototype identity.
const plain = value => JSON.parse(JSON.stringify(value));

test("folders without a saved order or pins keep the native result untouched", () => {
  const { normalizeExplorerOrder, crispOrderFolderItems } = runtime();
  const native = items("Notes", ["b.md", "a.md"]);
  assert.equal(crispOrderFolderItems(native, "Notes", normalizeExplorerOrder({ folders: { Other: ["a.md"] } })), native);
});

test("saved order applies, items the order has never seen go to the configured end", () => {
  const { normalizeExplorerOrder, crispOrderFolderItems } = runtime();
  const native = items("Notes", ["new-folder", "a.md", "b.md", "c.md"]);
  const folders = { Notes: ["c.md", "a.md", "b.md", "gone.md"] };
  assert.deepEqual(names(crispOrderFolderItems(native, "Notes", normalizeExplorerOrder({ folders }))), ["new-folder", "c.md", "a.md", "b.md"]);
  assert.deepEqual(names(crispOrderFolderItems(native, "Notes", normalizeExplorerOrder({ folders, newItems: "bottom" }))), ["c.md", "a.md", "b.md", "new-folder"]);
});

test("pinned items lead their folder even without a saved order", () => {
  const { normalizeExplorerOrder, crispOrderFolderItems } = runtime();
  const native = items("/", ["Core", "Topics", "README.md"]);
  assert.deepEqual(names(crispOrderFolderItems(native, "/", normalizeExplorerOrder({ pinned: ["README.md"] }))), ["README.md", "Core", "Topics"]);
  const ordered = normalizeExplorerOrder({ pinned: ["README.md", "Topics"], folders: { "/": ["README.md", "Core", "Topics"] } });
  assert.deepEqual(names(crispOrderFolderItems(native, "/", ordered)), ["README.md", "Topics", "Core"]);
});

test("reordering inserts the moved names next to the anchor", () => {
  const { crispReorderNames } = runtime();
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(plain(crispReorderNames(list, ["a"], "c", "after")), ["b", "c", "a", "d"]);
  assert.deepEqual(plain(crispReorderNames(list, ["d"], "a", "before")), ["d", "a", "b", "c"]);
  assert.deepEqual(plain(crispReorderNames(list, ["a", "d"], "b", "after")), ["b", "a", "d", "c"]);
  assert.deepEqual(plain(crispReorderNames(list, ["x"], null, "before")), ["x", "a", "b", "c", "d"]);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

test("dropping next to one of the moved items leaves the order as it was", () => {
  const { crispReorderNames } = runtime();
  assert.deepEqual(plain(crispReorderNames(["a", "b", "c"], ["b"], "b", "after")), ["a", "b", "c"]);
});

test("renaming in place keeps the position, folder renames carry their subtree orders", () => {
  const { normalizeExplorerOrder, crispRenameInOrder } = runtime();
  const order = normalizeExplorerOrder({
    folders: { Notes: ["b.md", "Sub", "a.md"], "Notes/Sub": ["y.md", "x.md"], "Notes/Sub/Deep": ["z.md"] },
    pinned: ["Notes/Sub/x.md"],
  });
  const renamed = crispRenameInOrder(order, "Notes/a.md", "Notes/aa.md");
  assert.deepEqual(plain(renamed.folders.Notes), ["b.md", "Sub", "aa.md"]);

  const moved = crispRenameInOrder(order, "Notes/Sub", "Notes/Renamed");
  assert.deepEqual(plain(moved.folders.Notes), ["b.md", "Renamed", "a.md"]);
  assert.deepEqual(plain(moved.folders["Notes/Renamed"]), ["y.md", "x.md"]);
  assert.deepEqual(plain(moved.folders["Notes/Renamed/Deep"]), ["z.md"]);
  assert.equal(moved.folders["Notes/Sub"], undefined);
  assert.deepEqual(plain(moved.pinned), ["Notes/Renamed/x.md"]);
  // Obsidian then reports each descendant; those events must not undo the move.
  assert.equal(crispRenameInOrder(moved, "Notes/Sub/x.md", "Notes/Renamed/x.md"), moved);
});

test("moving to another folder drops the old slot and leaves the new folder to place it", () => {
  const { normalizeExplorerOrder, crispRenameInOrder } = runtime();
  const order = normalizeExplorerOrder({ folders: { A: ["1.md", "2.md"], B: ["3.md"] } });
  const moved = crispRenameInOrder(order, "A/1.md", "B/1.md");
  assert.deepEqual(plain(moved.folders.A), ["2.md"]);
  assert.deepEqual(plain(moved.folders.B), ["3.md"]);
});

test("deleting removes the item, its pins and the orders of its subtree", () => {
  const { normalizeExplorerOrder, crispDeleteFromOrder } = runtime();
  const order = normalizeExplorerOrder({ folders: { A: ["Sub", "b.md"], "A/Sub": ["c.md"], "A/Subway": ["d.md"] }, pinned: ["A/Sub/c.md", "A/b.md"] });
  const next = crispDeleteFromOrder(order, "A/Sub");
  assert.deepEqual(plain(next.folders), { A: ["b.md"], "A/Subway": ["d.md"] });
  assert.deepEqual(plain(next.pinned), ["A/b.md"]);
});

test("Flexplorer data imports custom orders, pins and the new-item placement", () => {
  const { crispImportFlexplorer } = runtime();
  const imported = crispImportFlexplorer({
    newItemPlacement: "bottom",
    items: {
      "/": { sortOrder: "custom", customOrder: ["Now", "Core", "README.md"], isPinned: false },
      Core: { sortOrder: "byNameAsc", customOrder: ["b", "a"], isPinned: false },
      "Core/x.md": { isPinned: true, ctime: 1, mtime: 2 },
      Old: { customOrder: ["z.md"] },
    },
  });
  assert.deepEqual(plain(imported.folders), { "/": ["Now", "Core", "README.md"], Old: ["z.md"] });
  assert.deepEqual(plain(imported.pinned), ["Core/x.md"]);
  assert.equal(imported.newItems, "bottom");
  assert.equal(crispImportFlexplorer(undefined), null);
  assert.equal(crispImportFlexplorer({ items: [] }), null);
});

test("saved order data is normalized so a damaged file cannot break sorting", () => {
  const { normalizeExplorerOrder, DEFAULT_SETTINGS } = runtime();
  const order = normalizeExplorerOrder({ enabled: "yes", newItems: "middle", folders: { A: ["x", 3, "x"], B: "nope" }, pinned: ["p", null, "p"] });
  assert.equal(order.enabled, true);
  assert.equal(order.newItems, "top");
  assert.deepEqual(plain(order.folders), { A: ["x"] });
  assert.deepEqual(plain(order.pinned), ["p"]);
  assert.deepEqual(plain(normalizeExplorerOrder(DEFAULT_SETTINGS.explorerOrder)), plain(normalizeExplorerOrder(undefined)));
});

test("drop zones: files split in half, folders keep a middle band for moving inside", () => {
  const { crispDropZone } = runtime();
  assert.equal(crispDropZone(100, 20, 104, false, false), "before");
  assert.equal(crispDropZone(100, 20, 115, false, false), "after");
  assert.equal(crispDropZone(100, 20, 103, true, false), "before");
  assert.equal(crispDropZone(100, 20, 110, true, false), "inside");
  assert.equal(crispDropZone(100, 20, 118, true, false), "after");
  assert.equal(crispDropZone(100, 20, 118, true, true), "inside-start");
});

test("folder and file names that match Object properties sort like any other name", () => {
  const { normalizeExplorerOrder, crispOrderFolderItems, crispRenameInOrder, crispDeleteFromOrder } = runtime();
  const native = items("constructor", ["b.md", "a.md"]);
  const empty = normalizeExplorerOrder({});
  assert.equal(crispOrderFolderItems(native, "constructor", empty), native);
  assert.equal(crispOrderFolderItems(items("toString", ["x.md"]), "toString", empty).length, 1);

  const loaded = normalizeExplorerOrder(JSON.parse('{"folders":{"__proto__":["b.md","a.md"],"/":["__proto__","constructor"]}}'));
  assert.deepEqual(names(crispOrderFolderItems(items("__proto__", ["a.md", "b.md"]), "__proto__", loaded)), ["b.md", "a.md"]);
  const renamed = crispRenameInOrder(loaded, "__proto__", "proto");
  assert.deepEqual(plain(renamed.folders), { "/": ["proto", "constructor"], proto: ["b.md", "a.md"] });
  const deleted = crispDeleteFromOrder(loaded, "constructor");
  assert.deepEqual(plain(deleted.folders["/"]), ["__proto__"]);
});

test("collision names keep the whole name when there is no extension", () => {
  const { crispAvailableTarget } = runtime();
  const taken = paths => p => paths.includes(p);
  assert.equal(crispAvailableTarget("D", { name: "LICENSE", extension: "" }, taken(["D/LICENSE"])), "D/LICENSE 1");
  assert.equal(crispAvailableTarget("D", { name: "a.b.md", extension: "md" }, taken(["D/a.b.md", "D/a.b 1.md"])), "D/a.b 2.md");
  assert.equal(crispAvailableTarget("/", { name: "Notes", extension: "", children: [] }, taken(["Notes"])), "Notes 1");
  assert.equal(crispAvailableTarget("D", { name: "free.md", extension: "md" }, taken([])), "D/free.md");
});

test("moving two files with the same name gives the second one a free name", async () => {
  const h = harness({ folders: { A: ["same.md", "a.md"], B: ["same.md", "b.md"], D: ["anchor.md"] } },
    ["A/", "B/", "D/", "A/same.md", "A/a.md", "B/same.md", "B/b.md", "D/anchor.md"]);
  const files = [h.file("A/same.md"), h.file("B/same.md")];
  await h.order.commitDrop({ files, folder: h.file("D"), folderPath: "D", anchor: "anchor.md", side: "after" });
  assert.deepEqual(files.map(f => f.path), ["D/same.md", "D/same 1.md"]);
  assert.deepEqual(plain(h.plugin.settings.explorerOrder.folders), { A: ["a.md"], B: ["b.md"], D: ["anchor.md", "same.md", "same 1.md"] });
  assert.deepEqual(h.notices, []);
});

test("a failed move keeps the saved order and says how many moved", async () => {
  const h = harness({ folders: { A: ["x.md", "y.md", "z.md"], D: ["anchor.md"] } },
    ["A/", "D/", "A/x.md", "A/y.md", "A/z.md", "D/anchor.md"], { fail: file => file.name === "x.md" });
  await h.order.commitDrop({ files: [h.file("A/x.md")], folder: h.file("D"), folderPath: "D", anchor: "anchor.md", side: "after" });
  assert.equal(h.file("A/x.md").path, "A/x.md");
  assert.deepEqual(plain(h.plugin.settings.explorerOrder.folders), { A: ["x.md", "y.md", "z.md"], D: ["anchor.md"] });
  assert.equal(h.saves.length, 0);
  assert.equal(h.notices.length, 1);

  await h.order.commitDrop({ files: [h.file("A/x.md"), h.file("A/z.md")], folder: h.file("D"), folderPath: "D", anchor: null, side: "before" });
  assert.deepEqual(plain(h.plugin.settings.explorerOrder.folders), { A: ["x.md", "y.md"], D: ["z.md", "anchor.md"] });
  assert.match(h.notices[1], /1.*1/);
});

test("the root folder offers resetting its order but never pinning", () => {
  const h = harness({ folders: { "/": ["B", "A"] } }, ["A/", "B/"]);
  const titles = [];
  const menu = { addItem(callback) { const item = { setTitle(title) { titles.push(title); return this; }, setIcon() { return this; }, onClick() { return this; } }; callback(item); } };
  h.order.addMenuItems(menu, h.file("/"));
  assert.deepEqual(titles, ["恢复文件夹默认顺序"]);
});

test("a drop the pin rule forbids is refused instead of falling through to moving into the folder", () => {
  const h = harness({ pinned: ["Pinned"] }, ["Pinned/", "move.md"]);
  h.plugin.app.dragManager = { draggable: { type: "file", file: h.file("move.md") }, updateHover() {}, setAction() {} };
  const row = {
    dataset: { path: "Pinned" },
    classList: { contains: cls => cls === "nav-folder-title" },
    parentElement: { classList: { contains: cls => cls === "is-collapsed" } },
    getBoundingClientRect: () => ({ top: 100, bottom: 120, height: 20, left: 0, right: 200 }),
    querySelector: () => null,
  };
  row.closest = () => row;
  const container = { contains: () => true, querySelectorAll: () => [row] };
  const calls = [];
  const event = { type: "dragover", target: row, clientY: 102, dataTransfer: {}, preventDefault: () => calls.push("preventDefault"), stopPropagation: () => calls.push("stopPropagation") };
  h.order.onDragOver(event, container);
  assert.deepEqual(calls, ["stopPropagation"]);
  assert.equal(event.dataTransfer.dropEffect, "none");
  const drop = { ...event, type: "drop" };
  calls.length = 0;
  h.order.onDrop(drop, container);
  assert.deepEqual(calls, ["preventDefault", "stopPropagation"]);
  assert.equal(h.file("move.md").path, "move.md");
});

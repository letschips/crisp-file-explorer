"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function runtime() {
  const context = { module: { exports: {} }, require: id => id === "obsidian" ? { Plugin: class {}, PluginSettingTab: class {}, addIcon: () => {}, setIcon: () => {} } : require(id), window: { matchMedia: () => ({ matches: false }) }, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8") + "\nmodule.exports.helpers = { normalizeExplorerOrder, crispOrderFolderItems, crispReorderNames, crispRenameInOrder, crispDeleteFromOrder, crispImportFlexplorer, crispDropZone, DEFAULT_SETTINGS };", context);
  return context.module.exports.helpers;
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

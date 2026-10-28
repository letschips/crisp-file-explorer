import { isConnectedToOwnerDocument } from "../dom/owner-window.js";
import { Notice, setIcon, normalizePath } from "../obsidian.js";
import { FLEXPLORER_PLUGIN_ID, ORDER_SAVE_DELAY_MS, crispOrderParent, crispOrderName, crispOrderMatches, crispOwnList, crispCopyFolders, normalizeExplorerOrder, crispOrderFolderItems, crispReorderNames, crispRenameInOrder, crispDeleteFromOrder, crispImportFlexplorer, crispDropZone, crispAvailableTarget } from "./helpers.js";

export class CrispExplorerOrder {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.containers = new Map();
    this.patchedPrototype = null;
    this.originalSort = null;
    this.wrapper = null;
    this.blockedByFlexplorer = null;
    this.takingOver = false;
    this.indicator = null;
    this.indicatorPaths = new Set();
    this.saveTimer = null;
    this.sortTimer = null;
    this.destroyed = false;
  }

  get order() {
    return this.plugin.settings.explorerOrder;
  }

  set order(next) {
    this.plugin.settings.explorerOrder = next;
  }

  isFlexplorerEnabled() {
    const enabled = this.app.plugins && this.app.plugins.enabledPlugins;
    return Boolean(enabled && typeof enabled.has === "function" && enabled.has(FLEXPLORER_PLUGIN_ID));
  }

  isActive() {
    return !this.destroyed && !this.plugin.unloading && this.plugin.licensed === true
      && this.order.enabled && !this.isFlexplorerEnabled();
  }

  explorerViews() {
    const leaves = typeof this.app.workspace.getLeavesOfType === "function"
      ? this.app.workspace.getLeavesOfType("file-explorer")
      : [];
    return leaves.map((leaf) => leaf && leaf.view).filter((view) => view && typeof view.getSortedFolderItems === "function");
  }

  isPatched() {
    return Boolean(this.wrapper && this.patchedPrototype && this.patchedPrototype.getSortedFolderItems === this.wrapper);
  }

  ensurePatched() {
    if (this.isPatched()) return true;
    const view = this.explorerViews()[0];
    if (!view) return false;
    const proto = Object.getPrototypeOf(view);
    const original = proto.getSortedFolderItems;
    const order = this;
    const wrapper = function (folder) {
      const items = original.call(this, folder);
      if (!folder || !Array.isArray(items) || !order.isActive()) return items;
      return crispOrderFolderItems(items, folder.path, order.order);
    };
    this.patchedPrototype = proto;
    this.originalSort = original;
    this.wrapper = wrapper;
    proto.getSortedFolderItems = wrapper;
    return true;
  }

  unpatch() {
    // If another plugin wrapped this one, leave the chain alone; the wrapper passes through once inactive.
    if (this.isPatched()) this.patchedPrototype.getSortedFolderItems = this.originalSort;
    this.patchedPrototype = null;
    this.originalSort = null;
    this.wrapper = null;
  }

  // Called on start, on a timer and from the settings tab. Flexplorer patches the same
  // method, so this plugin stays out of the way while it is enabled and takes over once it is not.
  sync() {
    if (this.destroyed || this.plugin.unloading || this.plugin.licensed !== true) return;
    const blocked = this.isFlexplorerEnabled();
    if (blocked !== this.blockedByFlexplorer) {
      this.blockedByFlexplorer = blocked;
      if (blocked) this.syncIndicators();
      else this.takeOver();
      return;
    }
    if (!blocked && !this.takingOver && !this.isPatched() && this.ensurePatched()) this.requestSort();
  }

  async takeOver() {
    if (this.takingOver) return;
    this.takingOver = true;
    try {
      if (!this.order.flexplorerImported) await this.importFromFlexplorer({ auto: true });
    } finally {
      this.takingOver = false;
    }
    if (this.ensurePatched()) this.requestSort();
  }

  async importFromFlexplorer({ auto = false } = {}) {
    const adapter = this.app.vault.adapter;
    const dataPath = normalizePath(`${this.app.vault.configDir}/plugins/${FLEXPLORER_PLUGIN_ID}/data.json`);
    let imported = null;
    try {
      if (await adapter.exists(dataPath)) imported = crispImportFlexplorer(JSON.parse(await adapter.read(dataPath)));
    } catch (error) {
      // A file iCloud has not finished syncing reads as broken; try again next time.
      console.debug("Crisp File Explorer could not read Flexplorer data", error);
      if (!auto) new Notice("没能读取 Flexplorer 的数据，未导入");
      return false;
    }
    if (this.destroyed) return false;
    const current = this.order;
    const hasOwnOrder = Object.keys(current.folders).length > 0 || current.pinned.length > 0;
    if (imported && (!auto || !hasOwnOrder)) {
      const vault = this.app.vault;
      const exists = (path) => path === "/" || Boolean(vault.getAbstractFileByPath(path));
      const folders = Object.fromEntries(Object.entries(imported.folders).filter(([path]) => exists(path)));
      const pinned = imported.pinned.filter(exists);
      this.order = normalizeExplorerOrder({ ...current, folders, pinned, newItems: imported.newItems, flexplorerImported: true });
      new Notice(`已从 Flexplorer 导入 ${Object.keys(folders).length} 个文件夹的顺序${pinned.length ? `和 ${pinned.length} 个置顶` : ""}`);
    } else {
      if (!auto && !imported) new Notice("没有找到 Flexplorer 的排序数据");
      this.order = normalizeExplorerOrder({ ...current, flexplorerImported: true });
    }
    await this.plugin.saveSettings();
    this.requestSort();
    return Boolean(imported);
  }

  requestSort() {
    if (this.sortTimer) window.clearTimeout(this.sortTimer);
    this.sortTimer = window.setTimeout(() => {
      this.sortTimer = null;
      this.sortNow();
    }, 30);
  }

  sortNow() {
    for (const view of this.explorerViews()) {
      try {
        if (typeof view.sort === "function") view.sort();
      } catch (error) {
        console.debug("Crisp File Explorer could not sort the file explorer", error);
      }
    }
    this.syncIndicators();
  }

  scheduleSave() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.plugin.saveSettings();
    }, ORDER_SAVE_DELAY_MS);
  }

  flushSave() {
    if (!this.saveTimer) return null;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.plugin.saveSettings();
  }

  onRename(file, oldPath) {
    const next = crispRenameInOrder(this.order, oldPath, file && file.path);
    if (next === this.order) return;
    if (this.indicatorPaths.has(oldPath)) this.indicatorPaths.add(file.path);
    this.order = next;
    this.scheduleSave();
    this.requestSort();
  }

  onDelete(file) {
    const next = crispDeleteFromOrder(this.order, file && file.path);
    if (next === this.order) return;
    this.order = next;
    this.scheduleSave();
    this.syncIndicators();
  }

  addMenuItems(menu, file) {
    if (!this.isActive() || !menu || typeof menu.addItem !== "function" || !file || !file.path) return;
    // The vault root has nothing to be pinned above, but its own order can still be reset.
    if (file.path !== "/") {
      const pinned = this.order.pinned.includes(file.path);
      menu.addItem((item) => item
        .setTitle(pinned ? "取消文件列表置顶" : "在文件列表置顶")
        .setIcon(pinned ? "arrow-down-from-line" : "arrow-up-to-line")
        .onClick(() => this.setPinned(file.path, !pinned)));
    }
    if (Array.isArray(file.children) && crispOwnList(this.order.folders, file.path)) {
      menu.addItem((item) => item
        .setTitle("恢复文件夹默认顺序")
        .setIcon("arrow-down-up")
        .onClick(() => this.resetFolder(file.path)));
    }
  }

  async setPinned(path, pinned) {
    const list = this.order.pinned.filter((item) => item !== path);
    if (pinned) list.push(path);
    this.order = normalizeExplorerOrder({ ...this.order, pinned: list });
    this.requestSort();
    await this.plugin.saveSettings();
  }

  async resetFolder(path) {
    const folders = crispCopyFolders(this.order.folders);
    delete folders[path];
    this.order = normalizeExplorerOrder({ ...this.order, folders });
    this.requestSort();
    await this.plugin.saveSettings();
  }

  syncIndicators() {
    const active = this.isActive();
    const pinned = new Set(active ? this.order.pinned : []);
    for (const view of this.explorerViews()) {
      const fileItems = view.fileItems || {};
      for (const path of this.indicatorPaths) {
        if (pinned.has(path)) continue;
        const self = fileItems[path] && fileItems[path].selfEl;
        const mark = self && self.querySelector(":scope > .crisp-fe-order-pin");
        if (mark) mark.remove();
      }
      for (const path of pinned) {
        const self = fileItems[path] && fileItems[path].selfEl;
        if (!self || self.querySelector(":scope > .crisp-fe-order-pin")) continue;
        const mark = self.ownerDocument.createElement("span");
        mark.className = "crisp-fe-order-pin";
        mark.setAttribute("aria-label", "已置顶");
        setIcon(mark, "pin");
        self.appendChild(mark);
      }
    }
    this.indicatorPaths = pinned;
  }

  attach(container) {
    if (this.containers.has(container)) return;
    const onDragOver = (event) => this.onDragOver(event, container);
    const onDrop = (event) => this.onDrop(event, container);
    const onDragLeave = (event) => {
      if (!event.relatedTarget || !container.contains(event.relatedTarget)) this.clearDrop();
    };
    const onDragEnd = () => this.clearDrop();
    container.addEventListener("dragenter", onDragOver, true);
    container.addEventListener("dragover", onDragOver, true);
    container.addEventListener("drop", onDrop, true);
    container.addEventListener("dragleave", onDragLeave);
    container.addEventListener("dragend", onDragEnd);
    this.containers.set(container, () => {
      container.removeEventListener("dragenter", onDragOver, true);
      container.removeEventListener("dragover", onDragOver, true);
      container.removeEventListener("drop", onDrop, true);
      container.removeEventListener("dragleave", onDragLeave);
      container.removeEventListener("dragend", onDragEnd);
    });
  }

  detachMissing(containers) {
    for (const [container, cleanup] of Array.from(this.containers.entries())) {
      if (containers.has(container) && isConnectedToOwnerDocument(container)) continue;
      cleanup();
      this.containers.delete(container);
    }
  }

  detachAll() {
    for (const cleanup of this.containers.values()) cleanup();
    this.containers.clear();
    this.clearDrop();
  }

  draggedFiles() {
    const draggable = this.app.dragManager && this.app.dragManager.draggable;
    if (!draggable) return null;
    let files = null;
    if (draggable.type === "files") files = Array.from(draggable.files || []);
    else if (draggable.type === "file" || draggable.type === "folder") files = [draggable.file];
    if (!files || !files.length || files.some((file) => !file || !file.path || file.path === "/")) return null;
    // Rows inside a dragged folder travel with it.
    return files.filter((file) => !files.some((other) => other !== file && file.path.startsWith(`${other.path}/`)));
  }

  rowAt(event, container) {
    const hovered = event.target && typeof event.target.closest === "function" ? event.target.closest(".tree-item-self") : null;
    if (hovered && container.contains(hovered) && hovered.dataset.path && hovered.dataset.path !== "/") return hovered;
    let best = null;
    let bestDistance = Infinity;
    for (const row of container.querySelectorAll(".tree-item-self[data-path]")) {
      if (row.dataset.path === "/") continue;
      const rect = row.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const distance = event.clientY < rect.top ? rect.top - event.clientY : Math.max(0, event.clientY - rect.bottom);
      if (distance < bestDistance) {
        best = row;
        bestDistance = distance;
      }
    }
    return best;
  }

  resolveDrop(event, container) {
    const files = this.draggedFiles();
    if (!files) return null;
    const row = this.rowAt(event, container);
    if (!row) return null;
    const rowPath = row.dataset.path;
    const isFolder = row.classList.contains("nav-folder-title");
    const expanded = isFolder && Boolean(row.parentElement) && !row.parentElement.classList.contains("is-collapsed");
    const rect = row.getBoundingClientRect();
    const zone = crispDropZone(rect.top, rect.height, event.clientY, isFolder, expanded);
    if (zone === "inside") return null;
    const folderPath = zone === "inside-start" ? rowPath : crispOrderParent(rowPath);
    const anchor = zone === "inside-start" ? null : crispOrderName(rowPath);
    const side = zone === "after" ? "after" : "before";
    if (files.some((file) => file.path === rowPath && anchor !== null)) return null;
    if (files.some((file) => crispOrderMatches(folderPath, file.path))) return null;
    const vault = this.app.vault;
    const folder = folderPath === "/" ? vault.getRoot() : vault.getAbstractFileByPath(folderPath);
    if (!folder || !Array.isArray(folder.children)) return null;
    // Pinned rows only trade places with pinned rows; the rest stay below them.
    // An edge spot the pin rule forbids is refused outright; handing it to Obsidian would
    // turn "place next to this folder" into "move into this folder".
    const pinned = new Set(this.order.pinned);
    const movingPinned = new Set(files.map((file) => pinned.has(file.path)));
    if (movingPinned.size > 1) return { blocked: true };
    if (anchor !== null && pinned.has(rowPath) !== movingPinned.has(true)) return { blocked: true };
    return { files, folder, folderPath, anchor, side, zone, row };
  }

  onDragOver(event, container) {
    const target = this.isActive() ? this.resolveDrop(event, container) : null;
    if (!target) {
      this.clearDrop();
      return;
    }
    if (target.blocked) {
      // Not calling preventDefault leaves the drop disallowed; stopping here keeps Obsidian's
      // folder handler from accepting it.
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      this.clearDrop();
      this.clearNativeDropState();
      return;
    }
    // Taking the event first keeps Obsidian from highlighting a folder for this spot,
    // and forgetting its last target stops a pending hover-expand of that folder.
    event.preventDefault();
    this.clearNativeDropState();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    this.showDrop(target, container);
  }

  clearNativeDropState() {
    for (const view of this.explorerViews()) {
      if (view.lastDropTargetEl) view.lastDropTargetEl = null;
    }
    const manager = this.app.dragManager;
    if (manager && typeof manager.updateHover === "function") manager.updateHover(null, null);
    if (manager && typeof manager.setAction === "function") manager.setAction(null);
  }

  onDrop(event, container) {
    const target = this.isActive() ? this.resolveDrop(event, container) : null;
    this.clearDrop();
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.blocked) return;
    this.commitDrop(target).catch((error) => {
      console.error("Crisp File Explorer could not reorder", error);
      new Notice("Crisp File Explorer：顺序没有调整成功，请重试");
    });
  }

  showDrop(target, container) {
    const ownerDocument = container.ownerDocument;
    let entering = false;
    if (!this.indicator || this.indicator.ownerDocument !== ownerDocument || !this.indicator.isConnected) {
      if (this.indicator) this.indicator.remove();
      this.indicator = ownerDocument.createElement("div");
      this.indicator.className = "crisp-fe-order-indicator is-entering";
      ownerDocument.body.appendChild(this.indicator);
      entering = true;
    }
    const box = container.getBoundingClientRect();
    const rowRect = target.row.getBoundingClientRect();
    const inner = target.row.querySelector(".tree-item-inner") || target.row;
    let left = inner.getBoundingClientRect().left;
    let top = target.side === "after" ? rowRect.bottom : rowRect.top;
    if (target.zone === "inside-start") {
      top = rowRect.bottom;
      const child = target.row.parentElement && target.row.parentElement.querySelector(":scope > .tree-item-children .tree-item-inner");
      left = child ? child.getBoundingClientRect().left : left + 16;
    }
    // The ring sits just left of the text it will land beside; its centre marks the gap.
    left = Math.max(box.left, left - 10);
    const indicator = this.indicator;
    indicator.style.width = `${Math.max(24, box.right - left - 8)}px`;
    indicator.style.transform = `translate(${Math.round(left)}px, ${Math.round(top - 3)}px)`;
    if (!entering) return;
    // Place it before turning transitions on, so it fades in where it belongs instead of sliding from the corner.
    const ownerWindow = ownerDocument.defaultView || window;
    ownerWindow.requestAnimationFrame(() => {
      if (indicator.isConnected) indicator.classList.remove("is-entering");
    });
  }

  clearDrop() {
    if (this.indicator) this.indicator.remove();
    this.indicator = null;
  }

  availablePath(file, folderPath) {
    const vault = this.app.vault;
    const isTaken = (path) => Boolean(typeof vault.getAbstractFileByPathInsensitive === "function"
      ? vault.getAbstractFileByPathInsensitive(path)
      : vault.getAbstractFileByPath(path));
    return crispAvailableTarget(folderPath, file, isTaken);
  }

  // Moves first, then records only what actually landed: a failed move keeps its old place,
  // and the rename events have already cleared the old slots of the files that did move.
  async commitDrop({ files, folder, folderPath, anchor, side }) {
    const view = this.explorerViews()[0];
    const shown = view ? view.getSortedFolderItems(folder).map((item) => item.file.name) : folder.children.map((child) => child.name);
    const landed = [];
    let failed = 0;
    for (const file of files) {
      if (crispOrderParent(file.path) !== folderPath) {
        // Chosen right before each move, so files moved earlier in this batch count as taken.
        const target = this.availablePath(file, folderPath);
        try {
          await this.app.fileManager.renameFile(file, target);
        } catch (error) {
          console.error("Crisp File Explorer could not move", file.path, error);
        }
      }
      if (crispOrderParent(file.path) === folderPath) landed.push(file.name);
      else failed += 1;
    }
    if (landed.length) {
      const folders = crispCopyFolders(this.order.folders);
      folders[folderPath] = crispReorderNames(shown, landed, anchor, side);
      this.order = normalizeExplorerOrder({ ...this.order, folders });
      this.requestSort();
      await this.plugin.saveSettings();
    }
    if (failed) new Notice(`Crisp File Explorer：${landed.length} 个已移到位，${failed} 个没有移动，原位置和顺序保持不变`);
  }

  destroy() {
    this.destroyed = true;
    if (this.sortTimer) window.clearTimeout(this.sortTimer);
    this.sortTimer = null;
    const pending = this.flushSave();
    this.detachAll();
    this.unpatch();
    this.sortNow();
    return pending;
  }
}

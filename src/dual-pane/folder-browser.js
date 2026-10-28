import { getOwnerDocument, getOwnerWindow } from "../dom/owner-window.js";
import { crispFolderPath, crispRewritePath, crispDirectoryEntries, DUAL_PANE_ICON_ID, SINGLE_PANE_ICON_ID, crispRegisterIcons, crispPaneRatio, crispPaneFolderWidth, crispPaneFolderHeight, crispCollectEntries, crispNewEntryPath, crispListWindow, crispPaneLayout, crispMoveDestination, crispNameDialog } from "./helpers.js";
import { Notice, Menu, Scope, setIcon } from "../obsidian.js";
import { FileExplorerRail } from "../rail/rail.js";

export class CrispFolderBrowser {
  constructor(plugin, nativeContainer) {
    this.plugin = plugin;
    this.nativeContainer = nativeContainer;
    this.root = nativeContainer.closest('.workspace-leaf-content[data-type="file-explorer"]');
    this.doc = getOwnerDocument(nativeContainer);
    this.win = getOwnerWindow(nativeContainer);
    this.expanded = new Set([""]);
    this.selectedPath = crispFolderPath(plugin.app.workspace.getActiveFile()?.path || "");
    this.sort = plugin.settings.dualPaneSort === "modified" ? "modified" : "name";
    this.enabled = false;
    this.destroyed = false;
    this.dirty = true;
    this.descendants = Boolean(plugin.settings.dualPaneDescendants);
    this.lastActivePath = plugin.app.workspace.getActiveFile()?.path;
    this.entries = [];
    this.cleanups = [];
    this.treeRows = new Map();
    this.fileRows = new Map();
    this.expandAncestors(this.selectedPath);
    this.create();
    this.refresh();
  }

  element(tag, cls, parent, text) {
    const el = this.doc.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  listen(el, name, handler, options) {
    el.addEventListener(name, handler, options);
    this.cleanups.push(() => el.removeEventListener(name, handler, options));
  }

  iconButton(parent, icon, label, handler) {
    const button = this.element("button", "clickable-icon crisp-fe-browser-icon", parent);
    button.type = "button";
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    if (handler) this.listen(button, "click", handler);
    return button;
  }

  create() {
    const nativeTools = this.root.querySelector(".nav-buttons-container");
    // Match native toolbar markup: fixed-size inner-pane buttons stretch
    // Baseline's collapsed dot toolbar into vertical bars.
    this.toggle = this.element("div", "clickable-icon nav-action-button crisp-fe-browser-toggle", nativeTools || this.root);
    this.toggle.setAttribute("role", "button");
    this.toggle.setAttribute("aria-label", "切换到双栏浏览");
    this.toggle.tabIndex = 0;
    crispRegisterIcons();
    setIcon(this.toggle, DUAL_PANE_ICON_ID);
    this.listen(this.toggle, "click", () => this.plugin.setDualPaneEnabled(true));
    this.listen(this.toggle, "keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      this.plugin.setDualPaneEnabled(true);
    });
    this.shell = this.element("section", "crisp-fe-browser", this.root);
    this.shell.setAttribute("aria-label", "双栏文件浏览器");
    this.shell.hidden = true;
    const left = this.element("section", "crisp-fe-browser-navigation", this.shell);
    const leftHeader = this.element("header", "crisp-fe-browser-header", left);
    this.iconButton(leftHeader, SINGLE_PANE_ICON_ID, "切回单栏文件树", () => this.plugin.setDualPaneEnabled(false));
    this.element("span", "crisp-fe-browser-heading", leftHeader, "文件夹");
    this.iconButton(leftHeader, "house", "仓库根目录", () => this.selectFolder("", true));
    this.iconButton(leftHeader, "folder-plus", "在当前目录新建文件夹", () => this.createEntry(false));
    this.foldAllButton = this.iconButton(leftHeader, "chevrons-up-down", "展开所有文件夹", () => this.toggleAllFolders());
    this.tree = this.element("div", "nav-files-container crisp-fe-folder-tree", left);
    this.tree.setAttribute("role", "tree");
    this.tree.setAttribute("aria-label", "文件夹导航");
    this.tree.tabIndex = 0;
    this.treeContent = this.element("div", "crisp-fe-folder-tree-content", this.tree);

    this.separator = this.element("div", "crisp-fe-browser-separator", this.shell);
    this.separator.tabIndex = 0;
    this.separator.setAttribute("role", "separator");
    this.separator.setAttribute("aria-orientation", "vertical");
    this.separator.setAttribute("aria-label", "调整两栏宽度");
    this.separator.setAttribute("aria-valuemin", "100");
    this.separator.setAttribute("aria-valuemax", "500");
    this.listen(this.separator, "pointerdown", e => this.startResize(e));
    this.listen(this.separator, "keydown", e => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const delta = (["ArrowLeft", "ArrowUp"].includes(e.key) ? -10 : 10);
      if (this.layout === "vertical") {
        this.setSize(this.folderWidth, e.key === "Home" ? 200 : this.folderHeight + delta);
      } else {
        this.setSize(e.key === "Home" ? 200 : this.folderWidth + delta, this.folderHeight);
      }
      this.saveSize();
    });

    const right = this.element("section", "crisp-fe-browser-directory", this.shell);
    const rightHeader = this.element("header", "crisp-fe-browser-header", right);
    this.back = this.iconButton(rightHeader, "chevron-left", "返回上一级文件夹", () => this.selectFolder(crispFolderPath(this.selectedPath), true));
    this.heading = this.element("span", "crisp-fe-browser-heading", rightHeader);
    this.locateButton = this.iconButton(rightHeader, "crosshair", "定位当前文件", () => this.revealActive(true));
    this.iconButton(rightHeader, "file-plus", "在当前目录新建笔记", () => this.createEntry(true));
    this.sortButton = this.iconButton(rightHeader, "more-horizontal", "浏览选项", e => this.showSortMenu(e));
    this.list = this.element("div", "crisp-fe-browser-list", right);
    this.list.setAttribute("role", "list");
    this.list.setAttribute("aria-label", "当前文件夹内容");
    this.list.tabIndex = 0;
    this.viewport = this.element("div", "crisp-fe-browser-viewport", this.list);
    this.listen(this.list, "scroll", () => this.renderListWindow(), { passive: true });
    this.listen(this.list, "focusin", event => {
      const path = event.target.closest("[data-entry-path]")?.dataset.entryPath;
      if (path) this.focusedEntryPath = path;
    });
    this.empty = this.element("div", "crisp-fe-browser-empty", right, "这个文件夹是空的");
    this.empty.hidden = true;
    this.listen(this.treeContent, "click", e => this.handleTreeClick(e));
    this.listen(this.tree, "keydown", e => this.handleTreeKey(e));
    this.listen(this.tree, "contextmenu", e => this.showContextMenu(e, true));
    this.listen(this.list, "contextmenu", e => this.showContextMenu(e, false));
    this.listen(this.list, "dragstart", e => this.dragStart(e));
    this.listen(this.shell, "dragover", e => this.dragOver(e));
    this.listen(this.shell, "drop", e => this.drop(e));
    this.listen(this.shell, "dragleave", e => { if (!this.shell.contains(e.relatedTarget)) this.clearDrop(); });
    this.listen(this.shell, "dragend", () => this.clearDrop());
    this.listen(this.list, "keydown", e => this.handleListKey(e));
    // Obsidian handles F2 before DOM keydown bubbles. Give focused browser
    // rows their own scope so the active editor's rename command cannot win.
    this.keyScope = new Scope(this.plugin.app.scope);
    this.keyScope.register([], "F2", event => {
      if (this.tree.contains(event.target)) this.handleTreeKey(event);
      else if (this.list.contains(event.target)) this.handleListKey(event);
      else return;
      return false;
    });
    this.listen(this.shell, "focusin", event => {
      if (!this.enabled || this.keyScopeActive || !(this.tree.contains(event.target) || this.list.contains(event.target))) return;
      this.plugin.app.keymap.pushScope(this.keyScope);
      this.keyScopeActive = true;
    });
    this.listen(this.shell, "focusout", event => {
      if (!this.tree.contains(event.relatedTarget) && !this.list.contains(event.relatedTarget)) this.releaseKeyScope();
    });
    this.listen(this.list, "click", e => {
      const row = e.target.closest("[data-entry-path]");
      if (row) this.openEntry(row.dataset.entryPath, e);
    });
    this.listen(this.list, "auxclick", e => {
      if (e.button !== 1) return;
      const row = e.target.closest("[data-entry-path]");
      if (row) { e.preventDefault(); this.openEntry(row.dataset.entryPath, { ctrlKey: true }); }
    });
    const initialWidth = this.plugin.settings.dualPaneFolderWidth
      ?? (typeof this.plugin.settings.dualPaneRatio === "number" && this.plugin.settings.dualPaneRatio > 1
        ? this.plugin.settings.dualPaneRatio
        : (this.plugin.settings.dualPaneRatio ? Math.round(this.plugin.settings.dualPaneRatio * 480) : 200));
    const initialHeight = this.plugin.settings.dualPaneFolderHeight ?? 200;
    this.setSize(initialWidth, initialHeight);
    this.observeLayout();
  }

  runAction(action) {
    return Promise.resolve().then(action).catch(error => {
      console.error("Crisp File Explorer action failed", error);
      new Notice(error.message || "操作失败，请重试");
    });
  }

  releaseKeyScope() {
    if (!this.keyScopeActive) return;
    this.plugin.app.keymap.popScope(this.keyScope);
    this.keyScopeActive = false;
  }

  createEntry(note, folderPath = this.selectedPath) {
    this.nameModal?.close();
    this.nameModal = crispNameDialog(this.plugin.app, note ? "新建笔记" : "新建文件夹", async name => {
      if (this.destroyed) throw new Error("浏览器已关闭，请重新操作");
      const parent = this.folder(folderPath);
      if (!parent) throw new Error("目标目录已不存在");
      const path = crispNewEntryPath(parent.path, name, note);
      const vault = this.plugin.app.vault;
      if (vault.getAbstractFileByPath(path)) throw new Error("已有同名项目，请换一个名称");
      if (note) {
        const file = await vault.create(path, "");
        this.dirty = true;
        this.selectFolder(parent.path, true);
        await this.plugin.app.workspace.getLeaf(false).openFile(file);
      } else {
        await vault.createFolder(path);
        this.dirty = true;
        this.selectFolder(path, true);
      }
    });
  }

  showContextMenu(event, inTree) {
    event.preventDefault(); event.stopPropagation();
    const row = event.target.closest(inTree ? "[data-folder-path]" : "[data-entry-path]");
    const path = row ? (inTree ? row.dataset.folderPath : row.dataset.entryPath) : this.selectedPath;
    const file = path ? this.plugin.app.vault.getAbstractFileByPath(path) : this.folder("");
    if (!file) return;
    const menu = new Menu();
    const isFolder = Array.isArray(file.children);
    const add = (title, icon, action) => menu.addItem(item => item.setTitle(title).setIcon(icon).onClick(() => this.runAction(action)));
    if (isFolder) {
      add("新建笔记", "file-plus", () => this.createEntry(true, file.path));
      add("新建文件夹", "folder-plus", () => this.createEntry(false, file.path));
    } else {
      add("打开", "file-text", () => this.openEntry(file.path));
      add("在新标签页打开", "file-plus", () => this.openEntry(file.path, { ctrlKey: true }));
    }
    if (file.path) {
      menu.addSeparator();
      add("重命名", "pencil", () => this.plugin.app.fileManager.promptForFileRename(file));
      add("删除…", "trash-2", () => this.plugin.app.fileManager.promptForDeletion(file));
    }
    menu.addSeparator();
    // Core file actions above are explicit; this hook adds host/plugin extensions.
    this.plugin.app.workspace.trigger("file-menu", menu, file, "crisp-file-explorer");
    menu.showAtMouseEvent(event);
    return menu;
  }

  revealActive(force = false) {
    if (!force && !this.plugin.settings.dualPaneFollowActive) return false;
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file) return false;
    const present = this.entries?.some(entry => entry.path === file.path);
    if (force || !present) this.selectFolder(crispFolderPath(file.path), true);
    this.syncActiveFile();
    this.focusEntry(file.path, false);
    return true;
  }

  focusEntry(path, focus = true) {
    const index = (this.entries || []).findIndex(entry => entry.path === path);
    if (index < 0) { if (focus) this.list.focus(); return; }
    const top = index * this.rowHeight;
    if (top < this.list.scrollTop || top + this.rowHeight > this.list.scrollTop + this.list.clientHeight) {
      this.list.scrollTop = Math.max(0, top - (this.list.clientHeight - this.rowHeight) / 2);
    }
    this.renderListWindow();
    if (focus) this.fileRows.get(path)?.focus({ preventScroll: true });
  }

  focusList() {
    const active = this.plugin.app.workspace.getActiveFile()?.path;
    this.focusEntry(this.entries?.some(f => f.path === active) ? active : this.entries?.[0]?.path);
  }

  focusTree() {
    (this.treeRows.get(this.selectedPath) || this.tree).focus({ preventScroll: true });
  }

  focusEditor() {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf?.();
    if (!leaf || this.root.contains(leaf.view?.containerEl)) return;
    this.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view?.editor) leaf.view.editor.focus();
    else leaf.view?.containerEl?.focus();
  }

  setDescendants(value) {
    this.descendants = Boolean(value);
    this.plugin.settings.dualPaneDescendants = this.descendants;
    this.list.scrollTop = 0;
    this.renderDirectory();
    this.plugin.saveSettings();
  }

  observeLayout() {
    this.layoutObserver?.disconnect();
    this.layoutObserver = new this.win.ResizeObserver(() => {
      if (this.destroyed || !this.enabled) return;
      this.updateLayout();
      this.renderListWindow();
    });
    this.layoutObserver.observe(this.shell);
    this.layoutObserver.observe(this.list);
  }

  updateLayout() {
    const width = this.shell.getBoundingClientRect().width;
    if (!width) return;
    const layout = crispPaneLayout(this.plugin.settings.dualPaneLayout, width, this.layout);
    this.layout = layout;
    this.shell.classList.toggle("is-vertical", layout === "vertical");
    this.separator.setAttribute("aria-orientation", layout === "vertical" ? "horizontal" : "vertical");
    this.separator.setAttribute("aria-label", layout === "vertical" ? "调整两栏高度" : "调整两栏宽度");
    this.separator.setAttribute("aria-valuemin", layout === "vertical" ? "90" : "100");
    this.separator.setAttribute("aria-valuemax", layout === "vertical" ? "450" : "500");
    this.separator.setAttribute("aria-valuenow", String(layout === "vertical" ? (this.folderHeight || 200) : (this.folderWidth || 200)));
    this.shell.classList.toggle("is-compact-directory", this.list.getBoundingClientRect().width < 240);
  }

  dragStart(event) {
    const row = event.target.closest("[data-entry-path]");
    const file = row && this.plugin.app.vault.getAbstractFileByPath(row.dataset.entryPath);
    if (!file || Array.isArray(file.children) || !event.dataTransfer) return;
    event.dataTransfer.setData("text/plain", this.plugin.app.fileManager.generateMarkdownLink(file, this.plugin.app.workspace.getActiveFile()?.path || ""));
    const manager = this.plugin.app.dragManager;
    if (manager?.dragFile && manager?.onDragStart) manager.onDragStart(event, manager.dragFile(event, file, "crisp-file-explorer"));
    event.dataTransfer.effectAllowed = "copyMove";
  }

  getDraggedFile() {
    const file = this.plugin.app.dragManager?.draggable?.file;
    return file && !Array.isArray(file.children) && this.plugin.app.vault.getAbstractFileByPath(file.path) === file ? file : null;
  }

  dropFolder(event) {
    const row = event.target.closest("[data-folder-path], .crisp-fe-browser-entry.is-folder");
    if (row) return { folder: this.folder(row.dataset.folderPath ?? row.dataset.entryPath), element: row };
    if (this.list.contains(event.target)) return { folder: this.folder(this.selectedPath), element: this.list };
    return null;
  }

  clearDrop() {
    this.dropTarget?.classList.remove("crisp-fe-drop-target");
    this.dropTarget = null;
  }

  dragOver(event) {
    const file = this.getDraggedFile();
    const target = this.dropFolder(event);
    this.clearDrop();
    if (!file || !target?.folder) return;
    event.preventDefault(); event.stopPropagation();
    let destination;
    try { destination = crispMoveDestination(file, target.folder, this.plugin.app.vault); } catch (_) { destination = null; }
    if (event.dataTransfer) event.dataTransfer.dropEffect = destination ? "move" : "none";
    if (destination) { this.dropTarget = target.element; this.dropTarget.classList.add("crisp-fe-drop-target"); }
  }

  drop(event) {
    const file = this.getDraggedFile();
    const target = this.dropFolder(event);
    this.clearDrop();
    if (!file || !target?.folder) return;
    event.preventDefault(); event.stopPropagation();
    this.runAction(async () => {
      const path = crispMoveDestination(file, target.folder, this.plugin.app.vault);
      if (path) await this.plugin.app.fileManager.renameFile(file, path);
    });
  }

  folder(path) {
    const vault = this.plugin.app.vault;
    const file = path ? vault.getAbstractFileByPath(path) : vault.getRoot();
    return Array.isArray(file?.children) ? file : null;
  }

  expandAncestors(path) {
    let parent = crispFolderPath(path);
    while (parent) { this.expanded.add(parent); parent = crispFolderPath(parent); }
  }

  selectFolder(path, reveal = false) {
    if (!this.folder(path)) return false;
    const changed = this.selectedPath !== path;
    this.selectedPath = path;
    this.expandAncestors(path);
    this.renderTree();
    if (changed || this.dirty) {
      if (changed) this.focusedEntryPath = null;
      this.list.scrollTop = 0;
      this.renderDirectory();
    }
    this.dirty = false;
    if (reveal) this.treeRows.get(path)?.scrollIntoView({ block: "nearest" });
    this.rail?.refresh({ reveal: false });
    return true;
  }

  expandableFolders() {
    const folders = [];
    const pending = [this.folder("")];
    while (pending.length) {
      const folder = pending.pop();
      const children = (folder?.children || []).filter(child => Array.isArray(child.children));
      if (folder?.path && children.length) folders.push(folder.path);
      pending.push(...children);
    }
    return folders;
  }

  toggleAllFolders() {
    const folders = this.expandableFolders();
    const collapse = folders.length > 0 && folders.every(path => this.expanded.has(path));
    this.expanded = new Set(collapse ? [""] : ["", ...folders]);
    this.renderTree();
  }

  toggleFolder(path, force) {
    const next = force === undefined ? !this.expanded.has(path) : force;
    if (next === this.expanded.has(path)) return false;
    if (next) this.expanded.add(path); else this.expanded.delete(path);
    this.renderTree();
    this.treeRows.get(path)?.focus({ preventScroll: true });
    return true;
  }

  handleTreeClick(e) {
    const row = e.target.closest("[data-folder-path]");
    if (!row) return;
    const path = row.dataset.folderPath;
    if (e.target.closest(".crisp-fe-folder-chevron")) this.toggleFolder(path);
    else this.selectFolder(path);
  }

  handleTreeKey(e) {
    if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); this.focusList(); return;
    }
    const rows = [...this.treeRows.values()];
    const current = e.target.closest("[data-folder-path]") || this.treeRows.get(this.selectedPath) || rows[0];
    const path = current?.dataset?.folderPath;
    if (e.key === "F2") {
      e.preventDefault(); e.stopPropagation();
      const file = path && this.plugin.app.vault.getAbstractFileByPath(path);
      if (file && file.path) this.runAction(() => this.plugin.app.fileManager.promptForFileRename(file));
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
      e.preventDefault(); e.stopPropagation();
      const file = path && this.plugin.app.vault.getAbstractFileByPath(path);
      if (file && file.path) this.runAction(() => this.plugin.app.fileManager.promptForDeletion(file));
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (!current) return;
    const index = rows.indexOf(current);
    let target;
    if (e.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
    if (e.key === "ArrowDown") target = rows[Math.min(rows.length - 1, index + 1)];
    if (e.key === "Home") target = rows[0];
    if (e.key === "End") target = rows.at(-1);
    if (target) { this.selectFolder(target.dataset.folderPath); this.treeRows.get(target.dataset.folderPath)?.focus(); }
    if (e.key === "ArrowRight") {
      if (current.getAttribute("aria-expanded") === "false") this.toggleFolder(path, true);
      else if (current.getAttribute("aria-expanded") === "true") rows[index + 1]?.focus();
      else this.focusList();
    }
    if (e.key === "ArrowLeft") {
      if (this.expanded.has(path)) this.toggleFolder(path, false);
      else { const parent = crispFolderPath(path); this.selectFolder(parent, true); this.treeRows.get(parent)?.focus(); }
    }
    if (e.key === "Enter" || e.key === " ") this.selectFolder(path);
  }

  handleListKey(e) {
    const candidate = e.target.closest("[data-entry-path]")?.dataset.entryPath || this.focusedEntryPath;
    // A remembered focus is never authority to act outside the current list.
    const path = this.entries?.some(file => file.path === candidate) ? candidate : null;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (path) this.openEntry(path, { ctrlKey: true });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
      e.preventDefault(); e.stopPropagation();
      const file = path && this.plugin.app.vault.getAbstractFileByPath(path);
      if (file && file.path) this.runAction(() => this.plugin.app.fileManager.promptForDeletion(file));
      return;
    }
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation();
      if (path) this.openEntry(path, e);
      return;
    }
    if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if ((e.key === "Tab" && e.shiftKey) || e.key === "ArrowLeft" || e.key === "Escape") this.focusTree();
      else this.focusEditor();
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Backspace", "F2", "Delete"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Backspace") { this.selectFolder(crispFolderPath(this.selectedPath), true); this.focusList(); return; }
    if (e.key === "F2") {
      const file = path && this.plugin.app.vault.getAbstractFileByPath(path);
      if (file && file.path) this.runAction(() => this.plugin.app.fileManager.promptForFileRename(file));
      return;
    }
    if (e.key === "Delete") {
      const file = path && this.plugin.app.vault.getAbstractFileByPath(path);
      if (file && file.path) this.runAction(() => this.plugin.app.fileManager.promptForDeletion(file));
      return;
    }
    const entries = this.entries || [];
    const index = entries.findIndex(file => file.path === path);
    const visibleIndex = Math.floor(this.list.scrollTop / this.rowHeight);
    const next = e.key === "Home" ? 0 : e.key === "End" ? entries.length - 1 : index < 0 ? visibleIndex : e.key === "ArrowDown" ? index + 1 : index - 1;
    this.focusEntry(entries[Math.min(entries.length - 1, Math.max(0, next))]?.path);
  }

  renderTree() {
    this.tree.dataset.crispFolderPath = this.selectedPath;
    const focused = this.doc.activeElement?.dataset?.folderPath;
    const scroll = this.tree.scrollTop;
    this.treeRows.clear();
    const fragment = this.doc.createDocumentFragment();
    const append = (folder, depth) => {
      const row = this.element("button", "nav-folder-title crisp-fe-folder-row", fragment);
      row.type = "button";
      row.dataset.path = folder.path;
      row.dataset.folderPath = folder.path;
      row.style.setProperty("--folder-depth", depth);
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", depth + 1);
      row.setAttribute("aria-selected", String(folder.path === this.selectedPath));
      row.tabIndex = folder.path === this.selectedPath ? 0 : -1;
      row.title = folder.path;
      const children = crispDirectoryEntries(folder).filter(child => Array.isArray(child.children));
      const arrow = this.element("span", "crisp-fe-folder-chevron", row);
      if (children.length) {
        row.setAttribute("aria-expanded", String(this.expanded.has(folder.path)));
        setIcon(arrow, this.expanded.has(folder.path) ? "chevron-down" : "chevron-right");
      } else arrow.classList.add("is-empty");
      const icon = this.element("span", "crisp-fe-browser-entry-icon", row);
      setIcon(icon, "folder");
      this.element("span", "nav-folder-title-content crisp-fe-browser-name", row, folder.name);
      this.treeRows.set(folder.path, row);
      if (this.expanded.has(folder.path)) for (const child of children) append(child, depth + 1);
    };
    for (const child of crispDirectoryEntries(this.folder("")).filter(f => Array.isArray(f.children))) append(child, 0);
    const folders = this.expandableFolders();
    const allExpanded = folders.length > 0 && folders.every(path => this.expanded.has(path));
    if (this.foldAllButton) {
      const label = allExpanded ? "收起所有文件夹" : "展开所有文件夹";
      this.foldAllButton.setAttribute("aria-label", label);
      this.foldAllButton.title = label;
      this.foldAllButton.disabled = folders.length === 0;
      setIcon(this.foldAllButton, allExpanded ? "chevrons-down-up" : "chevrons-up-down");
    }
    this.treeContent.replaceChildren(fragment);
    this.tree.scrollTop = scroll;
    if (focused !== undefined) this.treeRows.get(focused)?.focus({ preventScroll: true });
    this.rail?.scheduleRefresh();
  }

  renderDirectory() {
    const focusedPath = this.doc.activeElement?.dataset?.entryPath;
    const hadListFocus = this.list.contains(this.doc.activeElement);
    const folder = this.folder(this.selectedPath);
    this.heading.textContent = folder?.name || this.plugin.app.vault.getName();
    this.heading.title = this.selectedPath || this.plugin.app.vault.getName();
    this.back.disabled = !this.selectedPath;
    this.entries = crispCollectEntries(folder, this.sort, this.descendants);
    if (!this.entries.some(file => file.path === this.focusedEntryPath)) this.focusedEntryPath = null;
    this.rowHeight = this.descendants ? 52 : 38;
    this.shell.classList.toggle("is-flat-view", Boolean(this.descendants));
    this.list.setAttribute("aria-label", this.descendants ? "包含子文件夹的笔记" : "当前文件夹内容");
    this.empty.textContent = this.descendants ? "当前目录及子目录中没有笔记" : "这个文件夹是空的";
    this.empty.hidden = this.entries.length > 0;
    this.windowKey = "";
    this.renderListWindow();
    if (focusedPath && this.entries.some(file => file.path === focusedPath)) this.focusEntry(focusedPath);
    else if (hadListFocus) this.list.focus({ preventScroll: true });
  }

  renderListWindow() {
    if (!this.entries || !this.viewport) return;
    const { start, end } = crispListWindow(this.entries.length, this.list.scrollTop, this.list.clientHeight, this.rowHeight);
    const key = `${start}:${end}`;
    if (key === this.windowKey) return;
    this.windowKey = key;
    const focusedPath = this.viewport.contains(this.doc.activeElement) ? this.doc.activeElement?.closest("[data-entry-path]")?.dataset.entryPath : null;
    this.fileRows.clear();
    const fragment = this.doc.createDocumentFragment();
    const activePath = this.plugin.app.workspace.getActiveFile()?.path;
    for (let index = start; index < end; index++) {
      const file = this.entries[index];
      const wrapper = this.element("div", "crisp-fe-browser-list-item", fragment);
      wrapper.setAttribute("role", "listitem");
      wrapper.setAttribute("aria-posinset", String(index + 1));
      wrapper.setAttribute("aria-setsize", String(this.entries.length));
      const row = this.element("button", "crisp-fe-browser-entry", wrapper);
      row.type = "button";
      row.dataset.entryPath = file.path;
      row.title = file.path;
      const isFolder = Array.isArray(file.children);
      row.draggable = !isFolder;
      row.classList.toggle("is-folder", isFolder);
      const icon = this.element("span", "crisp-fe-browser-entry-icon", row);
      setIcon(icon, isFolder ? "folder" : file.extension === "md" ? "file-text" : file.extension === "canvas" ? "layout-dashboard" : "file");
      const label = this.element("span", "crisp-fe-browser-label", row);
      const displayName = isFolder
        ? file.name
        : file.extension === "md"
        ? (file.basename || file.name.replace(/\.md$/i, ""))
        : file.extension === "canvas"
        ? (file.basename || file.name.replace(/\.canvas$/i, ""))
        : file.name;
      this.element("span", "crisp-fe-browser-name", label, displayName);
      if (this.descendants) {
        const parent = crispFolderPath(file.path);
        const relative = this.selectedPath && parent.startsWith(`${this.selectedPath}/`) ? parent.slice(this.selectedPath.length + 1) : parent;
        this.element("span", "crisp-fe-browser-path", label, parent === this.selectedPath ? "当前目录" : relative || "仓库根目录");
      }
      if (isFolder) setIcon(this.element("span", "crisp-fe-browser-entry-chevron", row), "chevron-right");
      row.classList.toggle("is-active", file.path === activePath);
      if (file.path === activePath) row.setAttribute("aria-current", "page");
      this.fileRows.set(file.path, row);
    }
    this.viewport.style.paddingTop = `${start * this.rowHeight}px`;
    this.viewport.style.paddingBottom = `${(this.entries.length - end) * this.rowHeight}px`;
    this.viewport.replaceChildren(fragment);
    if (focusedPath) {
      const row = this.fileRows.get(focusedPath);
      if (!row) this.focusedEntryPath = null;
      (row || this.list).focus({ preventScroll: true });
    }
  }

  syncActiveFile() {
    const path = this.plugin.app.workspace.getActiveFile()?.path;
    for (const [entryPath, row] of this.fileRows) {
      const active = entryPath === path;
      if (row.classList.contains("is-active") !== active) row.classList.toggle("is-active", active);
      if (active && !row.hasAttribute("aria-current")) row.setAttribute("aria-current", "page");
      else if (!active && row.hasAttribute("aria-current")) row.removeAttribute("aria-current");
    }
  }

  openEntry(path, event = {}) {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    if (Array.isArray(file.children)) {
      this.selectFolder(path, true);
      this.list.focus();
    } else {
      const newTab = Boolean(event.metaKey || event.ctrlKey);
      this.plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file).catch(error => {
        console.error("Crisp File Explorer could not open file", error);
        new Notice("文件打开失败，请重试");
      });
    }
  }

  showSortMenu(event) {
    const menu = new Menu();
    for (const [value, title] of [["name", "按名称排序"], ["modified", "最近修改优先"]]) {
      menu.addItem(item => item.setTitle(title).setChecked(this.sort === value).onClick(() => {
        this.sort = value;
        this.plugin.settings.dualPaneSort = value;
        this.plugin.saveSettings();
        this.renderDirectory();
      }));
    }
    menu.addSeparator();
    menu.addItem(item => item.setTitle("包含子文件夹笔记").setIcon("layers").setChecked(this.descendants).onClick(() => this.setDescendants(!this.descendants)));
    menu.addItem(item => item.setTitle("自动跟随当前文件").setIcon("crosshair").setChecked(Boolean(this.plugin.settings.dualPaneFollowActive)).onClick(() => {
      this.plugin.settings.dualPaneFollowActive = !this.plugin.settings.dualPaneFollowActive;
      this.plugin.saveSettings();
      if (this.plugin.settings.dualPaneFollowActive) this.revealActive(true);
    }));
    menu.addSeparator();
    for (const [mode, title] of [["auto", "自动布局"], ["horizontal", "左右分栏"], ["vertical", "上下分栏"]]) {
      menu.addItem(item => item.setTitle(title).setChecked((this.plugin.settings.dualPaneLayout || "auto") === mode).onClick(() => {
        this.plugin.settings.dualPaneLayout = mode;
        this.plugin.saveSettings();
        for (const browser of this.plugin.folderBrowsers.values()) browser.updateLayout();
      }));
    }
    menu.showAtMouseEvent(event);
  }

  setRatio(value) {
    if (typeof value === "number" && value >= 50) {
      this.setSize(value, this.folderHeight || 200);
      return;
    }
    this.ratio = crispPaneRatio(value);
    const rect = this.shell ? this.shell.getBoundingClientRect() : null;
    const total = (rect && rect.width > 0) ? rect.width : 480;
    const width = Math.round(this.ratio * total);
    this.setSize(width, this.folderHeight || 200, rect);
  }

  setSize(width, height, rect = null) {
    const box = rect || (this.shell ? this.shell.getBoundingClientRect() : null);
    this.folderWidth = crispPaneFolderWidth(width, box?.width);
    this.folderHeight = crispPaneFolderHeight(height, box?.height);
    this.ratio = crispPaneRatio(box && box.width > 0 ? this.folderWidth / box.width : 0.43);
    this.shell.style.setProperty("--crisp-fe-folder-width", `${this.folderWidth}px`);
    this.shell.style.setProperty("--crisp-fe-folder-height", `${this.folderHeight}px`);
    this.shell.style.setProperty("--crisp-fe-folder-share", `${this.folderWidth}px`);
    const isVertical = this.layout === "vertical";
    this.separator.setAttribute("aria-orientation", isVertical ? "horizontal" : "vertical");
    this.separator.setAttribute("aria-valuenow", String(isVertical ? this.folderHeight : this.folderWidth));
  }

  saveSize() {
    this.plugin.settings.dualPaneFolderWidth = this.folderWidth;
    this.plugin.settings.dualPaneFolderHeight = this.folderHeight;
    this.plugin.settings.dualPaneRatio = this.ratio;
    this.plugin.saveSettings();
  }

  saveRatio() {
    this.saveSize();
  }

  startResize(event) {
    if (event.button !== 0 || event.isPrimary === false || this.resizeCleanup) return;
    event.preventDefault(); event.stopPropagation();
    const win = getOwnerWindow(this.shell);
    const id = event.pointerId;
    const initialWidth = this.folderWidth || 200;
    const initialHeight = this.folderHeight || 200;
    this.shell.classList.add("is-resizing");
    const move = e => {
      if (e.pointerId !== id) return;
      const rect = this.shell.getBoundingClientRect();
      const vertical = this.layout === "vertical";
      if (vertical) {
        this.setSize(this.folderWidth, Math.round(e.clientY - rect.top), rect);
      } else {
        this.setSize(Math.round(e.clientX - rect.left), this.folderHeight, rect);
      }
    };
    const finish = e => {
      if (e.type !== "blur" && e.pointerId !== id) return;
      const cancel = e.type !== "pointerup";
      if (cancel) this.setSize(initialWidth, initialHeight);
      this.resizeCleanup();
      if (!cancel) this.saveSize();
    };
    this.resizeCleanup = () => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", finish);
      win.removeEventListener("pointercancel", finish);
      win.removeEventListener("blur", finish);
      this.shell.classList.remove("is-resizing");
      this.resizeCleanup = null;
    };
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", finish);
    win.addEventListener("pointercancel", finish);
    win.addEventListener("blur", finish);
  }

  onVaultChange(kind, file, oldPath) {
    const relevant = path => crispFolderPath(path) === this.selectedPath || (this.descendants && (!this.selectedPath || path.startsWith(`${this.selectedPath}/`)));
    if (kind === "modify" && (this.sort !== "modified" || !relevant(file.path))) return;
    if (!Array.isArray(file.children) && !relevant(file.path) && !(oldPath && relevant(oldPath))) return;
    if (oldPath) {
      this.selectedPath = crispRewritePath(this.selectedPath, oldPath, file.path);
      this.expanded = new Set([...this.expanded].map(path => crispRewritePath(path, oldPath, file.path)));
    } else if (kind === "delete") {
      this.selectedPath = crispRewritePath(this.selectedPath, file.path, null);
      this.expanded = new Set([...this.expanded].filter(path => path !== file.path && !path.startsWith(`${file.path}/`)));
    }
    this.dirty = true;
    if (this.changeTimer) this.win.clearTimeout(this.changeTimer);
    this.changeTimer = this.win.setTimeout(() => {
      this.changeTimer = null;
      if (!this.destroyed) this.refresh();
    }, kind === "modify" ? 250 : 80);
  }

  refresh() {
    if (this.destroyed) return;
    const nextWindow = getOwnerWindow(this.nativeContainer);
    if (nextWindow !== this.win) {
      this.releaseKeyScope();
      this.resizeCleanup?.();
      if (this.changeTimer) this.win.clearTimeout(this.changeTimer);
      this.changeTimer = null;
      this.win = nextWindow;
      this.doc = getOwnerDocument(this.nativeContainer);
      this.dirty = true;
      this.plugin.enableDocument(this.doc);
      this.observeLayout();
    }
    const enabled = Boolean(this.plugin.settings.dualPaneEnabled);
    const changed = enabled !== this.enabled;
    this.enabled = enabled;
    if (changed) {
      this.root.classList.toggle("crisp-fe-browser-open", enabled);
      this.shell.hidden = !enabled;
      this.nativeContainer.inert = enabled;
      if (!enabled) { this.releaseKeyScope(); this.resizeCleanup?.(); this.clearDrop(); }
      else this.updateLayout();
    }
    if (!enabled) { this.rail?.setEnabled(false); return; }
    if (!this.folder(this.selectedPath)) this.selectedPath = "";
    if (this.dirty || changed) {
      this.renderTree(); this.renderDirectory(); this.dirty = false;
    } else this.syncActiveFile();
    const activePath = this.plugin.app?.workspace?.getActiveFile?.()?.path;
    if (activePath !== this.lastActivePath) {
      this.lastActivePath = activePath;
      this.revealActive(false);
    }
    if (!this.rail) this.rail = new FileExplorerRail(this.plugin, this.tree);
    this.rail.refresh({ immediate: changed });
  }

  destroy() {
    this.destroyed = true;
    this.releaseKeyScope();
    this.resizeCleanup?.();
    this.clearDrop();
    this.layoutObserver?.disconnect();
    this.nameModal?.close();
    if (this.changeTimer) this.win.clearTimeout(this.changeTimer);
    this.rail?.destroy();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.root.classList.remove("crisp-fe-browser-open");
    this.nativeContainer.inert = false;
    this.shell.remove();
    this.toggle.remove();
  }
}

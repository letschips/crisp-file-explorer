import { getLocalDateKey, normalizeActivity, rankSmartMagnetPaths, pruneFileStats, rewriteActivityPaths } from "./activity.js";
import { INTERACTION_LOCK_MS, ACTIVE_REVEAL_RETRY_DELAYS, SMART_MAGNET_LIMIT, FILE_STATS_LIMIT, TODAY_TRAIL_LIMIT, ACTIVITY_SAVE_DELAY_MS } from "./constants.js";
import { getOwnerDocument, isConnectedToOwnerDocument } from "./dom/owner-window.js";
import { CrispFolderBrowser } from "./dual-pane/folder-browser.js";
import { crispRegisterIcons } from "./dual-pane/helpers.js";
import { verifyLicenseCode, LICENSE_PLUGIN_ID } from "./license.js";
import { Plugin, Notice, normalizePath } from "./obsidian.js";
import { normalizeOrbStyle, resolveOrbStyle, normalizeSoundStyle, resolveSoundStyle } from "./orb/styles.js";
import { CrispExplorerOrder } from "./order/explorer-order.js";
import { ORDER_SYNC_INTERVAL_MS, normalizeExplorerOrder } from "./order/helpers.js";
import { CrispAudio } from "./rail/audio.js";
import { FileExplorerRail } from "./rail/rail.js";
import { CrispFileExplorerSettingTab } from "./settings-tab.js";
import { DEFAULT_SETTINGS } from "./settings.js";

export default class CrispFileExplorerPlugin extends Plugin {
  async onload() {
    this.unloading = false;
    this.controllers = new Map();
    this.folderBrowsers = new Map();
    this.audio = new CrispAudio();
    this.refreshQueued = false;
    this.refreshFrame = null;
    this.pendingRefreshReveal = false;
    this.pendingRefreshImmediate = false;
    this.pendingRefreshTransition = false;
    this.activeRevealFrame = null;
    this.activeRevealTimers = [];
    this.activeRevealRunId = 0;
    this.interactionLockUntil = 0;
    this.activitySaveTimer = null;
    this.saveQueue = Promise.resolve();
    this.todayPathSetCache = null;
    this.frequentPathSetCache = null;
    this.pinnedPathSetCache = null;
    this.magnetRankingCache = null;
    this.magnetRankingCacheKey = "";
    this.runtimeStarted = false;
    this.observer = null;
    this.enabledDocuments = new Set();
    // Every feature requires activation; the runtime starts only after the license passes.
    this.licensed = false;
    this.layoutReady = false;
    this.licenseCheckSeq = 0;
    await this.loadSettings();
    this.explorerOrder = new CrispExplorerOrder(this);
    crispRegisterIcons();
    this.addSettingTab(new CrispFileExplorerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      if (this.unloading) return;
      this.refreshLicense({ online: true, notify: true }).catch((error) => {
        console.debug("Crisp File Explorer license check failed", error);
      });
    });

    this.addCommand({
      id: "toggle-dual-pane",
      name: "切换轻量双栏浏览",
      callback: () => this.requireLicense(() => this.setDualPaneEnabled(!this.settings.dualPaneEnabled)),
    });

    this.addCommand({
      id: "toggle-folder-marks",
      name: "切换文件夹刻度",
      callback: () => this.requireLicense(async () => {
        this.settings.includeFolders = !this.settings.includeFolders;
        await this.saveSettings();
        this.scheduleRefresh();
      }),
    });

    this.addCommand({
      id: "toggle-tick-sound",
      name: "切换拖动音效",
      callback: () => this.requireLicense(async () => {
        this.settings.soundEnabled = !this.settings.soundEnabled;
        await this.saveSettings();
      }),
    });

  }

  requireLicense(action) {
    if (!this.licensed) {
      new Notice("🔒 Crisp File Explorer 未激活，请在插件设置中输入授权码");
      return undefined;
    }
    return action();
  }

  // Local signature check decides immediately; the online device check (cached 15 min)
  // can still revoke it. Network outages keep the local result, as before.
  async refreshLicense({ online = true, notify = false } = {}) {
    const seq = ++this.licenseCheckSeq;
    const code = this.settings.licenseCode;
    const local = code
      ? await verifyLicenseCode(code, LICENSE_PLUGIN_ID, true)
      : { valid: false, reason: "授权码为空" };
    if (this.unloading || seq !== this.licenseCheckSeq) return local;
    if (!local.valid) {
      this.setLicensed(false);
      if (notify) new Notice(`🔒 Crisp File Explorer 未激活（${local.reason}），请在插件设置中输入授权码`);
      return local;
    }
    this.setLicensed(true);
    if (!online) return local;

    const remote = await verifyLicenseCode(code, LICENSE_PLUGIN_ID);
    if (this.unloading || seq !== this.licenseCheckSeq) return remote;
    if (!remote.valid) {
      this.setLicensed(false);
      if (notify) new Notice(`🔒 Crisp File Explorer 授权未通过（${remote.reason}）`);
    }
    return remote;
  }

  setLicensed(next) {
    const licensed = Boolean(next);
    if (this.licensed === licensed) return;
    this.licensed = licensed;
    if (!licensed) {
      this.teardownViews();
      return;
    }
    this.enableDocument(getOwnerDocument(this.app.workspace.containerEl));
    if (!this.layoutReady || this.unloading) return;
    if (this.runtimeStarted) {
      this.scheduleRefresh({ immediate: true, reveal: true });
      this.explorerOrder.sync();
      this.explorerOrder.requestSort();
    } else this.startRuntime();
  }

  teardownViews() {
    if (this.refreshFrame) cancelAnimationFrame(this.refreshFrame);
    this.refreshFrame = null;
    this.refreshQueued = false;
    this.pendingRefreshReveal = false;
    this.pendingRefreshImmediate = false;
    this.pendingRefreshTransition = false;
    this.activeRevealRunId += 1;
    this.cancelActiveRevealFrame();
    this.clearActiveRevealTimers();
    for (const ownerDocument of this.enabledDocuments || []) {
      if (ownerDocument && ownerDocument.body) {
        ownerDocument.body.classList.remove("crisp-file-explorer-enabled");
      }
    }
    this.enabledDocuments?.clear();
    for (const controller of this.controllers?.values() || []) controller.destroy();
    this.controllers?.clear();
    for (const browser of this.folderBrowsers?.values() || []) browser.destroy();
    this.folderBrowsers?.clear();
    if (this.explorerOrder && !this.explorerOrder.destroyed) {
      this.explorerOrder.detachAll();
      this.explorerOrder.sortNow();
    }
  }

  async setDualPaneEnabled(enabled) {
    this.settings.dualPaneEnabled = Boolean(enabled);
    this.activeRevealRunId += 1;
    this.cancelActiveRevealFrame();
    this.clearActiveRevealTimers();
    for (const browser of this.folderBrowsers.values()) browser.refresh();
    this.scheduleRefresh({ immediate: true });
    await this.saveSettings();
  }

  getOpenMarkdownPaths() {
    const leaves = this.app && this.app.workspace && typeof this.app.workspace.getLeavesOfType === "function"
      ? this.app.workspace.getLeavesOfType("markdown")
      : [];
    const paths = new Set();
    for (const leaf of leaves) {
      const p = leaf && leaf.view && leaf.view.file && leaf.view.file.path;
      if (p) paths.add(p);
    }
    return paths;
  }

  startRuntime() {
    if (this.runtimeStarted || this.unloading || !this.licensed) return;
    this.runtimeStarted = true;
    this.openMarkdownPaths = this.getOpenMarkdownPaths();
    this.enhanceFileExplorers();
    this.scheduleRefresh({ immediate: true, reveal: true });

    for (const delay of [60, 180, 450, 900]) {
      window.setTimeout(() => {
        if (!this.unloading) this.scheduleRefresh({ immediate: true, reveal: true });
      }, delay);
    }

    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.openMarkdownPaths = this.getOpenMarkdownPaths();
      this.scheduleRefresh();
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      const activeFile = this.app && this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null;
      const isAlreadyOpen = Boolean(
        activeFile && activeFile.path && this.openMarkdownPaths && this.openMarkdownPaths.has(activeFile.path)
      );
      this.openMarkdownPaths = this.getOpenMarkdownPaths();
      this.scheduleRefresh();
      if (this.isMarkdownActiveLeaf()) {
        this.scheduleActiveReveal({ transition: !isAlreadyOpen });
      }
    }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.recordFileActivity(file);
      const isAlreadyOpen = Boolean(
        file && file.path && this.openMarkdownPaths && this.openMarkdownPaths.has(file.path)
      );
      if (file && file.path) {
        if (!this.openMarkdownPaths) this.openMarkdownPaths = new Set();
        this.openMarkdownPaths.add(file.path);
      }
      const transition = !isAlreadyOpen;
      if (file && (file.extension === "md" || file.extension === "canvas")) {
        this.scheduleActiveReveal({ transition });
      } else {
        this.scheduleRefresh({ transition });
      }
    }));
    for (const kind of ["create", "delete", "rename", "modify"]) {
      this.registerEvent(this.app.vault.on(kind, (file, oldPath) => {
        for (const browser of this.folderBrowsers.values()) browser.onVaultChange(kind, file, oldPath);
      }));
    }
    this.registerEvent(this.app.workspace.on("window-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("window-close", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.rewriteActivityPath(oldPath, file && file.path);
      this.explorerOrder.onRename(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.rewriteActivityPath(file && file.path, null);
      this.explorerOrder.onDelete(file);
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      this.addCrispRailMenuItem(menu, file);
      this.explorerOrder.addMenuItems(menu, file);
    }));
    this.registerInterval(window.setInterval(() => this.explorerOrder.sync(), ORDER_SYNC_INTERVAL_MS));
    this.explorerOrder.sync();
    this.registerDomEvent(window, "resize", () => this.scheduleRefresh(), { passive: true });

    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(this.app.workspace.containerEl, {
      childList: true,
      subtree: false,
    });
    this.register(() => {
      if (this.observer) this.observer.disconnect();
    });
  }

  onunload() {
    this.unloading = true;
    const pendingOrderSave = this.explorerOrder && this.explorerOrder.destroy();
    if (pendingOrderSave) pendingOrderSave.catch((error) => console.debug("Crisp File Explorer final order save failed", error));
    const pendingSave = this.flushActivitySave();
    if (pendingSave) pendingSave.catch((error) => console.debug("Crisp File Explorer final save failed", error));
    this.audio.destroy().catch((error) => console.debug("Crisp File Explorer audio cleanup failed", error));
    this.teardownViews();
  }

  async loadSettings() {
    const data = await this.loadData();
    // loadData() returns undefined (not null) when data.json exists but cannot be parsed.
    // Keep a copy before the first save overwrites it with defaults.
    if (data === undefined) await this.backupUnreadableData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.settings.orbStyle = normalizeOrbStyle(this.settings.orbStyle);
    this.settings.soundStyle = normalizeSoundStyle(this.settings.soundStyle);
    this.settings.activity = normalizeActivity(this.settings.activity);
    this.settings.explorerOrder = normalizeExplorerOrder(this.settings.explorerOrder);
    this.ensureTodayActivity();
  }

  async backupUnreadableData() {
    try {
      const adapter = this.app.vault.adapter;
      const dataPath = normalizePath(`${this.manifest.dir}/data.json`);
      if (!(await adapter.exists(dataPath))) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = normalizePath(`${this.manifest.dir}/data.json.unreadable-${stamp}`);
      await adapter.write(backupPath, await adapter.read(dataPath));
      new Notice(`Crisp File Explorer 设置文件无法读取，已恢复默认设置。原文件已备份为 ${backupPath.split("/").pop()}`);
    } catch (error) {
      // Without a copy, saving would replace the only remaining version of the file.
      this.dataWriteBlocked = true;
      console.error("Crisp File Explorer could not back up unreadable data.json", error);
      new Notice("Crisp File Explorer 设置文件无法读取，也无法备份。为保护原文件，本次运行不会保存设置和活动记录。", 0);
    }
  }

  // Obsidian's saveData() swallows write errors, so read data.json back before trusting a save.
  async verifySavedData(snapshot) {
    const adapter = this.app?.vault?.adapter;
    if (!this.manifest?.dir || typeof adapter?.read !== "function") return;
    const onDisk = JSON.stringify(JSON.parse(await adapter.read(normalizePath(`${this.manifest.dir}/data.json`))));
    if (onDisk !== JSON.stringify(snapshot)) throw new Error("data.json was not written: its contents differ from the saved data");
  }

  saveSettings() {
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    const previous = this.saveQueue || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (this.dataWriteBlocked) return;
      try {
        await this.saveData(snapshot);
        await this.verifySavedData(snapshot);
        this.saveFailed = false;
      } catch (error) {
        console.error("Crisp File Explorer could not save data.json", error);
        if (!this.saveFailed) new Notice("Crisp File Explorer：设置或活动记录没有写入磁盘，下次变化时会再试。");
        this.saveFailed = true;
      }
    });
    this.saveQueue = next;
    return next;
  }

  ensureTodayActivity() {
    const todayKey = getLocalDateKey();
    if (!this.settings.activity || typeof this.settings.activity !== "object") {
      this.settings.activity = normalizeActivity(this.settings.activity);
    }
    if (this.settings.activity.todayKey !== todayKey) {
      this.settings.activity.todayKey = todayKey;
      this.settings.activity.todayPaths = [];
      this.invalidateActivityCaches();
    }
  }

  invalidateActivityCaches() {
    this.todayPathSetCache = null;
    this.frequentPathSetCache = null;
    this.pinnedPathSetCache = null;
    this.magnetRankingCache = null;
    this.magnetRankingCacheKey = "";
  }

  addCrispRailMenuItem(menu, file) {
    if (this.licensed === false || !menu || typeof menu.addItem !== "function" || !file || !file.path || Array.isArray(file.children)) return;
    const pinned = normalizeActivity(this.settings && this.settings.activity).pinnedPaths.includes(file.path);
    menu.addItem((item) => {
      item
        .setTitle(pinned ? "从 Crisp Rail 取消固定" : "固定到 Crisp Rail")
        .setIcon(pinned ? "pin-off" : "pin")
        .onClick(async () => {
          const result = await this.togglePinnedPath(file.path);
          if (!result.changed) {
            new Notice(`Crisp Rail 最多固定 ${SMART_MAGNET_LIMIT} 个文件`);
            return;
          }
          new Notice(result.pinned ? "已固定到 Crisp Rail" : "已从 Crisp Rail 取消固定");
        });
    });
  }

  async togglePinnedPath(path) {
    if (!path) return { changed: false, pinned: false };
    const activity = normalizeActivity(this.settings.activity);
    const pinnedPaths = activity.pinnedPaths.slice();
    const index = pinnedPaths.indexOf(path);
    let pinned = false;

    if (index >= 0) {
      pinnedPaths.splice(index, 1);
    } else {
      if (pinnedPaths.length >= SMART_MAGNET_LIMIT) {
        return { changed: false, pinned: false, limitReached: true };
      }
      pinnedPaths.push(path);
      pinned = true;
    }

    this.settings.activity = normalizeActivity({ ...activity, pinnedPaths });
    this.invalidateActivityCaches();
    await this.saveSettings();
    this.scheduleRefresh();
    return { changed: true, pinned };
  }

  rewriteActivityPath(oldPath, newPath) {
    const previous = this.settings.activity;
    const next = rewriteActivityPaths(previous, oldPath, newPath);
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    this.settings.activity = next;
    this.invalidateActivityCaches();
    this.scheduleActivitySave();
    this.scheduleRefresh();
  }

  recordFileActivity(file) {
    if (!file || !file.path || this.licensed === false) return;

    this.ensureTodayActivity();
    const path = file.path;
    const activity = this.settings.activity;
    const isNewPath = !activity.fileStats[path];
    const stat = activity.fileStats[path] || { count: 0, lastOpened: 0 };
    activity.fileStats[path] = {
      count: (Number(stat.count) || 0) + 1,
      lastOpened: Date.now(),
    };
    if (isNewPath && Object.keys(activity.fileStats).length > FILE_STATS_LIMIT) {
      activity.fileStats = pruneFileStats(activity.fileStats);
    }

    activity.todayPaths = activity.todayPaths.filter((current) => current !== path);
    activity.todayPaths.push(path);
    activity.todayPaths = activity.todayPaths.slice(-TODAY_TRAIL_LIMIT);
    this.invalidateActivityCaches();

    this.scheduleActivitySave();
    this.scheduleRefresh();
  }

  scheduleActivitySave() {
    if (this.activitySaveTimer) window.clearTimeout(this.activitySaveTimer);
    this.activitySaveTimer = window.setTimeout(async () => {
      this.activitySaveTimer = null;
      try {
        await this.saveSettings();
      } catch (error) {
        console.debug("Crisp File Explorer activity save failed", error);
      }
    }, ACTIVITY_SAVE_DELAY_MS);
  }

  flushActivitySave() {
    if (!this.activitySaveTimer) return null;
    window.clearTimeout(this.activitySaveTimer);
    this.activitySaveTimer = null;
    return this.saveSettings();
  }

  getTodayPathSet() {
    if (!this.settings.todayTrailEnabled) return new Set();
    this.ensureTodayActivity();
    if (!this.todayPathSetCache) {
      this.todayPathSetCache = new Set(this.settings.activity.todayPaths);
    }
    return this.todayPathSetCache;
  }

  getFrequentPathSet() {
    if (!this.settings.frequentMagnetsEnabled) return new Set();
    if (!this.frequentPathSetCache) {
      this.frequentPathSetCache = new Set(this.getFrequentPaths());
    }
    return this.frequentPathSetCache;
  }

  getPinnedPathSet() {
    if (!this.settings.frequentMagnetsEnabled) return new Set();
    if (!this.pinnedPathSetCache) {
      this.pinnedPathSetCache = new Set(this.getMagnetRanking().pinnedPaths);
    }
    return this.pinnedPathSetCache;
  }

  getMagnetRanking(now = Date.now()) {
    const cacheKey = getLocalDateKey(new Date(now));
    if (!this.magnetRankingCache || this.magnetRankingCacheKey !== cacheKey) {
      this.magnetRankingCache = rankSmartMagnetPaths(this.settings.activity, now);
      this.magnetRankingCacheKey = cacheKey;
    }
    return this.magnetRankingCache;
  }

  getFrequentPaths() {
    if (!this.settings.frequentMagnetsEnabled) return [];
    return this.getMagnetRanking().recommendedPaths;
  }

  expandFolderInExplorers(folderPath) {
    if (!folderPath) return false;
    const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType("file-explorer") : [];
    let didExpand = false;
    for (const browser of this.folderBrowsers?.values() || []) {
      if (browser.enabled) didExpand = browser.toggleFolder(folderPath, true) || didExpand;
    }

    for (const leaf of leaves) {
      const view = leaf.view;
      const folderItem = view && view.fileItems && view.fileItems[folderPath];
      if (!folderItem || typeof folderItem.setCollapsed !== "function") continue;

      const wasCollapsed = folderItem.collapsed !== false;
      // No slide animation: mid-animation the new rows are laid out before the
      // rows below move, and the rail would measure both on top of each other.
      if (wasCollapsed) folderItem.setCollapsed(false, false);
      didExpand = didExpand || wasCollapsed;
    }

    return didExpand;
  }

  getResourceUrl(relativePath) {
    return this.app.vault.adapter.getResourcePath(normalizePath(`${this.manifest.dir}/${relativePath}`));
  }

  enableDocument(ownerDocument) {
    if (!ownerDocument || !ownerDocument.body || !ownerDocument.body.classList) return;
    if (!ownerDocument.body.classList.contains("crisp-file-explorer-enabled")) {
      ownerDocument.body.classList.add("crisp-file-explorer-enabled");
    }
    if (!this.enabledDocuments) this.enabledDocuments = new Set();
    this.enabledDocuments.add(ownerDocument);
  }

  // Companion plugins need the resolved sound, not the "matchOrb" setting token.
  getResolvedSoundStyle(ownerDocument) {
    const mainDocument = this.app.workspace.containerEl.ownerDocument;
    const orb = ownerDocument?.querySelector(".crisp-fe-orb[data-orb-style]")
      || mainDocument.querySelector(".crisp-fe-orb[data-orb-style]");
    return resolveSoundStyle(
      this.settings.soundStyle,
      orb?.dataset.orbStyle || resolveOrbStyle(this.settings.orbStyle),
    );
  }

  updateOrbStyles() {
    for (const controller of this.controllers.values()) {
      controller.updateOrbStyle();
      controller.requestFrame();
    }
    for (const browser of this.folderBrowsers?.values() || []) {
      const rail = browser.rail;
      if (!rail || typeof rail.updateOrbStyle !== "function") continue;
      rail.updateOrbStyle();
      rail.requestFrame();
    }
  }

  lockInteraction(duration = INTERACTION_LOCK_MS) {
    this.interactionLockUntil = performance.now() + duration;
  }

  isInteractionLocked() {
    return performance.now() < this.interactionLockUntil;
  }

  clearActiveRevealTimers() {
    for (const timer of this.activeRevealTimers || []) {
      window.clearTimeout(timer);
    }
    this.activeRevealTimers = [];
  }

  cancelActiveRevealFrame() {
    if (this.activeRevealFrame) cancelAnimationFrame(this.activeRevealFrame);
    this.activeRevealFrame = null;
  }

  runActiveRevealAttempt(runId, options = {}) {
    if (runId !== this.activeRevealRunId) return false;
    const didReveal = this.revealActiveFileInExplorer();
    if (didReveal) {
      this.cancelActiveRevealFrame();
      this.clearActiveRevealTimers();
    }
    this.scheduleRefresh({
      ...(didReveal ? { reveal: true } : {}),
      ...options,
    });
    return didReveal;
  }

  isActiveFileVisibleInExplorers(file) {
    if (!file || !file.path || !this.app || !this.app.workspace) return false;
    const leaves = typeof this.app.workspace.getLeavesOfType === "function"
      ? this.app.workspace.getLeavesOfType("file-explorer")
      : [];
    for (const leaf of leaves) {
      const view = leaf && leaf.view;
      if (!view || !view.fileItems) continue;
      const fileItem = view.fileItems[file.path];
      const itemEl = this.getFileItemElement(fileItem);
      if (itemEl && itemEl.isConnected) {
        const rect = typeof itemEl.getBoundingClientRect === "function" ? itemEl.getBoundingClientRect() : null;
        const containerRect = view.containerEl && typeof view.containerEl.getBoundingClientRect === "function"
          ? view.containerEl.getBoundingClientRect()
          : null;
        if (rect && rect.height > 0 && containerRect) {
          if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
            return true;
          }
        }
      }
    }
    return false;
  }

  scheduleActiveReveal(options = {}) {
    if (this.unloading || this.licensed === false) return;
    if (this.isInteractionLocked()) {
      this.activeRevealRunId += 1;
      this.cancelActiveRevealFrame();
      this.clearActiveRevealTimers();
      this.scheduleRefresh(options);
      return;
    }

    if (!this.isMarkdownActiveLeaf()) {
      this.activeRevealRunId += 1;
      this.cancelActiveRevealFrame();
      this.clearActiveRevealTimers();
      this.scheduleRefresh(options);
      return;
    }

    const activeFile = this.app && this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
      ? this.app.workspace.getActiveFile()
      : null;
    if (activeFile && this.isActiveFileVisibleInExplorers(activeFile)) {
      this.activeRevealRunId += 1;
      this.cancelActiveRevealFrame();
      this.clearActiveRevealTimers();
      this.scheduleRefresh(options);
      return;
    }

    const runId = this.activeRevealRunId + 1;
    this.activeRevealRunId = runId;
    this.cancelActiveRevealFrame();
    this.clearActiveRevealTimers();

    this.activeRevealFrame = requestAnimationFrame(() => {
      this.activeRevealFrame = null;
      if (runId !== this.activeRevealRunId) return;
      this.runActiveRevealAttempt(runId, options);
    });

    for (const delay of ACTIVE_REVEAL_RETRY_DELAYS) {
      const timer = window.setTimeout(() => {
        this.activeRevealTimers = this.activeRevealTimers.filter((current) => current !== timer);
        this.runActiveRevealAttempt(runId, options);
      }, delay);
      this.activeRevealTimers.push(timer);
    }
  }

  revealActiveFileInExplorer() {
    if (this.settings.dualPaneEnabled) {
      for (const browser of this.folderBrowsers?.values() || []) if (browser.enabled) browser.refresh();
      return true;
    }
    if (this.isInteractionLocked()) return false;
    if (!this.isMarkdownActiveLeaf()) return false;

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return false;
    if (this.isActiveFileVisibleInExplorers(activeFile)) return false;

    const didReveal = this.revealFileExplorerItem(activeFile);
    if (didReveal) this.restoreMarkdownFocus();
    return didReveal;
  }

  isMarkdownActiveLeaf() {
    const leaf = this.app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    return Boolean(view && (typeof view.getViewType !== "function" || view.getViewType() === "markdown"));
  }

  restoreMarkdownFocus() {
    requestAnimationFrame(() => {
      if (this.unloading) return;
      const leaf = this.app.workspace.activeLeaf;
      const view = leaf && leaf.view;
      if (!view || (typeof view.getViewType === "function" && view.getViewType() !== "markdown")) return;

      if (leaf && typeof this.app.workspace.setActiveLeaf === "function") {
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      }

      if (view.editor && typeof view.editor.focus === "function") {
        view.editor.focus();
      } else if (view.containerEl && typeof view.containerEl.focus === "function") {
        view.containerEl.focus();
      }
    });
  }

  revealFileExplorerItem(file) {
    const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType("file-explorer") : [];
    let didReveal = false;

    for (const leaf of leaves) {
      const view = leaf.view;
      if (!view || !view.fileItems) continue;

      const parts = file.path.split("/");
      let folderPath = "";
      for (let index = 0; index < parts.length - 1; index += 1) {
        folderPath = folderPath ? `${folderPath}/${parts[index]}` : parts[index];
        const folderItem = view.fileItems[folderPath];
        if (
          folderItem
          && folderItem.collapsed !== false
          && typeof folderItem.setCollapsed === "function"
        ) {
          folderItem.setCollapsed(false, true);
        }
      }

      const fileItem = view.fileItems[file.path];
      const itemEl = this.getFileItemElement(fileItem);
      if (!itemEl || itemEl.isConnected === false) continue;
      const rect = typeof itemEl.getBoundingClientRect === "function"
        ? itemEl.getBoundingClientRect()
        : null;
      if (rect && rect.height === 0) continue;
      didReveal = true;
    }

    return didReveal;
  }

  getFileItemElement(fileItem) {
    if (!fileItem) return null;
    if (fileItem.selfEl) return fileItem.selfEl;
    if (fileItem.titleEl) return fileItem.titleEl;
    if (fileItem.el && typeof fileItem.el.querySelector === "function") {
      return fileItem.el.querySelector(".tree-item-self") || fileItem.el;
    }
    return fileItem.el || null;
  }

  scheduleRefresh(options = {}) {
    if (this.unloading || this.licensed === false) return;
    this.pendingRefreshReveal = this.pendingRefreshReveal || Boolean(options.reveal);
    this.pendingRefreshImmediate = this.pendingRefreshImmediate || Boolean(options.immediate);
    this.pendingRefreshTransition = this.pendingRefreshTransition || Boolean(options.transition);
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.refreshQueued = false;
      if (this.unloading) {
        this.pendingRefreshReveal = false;
        this.pendingRefreshImmediate = false;
        this.pendingRefreshTransition = false;
        return;
      }
      const reveal = this.pendingRefreshReveal;
      const immediate = this.pendingRefreshImmediate;
      const transition = this.pendingRefreshTransition;
      this.pendingRefreshReveal = false;
      this.pendingRefreshImmediate = false;
      this.pendingRefreshTransition = false;
      const createdControllers = this.enhanceFileExplorers();
      for (const controller of this.controllers.values()) {
        if (controller.enabled && !createdControllers.has(controller)) {
          controller.refresh({ reveal, immediate, transition });
        }
      }
    });
  }

  getFileExplorerContainers() {
    const containers = new Set();
    const leaves = typeof this.app.workspace.getLeavesOfType === "function"
      ? this.app.workspace.getLeavesOfType("file-explorer")
      : [];

    for (const leaf of leaves) {
      const viewRoot = leaf && leaf.view && leaf.view.containerEl;
      if (!viewRoot || typeof viewRoot.querySelectorAll !== "function") continue;
      for (const container of viewRoot.querySelectorAll(".nav-files-container")) {
        if (!container.classList?.contains("crisp-fe-folder-tree")) containers.add(container);
      }
    }

    const workspaceRoot = this.app.workspace.containerEl;
    if (workspaceRoot && typeof workspaceRoot.querySelectorAll === "function") {
      for (const container of workspaceRoot.querySelectorAll(
        '.workspace-leaf-content[data-type="file-explorer"] .nav-files-container'
      )) {
        if (!container.classList?.contains("crisp-fe-folder-tree")) containers.add(container);
      }
    }
    return containers;
  }

  enhanceFileExplorers() {
    const createdControllers = new Set();
    if (this.unloading || this.licensed === false) return createdControllers;
    const containers = this.getFileExplorerContainers();

    if (!this.folderBrowsers) this.folderBrowsers = new Map();
    for (const container of containers) {
      if (container.closest?.('.workspace-leaf-content[data-type="file-explorer"]')) {
        if (!this.folderBrowsers.has(container)) this.folderBrowsers.set(container, new CrispFolderBrowser(this, container));
        else this.folderBrowsers.get(container).refresh();
      }
      this.enableDocument(getOwnerDocument(container));
      this.explorerOrder?.attach(container);
      if (!this.controllers.has(container)) {
        const controller = new FileExplorerRail(this, container);
        this.controllers.set(container, controller);
        createdControllers.add(controller);
      } else {
        this.controllers.get(container).syncOwnerContext();
      }
    }

    for (const [container, controller] of Array.from(this.controllers.entries())) {
      if (!containers.has(container) || !isConnectedToOwnerDocument(container)) {
        controller.destroy();
        this.controllers.delete(container);
      } else if (!controller.enabled) {
        controller.setEnabled(controller.isVisible());
      }
    }

    for (const [container, browser] of this.folderBrowsers) {
      if (!containers.has(container) || !isConnectedToOwnerDocument(container)) {
        browser.destroy();
        this.folderBrowsers.delete(container);
      }
    }
    this.explorerOrder?.detachMissing(containers);

    const activeDocuments = new Set(Array.from(containers, (container) => getOwnerDocument(container)));
    activeDocuments.add(getOwnerDocument(this.app.workspace.containerEl));
    for (const ownerDocument of this.enabledDocuments || []) {
      if (activeDocuments.has(ownerDocument)) continue;
      if (ownerDocument && ownerDocument.body) {
        ownerDocument.body.classList.remove("crisp-file-explorer-enabled");
      }
      this.enabledDocuments.delete(ownerDocument);
    }
    return createdControllers;
  }
}

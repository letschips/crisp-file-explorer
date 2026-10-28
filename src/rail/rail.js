import { DOT_SIZE, LINE_WIDTH, BULGE_SIGMA, DYNAMIC_RENDER_RADIUS, MAX_FRAME_DT, SCROLL_REVEAL_MARGIN, TICK_SIDE_HYSTERESIS, RAIL_LINE_PADDING, DEFAULT_RAIL_X, RAIL_FOCUS_HEIGHT, ORB_ROTATION_PER_PX, DRAG_SCROLL_EDGE_MARGIN, DRAG_SCROLL_MAX_STEP, MAGNET_RADIUS, MAGNET_STRENGTH, SMART_MAGNET_LIMIT, FOLDER_AUTO_EXPAND_DELAY_MS, SPRING } from "../constants.js";
import { getOwnerDocument, getOwnerWindow, isConnectedToOwnerDocument, requestOwnerFrame, cancelOwnerFrame, setOwnerTimeout, clearOwnerTimeout } from "../dom/owner-window.js";
import { ORB_SVGS, ORB_IMAGE_DATA_URLS } from "../orb/assets.generated.js";
import { STATIC_ORB_STYLES, resolveOrbStyle, resolveSoundStyle } from "../orb/styles.js";
import { prefersReducedMotion, clamp, mix, morphProgress, gaussianInfluence, waveOffset, stepSpring, nearestIndex, indexRangeAround, getTickBaseWidth, mutationTouchesFileTree, buildTickMarks, fitTickToContent, labelShiftFor, tickContentLeft, findTreeContent, measureRowContentLeft, readRailX, hasStableTickTopology, reconcileMeasuredItemMotion, dispatchMouseSequence, findVisibleAncestorItem, resolveOrbTarget } from "./geometry.js";

export class FileExplorerRail {
  constructor(plugin, container) {
    this.plugin = plugin;
    this.container = container;
    this.ownerDocument = getOwnerDocument(container);
    this.ownerWindow = getOwnerWindow(container);
    this.items = [];
    this.magnetItems = [];
    this.tickMarks = [];
    this.tickEls = [];
    this.dynamicTickRange = [0, -1];
    this.dynamicItemRange = [0, -1];
    this.nearestTickIndex = -1;
    this.visualActiveIndex = -1;
    this.frame = null;
    this.displayY = 0;
    this.targetY = 0;
    this.velocity = 0;
    this.orbRotation = 0;
    this.hasOrbPosition = false;
    this.lastRenderViewportY = undefined;
    this.lastLineFocusTransform = "";
    this.lastFrameTime = undefined;
    this.isDragging = false;
    this.dragPointerId = null;
    this.dragOwnerWindow = null;
    this.dragScrollFrame = null;
    this.dragPointerViewportY = 0;
    this.lastDragIndex = -1;
    this.autoExpandTimer = null;
    this.autoExpandFolderPath = null;
    this.autoExpandedFolderPaths = new Set();
    this.measureFrame = null;
    this.measureQueued = false;
    this.pendingReveal = false;
    this.pendingImmediate = false;
    this.pendingTransition = false;
    this.transitionTimer = null;
    this.transitionOwnerWindow = null;
    this.transitionTargetY = undefined;
    this.tickSideMap = new Map();
    this.destroyed = false;
    this.enabled = true;
    this.mutationDebounceTimer = null;
    this.createObservers();
    this.onScroll = () => this.handleScroll();
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onWindowBlur = () => this.handleWindowBlur();

    this.rail = this.ownerDocument.createElement("div");
    this.rail.className = "crisp-fe-rail";
    this.rail.setAttribute("aria-hidden", "true");

    this.line = this.ownerDocument.createElement("div");
    this.line.className = "crisp-fe-line";

    this.lineFocus = this.ownerDocument.createElement("div");
    this.lineFocus.className = "crisp-fe-line-focus";
    this.line.appendChild(this.lineFocus);

    this.orb = this.ownerDocument.createElement("div");
    this.orb.className = "crisp-fe-orb";
    this.orb.tabIndex = -1;
    this.orb.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.updateOrbStyle();

    this.ticks = this.ownerDocument.createElement("div");
    this.ticks.className = "crisp-fe-ticks";
    this.rail.appendChild(this.line);
    this.rail.appendChild(this.ticks);
    this.rail.appendChild(this.orb);

    this.container.classList.add("crisp-fe-container");
    this.container.appendChild(this.rail);
    this.container.addEventListener("scroll", this.onScroll, { passive: true });
    this.resizeObserver.observe(this.container);
    this.syncContentObservation();
    this.mutationObserver.observe(this.container, { childList: true, subtree: true });

    this.setEnabled(this.isVisible());
    this.refresh({ reveal: true, immediate: true });
  }

  // Row heights can change without the scroll box resizing (a row gains a
  // style, a stylesheet loads late). The tree content box resizes with them,
  // so it is observed too and re-attached when Obsidian replaces it.
  syncContentObservation() {
    const content = findTreeContent(this.container);
    if (content === this.observedContent) return;
    if (this.observedContent) this.resizeObserver.unobserve(this.observedContent);
    this.observedContent = content;
    if (content) this.resizeObserver.observe(content);
  }

  createObservers() {
    const ResizeObserverClass = this.ownerWindow && this.ownerWindow.ResizeObserver
      ? this.ownerWindow.ResizeObserver
      : ResizeObserver;
    const MutationObserverClass = this.ownerWindow && this.ownerWindow.MutationObserver
      ? this.ownerWindow.MutationObserver
      : MutationObserver;
    this.resizeObserver = new ResizeObserverClass(() => {
      if (!this.enabled && this.isVisible()) {
        this.setEnabled(true);
      }
      this.scheduleRefresh();
    });
    this.mutationObserver = new MutationObserverClass((mutations) => {
      if (!this.enabled && this.isVisible()) {
        this.setEnabled(true);
      }
      if (mutationTouchesFileTree(mutations)) {
        clearOwnerTimeout(this.container, this.mutationDebounceTimer);
        this.mutationDebounceTimer = setOwnerTimeout(this.container, () => {
          this.mutationDebounceTimer = null;
          this.scheduleRefresh();
        }, 80);
      }
    });
  }

  syncOwnerContext() {
    const nextDocument = getOwnerDocument(this.container);
    const nextWindow = getOwnerWindow(this.container);
    if (nextDocument === this.ownerDocument && nextWindow === this.ownerWindow) return false;

    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.ownerDocument = nextDocument;
    this.ownerWindow = nextWindow;
    this.createObservers();
    this.observedContent = null;
    this.resizeObserver.observe(this.container);
    this.mutationObserver.observe(this.container, { childList: true, subtree: true });
    this.plugin.enableDocument(this.ownerDocument);
    return true;
  }

  updateOrbStyle() {
    const style = resolveOrbStyle(this.plugin.settings.orbStyle);
    this.orb.dataset.orbStyle = style;
    this.orb.empty();
    this.lastRenderViewportY = this.displayY - this.container.scrollTop;

    const imageDataUrl = ORB_IMAGE_DATA_URLS[style];
    if (imageDataUrl) {
      const ownerDocument = getOwnerDocument(this.container);
      const spinner = ownerDocument.createElement("span");
      spinner.className = "crisp-fe-orb-ball crisp-fe-orb-spinner";
      const img = ownerDocument.createElement("img");
      img.className = "crisp-fe-orb-image";
      img.alt = "";
      img.draggable = false;
      img.src = imageDataUrl;
      img.addEventListener("error", () => {
        if (this.orbBall !== spinner) return;
        this.orb.empty();
        this.orb.dataset.orbStyle = "default";
        this.orbBall = null;
        this.requestFrame();
      }, { once: true });
      spinner.appendChild(img);
      this.orb.appendChild(spinner);
      this.orbBall = spinner;
      return;
    }

    this.orb.innerHTML = ORB_SVGS[style] || "";
    this.orbBall = this.orb.querySelector(".crisp-fe-orb-ball");
  }

  destroy() {
    this.destroyed = true;
    this.clearColdOpenTransition();
    cancelOwnerFrame(this.container, this.frame);
    cancelOwnerFrame(this.container, this.measureFrame);
    cancelOwnerFrame(this.container, this.dragScrollFrame);
    this.clearAutoExpandTimer();
    this.frame = null;
    this.measureFrame = null;
    this.dragScrollFrame = null;
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    this.container.removeEventListener("scroll", this.onScroll);
    if (this.mutationDebounceTimer) {
      clearOwnerTimeout(this.container, this.mutationDebounceTimer);
      this.mutationDebounceTimer = null;
    }
    
    // 使用统一的清理方法，确保完全移除
    this.releasePointerCapture();
    this.cleanupDragListeners();

    for (const item of this.items) {
      this.resetItem(item.el);
    }

    this.rail.remove();
    this.container.classList.remove("crisp-fe-container", "crisp-fe-container-active", "crisp-fe-is-dragging");
  }

  isVisible() {
    if (!isConnectedToOwnerDocument(this.container)) return false;

    const leafContent = this.container.closest('.workspace-leaf-content[data-type="file-explorer"]');
    if (!leafContent) return false;

    if (typeof this.container.checkVisibility === "function") {
      try {
        if (!this.container.checkVisibility({ checkVisibilityCSS: true })) return false;
      } catch (error) {
        if (!this.container.checkVisibility()) return false;
      }
    }

    const ownerWindow = getOwnerWindow(this.container);
    const containerStyle = ownerWindow.getComputedStyle(this.container);
    const leafStyle = ownerWindow.getComputedStyle(leafContent);
    if (
      containerStyle.display === "none"
      || containerStyle.visibility === "hidden"
      || leafStyle.display === "none"
      || leafStyle.visibility === "hidden"
    ) {
      return false;
    }

    const containerRect = this.container.getBoundingClientRect();
    const leafRect = leafContent.getBoundingClientRect();
    return containerRect.width > 0
      && containerRect.height > 0
      && leafRect.width > 0
      && leafRect.height > 0;
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    this.enabled = next;
    this.rail.hidden = !next;
    this.container.classList.toggle("crisp-fe-container-active", next);

    if (!next) {
      this.clearColdOpenTransition();
      cancelOwnerFrame(this.container, this.frame);
      cancelOwnerFrame(this.container, this.measureFrame);
      cancelOwnerFrame(this.container, this.dragScrollFrame);
      this.clearAutoExpandTimer();
      this.frame = null;
      this.measureFrame = null;
      this.dragScrollFrame = null;
      this.measureQueued = false;
      this.pendingReveal = false;
      this.pendingImmediate = false;
      this.pendingTransition = false;
      this.lastFrameTime = undefined;
      this.releasePointerCapture();
      this.setDragging(false);
      this.dragPointerId = null;
      this.cleanupDragListeners();
      this.tickSideMap.clear();
      this.autoExpandedFolderPaths.clear();
      // Clear the painted state before discarding its range. A hidden tree
      // can keep the same rows while its active target moves elsewhere.
      const [tickStart, tickEnd] = this.dynamicTickRange || [0, -1];
      for (let index = tickStart; index <= tickEnd; index += 1) {
        const tick = this.tickMarks[index];
        const el = this.tickEls[index];
        if (!tick || !el) continue;
        el.classList.remove("is-line", "is-nearest");
        el.style.opacity = "";
        const transform = `translate(0px, -50%) scaleX(${getTickBaseWidth(tick) / LINE_WIDTH})`;
        el.style.transform = transform;
        tick.renderedTransform = transform;
      }
      const [dynamicStart, dynamicEnd] = this.dynamicItemRange || [0, -1];
      for (let index = dynamicStart; index <= dynamicEnd; index += 1) {
        const item = this.items[index];
        if (!item) continue;
        item.el.style.removeProperty("translate");
        item.renderedX = undefined;
      }
      this.dynamicTickRange = [0, -1];
      this.dynamicItemRange = [0, -1];
      this.nearestTickIndex = -1;
      this.visualActiveIndex = -1;
    }
  }

  clearColdOpenTransition() {
    if (this.transitionTimer) {
      const ownerWindow = this.transitionOwnerWindow;
      if (ownerWindow && typeof ownerWindow.clearTimeout === "function") {
        ownerWindow.clearTimeout(this.transitionTimer);
      } else {
        clearTimeout(this.transitionTimer);
      }
    }
    this.transitionTimer = null;
    this.transitionOwnerWindow = null;
    this.transitionTargetY = undefined;
    if (this.orb && this.orb.style) this.orb.style.transition = "";
    if (this.lineFocus && this.lineFocus.style) this.lineFocus.style.transition = "";
  }

  resetItem(el) {
    el.classList.remove("crisp-fe-item", "crisp-fe-active", "crisp-fe-folder", "crisp-fe-file", "crisp-fe-magnet", "crisp-fe-today");
    el.style.removeProperty("translate");
  }

  handleScroll() {
    this.lastRenderViewportY = this.displayY - this.container.scrollTop;
    if (this.isDragging) this.scheduleDragScroll();
  }

  setDragging(active) {
    this.isDragging = Boolean(active);
    this.orb.classList.toggle("is-dragging", this.isDragging);
    this.container.classList.toggle("crisp-fe-is-dragging", this.isDragging);
  }

  cancelDragInteraction() {
    const hasPointer = this.dragPointerId !== null && this.dragPointerId !== undefined;
    const wasActive = this.isDragging || hasPointer;
    if (!wasActive) return false;
    this.setDragging(false);
    this.releasePointerCapture();
    this.dragPointerId = null;
    this.cancelDragScroll();
    this.clearAutoExpandTimer();
    this.cleanupDragListeners();
    this.autoExpandedFolderPaths.clear();
    this.velocity = 0;
    return true;
  }

  syncEmptyState(itemCount) {
    const isEmpty = itemCount === 0;
    this.rail.classList.toggle("is-empty", isEmpty);
    if (!isEmpty) return;
    if (this.isDragging) this.cancelDragInteraction();
    this.displayY = 0;
    this.targetY = 0;
    this.velocity = 0;
    this.hasOrbPosition = false;
    this.lastRenderViewportY = undefined;
  }

  scheduleRefresh(options = {}) {
    if (this.destroyed) return;
    if (!this.enabled) {
      if (this.isVisible()) {
        this.setEnabled(true);
      } else {
        return;
      }
    }
    this.pendingReveal = this.pendingReveal || Boolean(options.reveal);
    this.pendingImmediate = this.pendingImmediate || Boolean(options.immediate);
    this.pendingTransition = this.pendingTransition || Boolean(options.transition);
    if (this.measureQueued) return;

    this.measureQueued = true;
    this.measureFrame = requestOwnerFrame(this.container, () => {
      this.measureFrame = null;
      this.measureQueued = false;
      const reveal = this.pendingReveal;
      const immediate = this.pendingImmediate;
      const transition = this.pendingTransition;
      this.pendingReveal = false;
      this.pendingImmediate = false;
      this.pendingTransition = false;
      this.refresh({ reveal, immediate, transition });
    });
  }

  refresh(options = {}) {
    if (this.destroyed || !isConnectedToOwnerDocument(this.container)) return;
    this.syncOwnerContext();
    this.syncContentObservation();
    if (!this.isVisible()) {
      this.setEnabled(false);
      return;
    }
    this.setEnabled(true);
    const resolvedOrbStyle = resolveOrbStyle(this.plugin.settings.orbStyle);
    if (this.orb.dataset.orbStyle !== resolvedOrbStyle) this.updateOrbStyle();

    const previousItems = this.items;
    const previousTickMarks = this.tickMarks;
    const hadOrbPosition = this.hasOrbPosition;
    const previousViewportY = hadOrbPosition ? this.displayY - this.container.scrollTop : 0;
    const titles = Array.from(
      this.container.querySelectorAll(".nav-file-title, .nav-folder-title")
    ).filter((el) => !el.closest(".crisp-fe-rail"));

    const activeFile = this.plugin.app.workspace.getActiveFile();
    const navigationPath = this.container.dataset?.crispFolderPath;
    const folderBrowser = navigationPath !== undefined;
    const activePath = folderBrowser ? navigationPath : activeFile ? activeFile.path : null;
    const containerRect = this.container.getBoundingClientRect();
    const todayPaths = this.plugin.getTodayPathSet();
    const frequentPaths = this.plugin.getFrequentPathSet();
    const pinnedPaths = this.plugin.getPinnedPathSet();

    const candidates = [];
    for (const el of titles) {
      const isFolder = el.classList.contains("nav-folder-title");
      if (isFolder && !folderBrowser && !this.plugin.settings.includeFolders) {
        this.resetItem(el);
        continue;
      }
      candidates.push({ el, isFolder });
    }

    const rects = candidates.map(({ el }) => el.getBoundingClientRect());
    // Read where each row's content starts (chevron, else label) in the same
    // layout pass, minus any label shift currently applied, so bulging ticks
    // can stop short of it.
    const contentLefts = candidates.map(({ el }) => measureRowContentLeft(el, containerRect));
    this.railX = readRailX(this.container);
    const nextItems = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const { el, isFolder } = candidates[index];
      const rect = rects[index];
      if (rect.height === 0) continue;

      const path = el.getAttribute("data-path");
      const type = isFolder ? "folder" : "file";
      const active = (folderBrowser || type === "file") && path && path === activePath;
      const today = type === "file" && path && todayPaths.has(path);
      const pinned = type === "file" && path && pinnedPaths.has(path);
      const magnet = type === "file" && path && (pinned || frequentPaths.has(path));
      const center = rect.top - containerRect.top + this.container.scrollTop + rect.height / 2;

      const contentLeft = contentLefts[index];
      nextItems.push({ el, center, contentLeft, path, type, active, today, magnet, pinned, renderedX: undefined });
    }

    for (const item of nextItems) {
      if (!item.el.classList.contains("crisp-fe-item")) {
        item.el.classList.add("crisp-fe-item", item.type === "folder" ? "crisp-fe-folder" : "crisp-fe-file");
      }
      const isActive = Boolean(item.active);
      if (item.el.classList.contains("crisp-fe-active") !== isActive) {
        item.el.classList.toggle("crisp-fe-active", isActive);
      }
      const isToday = Boolean(item.today);
      if (item.el.classList.contains("crisp-fe-today") !== isToday) {
        item.el.classList.toggle("crisp-fe-today", isToday);
      }
      const isMagnet = Boolean(item.magnet);
      if (item.el.classList.contains("crisp-fe-magnet") !== isMagnet) {
        item.el.classList.toggle("crisp-fe-magnet", isMagnet);
      }
    }

    const nextEls = new Set(nextItems.map((item) => item.el));
    for (const item of previousItems) {
      if (!nextEls.has(item.el)) {
        this.resetItem(item.el);
      }
    }

    const nextTickMarks = buildTickMarks(nextItems, this.railX);
    const preserveTickMotion = hasStableTickTopology(
      previousItems,
      nextItems,
      previousTickMarks,
      nextTickMarks,
    );
    const nextDynamicItemRange = reconcileMeasuredItemMotion(
      previousItems,
      nextItems,
      this.dynamicItemRange,
      preserveTickMotion,
    );

    this.items = nextItems;
    this.magnetItems = nextItems.filter((item) => item.magnet).slice(0, SMART_MAGNET_LIMIT);
    this.visualActiveIndex = nextItems.findIndex((item) => item.active);
    this.dynamicItemRange = nextDynamicItemRange;
    if (!preserveTickMotion) {
      this.dynamicTickRange = [0, -1];
      this.nearestTickIndex = -1;
    }
    this.syncEmptyState(this.items.length);
    this.tickMarks = nextTickMarks;
    const railHeight = `${Math.max(this.container.scrollHeight, this.container.clientHeight)}px`;
    if (this.container.style.getPropertyValue("--crisp-fe-height") !== railHeight) {
      this.container.style.setProperty("--crisp-fe-height", railHeight);
    }
    this.updateRailLineBounds();
    this.syncTickElements({ preserveMotion: preserveTickMotion });

    if (this.syncDragPositionAfterMeasure()) {
      if (!preserveTickMotion) this.render();
      return;
    }

    const activeItem = this.visualActiveIndex >= 0 ? this.items[this.visualActiveIndex] : null;
    const activeTargetItem = activeItem || findVisibleAncestorItem(this.items, activePath);
    if (activeTargetItem && this.visualActiveIndex < 0) {
      this.visualActiveIndex = this.items.indexOf(activeTargetItem);
    }
    const hasCurrentPosition = hadOrbPosition;
    const currentPosition = this.targetY || this.displayY;
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    const clampedCurrentPosition = first && last
      ? clamp(currentPosition, first.center, last.center)
      : currentPosition;
    const nextTarget = resolveOrbTarget(
      this.items,
      activeTargetItem,
      hasCurrentPosition,
      clampedCurrentPosition
    );
    if (this.visualActiveIndex < 0 && this.items.length) {
      this.visualActiveIndex = nearestIndex(this.items, nextTarget);
    }
    if (activeItem && options.reveal) {
      this.ensureItemVisible(activeItem);
    }
    const shouldTransition = Boolean(
      options.transition &&
      hadOrbPosition &&
      !options.immediate &&
      !this.isDragging &&
      !prefersReducedMotion.matches &&
      Math.abs(this.displayY - nextTarget) > 1
    );

    const transitionTargetChanged = this.transitionTimer && (
      options.immediate
      || prefersReducedMotion.matches
      || this.isDragging
      || Math.abs((this.transitionTargetY ?? nextTarget) - nextTarget) > 1
    );
    if (transitionTargetChanged) this.clearColdOpenTransition();

    this.targetY = nextTarget;
    if (shouldTransition) {
      this.clearColdOpenTransition();
      const transitionStyle = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";
      if (this.orb && this.orb.style) this.orb.style.transition = transitionStyle;
      if (this.lineFocus && this.lineFocus.style) this.lineFocus.style.transition = transitionStyle;

      this.displayY = nextTarget;
      this.velocity = 0;

      const ownerWindow = getOwnerWindow(this.container);
      this.transitionOwnerWindow = ownerWindow;
      this.transitionTargetY = nextTarget;
      const timer = setOwnerTimeout(this.container, () => {
        if (this.transitionTimer !== timer) return;
        this.transitionTimer = null;
        this.transitionOwnerWindow = null;
        this.transitionTargetY = undefined;
        if (this.orb && this.orb.style) this.orb.style.transition = "";
        if (this.lineFocus && this.lineFocus.style) this.lineFocus.style.transition = "";
      }, 240);
      this.transitionTimer = timer;
    } else if (hadOrbPosition && !options.immediate && !this.isDragging && first && last) {
      this.displayY = clamp(this.container.scrollTop + previousViewportY, first.center, last.center);
    } else if (!hadOrbPosition) {
      this.displayY = nextTarget;
    }
    if (options.immediate || prefersReducedMotion.matches) {
      this.displayY = nextTarget;
      this.velocity = 0;
    }
    this.hasOrbPosition = Boolean(this.items.length);
    if (!preserveTickMotion) this.render();
    this.requestFrame();
  }

  updateRailLineBounds() {
    if (!this.items.length) {
      this.line.style.height = "0px";
      this.lastLineFocusTransform = "";
      return;
    }

    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    const top = Math.max(0, first.center - RAIL_LINE_PADDING);
    const bottom = Math.max(top, last.center + RAIL_LINE_PADDING);
    const height = Math.max(1, bottom - top);
    if (this.line.style.top !== `${top}px`) this.line.style.top = `${top}px`;
    if (this.line.style.height !== `${height}px`) this.line.style.height = `${height}px`;
    this.updateRailLineFocus();
  }

  syncTickElements(options = {}) {
    const preserveMotion = Boolean(options.preserveMotion);
    while (this.tickEls.length < this.tickMarks.length) {
      const ownerDocument = getOwnerDocument(this.container);
      const tick = ownerDocument.createElement("div");
      tick.className = "crisp-fe-tick";
      this.ticks.appendChild(tick);
      this.tickEls.push(tick);
    }

    while (this.tickEls.length > this.tickMarks.length) {
      const tick = this.tickEls.pop();
      tick.remove();
    }

    for (let index = 0; index < this.tickMarks.length; index += 1) {
      const mark = this.tickMarks[index];
      const el = this.tickEls[index];
      const top = `${mark.y}px`;
      if (el.style.top !== top) el.style.top = top;
      if (el.style.width !== `${LINE_WIDTH}px`) {
        el.style.width = `${LINE_WIDTH}px`;
      }
      if (!el.classList.contains("crisp-fe-tick")) el.classList.add("crisp-fe-tick");
      el.classList.toggle("is-long", mark.kind === "long");
      el.classList.toggle("is-short", mark.kind !== "long");
      el.classList.toggle("is-folder", mark.isFile === false);
      el.classList.toggle("is-file", mark.isFile !== false);
      el.classList.toggle("is-today", Boolean(mark.isToday));
      el.classList.toggle("is-magnet", Boolean(mark.isMagnet));
      el.classList.toggle("is-pinned", Boolean(mark.isPinned));

      const baseTransform = `translate(0px, -50%) scaleX(${getTickBaseWidth(mark) / LINE_WIDTH})`;
      if (!preserveMotion) {
        el.classList.remove("is-line", "is-nearest");
        if (el.style.opacity) el.style.opacity = "";
        this.tickSideMap.delete(index);
      }
      if (!preserveMotion || !el.style.transform) {
        if (el.style.transform !== baseTransform) el.style.transform = baseTransform;
      }
      mark.renderedTransform = el.style.transform || baseTransform;
    }
  }

  ensureItemVisible(item) {
    const visibleTop = this.container.scrollTop + SCROLL_REVEAL_MARGIN;
    const visibleBottom = this.container.scrollTop + this.container.clientHeight - SCROLL_REVEAL_MARGIN;
    if (item.center >= visibleTop && item.center <= visibleBottom) return false;

    const nextTop = clamp(
      item.center - this.container.clientHeight / 2,
      0,
      Math.max(0, this.container.scrollHeight - this.container.clientHeight)
    );

    this.container.scrollTop = nextTop;
    return true;
  }

  syncDragPositionAfterMeasure() {
    if (!this.isDragging || !this.items.length) return false;
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    const pointerY = this.container.scrollTop + this.dragPointerViewportY;
    const y = this.applyMagnet(clamp(pointerY, first.center, last.center));
    this.lastDragIndex = -1;
    this.applyDragY(y);
    return true;
  }

  requestFrame() {
    if (this.destroyed || this.enabled === false || this.frame) return;
    this.frame = requestOwnerFrame(this.container, (time) => this.animate(time));
  }

  isSettled() {
    return !this.isDragging
      && Math.abs(this.targetY - this.displayY) < SPRING.restDelta
      && Math.abs(this.velocity) < SPRING.restSpeed;
  }

  animate(timestamp) {
    const lastTime = this.lastFrameTime;
    this.lastFrameTime = timestamp;
    const dt = lastTime === undefined ? 1 / 60 : Math.min((timestamp - lastTime) / 1000, MAX_FRAME_DT);

    if (!this.isDragging) {
      if (prefersReducedMotion.matches) {
        this.displayY = this.targetY;
        this.velocity = 0;
      } else {
        const next = stepSpring({ position: this.displayY, velocity: this.velocity }, this.targetY, dt);
        this.displayY = next.position;
        this.velocity = next.velocity;
      }
    }

    this.render();
    // Pointer changes and edge scrolling request their own frame. Holding
    // still needs no animation loop; release continues the spring as usual.
    if (this.isDragging || this.isSettled()) {
      this.frame = null;
      this.lastFrameTime = undefined;
      return;
    }
    this.frame = requestOwnerFrame(this.container, (time) => this.animate(time));
  }

  render() {
    this.updateRailLineFocus();
    const orbTransform = `translate(0, ${this.displayY}px)`;
    if (this.orb.style.transform !== orbTransform) this.orb.style.transform = orbTransform;
    this.renderOrbBall();

    const nearestTick = nearestIndex(this.tickMarks, this.displayY, "y");
    if (!this.isDragging) this.tickSideMap.clear();

    const nextTickRange = indexRangeAround(this.tickMarks, this.displayY, DYNAMIC_RENDER_RADIUS, "y");
    const [previousTickStart, previousTickEnd] = this.dynamicTickRange || [0, -1];
    const [nextTickStart, nextTickEnd] = nextTickRange;
    for (let index = previousTickStart; index <= previousTickEnd; index += 1) {
      if (index >= nextTickStart && index <= nextTickEnd) continue;
      const tick = this.tickMarks[index];
      const el = this.tickEls[index];
      if (!tick || !el) continue;
      el.classList.remove("is-line", "is-nearest");
      if (el.style.opacity) el.style.opacity = "";
      const baseTransform = `translate(0px, -50%) scaleX(${getTickBaseWidth(tick) / LINE_WIDTH})`;
      if (tick.renderedTransform !== baseTransform) {
        el.style.transform = baseTransform;
        tick.renderedTransform = baseTransform;
      }
      this.tickSideMap.delete(index);
    }
    if (this.nearestTickIndex >= 0 && this.nearestTickIndex !== nearestTick) {
      const previousNearest = this.tickEls[this.nearestTickIndex];
      if (previousNearest) previousNearest.classList.remove("is-nearest");
    }

    for (let index = nextTickStart; index <= nextTickEnd; index += 1) {
      const tick = this.tickMarks[index];
      const el = this.tickEls[index];
      const distance = tick.y - this.displayY;
      const progress = tick.itemIndex === undefined ? 0 : morphProgress(distance);
      const wave = tick.itemIndex === undefined || prefersReducedMotion.matches ? 0 : gaussianInfluence(distance, BULGE_SIGMA);
      const baseWidth = getTickBaseWidth(tick);
      const waveProgress = Math.max(progress, wave * 0.76);
      let width = mix(baseWidth, LINE_WIDTH, waveProgress);
      const fitted = fitTickToContent(
        mix(waveOffset(this.displayY, tick.y), DOT_SIZE + 15, progress),
        width,
        baseWidth,
        this.railX ?? DEFAULT_RAIL_X,
        tickContentLeft(this, tick),
      );
      const x = fitted.x;
      width = fitted.width;

      if (this.isDragging) {
        const previousSide = this.tickSideMap.get(index);
        let currentSide = previousSide;
        if (distance >= TICK_SIDE_HYSTERESIS) {
          currentSide = 1;
        } else if (distance <= -TICK_SIDE_HYSTERESIS) {
          currentSide = -1;
        }
        if (
          this.plugin.settings.soundEnabled
          && previousSide !== undefined
          && currentSide !== previousSide
          && !prefersReducedMotion.matches
        ) {
          const dragProgress = index / Math.max(1, this.tickMarks.length - 1);
          this.plugin.audio.tick(
            resolveSoundStyle(this.plugin.settings.soundStyle, this.orb.dataset.orbStyle),
            dragProgress,
            this.plugin.settings.pitchScaleEnabled,
            this.ownerWindow,
          );
        }
        this.tickSideMap.set(index, currentSide);
      }

      el.classList.toggle("is-line", progress > 0.5);
      el.classList.toggle("is-nearest", index === nearestTick);

      if (wave > 0) {
        let baseOpacity = 0.56;
        if (tick.isFile === false) baseOpacity = 0.35;
        else if (tick.kind !== "long") baseOpacity = 0.28;
        // Match the CSS cascade before brightening; semantic highlights must never dim.
        if (progress > 0.5) baseOpacity = 0.95;
        if (tick.isMagnet) baseOpacity = 0.78;
        if (index === nearestTick) baseOpacity = 1;
        const targetOpacity = mix(baseOpacity, Math.max(baseOpacity, 0.96), wave);
        const nextOpacity = targetOpacity.toFixed(2);
        if (el.style.opacity !== nextOpacity) el.style.opacity = nextOpacity;
      } else if (el.style.opacity) {
        el.style.opacity = "";
      }

      const scaleX = width / LINE_WIDTH;
      const transformValue = `translate(${x}px, -50%) scaleX(${scaleX})`;
      if (tick.renderedTransform !== transformValue) {
        el.style.transform = transformValue;
        tick.renderedTransform = transformValue;
      }
    }
    this.dynamicTickRange = nextTickRange;
    this.nearestTickIndex = nearestTick;

    const nextItemRange = indexRangeAround(this.items, this.displayY, DYNAMIC_RENDER_RADIUS);
    const [previousItemStart, previousItemEnd] = this.dynamicItemRange || [0, -1];
    const [nextItemStart, nextItemEnd] = nextItemRange;
    for (let index = previousItemStart; index <= previousItemEnd; index += 1) {
      if (index >= nextItemStart && index <= nextItemEnd) continue;
      const item = this.items[index];
      if (!item || item.renderedX === undefined) continue;
      item.el.style.removeProperty("translate");
      item.renderedX = undefined;
    }

    for (let index = nextItemStart; index <= nextItemEnd; index += 1) {
      const item = this.items[index];
      const x = labelShiftFor(this, index);

      if (item.renderedX === x) continue;
      if (x === 0) {
        if (typeof item.el.style.removeProperty === "function") {
          item.el.style.removeProperty("translate");
        } else {
          item.el.style.translate = "";
        }
        item.renderedX = undefined;
      } else {
        item.el.style.translate = `${x}px 0px`;
        item.renderedX = x;
      }
    }
    this.dynamicItemRange = nextItemRange;
  }

  renderOrbBall() {
    const ball = this.orbBall || this.orb.querySelector(".crisp-fe-orb-ball");
    const viewportY = this.displayY - this.container.scrollTop;
    if (!ball) {
      this.lastRenderViewportY = viewportY;
      return;
    }

    if (STATIC_ORB_STYLES.has(this.orb.dataset.orbStyle)) {
      this.lastRenderViewportY = viewportY;
      if (ball.style.transform) ball.style.removeProperty("transform");
      return;
    }

    if (this.lastRenderViewportY !== undefined && !prefersReducedMotion.matches) {
      this.orbRotation += (viewportY - this.lastRenderViewportY) * ORB_ROTATION_PER_PX;
    }
    this.lastRenderViewportY = viewportY;
    const rotation = prefersReducedMotion.matches ? "none" : `rotate(${this.orbRotation}deg)`;
    if (ball.style.transform !== rotation) ball.style.transform = rotation;
  }

  updateRailLineFocus() {
    if (!this.items.length) return;

    const first = this.items[0];
    const top = Math.max(0, first.center - RAIL_LINE_PADDING);
    const focusY = this.displayY - top - RAIL_FOCUS_HEIGHT / 2;
    const transform = `translate(0px, ${focusY}px)`;
    if (transform === this.lastLineFocusTransform) return;
    this.lineFocus.style.transform = transform;
    this.lastLineFocusTransform = transform;
  }

  handlePointerDown(event) {
    const isSecondaryPointer = typeof event.button === "number" && event.button !== 0;
    if (this.isDragging || !this.items.length || event.isPrimary === false || isSecondaryPointer) return;
    event.preventDefault();
    event.stopPropagation();

    this.clearColdOpenTransition();

    // 先清理可能残留的监听器，避免重复绑定
    this.cleanupDragListeners();

    this.setDragging(true);
    this.dragPointerId = event.pointerId;
    this.velocity = 0;
    this.lastDragIndex = -1;
    this.tickSideMap.clear();
    
    try {
      this.orb.setPointerCapture(event.pointerId);
    } catch (error) {
      console.debug("Crisp File Explorer: setPointerCapture failed", error);
    }
    
    this.updateDrag(event);
    this.requestFrame();

    // 使用 bubble phase（默认），不用 capture，避免拦截其他面板的事件
    const ownerWindow = getOwnerWindow(this.container);
    this.dragOwnerWindow = ownerWindow;
    ownerWindow.addEventListener("pointermove", this.onPointerMove, { passive: false });
    ownerWindow.addEventListener("pointerup", this.onPointerUp, { passive: false });
    ownerWindow.addEventListener("pointercancel", this.onPointerUp, { passive: false });
    ownerWindow.addEventListener("blur", this.onWindowBlur);
  }
  
  cleanupDragListeners() {
    // 只清理 bubble 模式的监听器（不再使用 capture）
    const ownerWindow = this.dragOwnerWindow || getOwnerWindow(this.container);
    if (!ownerWindow) return;
    ownerWindow.removeEventListener("pointermove", this.onPointerMove, false);
    ownerWindow.removeEventListener("pointerup", this.onPointerUp, false);
    ownerWindow.removeEventListener("pointercancel", this.onPointerUp, false);
    ownerWindow.removeEventListener("blur", this.onWindowBlur, false);
    this.dragOwnerWindow = null;
  }

  cancelDragScroll() {
    cancelOwnerFrame(this.container, this.dragScrollFrame);
    this.dragScrollFrame = null;
  }

  clearAutoExpandTimer() {
    clearOwnerTimeout(this.container, this.autoExpandTimer);
    this.autoExpandTimer = null;
    this.autoExpandFolderPath = null;
  }

  releasePointerCapture() {
    if (this.dragPointerId === null || this.dragPointerId === undefined) return;
    try {
      this.orb.releasePointerCapture(this.dragPointerId);
    } catch (error) {
      // Pointer capture may already be released by the host window.
    }
  }

  handlePointerMove(event) {
    if (this.destroyed || !this.isDragging || event.pointerId !== this.dragPointerId) return;
    // 只在确认是拖动事件时才 preventDefault
    event.preventDefault();
    event.stopPropagation();
    this.updateDrag(event);
  }

  handleWindowBlur() {
    if (!this.cancelDragInteraction()) return;
    if (this.plugin && typeof this.plugin.scheduleRefresh === "function") {
      this.plugin.scheduleRefresh();
    }
    this.requestFrame();
  }

  handlePointerUp(event) {
    if (this.destroyed || !this.isDragging || event.pointerId !== this.dragPointerId) return;
    // 只在确认是拖动事件时才 preventDefault
    event.preventDefault();
    event.stopPropagation();

    const cancelled = event.type === "pointercancel";
    if (!cancelled) this.updateDrag(event);
    this.setDragging(false);
    this.releasePointerCapture();
    this.dragPointerId = null;
    this.cancelDragScroll();
    this.clearAutoExpandTimer();
    
    // 立即清理所有全局监听器
    this.cleanupDragListeners();

    if (cancelled) {
      this.autoExpandedFolderPaths.clear();
      if (this.plugin && typeof this.plugin.scheduleRefresh === "function") {
        this.plugin.scheduleRefresh();
      }
      this.requestFrame();
      return;
    }

    const index = nearestIndex(this.items, this.displayY);
    const item = this.items[index];
    let didNavigate = false;
    if (item && this.plugin.settings.releaseSoundEnabled && !prefersReducedMotion.matches) {
      this.plugin.audio.release(resolveSoundStyle(this.plugin.settings.soundStyle, this.orb.dataset.orbStyle), this.ownerWindow);
    }
    if (item && this.plugin.settings.openOnDragRelease) {
      const skipAutoExpandedFolder = this.container.dataset?.crispFolderPath === undefined && item.type === "folder" && this.autoExpandedFolderPaths.has(item.path);
      if (!skipAutoExpandedFolder) {
        this.plugin.lockInteraction();
        dispatchMouseSequence(item.el);
        didNavigate = true;
      }
    }
    this.autoExpandedFolderPaths.clear();
    if (!didNavigate && this.plugin && typeof this.plugin.scheduleRefresh === "function") {
      this.plugin.scheduleRefresh();
    }
    this.requestFrame();
  }

  updateDrag(event) {
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    if (!first || !last) return;

    const rect = this.container.getBoundingClientRect();
    this.dragPointerViewportY = event.clientY - rect.top;
    const pointerY = this.dragPointerViewportY + this.container.scrollTop;
    const y = this.applyMagnet(clamp(pointerY, first.center, last.center));
    this.applyDragY(y);
    this.scheduleDragScroll();
  }

  applyMagnet(y) {
    if (!this.plugin.settings.frequentMagnetsEnabled) return y;
    let nearestMagnet = null;
    let nearestDistance = Infinity;

    for (const item of this.magnetItems || []) {
      const distance = Math.abs(item.center - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestMagnet = item;
      }
    }

    if (!nearestMagnet || nearestDistance > MAGNET_RADIUS) return y;
    const pressure = 1 - nearestDistance / MAGNET_RADIUS;
    return mix(y, nearestMagnet.center, pressure * MAGNET_STRENGTH);
  }

  applyDragY(y) {
    this.displayY = y;
    this.targetY = y;
    this.velocity = 0;
    this.hasOrbPosition = true;

    const index = nearestIndex(this.items, y);
    if (index === this.lastDragIndex) {
      this.requestFrame();
      return;
    }
    this.lastDragIndex = index;
    const previousActive = this.items[this.visualActiveIndex];
    if (previousActive && this.visualActiveIndex !== index) {
      previousActive.el.classList.toggle("crisp-fe-active", false);
    }
    const nextActive = this.items[index];
    if (nextActive) nextActive.el.classList.toggle("crisp-fe-active", true);
    this.visualActiveIndex = index;
    this.queueFolderAutoExpand(this.items[index]);

    this.requestFrame();
  }

  queueFolderAutoExpand(item) {
    if (!this.plugin.settings.autoExpandFoldersOnDrag || !this.isDragging || !item || item.type !== "folder" || !item.path) {
      this.clearAutoExpandTimer();
      return;
    }
    if (this.autoExpandFolderPath === item.path) return;

    this.clearAutoExpandTimer();
    this.autoExpandFolderPath = item.path;
    this.autoExpandTimer = setOwnerTimeout(this.container, () => {
      const folderPath = this.autoExpandFolderPath;
      this.clearAutoExpandTimer();
      if (!this.isDragging || !folderPath) return;
      if (this.plugin.expandFolderInExplorers(folderPath)) {
        this.autoExpandedFolderPaths.add(folderPath);
        this.scheduleRefresh();
      }
    }, FOLDER_AUTO_EXPAND_DELAY_MS);
  }

  scheduleDragScroll() {
    if (this.dragScrollFrame || !this.isDragging) return;
    this.dragScrollFrame = requestOwnerFrame(this.container, () => {
      this.dragScrollFrame = null;
      this.performDragScroll();
    });
  }

  performDragScroll() {
    if (!this.isDragging || !this.items.length) return;

    const height = this.container.clientHeight;
    const pointerY = clamp(this.dragPointerViewportY, 0, height);
    let direction = 0;
    let pressure = 0;

    if (pointerY < DRAG_SCROLL_EDGE_MARGIN) {
      direction = -1;
      pressure = (DRAG_SCROLL_EDGE_MARGIN - pointerY) / DRAG_SCROLL_EDGE_MARGIN;
    } else if (pointerY > height - DRAG_SCROLL_EDGE_MARGIN) {
      direction = 1;
      pressure = (pointerY - (height - DRAG_SCROLL_EDGE_MARGIN)) / DRAG_SCROLL_EDGE_MARGIN;
    }

    if (!direction) return;

    const maxScrollTop = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    const delta = direction * DRAG_SCROLL_MAX_STEP * pressure * pressure;
    const nextScrollTop = clamp(this.container.scrollTop + delta, 0, maxScrollTop);
    if (Math.abs(nextScrollTop - this.container.scrollTop) < 0.5) return;

    this.container.scrollTop = nextScrollTop;
    const first = this.items[0];
    const last = this.items[this.items.length - 1];
    if (first && last) {
      this.applyDragY(this.applyMagnet(clamp(this.container.scrollTop + pointerY, first.center, last.center)));
    }
    this.scheduleDragScroll();
  }
}

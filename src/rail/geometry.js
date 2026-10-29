import { TICK_SHORT_WIDTH, TICK_LONG_WIDTH, TICK_FOLDER_WIDTH, ACTIVE_LABEL_TRANSLATE_X, BULGE_AMPLITUDE, BULGE_SIGMA, MORPH_RADIUS, DEFAULT_RAIL_X, TICK_CONTENT_GAP, MIN_TICK_WIDTH, SPRING } from "../constants.js";
import { getOwnerWindow } from "../dom/owner-window.js";

export const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function mix(from, to, progress) {
  return from + (to - from) * progress;
}

export function morphProgress(distance) {
  const t = clamp(1 - Math.abs(distance) / MORPH_RADIUS, 0, 1);
  return t * t * (3 - 2 * t);
}

export function gaussianInfluence(distance, sigma) {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

export function waveOffset(dotY, y) {
  return gaussianInfluence(y - dotY, BULGE_SIGMA) * BULGE_AMPLITUDE;
}

export function stepSpring(state, target, dt) {
  // A 33ms step is unstable with this stiffness/damping. Keep the original
  // 60Hz response, but subdivide dropped frames instead of amplifying them.
  const steps = Math.max(1, Math.ceil(dt * 60 - 1e-9));
  const stepDt = dt / steps;
  let { position, velocity } = state;
  for (let index = 0; index < steps; index += 1) {
    const displacement = target - position;
    velocity += (SPRING.stiffness * displacement - SPRING.damping * velocity) * stepDt;
    position += velocity * stepDt;
  }

  if (Math.abs(target - position) < SPRING.restDelta && Math.abs(velocity) < SPRING.restSpeed) {
    return { position: target, velocity: 0 };
  }

  return { position, velocity };
}

export function nearestIndex(items, y, centerKey = "center") {
  if (!items.length) return -1;
  const lastIndex = items.length - 1;
  if (y <= items[0][centerKey]) return 0;
  if (y >= items[lastIndex][centerKey]) return lastIndex;

  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (items[middle][centerKey] <= y) low = middle;
    else high = middle;
  }

  return y - items[low][centerKey] <= items[high][centerKey] - y ? low : high;
}

export function indexRangeAround(items, y, radius, centerKey = "center") {
  if (!items.length) return [0, -1];
  const minimum = y - radius;
  const maximum = y + radius;

  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (items[middle][centerKey] < minimum) low = middle + 1;
    else high = middle;
  }
  const start = low;

  low = start;
  high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (items[middle][centerKey] <= maximum) low = middle + 1;
    else high = middle;
  }

  return start < low ? [start, low - 1] : [0, -1];
}

export function getTickBaseWidth(tick) {
  let width = TICK_SHORT_WIDTH;
  if (tick.kind === "long") width = tick.isFile === false ? TICK_FOLDER_WIDTH : TICK_LONG_WIDTH;
  return Number.isFinite(tick.maxWidth) ? Math.min(width, tick.maxWidth) : width;
}

export function mutationTouchesFileTree(mutations) {
  return mutations.some((mutation) => {
    if (!mutation.addedNodes.length && !mutation.removedNodes.length) return false;
    const target = mutation.target;
    return !(target && typeof target.closest === "function" && target.closest(".crisp-fe-rail"));
  });
}

export function buildTickMarks(items, railX = DEFAULT_RAIL_X) {
  const ticks = [];
  if (!items.length) return ticks;

  // Longest a resting tick may be and still leave a gap before the row
  // content; between-row ticks take the nearer of their two rows.
  const maxWidthFor = (...indices) => {
    let width;
    for (const index of indices) {
      const contentLeft = items[index] && items[index].contentLeft;
      if (!Number.isFinite(contentLeft)) continue;
      const room = Math.max(MIN_TICK_WIDTH, contentLeft - TICK_CONTENT_GAP - railX);
      width = width === undefined ? room : Math.min(width, room);
    }
    return width;
  };

  // Ticks live on the rail line, which runs from the first item centre to the
  // last; nothing is drawn above or below it.
  for (let index = 0; index < items.length; index += 1) {
    ticks.push({
      y: items[index].center,
      kind: "long",
      itemIndex: index,
      isFile: items[index].type === "file",
      isToday: Boolean(items[index].today),
      isMagnet: Boolean(items[index].magnet),
      isPinned: Boolean(items[index].pinned),
      maxWidth: maxWidthFor(index),
    });

    const next = items[index + 1];
    if (!next) continue;

    const gap = next.center - items[index].center;
    if (gap >= 22) {
      ticks.push(
        { y: items[index].center + gap / 3, kind: "short", prevItemIndex: index, nextItemIndex: index + 1, maxWidth: maxWidthFor(index, index + 1) },
        { y: items[index].center + (gap * 2) / 3, kind: "short", prevItemIndex: index, nextItemIndex: index + 1, maxWidth: maxWidthFor(index, index + 1) }
      );
    }
  }
  return ticks;
}

// Keeps a bulging tick clear of the row content (chevron or label). The
// resting length is never cut, so the idle ruler looks exactly as before;
// only the bulge is held back, first in length, then in offset.
export function fitTickToContent(x, width, baseWidth, railX, contentLeft) {
  if (!Number.isFinite(contentLeft)) return { x, width };
  const allowedRight = Math.max(railX + baseWidth, contentLeft - TICK_CONTENT_GAP);
  let excess = railX + x + width - allowedRight;
  if (excess <= 0) return { x, width };
  const widthCut = Math.min(excess, Math.max(0, width - baseWidth));
  excess -= widthCut;
  const xCut = Math.min(excess, Math.max(0, x));
  return { x: x - xCut, width: width - widthCut };
}

export function labelShiftFor(rail, index) {
  const item = rail.items[index];
  if (!item) return 0;
  if (rail.isDragging) {
    const progress = morphProgress(item.center - rail.displayY);
    return mix(waveOffset(rail.displayY, item.center), ACTIVE_LABEL_TRANSLATE_X, progress);
  }
  return item.active || rail.visualActiveIndex === index ? ACTIVE_LABEL_TRANSLATE_X : 0;
}

// The content edge a tick must stay clear of: its own row's, or for a
// between-row tick the nearer of its two neighbours, wherever their labels
// currently sit.
export function tickContentLeft(rail, tick) {
  const indices = tick.itemIndex !== undefined
    ? [tick.itemIndex]
    : [tick.prevItemIndex, tick.nextItemIndex];
  let left;
  for (const index of indices) {
    const item = index === undefined || !rail.items ? undefined : rail.items[index];
    if (!item || !Number.isFinite(item.contentLeft)) continue;
    let edge = item.contentLeft + labelShiftFor(rail, index);
    // A shifted label moves away from its tree trunk; the trunk stays put.
    if (Number.isFinite(item.treeEdge)) edge = Math.min(edge, item.treeEdge);
    left = left === undefined ? edge : Math.min(left, edge);
  }
  return left;
}

export function findTreeContent(container) {
  if (!container || !container.children) return null;
  for (const child of Array.from(container.children)) {
    if (child.classList && !child.classList.contains("crisp-fe-rail")) return child;
  }
  return null;
}

export function measureRowContentLeft(el, containerRect) {
  if (!el || typeof el.querySelector !== "function" || !containerRect) return undefined;
  const chevron = el.querySelector(".collapse-icon svg");
  const label = el.querySelector(".tree-item-inner");
  for (const candidate of [chevron, label]) {
    if (!candidate || typeof candidate.getBoundingClientRect !== "function") continue;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0) {
      const shift = parseFloat((el.style && el.style.translate) || "") || 0;
      return rect.left - containerRect.left - shift;
    }
  }
  return undefined;
}

// With tree guides on, the top-level folders' trunk runs just right of the
// rail. Rows inside any folder (depth 1 and deeper; top-level rows are 0)
// treat the trunk as their content edge, so their ticks end before it
// instead of crossing it.
export function treeGuideContentLeft(contentLeft, depth, rootTrunkX) {
  if (depth < 1 || !Number.isFinite(rootTrunkX) || !Number.isFinite(contentLeft)) return contentLeft;
  return Math.min(contentLeft, rootTrunkX);
}

export function treeRowDepth(el, container) {
  let depth = 0;
  for (let node = el && el.parentElement; node && node !== container; node = node.parentElement) {
    if (node.classList && node.classList.contains("tree-item-children")) depth += 1;
  }
  return depth;
}

// How far a row is translated right now. The inline value is where a slide
// is heading; the computed value is where the row is drawn this frame, which
// is what getBoundingClientRect reports.
export function currentShiftX(row) {
  if (!row) return 0;
  const ownerWindow = row.nodeType === 1 ? getOwnerWindow(row) : null;
  if (ownerWindow && typeof ownerWindow.getComputedStyle === "function") {
    const value = parseFloat(ownerWindow.getComputedStyle(row).translate);
    return Number.isFinite(value) ? value : 0;
  }
  return parseFloat((row.style && row.style.translate) || "") || 0;
}

// Per-row corrections the shared CSS geometry cannot know: a first mounted
// child sitting below unmounted siblings (lead), a last mounted child with
// unmounted siblings still to come (more, tail), and rows taller or shorter
// than the measured default (mid).
export function measureTreeRows(container, defaultMid) {
  const rows = [];
  if (!container || typeof container.querySelectorAll !== "function") return rows;
  for (const block of container.querySelectorAll(".tree-item-children")) {
    const children = Array.from(block.children || []).filter(
      (el) => el.classList && el.classList.contains("tree-item")
    );
    if (!children.length) continue;
    const blockRect = block.getBoundingClientRect();
    if (!blockRect.height) continue;
    children.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const row = { el };
      if (index === 0) {
        const lead = rect.top - blockRect.top;
        if (lead > 1) row.lead = lead;
      }
      if (index === children.length - 1) {
        const tail = blockRect.bottom - rect.bottom;
        if (tail > 1) {
          row.more = true;
          row.tail = tail;
        }
      }
      const self = el.querySelector(":scope > .tree-item-self");
      const selfRect = self && self.getBoundingClientRect();
      if (selfRect && selfRect.height && Math.abs(selfRect.height / 2 - defaultMid) > 0.5) {
        row.mid = selfRect.height / 2;
      }
      if (row.lead !== undefined || row.more || row.mid !== undefined) rows.push(row);
    });
  }
  return rows;
}

// Reads the tree guide geometry from the rendered tree so the connectors line
// up under any theme: where a folder's trunk sits relative to its children,
// how far each elbow runs, and the row midline. Needs one expanded folder.
export function measureTreeGuides(container, containerRect) {
  if (!container || typeof container.querySelector !== "function" || !containerRect) return null;
  const child = container.querySelector(
    ".nav-folder:not(.is-collapsed) > .tree-item-children > .tree-item"
  );
  const parent = child && child.parentElement && child.parentElement.parentElement;
  const parentChevron = parent && parent.querySelector(":scope > .tree-item-self .collapse-icon svg");
  const childSelf = child && child.querySelector(":scope > .tree-item-self");
  if (!parentChevron || !childSelf) return null;

  // Rows may be mid-shift (active label, drag wave); measure them at rest.
  const shiftOf = currentShiftX;
  const chevronRect = parentChevron.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const selfRect = childSelf.getBoundingClientRect();
  if (!chevronRect.width || !selfRect.height) return null;
  const parentShift = shiftOf(parent.querySelector(":scope > .tree-item-self"));
  const trunk = chevronRect.left - parentShift + chevronRect.width / 2 - childRect.left;
  const parentMid = chevronRect.top + chevronRect.height / 2;

  // Elbow ends: just before a child folder's chevron, a little further for a
  // file, which has no chevron and starts at its label.
  const inset = (row, selector, gap) => {
    const target = row && row.querySelector(selector);
    const rowItem = row && row.parentElement;
    if (!target || !rowItem) return undefined;
    const left = target.getBoundingClientRect().left - shiftOf(row) - rowItem.getBoundingClientRect().left;
    return left - gap - trunk;
  };
  const folderStub = inset(container.querySelector(".tree-item-children .nav-folder-title"), ".collapse-icon svg", 3);
  const fileStub = inset(container.querySelector(".tree-item-children .nav-file-title"), ".tree-item-inner", 6);

  const next = child.nextElementSibling;
  const gap = next && next.classList.contains("tree-item")
    ? Math.max(0, next.getBoundingClientRect().top - childRect.bottom)
    : 0;

  // Top-level rows sit in a plain wrapper, not in a .tree-item-children.
  const rootSelf = container.querySelector(":scope > div > .nav-folder > .tree-item-self");
  const rootChevron = rootSelf && rootSelf.querySelector(".collapse-icon svg");
  const rootRect = rootChevron && rootChevron.getBoundingClientRect();

  return {
    trunk,
    folderStub,
    fileStub,
    mid: selfRect.height / 2,
    // From the top of the children block up to just under the parent's
    // chevron. Measured on the block, not on a child: the tree renders lazily,
    // so the first child in the DOM can sit far below its folder.
    reach: clamp(
      child.parentElement.getBoundingClientRect().top - (parentMid + chevronRect.height / 2 + 2),
      0,
      selfRect.height,
    ),
    gap,
    rootTrunkX: rootRect && rootRect.width
      ? rootRect.left - shiftOf(rootSelf) + rootRect.width / 2 - containerRect.left
      : undefined,
  };
}

export function readRailX(container) {
  const ownerWindow = getOwnerWindow(container);
  if (!ownerWindow || typeof ownerWindow.getComputedStyle !== "function") return DEFAULT_RAIL_X;
  const value = parseFloat(ownerWindow.getComputedStyle(container).getPropertyValue("--crisp-fe-rail-x"));
  return Number.isFinite(value) ? value : DEFAULT_RAIL_X;
}

export function hasStableTickTopology(previousItems, nextItems, previousTicks, nextTicks) {
  if (
    previousItems.length !== nextItems.length
    || previousTicks.length !== nextTicks.length
  ) {
    return false;
  }

  for (let index = 0; index < nextItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (previous.path !== next.path || previous.type !== next.type) return false;
  }

  for (let index = 0; index < nextTicks.length; index += 1) {
    const previous = previousTicks[index];
    const next = nextTicks[index];
    if (previous.kind !== next.kind || previous.itemIndex !== next.itemIndex) return false;
    if (previous.maxWidth !== next.maxWidth) return false;
  }

  return true;
}

export function reconcileMeasuredItemMotion(previousItems, nextItems, dynamicItemRange, preserveMotion) {
  const [start, end] = dynamicItemRange || [0, -1];

  for (let index = start; index <= end; index += 1) {
    const previous = previousItems[index];
    if (!previous) continue;
    const next = nextItems[index];
    if (preserveMotion && next && next.el === previous.el) {
      next.renderedX = previous.renderedX;
      continue;
    }
    if (previous.renderedX !== undefined) {
      previous.el.style.removeProperty("translate");
    }
  }

  return preserveMotion ? [start, end] : [0, -1];
}

export function dispatchMouseSequence(el) {
  const ownerWindow = getOwnerWindow(el);
  const MouseEventConstructor = ownerWindow.MouseEvent;
  const options = {
    bubbles: true,
    cancelable: true,
    view: ownerWindow,
    button: 0,
  };
  el.dispatchEvent(new MouseEventConstructor("mousedown", options));
  el.dispatchEvent(new MouseEventConstructor("mouseup", options));
  el.dispatchEvent(new MouseEventConstructor("click", options));
}

export function findVisibleAncestorItem(items, activePath) {
  if (!activePath) return null;
  const parts = activePath.split("/");
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const folderPath = parts.slice(0, index).join("/");
    const item = items.find((candidate) => candidate.type === "folder" && candidate.path === folderPath);
    if (item) return item;
  }
  return null;
}

export function resolveOrbTarget(items, activeTargetItem, hasCurrentPosition, currentPosition) {
  if (activeTargetItem) return activeTargetItem.center;
  if (!items.length) return 0;
  if (hasCurrentPosition) {
    return clamp(currentPosition, items[0].center, items[items.length - 1].center);
  }
  return items[0].center;
}

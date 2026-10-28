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
    const edge = item.contentLeft + labelShiftFor(rail, index);
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

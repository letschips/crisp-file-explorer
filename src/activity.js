import { SMART_MAGNET_MIN_COUNT, SMART_MAGNET_LIMIT, SMART_MAGNET_HALF_LIFE_MS, SMART_MAGNET_MAX_AGE_MS, FILE_STATS_LIMIT, TODAY_TRAIL_LIMIT } from "./constants.js";

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeActivity(value) {
  const activity = value && typeof value === "object" ? value : {};
  const todayPaths = Array.isArray(activity.todayPaths)
    ? activity.todayPaths.filter((path) => typeof path === "string")
    : [];
  const fileStats = activity.fileStats && typeof activity.fileStats === "object"
    ? activity.fileStats
    : {};
  const pinnedPaths = [];
  const seenPinnedPaths = new Set();
  for (const path of Array.isArray(activity.pinnedPaths) ? activity.pinnedPaths : []) {
    if (typeof path !== "string" || !path || seenPinnedPaths.has(path)) continue;
    seenPinnedPaths.add(path);
    pinnedPaths.push(path);
    if (pinnedPaths.length >= SMART_MAGNET_LIMIT) break;
  }

  return {
    todayKey: typeof activity.todayKey === "string" ? activity.todayKey : "",
    todayPaths: todayPaths.slice(-TODAY_TRAIL_LIMIT),
    pinnedPaths,
    fileStats: pruneFileStats(fileStats),
  };
}

function smartMagnetScore(stat, now = Date.now()) {
  const count = Number(stat && stat.count) || 0;
  const lastOpened = Number(stat && stat.lastOpened) || 0;
  if (count < SMART_MAGNET_MIN_COUNT || lastOpened <= 0) return Number.NEGATIVE_INFINITY;

  const age = Math.max(0, now - lastOpened);
  if (age > SMART_MAGNET_MAX_AGE_MS) return Number.NEGATIVE_INFINITY;

  const recency = 2 ** (-age / SMART_MAGNET_HALF_LIFE_MS);
  const frequency = Math.min(1, Math.log2(count + 1) / 6);
  return recency * 0.72 + frequency * 0.28;
}

export function rankSmartMagnetPaths(value, now = Date.now()) {
  const activity = normalizeActivity(value);
  const pinnedPaths = activity.pinnedPaths.slice(0, SMART_MAGNET_LIMIT);
  const pinnedSet = new Set(pinnedPaths);
  const remaining = Math.max(0, SMART_MAGNET_LIMIT - pinnedPaths.length);
  const recommendedPaths = Object.entries(activity.fileStats)
    .filter(([path]) => !pinnedSet.has(path))
    .map(([path, stat]) => ({ path, stat, score: smartMagnetScore(stat, now) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff) return scoreDiff;
      const recentDiff = (Number(b.stat.lastOpened) || 0) - (Number(a.stat.lastOpened) || 0);
      if (recentDiff) return recentDiff;
      const countDiff = (Number(b.stat.count) || 0) - (Number(a.stat.count) || 0);
      if (countDiff) return countDiff;
      return a.path.localeCompare(b.path);
    })
    .slice(0, remaining)
    .map((entry) => entry.path);

  return { pinnedPaths, recommendedPaths };
}

export function pruneFileStats(fileStats) {
  return Object.fromEntries(
    Object.entries(fileStats || {})
      .filter(([path, stat]) => typeof path === "string" && stat && typeof stat === "object")
      .sort(([, a], [, b]) => {
        const lastDiff = (Number(b.lastOpened) || 0) - (Number(a.lastOpened) || 0);
        if (lastDiff) return lastDiff;
        return (Number(b.count) || 0) - (Number(a.count) || 0);
      })
      .slice(0, FILE_STATS_LIMIT)
  );
}

export function rewriteActivityPaths(value, oldPath, newPath) {
  const activity = normalizeActivity(value);
  const sourcePath = typeof oldPath === "string"
    ? oldPath.replace(/\/+$/, "")
    : "";
  const destinationPath = typeof newPath === "string"
    ? newPath.replace(/\/+$/, "")
    : null;
  if (!sourcePath || destinationPath === sourcePath) {
    return activity;
  }

  const rewritePath = (path) => {
    if (path !== sourcePath && !path.startsWith(`${sourcePath}/`)) {
      return path;
    }
    if (destinationPath === null) {
      return null;
    }
    return `${destinationPath}${path.slice(sourcePath.length)}`;
  };

  const rewrittenTodayPaths = activity.todayPaths
    .map(rewritePath)
    .filter((path) => typeof path === "string");
  const seenTodayPaths = new Set();
  const todayPaths = [];
  for (let index = rewrittenTodayPaths.length - 1; index >= 0; index -= 1) {
    const path = rewrittenTodayPaths[index];
    if (seenTodayPaths.has(path)) continue;
    seenTodayPaths.add(path);
    todayPaths.unshift(path);
  }

  const pinnedPaths = [];
  const seenPinnedPaths = new Set();
  for (const path of activity.pinnedPaths.map(rewritePath)) {
    if (!path || seenPinnedPaths.has(path)) continue;
    seenPinnedPaths.add(path);
    pinnedPaths.push(path);
  }

  const fileStats = {};
  for (const [path, stat] of Object.entries(activity.fileStats)) {
    const rewrittenPath = rewritePath(path);
    if (!rewrittenPath) continue;
    const previous = fileStats[rewrittenPath];
    fileStats[rewrittenPath] = previous
      ? {
        count: (Number(previous.count) || 0) + (Number(stat.count) || 0),
        lastOpened: Math.max(
          Number(previous.lastOpened) || 0,
          Number(stat.lastOpened) || 0,
        ),
      }
      : { ...stat };
  }

  return normalizeActivity({
    todayKey: activity.todayKey,
    todayPaths,
    pinnedPaths,
    fileStats,
  });
}

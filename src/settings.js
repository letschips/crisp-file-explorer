export const DEFAULT_SETTINGS = {
  dualPaneEnabled: false,
  dualPaneFolderWidth: 200,
  dualPaneFolderHeight: 200,
  dualPaneRatio: 0.43,
  dualPaneSort: "name",
  dualPaneDescendants: false,
  dualPaneLayout: "auto",
  includeFolders: true,
  treeGuidesEnabled: false,
  openOnDragRelease: true,
  soundEnabled: false,
  soundStyle: "soft",
  pitchScaleEnabled: false,
  releaseSoundEnabled: false,
  orbStyle: "default",
  todayTrailEnabled: true,
  frequentMagnetsEnabled: true,
  autoExpandFoldersOnDrag: true,
  followActiveFile: "reveal",
  activity: {
    todayKey: "",
    todayPaths: [],
    pinnedPaths: [],
    fileStats: {},
  },
  explorerOrder: {
    enabled: true,
    newItems: "top",
    folders: {},
    pinned: [],
    flexplorerImported: false,
  },
  licenseCode: "",
};

// How the file tree follows the active file:
// "off" leaves folders alone, "reveal" expands its parents, "focus" also collapses every other folder.
// The dual pane only tells "off" from following.
export const FOLLOW_ACTIVE_FILE_MODES = ["off", "reveal", "focus"];

export function normalizeFollowActiveFile(value) {
  return FOLLOW_ACTIVE_FILE_MODES.includes(value) ? value : "reveal";
}

// Up to 0.5.6 the dual pane had its own `dualPaneFollowActive` toggle. In dual-pane mode it was
// the only follow switch in effect, so a user who turned it off there keeps following off.
export function resolveFollowActiveFile(data) {
  const saved = data ? data.followActiveFile : undefined;
  if (data && data.dualPaneEnabled === true && data.dualPaneFollowActive === false && saved !== "focus") return "off";
  return normalizeFollowActiveFile(saved);
}

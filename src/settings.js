export const DEFAULT_SETTINGS = {
  dualPaneEnabled: false,
  dualPaneFolderWidth: 200,
  dualPaneFolderHeight: 200,
  dualPaneRatio: 0.43,
  dualPaneSort: "name",
  dualPaneFollowActive: true,
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

// How the native file tree follows the active file:
// "off" leaves folders alone, "reveal" expands its parents, "focus" also collapses every other folder.
export const FOLLOW_ACTIVE_FILE_MODES = ["off", "reveal", "focus"];

export function normalizeFollowActiveFile(value) {
  return FOLLOW_ACTIVE_FILE_MODES.includes(value) ? value : "reveal";
}

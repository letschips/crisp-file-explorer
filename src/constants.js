export const DOT_SIZE = 14;

export const LINE_WIDTH = 28;

export const TICK_SHORT_WIDTH = 14;

export const TICK_LONG_WIDTH = 24;

export const TICK_FOLDER_WIDTH = 18;

export const ACTIVE_LABEL_TRANSLATE_X = 34;

export const BULGE_AMPLITUDE = DOT_SIZE * 1.4;

export const BULGE_SIGMA = 34;

export const DYNAMIC_RENDER_RADIUS = BULGE_SIGMA * 3.5;

export const MORPH_RADIUS = 22;

export const MAX_FRAME_DT = 1 / 30;

export const SCROLL_REVEAL_MARGIN = 64;

export const TICK_SIDE_HYSTERESIS = 0.75; // 精准的滞后判断，避免抖动时反复触发音效

export const RAIL_LINE_PADDING = 0;

export const DEFAULT_RAIL_X = 12;

export const TICK_CONTENT_GAP = 3;

export const MIN_TICK_WIDTH = 6;

export const RAIL_FOCUS_HEIGHT = 192;

export const INTERACTION_LOCK_MS = 180;

export const ACTIVE_REVEAL_RETRY_DELAYS = [120, 300, 700];

export const ORB_ROTATION_PER_PX = 3.2;

export const DRAG_SCROLL_EDGE_MARGIN = 56;

export const DRAG_SCROLL_MAX_STEP = 20;

export const MAGNET_RADIUS = 18;

export const MAGNET_STRENGTH = 0.42;

export const SMART_MAGNET_MIN_COUNT = 2;

export const SMART_MAGNET_LIMIT = 8;

export const SMART_MAGNET_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

export const SMART_MAGNET_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export const FILE_STATS_LIMIT = 240;

export const TODAY_TRAIL_LIMIT = 140;

export const FOLDER_AUTO_EXPAND_DELAY_MS = 420;

export const ACTIVITY_SAVE_DELAY_MS = 240;

export const SPRING = {
  stiffness: 700, // 临界阻尼：点击切换快速到位、不反弹
  damping: 53,
  restDelta: 0.08,
  restSpeed: 0.5, // 让球更彻底地滑到位，不会过早停止
};

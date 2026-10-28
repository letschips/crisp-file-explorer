import { getLocalDateKey } from "../activity.js";

export const STATIC_ORB_STYLES = new Set([
  "character1",
  "character2",
  "character3",
  "character4",
  "character5",
  "character6",
  "character7",
  "character8",
  "character9",
  "character10",
  "snorlax",
  "pikachu",
  "snorlaxface",
  "batman",
  "superman",
  "spiderman",
]);

const RANDOM_DAILY_ORB_STYLES = [
  "soccer",
  "basketball",
  "redball",
  "tennis",
  "clown",
  "dragonball",
  "christmasball",
  "orangeball",
  "blueball",
  "character1",
  "character2",
  "character3",
  "character4",
  "character5",
  "character6",
  "character7",
  "character8",
  "character9",
  "character10",
  "shutup",
  "snorlax",
  "pikachu",
  "pokeball",
  "bracelet",
  "snorlaxface",
  "fear",
  "devil",
  "fan",
  "gear",
  "alfresco",
  "mercedes",
  "taiga",
  "angry",
  "squint",
  "facemask",
  "pokerface",
  "captainshield",
  "batman",
  "superman",
  "spiderman",
  "dizzy",
  "vinyl",
];

export function normalizeOrbStyle(value) {
  return ["default", "randomDaily", ...RANDOM_DAILY_ORB_STYLES].includes(value) ? value : "default";
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

export function resolveOrbStyle(value) {
  const style = normalizeOrbStyle(value);
  if (style !== "randomDaily") return style;
  return RANDOM_DAILY_ORB_STYLES[hashString(getLocalDateKey()) % RANDOM_DAILY_ORB_STYLES.length];
}

const SOUND_STYLE_VALUES = [
  "soft",
  "scale",
  "wooden",
  "mechanical",
  "raindrop",
  "retro8bit",
  "watchgear",
  "bubble",
  "matchOrb",
];

const PLAYBACK_SOUND_STYLE_VALUES = [
  "soft",
  "scale",
  "raindrop",
  "retro8bit",
  "watchgear",
  "wooden",
  "mechanical",
  "bubble",
  "wood",
  "digital",
  "bounce",
  "thump",
  "pop",
  "chime",
  "spark",
  "bell",
];

export function normalizeSoundStyle(value) {
  return SOUND_STYLE_VALUES.includes(value) ? value : "soft";
}

export function normalizePlaybackSoundStyle(value) {
  return PLAYBACK_SOUND_STYLE_VALUES.includes(value) ? value : "soft";
}

function soundStyleForOrb(orbStyle) {
  if (orbStyle === "dragonball") return "spark";
  if (orbStyle === "christmasball") return "bell";
  if (orbStyle === "basketball") return "thump";
  if (["soccer", "tennis"].includes(orbStyle)) return "bounce";
  if (["redball", "orangeball", "blueball"].includes(orbStyle)) return "pop";
  if (orbStyle === "pokeball") return "spark";
  if (orbStyle === "bracelet") return "chime";
  if (["character1", "character2", "character3", "character4", "character5", "character6", "character7", "character8", "character9", "character10", "shutup", "snorlax", "pikachu", "snorlaxface", "clown", "fear", "devil", "fan", "alfresco", "mercedes", "taiga", "angry", "squint", "facemask", "pokerface", "captainshield", "batman", "superman", "spiderman"].includes(orbStyle)) return "bubble";
  if (orbStyle === "gear") return "digital";
  return "soft";
}

export function resolveSoundStyle(value, orbStyle) {
  const style = normalizeSoundStyle(value);
  return style === "matchOrb" ? soundStyleForOrb(orbStyle) : style;
}

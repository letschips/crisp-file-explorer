import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = resolve(projectRoot, "assets");
const mainPath = resolve(projectRoot, "main.js");

const ASSET_STYLES = {
  "alfresco.svg": "alfresco",
  "angry.svg": "angry",
  "basketball.svg": "basketball",
  "batman.svg": "batman",
  "bracelet.svg": "bracelet",
  "captain-america-shield.svg": "captainshield",
  "character1.png": "character1",
  "character2.png": "character2",
  "character3.png": "character3",
  "character4.svg": "character4",
  "character5.svg": "character5",
  "devil.svg": "devil",
  "dizzy.svg": "dizzy",
  "face-mask.svg": "facemask",
  "fan.svg": "fan",
  "fear.svg": "fear",
  "gear.svg": "gear",
  "mercedes.svg": "mercedes",
  "pikachu.svg": "pikachu",
  "poke-ball.svg": "pokeball",
  "poker-face.svg": "pokerface",
  "shut-up.svg": "shutup",
  "snorlax-face.svg": "snorlaxface",
  "snorlax.svg": "snorlax",
  "soccer.svg": "soccer",
  "spider-man.svg": "spiderman",
  "squint.svg": "squint",
  "superman.svg": "superman",
  "taiga.svg": "taiga",
  "tennis.svg": "tennis",
  "vinyl.svg": "vinyl",
};

function escapeTemplateLiteral(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function cleanSvg(source) {
  let cleaned = source
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?(<svg)/i, "$1")
    .trim();
  // Normalize only the root <svg> tag: drop width/height/legacy class and
  // apply the orb class. Child element classes (e.g. cls-N fills) must stay.
  cleaned = cleaned.replace(/^(<svg)\b([^>]*)>/i, (_match, open, attrs) => {
    const cleanedAttrs = attrs
      .replace(/\s+width="[^"]*"/gi, "")
      .replace(/\s+height="[^"]*"/gi, "")
      .replace(/\s+class="[^"]*"/gi, "")
      .trim();
    return `${open} class="crisp-fe-orb-ball"${cleanedAttrs ? ` ${cleanedAttrs}` : ""}>`;
  });
  return cleaned;
}

function blockRange(source, startMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    return null;
  }
  const end = source.indexOf("\n};", start + startMarker.length);
  if (end < 0) {
    throw new Error(`closing brace not found after: ${startMarker}`);
  }
  return { start, end: end + 3 };
}

const svgEntries = [];
const pngEntries = [];

for (const [filename, style] of Object.entries(ASSET_STYLES)) {
  const source = readFileSync(resolve(assetsDir, filename));
  if (filename.endsWith(".svg")) {
    const cleaned = cleanSvg(source.toString("utf8"));
    svgEntries.push(`  ${style}: \`\n    ${escapeTemplateLiteral(cleaned)}\n  \`,`);
  } else {
    pngEntries.push(
      `  ${style}: "data:image/png;base64,${source.toString("base64")}",`,
    );
  }
}

let main = readFileSync(mainPath, "utf8");

// 1. Replace the file-backed IMAGE_ORB_ASSETS with inline PNG data URLs.
// Run on a clean main.js (restore from git first if it was already inlined).
const imageBlock = blockRange(main, "const IMAGE_ORB_ASSETS = {");
if (!imageBlock) {
  throw new Error("image orb block not found");
}
main =
  main.slice(0, imageBlock.start) +
  `const ORB_IMAGE_DATA_URLS = {\n${pngEntries.join("\n")}\n};` +
  main.slice(imageBlock.end);

// 2. Fold the SVG assets into the inline ORB_SVGS map.
const svgBlock = blockRange(main, "const ORB_SVGS = {");
if (!svgBlock) {
  throw new Error("ORB_SVGS block not found");
}
main =
  main.slice(0, svgBlock.end - 2) +
  `\n${svgEntries.join("\n")}\n` +
  main.slice(svgBlock.end - 2);

// 3. Point the orb renderer at the inline data URLs.
const expectedReplacements = [
  [
    "const imagePath = IMAGE_ORB_ASSETS[style];",
    "const imageDataUrl = ORB_IMAGE_DATA_URLS[style];",
  ],
  ["if (imagePath) {", "if (imageDataUrl) {"],
  [
    "img.src = this.plugin.getResourceUrl(imagePath);",
    "img.src = imageDataUrl;",
  ],
];
for (const [from, to] of expectedReplacements) {
  const fromCount = main.split(from).length - 1;
  if (fromCount === 1) {
    main = main.split(from).join(to);
  } else {
    throw new Error(`expected exactly 1 occurrence of "${from}", found ${fromCount}`);
  }
}

if (main.includes("IMAGE_ORB_ASSETS")) {
  throw new Error("IMAGE_ORB_ASSETS still referenced after transform");
}

writeFileSync(mainPath, main);
process.stdout.write(
  `Inlined ${svgEntries.length} SVGs + ${pngEntries.length} PNG data URLs into ${mainPath}\n`,
);

// Custom order for the native file tree: drag a row between two rows to reorder it,
// pin rows to the top of their folder. Orders are item names keyed by folder path;
// names an order has never seen keep the native sort and sit at one end.
export const FLEXPLORER_PLUGIN_ID = "flexplorer";

export const ORDER_SAVE_DELAY_MS = 400;

export const ORDER_SYNC_INTERVAL_MS = 1500;

export function crispOrderParent(path) {
  const index = (path || "").lastIndexOf("/");
  return index < 0 ? "/" : path.slice(0, index);
}

export function crispOrderName(path) {
  return (path || "").slice((path || "").lastIndexOf("/") + 1);
}

export function crispOrderMatches(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

// Folder paths are user data: a folder may be named "constructor" or "__proto__", so path
// dictionaries have no prototype and are read through own properties only.
export function crispOwnList(folders, path) {
  if (!folders || !Object.prototype.hasOwnProperty.call(folders, path)) return null;
  const list = folders[path];
  return Array.isArray(list) ? list : null;
}

export function crispCopyFolders(folders) {
  return Object.assign(Object.create(null), folders);
}

function crispUniqueStrings(value) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item) => typeof item === "string" && item))) : [];
}

export function normalizeExplorerOrder(value) {
  const source = value && typeof value === "object" ? value : {};
  const folders = Object.create(null);
  if (source.folders && typeof source.folders === "object" && !Array.isArray(source.folders)) {
    for (const [folder, list] of Object.entries(source.folders)) {
      const names = crispUniqueStrings(list);
      if (folder && names.length) folders[folder] = names;
    }
  }
  return {
    enabled: source.enabled !== false,
    newItems: source.newItems === "bottom" ? "bottom" : "top",
    folders,
    pinned: crispUniqueStrings(source.pinned),
    flexplorerImported: source.flexplorerImported === true,
  };
}

export function crispOrderFolderItems(items, folderPath, order) {
  const list = crispOwnList(order.folders, folderPath);
  const pinned = order.pinned.length ? new Set(order.pinned) : null;
  const isPinned = (item) => Boolean(pinned && pinned.has(item && item.file && item.file.path));
  if (!list && !items.some(isPinned)) return items;
  const rank = new Map((list || []).map((name, index) => [name, index]));
  const unlisted = order.newItems === "bottom" ? Number.MAX_SAFE_INTEGER : -1;
  return items
    .map((item, index) => {
      const name = item && item.file && item.file.name;
      return { item, index, pinned: isPinned(item), rank: rank.has(name) ? rank.get(name) : unlisted };
    })
    .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.item);
}

export function crispReorderNames(names, moving, anchor, side) {
  const hasAnchor = anchor !== null && anchor !== undefined;
  if (hasAnchor && moving.includes(anchor)) return names.slice();
  const rest = names.filter((name) => !moving.includes(name));
  let index = hasAnchor ? rest.indexOf(anchor) : 0;
  if (index < 0) index = 0;
  else if (hasAnchor && side === "after") index += 1;
  rest.splice(index, 0, ...moving);
  return rest;
}

// Returns the same object when nothing changes: Obsidian reports every descendant of a
// renamed folder, and most of those events touch nothing here.
export function crispRenameInOrder(order, oldPath, newPath) {
  if (!oldPath || !newPath || oldPath === newPath) return order;
  const oldParent = crispOrderParent(oldPath);
  const newParent = crispOrderParent(newPath);
  const oldName = crispOrderName(oldPath);
  const newName = crispOrderName(newPath);
  const folderKeys = Object.keys(order.folders).filter((folder) => crispOrderMatches(folder, oldPath));
  const parentList = crispOwnList(order.folders, oldParent);
  const listed = Boolean(parentList && parentList.includes(oldName));
  const pinnedHit = order.pinned.some((path) => crispOrderMatches(path, oldPath));
  if (!folderKeys.length && !listed && !pinnedHit) return order;

  const kept = Object.create(null);
  const moved = Object.create(null);
  for (const [folder, list] of Object.entries(order.folders)) {
    if (crispOrderMatches(folder, oldPath)) moved[newPath + folder.slice(oldPath.length)] = list.slice();
    else kept[folder] = list.slice();
  }
  const folders = Object.assign(Object.create(null), kept, moved);
  if (listed) {
    const list = crispOwnList(folders, oldParent);
    const index = list.indexOf(oldName);
    if (oldParent === newParent && !list.includes(newName)) list[index] = newName;
    else list.splice(index, 1);
    if (!list.length) delete folders[oldParent];
  }
  const pinned = order.pinned.map((path) => (crispOrderMatches(path, oldPath) ? newPath + path.slice(oldPath.length) : path));
  return normalizeExplorerOrder({ ...order, folders, pinned });
}

export function crispDeleteFromOrder(order, path) {
  if (!path) return order;
  const parent = crispOrderParent(path);
  const name = crispOrderName(path);
  const touched = Object.keys(order.folders).some((folder) => crispOrderMatches(folder, path))
    || Boolean(crispOwnList(order.folders, parent) && crispOwnList(order.folders, parent).includes(name))
    || order.pinned.some((pinnedPath) => crispOrderMatches(pinnedPath, path));
  if (!touched) return order;
  const folders = Object.create(null);
  for (const [folder, list] of Object.entries(order.folders)) {
    if (crispOrderMatches(folder, path)) continue;
    folders[folder] = folder === parent ? list.filter((item) => item !== name) : list.slice();
  }
  const pinned = order.pinned.filter((pinnedPath) => !crispOrderMatches(pinnedPath, path));
  return normalizeExplorerOrder({ ...order, folders, pinned });
}

export function crispImportFlexplorer(data) {
  const items = data && typeof data === "object" ? data.items : null;
  if (!items || typeof items !== "object" || Array.isArray(items)) return null;
  const folders = Object.create(null);
  const pinned = [];
  for (const [path, item] of Object.entries(items)) {
    if (!item || typeof item !== "object") continue;
    if (item.isPinned === true) pinned.push(path);
    const custom = item.sortOrder === undefined || item.sortOrder === "custom";
    const list = crispUniqueStrings(item.customOrder);
    if (custom && list.length) folders[path] = list;
  }
  return { folders, pinned, newItems: data.newItemPlacement === "bottom" ? "bottom" : "top" };
}

// Files split at the middle. Folders keep their middle band for Obsidian's own
// "move into folder"; the bottom edge of an open folder means "first inside it".
export function crispDropZone(top, height, y, isFolder, expanded) {
  const ratio = height > 0 ? (y - top) / height : 0.5;
  if (!isFolder) return ratio < 0.5 ? "before" : "after";
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return expanded ? "inside-start" : "after";
  return "inside";
}

// Obsidian-style free name ("same 1.md"); a name without an extension keeps every character.
export function crispAvailableTarget(folderPath, file, isTaken) {
  const prefix = folderPath === "/" ? "" : `${folderPath}/`;
  const target = prefix + file.name;
  if (!isTaken(target)) return target;
  const suffix = !Array.isArray(file.children) && file.extension ? `.${file.extension}` : "";
  const stem = suffix && file.name.endsWith(suffix) && file.name.length > suffix.length
    ? file.name.slice(0, file.name.length - suffix.length)
    : file.name;
  const extension = stem === file.name ? "" : suffix;
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${stem} ${index}${extension}`;
    if (!isTaken(candidate)) return candidate;
  }
}

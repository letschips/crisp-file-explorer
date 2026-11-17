// Entitlement lives in a module-private map keyed by the plugin. Nothing on the plugin instance
// can turn it on; only a license check applied here can.
const FE_ENTITLED = new WeakMap();

/** The single gate every licensed feature goes through. */
export function fileExplorerEntitled(owner) {
  return !!owner && FE_ENTITLED.get(owner) === true;
}

/** Records the outcome of a license check for this plugin. */
export function applyFileExplorerEntitlement(owner, valid) {
  FE_ENTITLED.set(owner, valid === true);
}

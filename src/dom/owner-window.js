export function getOwnerDocument(element) {
  if (element && element.ownerDocument) return element.ownerDocument;
  return typeof document !== "undefined" ? document : null;
}

export function getOwnerWindow(element) {
  const ownerDocument = getOwnerDocument(element);
  if (ownerDocument && ownerDocument.defaultView) return ownerDocument.defaultView;
  return typeof window !== "undefined" ? window : null;
}

export function isConnectedToOwnerDocument(element) {
  const ownerDocument = getOwnerDocument(element);
  if (ownerDocument && ownerDocument.body && typeof ownerDocument.body.contains === "function") {
    return ownerDocument.body.contains(element);
  }
  return Boolean(element && element.isConnected !== false);
}

export function requestOwnerFrame(element, callback) {
  const ownerWindow = getOwnerWindow(element);
  if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
    return ownerWindow.requestAnimationFrame(callback);
  }
  return requestAnimationFrame(callback);
}

export function cancelOwnerFrame(element, frame) {
  if (!frame) return;
  const ownerWindow = getOwnerWindow(element);
  if (ownerWindow && typeof ownerWindow.cancelAnimationFrame === "function") {
    ownerWindow.cancelAnimationFrame(frame);
    return;
  }
  cancelAnimationFrame(frame);
}

export function setOwnerTimeout(element, callback, delay) {
  const ownerWindow = getOwnerWindow(element);
  return ownerWindow && typeof ownerWindow.setTimeout === "function"
    ? ownerWindow.setTimeout(callback, delay)
    : setTimeout(callback, delay);
}

export function clearOwnerTimeout(element, timer) {
  if (!timer) return;
  const ownerWindow = getOwnerWindow(element);
  if (ownerWindow && typeof ownerWindow.clearTimeout === "function") {
    ownerWindow.clearTimeout(timer);
    return;
  }
  clearTimeout(timer);
}

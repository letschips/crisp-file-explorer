import { requestUrl } from "./obsidian.js";

const CRISP_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`;

const CRISP_LICENSE_PRODUCTS = [
  "Crisp Suite",
  "Crisp Organize",
  "Crisp ASR",
  "Crisp Annotations",
  "Crisp File Explorer",
  "Crisp Focus",
  "Crisp Reading Rail",
  "Crisp Base",
];

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

// WebCrypto is taken once at load: replacing crypto.subtle later does not reach the license check.
const SUBTLE = (() => {
  try {
    const globalCrypto = globalThis.crypto;
    const subtle = (globalCrypto && globalCrypto.subtle) || (typeof window !== "undefined" && window.crypto ? window.crypto.subtle : undefined);
    return subtle ? Object.freeze({ importKey: subtle.importKey.bind(subtle), verify: subtle.verify.bind(subtle) }) : null;
  } catch {
    return null;
  }
})();

let subtleCheck = null;

// A verifier that accepts an all-zero signature is not a real verifier; no license is trusted then.
function subtleTrusted() {
  if (!subtleCheck) {
    subtleCheck = (async () => {
      if (!SUBTLE) return false;
      try {
        const key = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
        const accepted = await SUBTLE.verify("Ed25519", key, new Uint8Array(64), new TextEncoder().encode("crisp-file-explorer/self-test"));
        return accepted === false;
      } catch {
        return false;
      }
    })();
  }
  return subtleCheck;
}

async function importEd25519PublicKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  if (!SUBTLE) throw new Error("WebCrypto 在当前运行环境不可用");
  return await SUBTLE.importKey(
    "spki",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

const LICENSE_CACHE_TTL_MS = 15 * 60 * 1000;

function createLicenseVerificationCache(ttlMs, now = Date.now) {
  const resolved = new Map();
  const inFlight = new Map();
  return {
    verify(licenseCode, targetPluginId, verifier) {
      const key = `${targetPluginId}\u0000${licenseCode}`;
      const cached = resolved.get(key);
      if (cached && cached.expiresAt >= now()) return Promise.resolve(cached.result);
      const pending = inFlight.get(key);
      if (pending) return pending;
      const operation = verifier().then((result) => {
        resolved.set(key, { expiresAt: now() + Math.max(0, ttlMs), result });
        return result;
      }).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, operation);
      return operation;
    },
    clear() {
      resolved.clear();
      inFlight.clear();
    },
  };
}

const licenseVerificationCache = createLicenseVerificationCache(LICENSE_CACHE_TTL_MS);

export function clearLicenseVerificationCache() {
  licenseVerificationCache.clear();
}

/**
 * Chat apps mangle long codes when they are copied: line breaks, spaces (incl. full-width/NBSP),
 * zero-width characters, and surrounding text such as "卡密：…。". Returns the bare code.
 */
export function normalizeLicenseCode(input) {
  if (typeof input !== "string") return "";
  const compact = input.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
  const match = compact.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
  return match ? match[0] : compact;
}

// Online checks are cached per session for 15 minutes; signature-only checks are never cached.
export function verifyLicenseCode(licenseCode, targetPluginId = "crisp-file-explorer", skipOnline = false) {
  const trimmed = normalizeLicenseCode(licenseCode);
  if (skipOnline) return verifyLicenseCodeUncached(trimmed, targetPluginId, true);
  return licenseVerificationCache.verify(trimmed, targetPluginId, () => (
    verifyLicenseCodeUncached(trimmed, targetPluginId, false)
  ));
}

async function verifyLicenseCodeUncached(licenseCode, targetPluginId = "crisp-file-explorer", skipOnline = false) {
  const trimmed = normalizeLicenseCode(licenseCode);
  if (!trimmed) return { valid: false, reason: "授权码为空" };
  const parts = trimmed.split(".");
  if (parts.length !== 2) return { valid: false, reason: "授权码格式无效" };
  const [payloadBase64, signatureBase64] = parts;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadBase64));
    const payload = JSON.parse(payloadJson);
    if (!CRISP_LICENSE_PRODUCTS.includes(payload.product)) return { valid: false, reason: "授权码不属于 Crisp 系列插件" };
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (!features.includes("all") && !features.includes(targetPluginId)) {
      return { valid: false, reason: `该授权码未包含 ${targetPluginId} 权限` };
    }
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: `授权已于 ${payload.expiresAt.split("T")[0]} 到期` };
    }
    if (!SUBTLE || !(await subtleTrusted())) return { valid: false, reason: "WebCrypto 在当前运行环境不可用" };
    const publicKey = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
    const isValid = await SUBTLE.verify(
      "Ed25519",
      publicKey,
      base64UrlToUint8Array(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (isValid !== true) return { valid: false, reason: "授权签名无效" };
    if (skipOnline) return { valid: true, payload };

    try {
      const app = (window.app);
      const deviceId = app?.appId || (app?.vault?.getName ? "vault-" + encodeURIComponent(app.vault.getName()) : "device-default");
      const res = await Promise.race([
        requestUrl({
          url: "https://license.letschips.xyz/api/verify-device",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            licenseCode: trimmed,
            deviceId: deviceId,
            action: "activate",
            pluginId: targetPluginId
          }),
          throw: false
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Crisp license check timeout")), 2500))
      ]);

      let cloudResult = null;
      try {
        cloudResult = res.json;
      } catch {
        cloudResult = null;
      }

      // 1. 明确的服务端业务拒绝（200/400/401/403 且带有明确的 valid: false）
      const isAuthDenial =
        (res.status === 200 || res.status === 400 || res.status === 401 || res.status === 403) &&
        cloudResult !== null &&
        cloudResult.valid === false;

      if (isAuthDenial) {
        return {
          valid: false,
          reason: cloudResult?.reason || "授权已被服务端拒绝或设备数已达上限"
        };
      }

      // 2. 服务端明确批准（200 OK 且 valid: true）
      if (res.status === 200 && cloudResult && cloudResult.valid === true) {
        return { valid: true, payload, message: cloudResult.message };
      }

      // 其余情况（404/408/429/5xx、网关故障等）均视为服务不可用，降级离线可用
      if (res.status >= 400) {
        console.warn(`[Crisp File Explorer] License server unavailable (status ${res.status}), offline fallback`);
      }
    } catch (netErr) {}

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: `解析授权码失败: ${e.message}` };
  }
}

export const LICENSE_PLUGIN_ID = "crisp-file-explorer";

// Every paid Crisp plugin; module constant so nothing on a plugin instance can widen the scan.
const CRISP_SIBLING_PLUGIN_IDS = [
  "crisp-annotations", "crisp-asr", "crisp-base", "crisp-file-explorer", "crisp-focus", "crisp-mind",
  "crisp-pets", "crisp-pulse", "crisp-reading-rail", "crisp-recall", "crisp-ripple", "crisp-search",
  "crisp-tempo", "crisp-visual",
];

/** Codes saved by sibling Crisp plugins in this vault that pass the local signature check (read-only scan). */
export async function discoverVaultCrispLicenses(app, targetPluginId = LICENSE_PLUGIN_ID, limit = 5) {
  if (!app) return [];
  const candidates = [];
  const seen = new Set();
  const add = (code) => {
    const clean = normalizeLicenseCode(code);
    if (!clean.includes(".") || seen.has(clean)) return;
    seen.add(clean);
    candidates.push(clean);
  };
  for (const pid of CRISP_SIBLING_PLUGIN_IDS) {
    if (pid === targetPluginId) continue;
    const p = app.plugins?.plugins?.[pid];
    add(p?.settings?.licenseCode);
    add(p?.settings?.licenseKey);
    add(p?.data?.licenseCode);
    add(p?.data?.licenseKey);
    add(p?.options?.licenseCode);
    add(p?.licenseKey);
  }
  try {
    const adapter = app.vault?.adapter;
    if (adapter && typeof adapter.list === "function") {
      const pluginsDir = `${app.vault?.configDir || ".obsidian"}/plugins`;
      if (await adapter.exists(pluginsDir)) {
        const listing = await adapter.list(pluginsDir);
        for (const folder of listing.folders || []) {
          const name = folder.split("/").pop() || "";
          if (!name.startsWith("crisp-") || name === targetPluginId) continue;
          const dataPath = `${folder}/data.json`;
          if (!(await adapter.exists(dataPath))) continue;
          try {
            const data = JSON.parse(await adapter.read(dataPath));
            add(data?.licenseCode || data?.licenseKey || data?.license);
            // Crisp Pulse keeps its settings nested under `settings`.
            add(data?.settings?.licenseCode || data?.settings?.licenseKey);
          } catch {
            // a damaged data.json of another plugin is skipped
          }
        }
      }
    }
  } catch (error) {
    console.debug("Crisp File Explorer license scan error:", error);
  }
  const valid = [];
  for (const code of candidates) {
    if (valid.length >= limit) break;
    if ((await verifyLicenseCode(code, targetPluginId, true)).valid) valid.push(code);
  }
  return valid;
}

/**
 * Startup, once: when the stored code is empty or no longer passes the online check, take the first
 * sibling code that passes online and hand it to `persistCode`. Returns the adopted code or null.
 * It only saves; the caller re-runs the normal license check, which is what actually grants access.
 */
export async function adoptSiblingLicense({ app, targetPluginId = LICENSE_PLUGIN_ID, getCode, persistCode, isStale }) {
  const own = getCode();
  if (own && (await verifyLicenseCode(own, targetPluginId)).valid) return null;
  for (const candidate of await discoverVaultCrispLicenses(app, targetPluginId)) {
    if (isStale()) return null;
    if (candidate === normalizeLicenseCode(own)) continue;
    const result = await verifyLicenseCode(candidate, targetPluginId);
    if (isStale()) return null;
    if (!result.valid) continue;
    if (getCode() !== own) return null;
    await persistCode(candidate);
    return candidate;
  }
  return null;
}

export const UNLICENSED_STATUS = "❌ 未激活（Crisp File Explorer 需激活后使用，请输入授权码）";

export function describeLicenseStatus(result) {
  if (!result || !result.valid || !result.payload) {
    return `❌ 未激活（${(result && result.reason) || "授权码无效"}）`;
  }
  const { userName, expiresAt } = result.payload;
  const details = [];
  if (userName) details.push(`授权给: ${userName}`);
  details.push(`到期时间: ${typeof expiresAt === "string" && expiresAt ? expiresAt.split("T")[0] : "长期有效"}`);
  return `✅ 已激活（${details.join("，")}）`;
}

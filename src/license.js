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

async function importEd25519PublicKey(pem) {
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await window.crypto.subtle.importKey(
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

// Online checks are cached per session for 15 minutes; signature-only checks are never cached.
export function verifyLicenseCode(licenseCode, targetPluginId = "crisp-file-explorer", skipOnline = false) {
  const trimmed = (licenseCode || "").trim();
  if (skipOnline) return verifyLicenseCodeUncached(trimmed, targetPluginId, true);
  return licenseVerificationCache.verify(trimmed, targetPluginId, () => (
    verifyLicenseCodeUncached(trimmed, targetPluginId, false)
  ));
}

async function verifyLicenseCodeUncached(licenseCode, targetPluginId = "crisp-file-explorer", skipOnline = false) {
  const trimmed = (licenseCode || "").trim();
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
    const publicKey = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
    const isValid = await window.crypto.subtle.verify(
      "Ed25519",
      publicKey,
      base64UrlToUint8Array(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (!isValid) return { valid: false, reason: "授权签名无效" };
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

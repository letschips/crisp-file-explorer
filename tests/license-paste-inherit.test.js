"use strict";

// Paste normalisation and sibling-license inheritance, against the real verifier with a test key.
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const vm = require("node:vm");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");
const esbuild = require("esbuild");

const pair = generateKeyPairSync("ed25519");
const publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString().trim();
const bundled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "license.js")],
  bundle: true, write: false, format: "cjs", platform: "neutral", external: ["obsidian"],
}).outputFiles[0].text.replace(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/, publicPem);

function makeCode(overrides = {}, key = pair.privateKey) {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite", licenseId: "PASTE-TEST", features: ["all"], expiresAt: "2999-01-01T00:00:00Z", ...overrides,
  })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), key).toString("base64url")}`;
}

// serverVerdict: (licenseCode) => { valid } | "down"
function load(serverVerdict = () => ({ valid: true })) {
  const requests = [];
  const requestUrl = async (options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const verdict = serverVerdict(body.licenseCode);
    if (verdict === "down") throw new Error("offline");
    return { status: 200, json: verdict };
  };
  const context = {
    module: { exports: {} }, atob, btoa, TextEncoder, TextDecoder, console: { debug() {}, warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, crypto: webcrypto,
    require: (id) => (id === "obsidian" ? { requestUrl } : require(id)),
  };
  context.exports = context.module.exports;
  context.window = context;
  vm.runInNewContext(bundled, context);
  return { lib: context.module.exports, requests };
}

const CLEAN = makeCode();
const [P, S] = CLEAN.split(".");

test("normalize: breaks, spaces, full-width space and zero-width characters are removed", async () => {
  const { lib } = load();
  const messy = `${P.slice(0, 10)}\n${P.slice(10, 20)}\r\n${P.slice(20)}.${S.slice(0, 15)}\u3000${S.slice(15, 30)}\u200B ${S.slice(30)}`;
  assert.equal(lib.normalizeLicenseCode(messy), CLEAN);
  assert.equal((await lib.verifyLicenseCode(messy, "crisp-file-explorer", true)).valid, true);
});

test("normalize: surrounding text is dropped and the server receives the clean code", async () => {
  const { lib, requests } = load();
  for (const wrapped of [`卡密：${CLEAN}。`, `${CLEAN}\n复制卡密发送给买家`]) {
    assert.equal((await lib.verifyLicenseCode(wrapped, "crisp-file-explorer")).valid, true);
  }
  // Both wrappers normalise to the same key, so the second call is served from the cache.
  assert.equal(requests.length, 1);
  for (const body of requests) assert.equal(body.licenseCode, CLEAN);
});

test("normalize: garbage and empty input stay invalid with the same reasons", async () => {
  const { lib } = load();
  assert.equal(lib.normalizeLicenseCode(undefined), "");
  const empty = await lib.verifyLicenseCode("  \n ", "crisp-file-explorer", true);
  assert.deepEqual([empty.valid, empty.reason], [false, "授权码为空"]);
  const junk = await lib.verifyLicenseCode("not a code", "crisp-file-explorer", true);
  assert.deepEqual([junk.valid, junk.reason], [false, "授权码格式无效"]);
});

test("normalize: a clean code is unchanged", async () => {
  const { lib } = load();
  assert.equal(lib.normalizeLicenseCode(CLEAN), CLEAN);
  assert.equal((await lib.verifyLicenseCode(CLEAN, "crisp-file-explorer", true)).valid, true);
});

function fakeApp(siblings, loaded = {}) {
  const files = new Map();
  const folders = [];
  for (const [id, data] of Object.entries(siblings)) {
    folders.push(`.config/plugins/${id}`);
    files.set(`.config/plugins/${id}/data.json`, JSON.stringify(data));
  }
  const counters = { list: 0 };
  return {
    counters,
    app: {
      plugins: { plugins: loaded },
      vault: {
        configDir: ".config",
        adapter: {
          exists: async (p) => p === ".config/plugins" || files.has(p),
          list: async () => { counters.list++; return { folders, files: [] }; },
          read: async (p) => files.get(p),
        },
      },
    },
  };
}

function adopt(lib, app, own) {
  const state = { code: own, saved: [] };
  const promise = lib.adoptSiblingLicense({
    app, targetPluginId: "crisp-file-explorer",
    getCode: () => state.code,
    persistCode: async (code) => { state.code = code; state.saved.push(code); },
    isStale: () => false,
  });
  return { state, promise };
}

test("inherit: no own code, sibling has a valid one -> saved (clean, from a messy data.json)", async () => {
  const { lib } = load();
  const { app } = fakeApp({ "crisp-mind": { licenseCode: `卡密：${CLEAN}\n` } });
  const { state, promise } = adopt(lib, app, "");
  assert.equal(await promise, CLEAN);
  assert.deepEqual(state.saved, [CLEAN]);
});

test("inherit: Tempo's licenseKey and the configured config dir are read", async () => {
  const { lib } = load();
  const { app } = fakeApp({ "crisp-tempo": { licenseKey: CLEAN } });
  assert.equal(await adopt(lib, app, "").promise, CLEAN);
});

test("inherit: a still-valid own code is neither scanned nor replaced", async () => {
  const { lib } = load();
  const other = makeCode({ licenseId: "OTHER" });
  const { app, counters } = fakeApp({ "crisp-mind": { licenseCode: other } });
  const { state, promise } = adopt(lib, app, CLEAN);
  assert.equal(await promise, null);
  assert.equal(counters.list, 0);
  assert.deepEqual(state.saved, []);
});

test("inherit: a sibling code the server rejects is not saved", async () => {
  const { lib } = load(() => ({ valid: false, reason: "revoked" }));
  const { app } = fakeApp({ "crisp-mind": { licenseCode: CLEAN } });
  const { state, promise } = adopt(lib, app, "");
  assert.equal(await promise, null);
  assert.deepEqual(state.saved, []);
});

test("inherit: forged or wrong-product codes never reach the server", async () => {
  const { lib, requests } = load();
  const other = generateKeyPairSync("ed25519");
  const forged = makeCode({}, other.privateKey);
  const wrongProduct = makeCode({ product: "Crisp Pulse" });
  const singleOther = makeCode({ features: ["crisp-pulse"] });
  const { app } = fakeApp({
    "crisp-mind": { licenseCode: forged }, "crisp-pulse": { licenseCode: wrongProduct }, "crisp-search": { licenseCode: singleOther },
  });
  const { state, promise } = adopt(lib, app, "");
  assert.equal(await promise, null);
  assert.equal(requests.length, 0);
  assert.deepEqual(state.saved, []);
});

test("inherit: an expired own code falls through to a sibling code", async () => {
  const expired = makeCode({ expiresAt: "2020-01-01T00:00:00Z" });
  const { lib } = load();
  const { app } = fakeApp({ "crisp-mind": { licenseCode: CLEAN } });
  assert.equal(await adopt(lib, app, expired).promise, CLEAN);
});

// Crisp Pulse keeps its code under `settings`; Pets and Days keep theirs under `options`.
test("inherit: Crisp Pulse's nested settings on disk and a loaded sibling's options are read", async () => {
  const { lib } = load();
  const B = makeCode({ licenseId: "TEST-B" });
  const { app } = fakeApp({ "crisp-pulse": { settings: { licenseCode: CLEAN } } });
  assert.deepEqual([...(await lib.discoverVaultCrispLicenses(app, "crisp-file-explorer"))], [CLEAN]);
  app.plugins.plugins["crisp-focus"] = { options: { licenseCode: B } };
  assert.deepEqual([...(await lib.discoverVaultCrispLicenses(app, "crisp-file-explorer"))], [B, CLEAN]);
});

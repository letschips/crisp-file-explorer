"use strict";

// Hardening: the verifier takes WebCrypto once at load and must reject an all-zero signature,
// so a console patch of crypto.subtle cannot make a forged code pass.
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const esbuild = require("esbuild");

const bundled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, "..", "src", "license.js")],
  bundle: true, write: false, format: "cjs", platform: "neutral", external: ["obsidian"],
}).outputFiles[0].text;

function load(crypto) {
  const context = {
    module: { exports: {} }, atob, btoa, TextEncoder, TextDecoder, console, setTimeout, clearTimeout,
    require: (id) => (id === "obsidian" ? { requestUrl: async () => { throw new Error("offline"); } } : require(id)),
  };
  context.exports = context.module.exports;
  context.crypto = crypto;
  context.window = context;
  vm.runInNewContext(bundled, context);
  return { lib: context.module.exports, context };
}

function forged() {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite", licenseId: "FORGED", userName: "x", expiresAt: "2999-01-01T00:00:00.000Z", features: ["all"],
  })).toString("base64url");
  return `${payload}.${Buffer.alloc(64).toString("base64url")}`;
}

const real = webcrypto.subtle;

test("replacing crypto.subtle after load cannot pass a forged code", async () => {
  const { lib, context } = load({ subtle: real });
  context.crypto = { subtle: { importKey: real.importKey.bind(real), verify: async () => true } };
  assert.equal((await lib.verifyLicenseCode(forged(), "crisp-file-explorer", true)).valid, false);
});

test("a verifier that accepts everything at load is not trusted, so no code passes", async () => {
  const { lib } = load({ subtle: { importKey: real.importKey.bind(real), verify: async () => true } });
  assert.equal((await lib.verifyLicenseCode(forged(), "crisp-file-explorer", true)).valid, false);
});

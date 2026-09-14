"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('orb generation updates existing artwork and is repeatable without losing runtime edits', () => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-orb-generator-'));
  try {
    fs.cpSync(path.join(root, 'scripts'), path.join(temp, 'scripts'), { recursive: true });
    fs.cpSync(path.join(root, 'assets'), path.join(temp, 'assets'), { recursive: true });
    fs.copyFileSync(path.join(root, 'main.js'), path.join(temp, 'main.js'));
    fs.appendFileSync(path.join(temp, 'main.js'), '\n// Preserve unrelated local edits.\n');
    const asset = path.join(temp, 'assets', 'character6.svg');
    fs.writeFileSync(asset, fs.readFileSync(asset, 'utf8').replace('#fbf8f6', '#abcdef'));
    const run = () => execFileSync(process.execPath, [path.join(temp, 'scripts', 'inline-orb-assets.mjs')]);
    run();
    const first = fs.readFileSync(path.join(temp, 'main.js'), 'utf8');
    assert.match(first, /#abcdef/);
    assert.match(first, /Preserve unrelated local edits/);
    assert.equal((first.match(/^\s*character6: `/gm) || []).length, 1);
    assert.match(first, /^\s*dragonball: `/m);
    run();
    assert.equal(fs.readFileSync(path.join(temp, 'main.js'), 'utf8'), first);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

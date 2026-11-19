import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

test('JSON storage survives a restart and preserves a recoverable backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbtb-store-'));
  try {
    const file = path.join(dir, 'db.json');
    const store = createStore(file);
    store.insert('projects', { id: 'p1', name: 'First version' });
    store.flush();
    store.update('projects', 'p1', { name: 'Second version' });
    store.flush();
    assert.equal(createStore(file).get('projects', 'p1').name, 'Second version');
    assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).projects[0].name, 'First version');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt JSON never silently resets and overwrites project data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbtb-corrupt-'));
  try {
    const file = path.join(dir, 'db.json');
    fs.writeFileSync(file, '{ broken JSON ');
    assert.throws(() => createStore(file), /원본 보호/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ broken JSON ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

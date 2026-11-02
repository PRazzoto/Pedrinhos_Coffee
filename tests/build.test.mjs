import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const assets = ['index.html', 'barista.html', 'acompanhamento.html', 'styles.css', 'menu.js', 'order.js', 'barista.js', 'acompanhamento.js', 'order-status.js', 'order-metrics.js', 'metricas.html', 'metricas.js', 'metrics-summary.js', 'revenue-simulation.js', 'revenue-widget.js'];
const required = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_APP_ID: 'test-app-id',
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'barista-build-test-'));
  t.after(async () => {
    // Only remove the temporary directory created for this test.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('barista-build-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'scripts'));
  for (const file of [...assets, 'scripts/build.mjs']) {
    await copyFile(new URL(file, root), join(directory, file));
  }
  return directory;
}

function build(directory, variables) {
  const env = { ...process.env };
  for (const name of [...Object.keys(required), 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID']) {
    delete env[name];
  }
  return spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: directory, env: { ...env, ...variables }, encoding: 'utf8',
  });
}

test('build creates all runtime files from env without a local Firebase config', async (t) => {
  const directory = await fixture(t);
  const result = build(directory, required);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(join(directory, 'dist'))).sort(), [...assets, 'firebase-config.js'].sort());
  for (const file of assets) {
    assert.deepEqual(await readFile(join(directory, 'dist', file)), await readFile(new URL(file, root)));
  }
  const generated = await import(pathToFileURL(join(directory, 'dist/firebase-config.js')));
  assert.deepEqual(generated.firebaseConfig, {
    apiKey: required.FIREBASE_API_KEY,
    authDomain: required.FIREBASE_AUTH_DOMAIN,
    projectId: required.FIREBASE_PROJECT_ID,
    appId: required.FIREBASE_APP_ID,
  });
  assert.equal(generated.firebaseConfigured, true);
});

test('each missing required variable fails before producing deployment files', async (t) => {
  const directory = await fixture(t);
  for (const name of Object.keys(required)) {
    const variables = { ...required };
    delete variables[name];
    const result = build(directory, variables);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(name));
    assert.ok(!result.stderr.includes(required.FIREBASE_API_KEY));
    await assert.rejects(readdir(join(directory, 'dist')), { code: 'ENOENT' });
  }
});

test('generated JS handles quoted values and never copies a local config into deployment', async (t) => {
  const directory = await fixture(t);
  const localConfig = 'throw new Error("Local-only configuration must not be deployed");';
  await writeFile(join(directory, 'firebase-config.js'), localConfig);
  const variables = {
    ...required,
    FIREBASE_STORAGE_BUCKET: 'bucket-with-"quotes"',
    FIREBASE_MESSAGING_SENDER_ID: 'test-sender',
  };
  const result = build(directory, variables);
  assert.equal(result.status, 0, result.stderr);
  const generated = await import(pathToFileURL(join(directory, 'dist/firebase-config.js')));
  assert.equal(generated.firebaseConfig.storageBucket, variables.FIREBASE_STORAGE_BUCKET);
  assert.equal(generated.firebaseConfig.messagingSenderId, 'test-sender');
  assert.equal(await readFile(join(directory, 'firebase-config.js'), 'utf8'), localConfig);
});

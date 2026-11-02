import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const fields = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  appId: 'FIREBASE_APP_ID',
};
const missing = Object.values(fields).filter((name) => !process.env[name]?.trim());

if (missing.length) {
  console.error(`Missing Firebase environment variables: ${missing.join(', ')}`);
  console.error('Add them in Vercel Project Settings > Environment Variables, then redeploy.');
  process.exitCode = 1;
} else {
  const firebaseConfig = Object.fromEntries(
    Object.entries(fields).map(([key, name]) => [key, process.env[name].trim()]));
  for (const [key, name] of [
    ['storageBucket', 'FIREBASE_STORAGE_BUCKET'],
    ['messagingSenderId', 'FIREBASE_MESSAGING_SENDER_ID'],
  ]) {
    const value = process.env[name]?.trim();
    if (value) firebaseConfig[key] = value;
  }

  await mkdir(output, { recursive: true });
  for (const file of ['index.html', 'barista.html', 'acompanhamento.html', 'styles.css', 'menu.js', 'order.js', 'barista.js', 'acompanhamento.js', 'order-status.js', 'order-metrics.js', 'metricas.html', 'metricas.js', 'metrics-summary.js', 'revenue-simulation.js', 'revenue-widget.js']) {
    await copyFile(new URL(file, root), new URL(file, output));
  }
  await writeFile(new URL('firebase-config.js', output),
    '// Generated at build time. Firebase Web configuration is public in the browser.\n' +
    `export const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};\n` +
    'export const firebaseConfigured = true;\n', 'utf8');
  console.log('Static site ready in dist/.');
}

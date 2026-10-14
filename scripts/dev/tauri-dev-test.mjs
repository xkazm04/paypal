#!/usr/bin/env node
// `npm run tauri:dev:test`: build the client with the inspector on, then run the native shell.
//
// The shell embeds apps/desktop/client/dist (windows are created in Rust, the CSP is
// `script-src 'self'`), so there is no dev server: the client is rebuilt with source stamping
// (THE_TABLE_INSPECTOR=1, VITE_INSPECTOR=1) and cargo re-embeds it. In the app press Ctrl+Shift+L.
// Cache and temp locations match scripts/cargo.ps1.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const client = join(root, 'apps', 'desktop', 'client');
const tmp = join(root, '.build', 'tmp');
mkdirSync(tmp, { recursive: true });

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(join(client, 'node_modules'))) run('pnpm', ['--dir', client, 'install']);
run('pnpm', ['--dir', client, 'exec', 'vite', 'build'], { THE_TABLE_INSPECTOR: '1', VITE_INSPECTOR: '1' });
console.log('\n[tauri:dev:test] client built with the inspector; starting the shell. Ctrl+Shift+L arms it.\n');
run('cargo', ['run', '-p', 'table-desktop'], {
  CARGO_HOME: join(root, '.build', 'cargo-home'),
  CARGO_TARGET_DIR: join(root, 'target'),
  TEMP: tmp,
  TMP: tmp,
});

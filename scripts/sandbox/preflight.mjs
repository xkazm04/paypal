// Verifies sandbox credentials by fetching an OAuth token. Prints only pass/fail facts, never values.
// Usage: node scripts/sandbox/preflight.mjs [path-to-env]   (default scripts/sandbox/.env.sandbox)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '.env.sandbox');
export function loadEnv(path = file) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv();
const need = ['PAYPAL_SANDBOX_CLIENT_ID', 'PAYPAL_SANDBOX_SECRET', 'PAYPAL_SANDBOX_MERCHANT_ID'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exit(2); }
const optional = ['PAYPAL_SANDBOX_INVOICE_EMAIL'].filter((k) => !env[k]);
if (optional.length) console.warn('note: unset (spike 8 will not run):', optional.join(', '));

const basic = Buffer.from(`${env.PAYPAL_SANDBOX_CLIENT_ID}:${env.PAYPAL_SANDBOX_SECRET}`).toString('base64');
const res = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
  method: 'POST',
  headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`FAIL oauth ${res.status}: ${body.error ?? 'unknown'}`); process.exit(1); }
console.log(`OK oauth token (expires_in=${body.expires_in}s, app_id=${body.app_id ?? '?'})`);
console.log('scopes:', String(body.scope ?? '').split(' ').filter(Boolean).length);

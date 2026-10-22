// The client's copies of Rust constants (the browser mock and lib/marketWatch) are read against
// the Rust source they copy, so a change on the Rust side turns this red instead of letting the
// preview and the editor show other numbers than the wallet enforces. Comments are stripped first,
// so a constant named only in prose never satisfies the match.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_MARKET_CHECKS_DAY, MAX_WATCHED_ITEMS, productValid } from '../lib/marketWatch';
import { AUTHORIZED_DEADLINE_SECS, CORROBORATION_SECS, FORECAST_HORIZON_SECS, ORDER_CREATED_DEADLINE_SECS } from './forecast';
import { RESCUE_WATCH_MAX, RESCUE_WATCH_READS_DAY } from './rescue';
import { SAFETY_DEALS } from './safety';

const CRATES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../crates');

function source(path: string): string {
  return readFileSync(resolve(CRATES, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The value of `const NAME: T = <a * b * ...>;` in a Rust file, or of a named alias of one. */
function rustConst(path: string, name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*:\\s*[A-Za-z0-9_]+\\s*=\\s*([^;]+);`).exec(source(path));
  if (!m) throw new Error(`${name} not found in ${path}`);
  const expr = m[1]!.trim();
  if (/^[\d_\s*]+$/.test(expr)) return expr.split('*').reduce((p, f) => p * Number(f.trim().replace(/_/g, '')), 1);
  const alias = /^table_core::([A-Z_]+)$/.exec(expr);
  if (alias) return rustConst('table-core/src/deal.rs', alias[1]!);
  throw new Error(`${name} = ${expr}: not a plain product`);
}

describe('client copies of Rust constants', () => {
  it('reads the Rust value of every copied constant', () => {
    const pins: Array<[string, string, number]> = [
      ['table-core/src/mandate.rs', 'MAX_MARKET_CHECKS_DAY', MAX_MARKET_CHECKS_DAY],
      ['table-core/src/mandate.rs', 'MAX_WATCHED_ITEMS', MAX_WATCHED_ITEMS],
      ['table-core/src/rescue.rs', 'RESCUE_WATCH_MAX', RESCUE_WATCH_MAX],
      ['table-core/src/rescue.rs', 'RESCUE_WATCH_READS_DAY', RESCUE_WATCH_READS_DAY],
      ['table-core/src/deal.rs', 'CORROBORATION_SECS', CORROBORATION_SECS],
      ['table-attention/src/forecast.rs', 'ORDER_CREATED_DEADLINE_SECS', ORDER_CREATED_DEADLINE_SECS],
      ['table-attention/src/forecast.rs', 'AUTHORIZED_DEADLINE_SECS', AUTHORIZED_DEADLINE_SECS],
      ['table-runtime/src/forecast.rs', 'FORECAST_HORIZON_SECS', FORECAST_HORIZON_SECS],
      ['table-client/src/history.rs', 'SAFETY_DEALS', SAFETY_DEALS],
    ];
    for (const [path, name, client] of pins) expect(client, `${name} (${path})`).toBe(rustConst(path, name));
  });

  it('bounds a market product id as table-core market_product_valid does', () => {
    const bound = /product\.len\(\)\s*<=\s*(\d+)/.exec(source('table-core/src/market.rs'))?.[1];
    expect(bound).toBeDefined();
    expect(productValid('p'.repeat(Number(bound)))).toBe(true);
    expect(productValid('p'.repeat(Number(bound) + 1))).toBe(false);
  });
});

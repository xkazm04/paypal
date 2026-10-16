// The scoreboard's head witness: pure rules for comparing a head kept earlier (a look this browser
// stored, or a head from a wallet's proof file) with the house's record now. A classic script so
// the page's CSP ('self' only, no modules) loads it before scoreboard.js; it puts one object,
// `TableWitness`, on the global and touches nothing else. The rules mirror
// `table_proto::compare_heads` case for case; signatures are checked with the browser's own Ed25519.
(() => {
  'use strict';

  const HEAD_DOMAIN = 'table.house.head.v1';
  const PREFIX_DOMAIN = 'table.house.prefix.v1';
  /** A kept-head file larger than this is not a head or a proof file. */
  const MAX_FILE = 2 * 1024 * 1024;

  /** RFC 8785 canonical JSON for the record's values (integers, strings, arrays, objects). */
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }
  const hex = (b) => (Array.isArray(b) ? b.map((x) => x.toString(16).padStart(2, '0')).join('') : typeof b === 'string' ? b : '');
  const unhex = (s) => (s.match(/../g) || []).map((x) => parseInt(x, 16));
  const utf8 = (s) => new TextEncoder().encode(s);
  const isBytes = (v, n) => Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => Number.isInteger(x) && x >= 0 && x < 256);

  /** Ed25519 with the browser's own crypto; false when it cannot check (or the check fails). */
  async function verify(key, signature, data) {
    try {
      const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'Ed25519' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, k, new Uint8Array(signature), data);
    } catch {
      return false;
    }
  }

  /** A signed head as a look: {epoch, rows, hash, at, started, sig} with hex strings. */
  function lookOf(signed) {
    const h = signed.head;
    return { epoch: hex(h.epoch), rows: h.row_count, hash: hex(h.audit_head), at: h.at, started: h.epoch_started, sig: hex(signed.signature) };
  }
  /** Stored looks from their saved text. Looks saved before signatures were kept still load. */
  function looksFrom(text) {
    try {
      const v = JSON.parse(text || '[]');
      return Array.isArray(v) ? v.filter((s) => s && typeof s.epoch === 'string' && Number.isInteger(s.rows)) : [];
    } catch {
      return [];
    }
  }
  /**
   * The signed head to save: the object `table-verify --head` reads. A live head is copied; a
   * stored look is rebuilt from its kept signature; a look stored without one cannot be saved.
   */
  function lookToSave(x) {
    if (x && x.head && isBytes(x.signature)) return { head: { ...x.head }, signature: [...x.signature] };
    if (!x || typeof x.sig !== 'string' || x.sig.length !== 128 || typeof x.hash !== 'string') return null;
    return {
      head: { epoch: unhex(x.epoch), epoch_started: x.started, row_count: x.rows, audit_head: unhex(x.hash), at: x.at },
      signature: unhex(x.sig),
    };
  }

  /**
   * How a later head relates to one kept earlier, given (optionally) the house's signed prefix at
   * the kept row count. Looks and heads compare by hex; a prefix arrives as the wire shape.
   */
  function compareHeads(kept, later, prefix) {
    if (later.epoch !== kept.epoch) return 'new_epoch';
    if (later.rows < kept.rows) return 'shorter';
    if (later.rows === kept.rows) return later.hash === kept.hash ? 'same' : 'rewritten';
    if (prefix && hex(prefix.epoch) === kept.epoch && prefix.row_count === kept.rows && prefix.within === later.rows) {
      return hex(prefix.audit_head) === kept.hash ? 'extends' : 'rewritten';
    }
    return 'longer';
  }
  /** The row count to ask a prefix at: the newest look in this record shorter than now, or null. */
  function prefixToAsk(seen, cur) {
    let rows = null;
    for (const s of seen) if (s.epoch === cur.epoch && s.rows < cur.rows && (rows === null || s.rows > rows)) rows = s.rows;
    return rows;
  }

  async function headSigned(signed, agentKey) {
    const h = signed && signed.head;
    if (!h || !isBytes(signed.signature) || !(h.row_count > 0) || !(h.at >= h.epoch_started)) return false;
    return verify(agentKey, signed.signature, utf8(canonical([HEAD_DOMAIN, h])));
  }
  /** True when the house's agent key signed this prefix (and it is well formed). */
  async function prefixSigned(signed, agentKey) {
    const p = signed && signed.prefix;
    if (!p || !isBytes(signed.signature) || !(p.row_count > 0) || !(p.row_count <= p.within)) return false;
    return verify(agentKey, signed.signature, utf8(canonical([PREFIX_DOMAIN, p])));
  }

  function asSignedHead(v) {
    return v && typeof v === 'object' && v.head && typeof v.head === 'object' && Number.isInteger(v.head.row_count)
      && isBytes(v.head.epoch, 32) && isBytes(v.head.audit_head, 32) && isBytes(v.signature) ? v : null;
  }
  /**
   * The house heads a file holds: a bare signed head, or the heads a wallet kept in a v2 proof
   * file (the receipt head first, then the newest). Anything else: no heads, reason 'not_a_head'.
   */
  function keptHeadsFrom(text) {
    const none = { heads: [], reason: 'not_a_head' };
    if (typeof text !== 'string' || text.length > MAX_FILE) return none;
    let v;
    try { v = JSON.parse(text); } catch { return none; }
    const bare = asSignedHead(v);
    if (bare) return { heads: [{ head: bare, receipt: null, kept_at: null }], reason: null };
    const kept = v && typeof v === 'object' && typeof v.format === 'string' && v.format.startsWith('table.proof.')
      && v.house && Array.isArray(v.house.heads) ? v.house.heads : [];
    const heads = kept.filter((k) => k && asSignedHead(k.head))
      .map((k) => ({ head: k.head, receipt: k.receipt === true, kept_at: Number.isInteger(k.kept_at) ? k.kept_at : null }))
      .sort((a, b) => (b.receipt - a.receipt) || ((b.kept_at || 0) - (a.kept_at || 0)));
    return heads.length ? { heads, reason: null } : none;
  }

  /**
   * One kept head against the record the page shows now. Its signature is checked against the
   * house key first (no prefix is asked for a head the house did not sign); then, when it is
   * shorter, the house's signed prefix at its row count decides extends or rewritten.
   * `io.fetchPrefix(rows)` returns a signed prefix, or null when the house did not answer.
   */
  async function witnessVerdict(kept, view, io) {
    const agentKey = view.release.agent_key;
    if (!(await headSigned(kept.head, agentKey))) return 'bad_signature';
    const was = lookOf(kept.head);
    const now = lookOf(view.head);
    let prefix = null;
    if (was.epoch === now.epoch && was.rows < now.rows) {
      const signed = await io.fetchPrefix(was.rows);
      if (signed) {
        if (!(await prefixSigned(signed, agentKey))) return 'bad_prefix';
        prefix = signed.prefix;
      }
    }
    return compareHeads(was, now, prefix);
  }

  globalThis.TableWitness = Object.freeze({
    HEAD_DOMAIN, PREFIX_DOMAIN, canonical, hex, verify, lookOf, looksFrom, lookToSave,
    compareHeads, prefixToAsk, headSigned, prefixSigned, keptHeadsFrom, witnessVerdict,
  });
})();

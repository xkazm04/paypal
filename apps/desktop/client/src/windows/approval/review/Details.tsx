// Layer 2 of The Diff: the Details sheet that drops from the approval window's title bar. Sources
// for every row, the proof after the hand-off, the market, what the button does, the steps, the
// signed history and the reference numbers (for PayPal support or a dispute).
import type { ReactNode } from 'react';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { TranscriptType } from '@bindings/TranscriptType';
import type { WalletError } from '../../../lib/contract';
import { clockLabel, formatMoney, shortHash, shortId } from '../../../lib/format';
import { WalletNotice } from '../../../shared/honesty';
import { reasonWords, receiptWord, reconWord } from '../../../lib/words';
import { Btn, Kv, Sheet } from '../../../shared/ui';
import type { Step } from '../model';
import { relMark, rowWord, type DiffRow } from './diff';
import { MarkIcon, MarketTrack, StateList } from './Parts';

/** One source line per row: relation, both full values, and where they came from. */
export function Sources({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="ui-group srcs">
      {rows.map((r) => (
        <div key={r.id} className="src">
          <span className="g" aria-label={rowWord(r)}><MarkIcon mark={relMark(r.rel, r.tone)} /></span>
          <span className="n">{r.name}</span>
          <span className="v">
            {r.left}
            <span className="op">·</span>
            {r.right ?? <span className="dr-unk">not shown here</span>}
            <span className="op">·</span>
            <span className="rw">{rowWord(r)}</span>
          </span>
          <span className="s">{r.src}</span>
          {r.note ? <span className="nt">{r.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** The two values of one row and its source, for the row popover. */
export function RowDetail({ row, heads }: { row: DiffRow; heads: [string, string] }) {
  return (
    <Kv
      items={[
        [heads[0], row.left],
        [heads[1], row.right ?? <span className="dr-unk">not shown here</span>],
        ['Reading', <span className="rd"><MarkIcon mark={relMark(row.rel, row.tone)} /> {row.tone === 'ok' ? 'passes' : row.tone === 'bad' ? 'fails' : row.rel === '?' ? 'not checked here, so not a pass' : rowWord(row)}</span>],
        ['Where from', row.src],
        row.note ? ['Note', <span className="coral">{row.note}</span>] : null,
      ]}
    />
  );
}

/** Signed message types, in words (the protocol name stays in the export). */
const TYP: Record<TranscriptType, string> = {
  LISTING: 'listed it', OFFER: 'offered', COUNTER: 'countered', ACCEPT: 'accepted', WITHDRAW: 'withdrew',
  SETTLE: 'sent the payment request', RECEIPT: 'sent a receipt',
};

function Sec({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="dsec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function DetailsSheet(p: {
  title: string;
  onClose: () => void;
  heads: [string, string];
  rows: DiffRow[];
  evidence: { heads: [string, string]; rows: DiffRow[] } | null;
  status: { title: string; body: string } | null;
  mismatch: ReactNode;
  whatItDoes: ReactNode;
  steps: Step[];
  countdown: ReactNode;
  summary: ApprovalSummary;
  transcript: readonly TranscriptStep[] | undefined;
  transcriptError: WalletError | null;
}) {
  const d = p.summary.deal;
  const ev = p.summary.evidence;
  return (
    <Sheet title={p.title} onClose={p.onClose} size="wide" className="dr-sheet" footer={<Btn kind="primary" onClick={p.onClose}>Done</Btn>}>
      <Sec title={`${p.heads[0]} · ${p.heads[1]} · where each check comes from`}>
        <Sources rows={p.rows} />
      </Sec>
      {p.mismatch ? <Sec title="Amount didn’t match">{p.mismatch}</Sec> : null}
      {p.status ? (
        <Sec title={p.status.title}>
          <p className="pop-p">{p.status.body}</p>
        </Sec>
      ) : null}
      {p.evidence ? (
        <Sec title={`${p.evidence.heads[0]} · ${p.evidence.heads[1]}`}>
          <Sources rows={p.evidence.rows} />
        </Sec>
      ) : null}
      <Sec title="Market price">
        <MarketTrack deal={d} />
      </Sec>
      {p.whatItDoes ? <Sec title="What the button does">{p.whatItDoes}</Sec> : null}
      <Sec title="Steps">
        <StateList steps={p.steps} countdown={p.countdown} />
      </Sec>
      <Sec title="Signed history · every message both wallets signed">
        {p.transcriptError ? (
          <WalletNotice error={p.transcriptError} what="No signed history" />
        ) : !p.transcript ? (
          <p className="pop-p dim">Reading the signed history…</p>
        ) : !p.transcript.length ? (
          <p className="pop-p dim">Nothing signed for this deal yet.</p>
        ) : (
          <ol className="tlog">
            {p.transcript.map((s) => (
              <li key={s.seq}>
                <span className="lt">#{s.seq} · {clockLabel(s.at)}</span>{' '}
                <span className={`lw ${s.by === 'you' ? 'w-you' : 'w-them'}`}>{s.by}</span> {TYP[s.typ]}
                {s.price ? <> · <span className="money">{formatMoney(s.price)}</span></> : null}
                {s.verified ? <span className="okc"> · signature checked ✓</span> : <span className="red"> · signature not checked</span>}
              </li>
            ))}
          </ol>
        )}
      </Sec>
      <Sec title="Reference numbers · for PayPal support or a dispute">
        <Kv
          className="mono-kv"
          items={[
            d.paypal.order ? ['PayPal order', <span className="mono">{d.paypal.order}</span>] : null,
            d.paypal.authorization ? ['PayPal hold', <span className="mono">{d.paypal.authorization}</span>] : null,
            d.paypal.capture ? ['PayPal payment', <span className="mono">{d.paypal.capture}</span>] : null,
            ['Receipt', receiptWord(ev.receipt).text],
            ['PayPal statement', reconWord(ev.reconciliation).text],
            ['Deal', <span className="mono">{d.id}</span>],
            ['Agreed terms', <span className="mono">{shortHash(p.summary.terms_hash)} · try {p.summary.attempt}</span>],
            ['Signed history', <span className="mono">{shortHash(d.transcript_head)}</span>],
            ['Rules', <span className="mono">{shortId(d.mandate_id)} · version {d.mandate_version}</span>],
            p.summary.unavailable_reason ? ['Wallet note', reasonWords(p.summary.unavailable_reason)] : null,
          ]}
        />
      </Sec>
    </Sheet>
  );
}

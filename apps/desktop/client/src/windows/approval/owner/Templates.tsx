// First signature: three ready-made sets of rules to start from (templates.ts). Picking one only
// fills the draft below; every limit stays editable and nothing is signed until Review & sign.
// What the wallet can't know for the owner (who agents may pay, the haggler's one item) is asked
// right here, in the draft's own fields.
import { useId } from 'react';
import { BLANK_WORDS, TEMPLATES, type TemplateBlank, type TemplateKey } from '../templates';

export type BlankField = { blank: TemplateBlank; value: string; onChange: (v: string) => void };

const FIELD: Record<TemplateBlank, { label: string; placeholder: string; hint: string }> = {
  payees: { label: 'Who may they pay?', placeholder: 'e.g. packrite-supply, cablehaus', hint: 'The payee names of the shops you use, separated by commas. Anyone else is refused.' },
  item: { label: 'Which item?', placeholder: 'e.g. monitor-24-ips', hint: 'The item’s code, as the seller lists it. Every other item is refused.' },
};

export function TemplatePicker({ picked, blanks, fields, onPick }: {
  picked: TemplateKey | null;
  /** Blanks still empty in the draft. */
  blanks: readonly TemplateBlank[];
  /** The blanks the picked template asked for, as editable fields (kept while the owner types). */
  fields: readonly BlankField[];
  onPick: (k: TemplateKey) => void;
}) {
  const id = useId();
  return (
    <section className="ow-tpl" aria-label="Start from ready-made rules">
      <div className="ow-tpl-h"><b>Start from ready-made rules</b><span>you can change every limit before you sign</span></div>
      <div className="ow-tpl-grid">
        {TEMPLATES.map((t) => {
          const on = picked === t.key;
          return (
            <button key={t.key} type="button" className="ow-tpl-card" aria-pressed={on} onClick={() => onPick(t.key)}>
              <b>{t.name}</b>
              <span>{t.line}</span>
              {on && blanks.length ? <span className="ow-tpl-blank">You add: {blanks.map((b) => BLANK_WORDS[b]).join(' and ')}</span> : null}
            </button>
          );
        })}
      </div>
      {fields.length ? (
        <div className="ow-tpl-fields">
          {fields.map((f) => (
            <label key={f.blank} className="ow-tpl-field" htmlFor={`${id}-${f.blank}`}>
              <b>{FIELD[f.blank].label}</b>
              <input id={`${id}-${f.blank}`} className="ui-field mono" value={f.value} spellCheck={false} placeholder={FIELD[f.blank].placeholder}
                aria-invalid={!f.value.trim()} onChange={(e) => f.onChange(e.target.value)} />
              <span>{FIELD[f.blank].hint}</span>
            </label>
          ))}
        </div>
      ) : null}
    </section>
  );
}

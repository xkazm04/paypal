// "Say it": the wallet's own reading of one typed or spoken sentence into the facts of a rule set.
// Pure and deterministic: a fixed grammar, no model, no network, no IO, no clock but the one it is
// handed (like the Book's understand.ts, windows/main/modules/book). Tested in say.test.ts.
//
// The rules this reads, and nothing else: haggle for one item (or buy supplies), the most you'll
// pay, when to ask you, how many offers, when it ends, what a day may hold, and who it deals with.
// A part it cannot read is never guessed: it comes back as a question (or as words left over) and
// stays OUT of the rules, so a miss degrades to the editable form. The reading can never sign
// anything; it ends in a typed draft the approval window shows, and Rust checks and signs there.
//
// Speech is only input: whatever text arrives, from the keyboard or a recogniser, is read the same
// way and never trusted. Money is integer minor units, parsed from strings; no float touches it.
import type { Currency } from '@bindings/Currency';
import { exponent, parseMoneyText } from '../format';
import { SAY_Q } from '../words';

/** The longest sentence the wallet reads. */
export const MAX_SAY = 400;
const DAY = 86_400;

/** A span of days ends on the hour, never past what was said: "for a week" at 13:07 ends 13:00, not at an arbitrary minute. */
const floorHour = (t: number, ctx: SayCtx): number => Math.floor((t - ctx.offsetMin * 60) / 3600) * 3600 + ctx.offsetMin * 60;

export type SayCtx = {
  /** Unix seconds: the one client clock (lib/clock.ts), injected so tests and the director can move it. */
  now: number;
  /** The owner's UTC offset in minutes, east positive. */
  offsetMin: number;
  /** Payee names of the wallets already connected (templates.ts connectedPayees). */
  payees: readonly string[];
  /** The house seller's payee names, when it is connected: all a rule for the house's table may pay. */
  housePayees?: readonly string[];
  /** The items the owner's deals already name (the reference the wallet knows it by, and the title it shows): what
   *  "a monitor" is tied to when exactly one of them fits, and asked about when several do. */
  items?: ReadonlyArray<{ ref: string; title: string; /** A table for it is open now. */ open?: boolean }>;
};

export type Slot = 'job' | 'item' | 'ceiling' | 'ask' | 'offers' | 'ends' | 'dayTotal' | 'dayDeals' | 'who' | 'payees' | 'currency' | 'leftover';

export type Facts = {
  /** Only buying is read from a sentence. */
  job: 'buy' | null;
  /** The one item, as said ("27 inch monitor"); null for supplies or no item. */
  item: string | null;
  /** The wallet's own reference for the item when the words matched one of the owner's items (SayCtx.items), else null. */
  itemRef: string | null;
  /** The title the wallet shows for that item. */
  itemTitle: string | null;
  /** "buy supplies": a purchase with no single item (the word as said, or null). */
  anything: string | null;
  currency: Currency;
  /** The most you'll pay, minor units. */
  ceiling: number | null;
  /** Above this the owner decides, minor units; 0 = ask about every payment. */
  ask: number | null;
  offers: number | null;
  /** When the rules end, Unix seconds. */
  ends: number | null;
  dayTotal: number | null;
  dayDeals: number | null;
  who: 'paired' | 'house';
};

export type Answer =
  | { kind: 'choice'; choices: ReadonlyArray<{ value: string; label: string }> }
  | { kind: 'amount' | 'text'; label: string };
export type Question = { id: string; slot: Slot; text: string; answer: Answer };

export type From = 'said' | 'filled';
export type Reading = {
  text: string;
  facts: Facts;
  /** How each slot got its value: said (or edited) by the owner, or a safe default filled in. */
  from: Partial<Record<Slot, From>>;
  /** The words each said slot came from, as read (lower case, numbers as digits). */
  heard: Partial<Record<Slot, string>>;
  /** One question per slot the wallet is not sure of, in the order they matter. Never guessed past. */
  questions: Question[];
  /** The slots left out of the rules because a question stands open. */
  unsure: ReadonlySet<Slot>;
  /** Words the wallet did not read and the owner has not waved away. */
  leftover: string[];
  /** The sentence asked for a thing the wallet cannot set from words (selling). */
  selling: boolean;
};

/** What the owner answered or edited: a question id (or a slot name for an edit) to its value. */
export type Answers = Readonly<Record<string, string>>;

// ---- normalising ---------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** "twenty first" is the 21st: ordinals only count after a tens word. */
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
/** Day-of-month ordinals that follow a month name ("november first"). */
const DAY_ORDINALS: Record<string, number> = { ...ORDINALS, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const QUANTITY = /^(?:counter-?offers?|offers?|rounds?|tries|attempts?|bids?|counters?|deals?|purchases?|buys?|orders?|haggles?|payments?|tables?|days?|weeks?|hours?|dollars?|bucks?|usd|euros?|eur|pounds?|gbp|time|times)$/;
const isNumWord = (w: string | undefined): boolean => w !== undefined && (w in UNITS || w in TENS || w === 'hundred' || w === 'thousand');

/** "three hundred and forty" -> "340", "a hundred" -> "100", "twenty-five" -> "25". */
function spokenNumbers(s: string): string {
  const words = s.split(/(\s+|-)/);
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    const w = words[i] ?? '';
    const nextWord = (from: number): number => { let j = from + 1; while (j < words.length && /^(\s+|-)$/.test(words[j] ?? '')) j++; return j; };
    const startsRun = isNumWord(w) || ((w === 'a' || w === 'an') && (words[nextWord(i)] === 'hundred' || words[nextWord(i)] === 'thousand'));
    const prevTok = [...out].reverse().find((t) => !/^(\s+|-)$/.test(t));
    if (!startsRun || ((w === 'hundred' || w === 'thousand') && prevTok !== undefined && /^\d/.test(prevTok))) { out.push(w); i++; continue; }
    let total = 0;
    let cur = 0;
    let j = i;
    let last = i;
    let count = 0;
    let ordinal = false;
    let clock: string | null = null;
    while (j < words.length) {
      const x = words[j] ?? '';
      if (x === 'a' || x === 'an') { cur += 1; }
      else if (x in TENS && count === 1 && cur >= 1 && cur <= 9 && total === 0 && words[i] !== 'a' && words[i] !== 'an') {
        // "three forty" is 340, said the short way; before am / pm it is a time: "five thirty pm" is 5:30 pm
        const k1 = nextWord(j);
        const unit = words[k1] !== undefined && words[k1] in UNITS && (UNITS[words[k1] ?? ''] ?? 0) <= 9 ? UNITS[words[k1] ?? ''] ?? 0 : 0;
        const kAfter = nextWord(unit ? k1 : j);
        if (/^(?:am|pm|a\.m\.|p\.m\.|o'clock)$/.test(words[kAfter] ?? '')) { clock = `${cur}:${String((TENS[x] ?? 0) + unit).padStart(2, '0')}`; cur = 0; last = unit ? k1 : j; break; }
        cur = cur * 100 + (TENS[x] ?? 0);
      }
      else if (x in ORDINALS && cur >= 20) { cur += ORDINALS[x] ?? 0; ordinal = true; last = j; break; }
      else if (x in UNITS) cur += UNITS[x] ?? 0;
      else if (x in TENS) cur += TENS[x] ?? 0;
      else if (x === 'hundred') cur = (cur || 1) * 100;
      else if (x === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
      else break;
      count += 1;
      last = j;
      let k = j + 1;
      while (k < words.length && /^(\s+|-)$/.test(words[k] ?? '')) k++;
      // "three hundred and forty": an "and" inside the number
      if (words[k] === 'and' && isNumWord(words[nextWord(k)]) && cur > 0) { j = k + 1; while (j < words.length && /^\s+$/.test(words[j] ?? '')) j++; continue; }
      if (k < words.length && (isNumWord(words[k]) || (cur >= 20 && cur % 10 === 0 && (words[k] ?? '') in ORDINALS))) { j = k; continue; }
      break;
    }
    // A lone "one" in front of a thing ("buy one monitor") is the article, not a count: it becomes a digit only before a
    // quantity word ("one offer", "one deal a day") or at the end.
    const after = words[nextWord(last)];
    if (clock) out.push(clock);
    else if (ordinal) out.push(`${total + cur}th`);
    else if (last === i && w === 'one' && after !== undefined && !QUANTITY.test(after)) out.push(w);
    else out.push(String(total + cur));
    i = last + 1;
  }
  return out.join('');
}

/** "2k" and "1.5k", but only after a currency mark or before "dollars": "4k monitor" is a screen. */
function thousands(whole: string, frac = ''): string {
  return String(Number(whole) * 1000 + Number(frac.padEnd(3, '0').slice(0, 3)));
}

const UNIT = String.raw`(?:%|(?:percent|inch(?:es)?|gb|tb|mb|hz|mm|cm|km|miles?|kg|lbs?|days?|hours?|weeks?|months?|years?|times?|offers?|rounds?|messages?|haggles?|tries|attempts?|bids?|deals?|items?|pieces?|units?|pcs|monitors?)\b)`;
const AMT = String.raw`(?:[$€£]\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?(?!\d|\s*${UNIT}))`;

/** Currencies this reader does not take from words (it knows dollars, euros and pounds): their names and codes. */
const FOREIGN = String.raw`(?:cad|aud|chf|nzd|czk|sek|nok|dkk|pln|jpy|huf|kwd|bhd|yen|yuan|rupees?|francs?|crowns?|koruna|zloty|krona|kronor|kroner|(?:canadian|australian|new zealand|swiss|japanese) (?:dollars?|francs?|yen))`;

/** The foreign currency a sentence names ("340 cad", "¥34000"), as said, or null. The reader asks which of its three it is. */
export function foreignMoney(raw: string): string | null {
  return new RegExp(String.raw`\d[\d,.]*\s*${FOREIGN}\b|\b${FOREIGN}\s*\d|[¥₹₩₽]\s*\d`).exec(raw.toLowerCase())?.[0].trim() ?? null;
}

/** "2 million", "3 grand", "3 thousand", "3 hundred" -> the number, so no word of size is left behind a digit. */
function sized(n: string, word: string): string {
  const mult = word === 'hundred' ? 100 : word === 'million' ? 1_000_000 : 1000;
  return String(Math.round(Number.parseFloat(n) * mult));
}

export function normalize(raw: string): string {
  let s = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ');
  s = spokenNumbers(s);
  // "november first" -> "november 1"
  s = s.replace(new RegExp(String.raw`\b${MONTH}\s+(${Object.keys(DAY_ORDINALS).join('|')})\b`, 'g'), (_m, mon: string, o: string) => `${mon} ${DAY_ORDINALS[o] ?? o}`);
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(hundred|thousand|grand|million)\b/g, (_m, n: string, w: string) => sized(n, w)).replace(/\ba grand\b/g, '1000');
  // "3k" is three thousand only where an amount is asked for ("4k monitor" is a screen)
  s = s.replace(/(?<=(?:up to|at most|no more than|not more than|max(?:imum)?(?: of)?|under|below|less than|within|budget(?: of| is)?|limit(?: of)?|over|above|more than|around|about|for) )(\d+)(?:\.(\d{1,3}))?k\b(?! (?:monitor|monitors|tv|display|screen|projector|camera|video|ultra|uhd|resolution|panel))/g, (_m, w: string, f?: string) => thousands(w, f));
  s = s.replace(/([$€£])(\d+)(?:\.(\d{1,3}))?k\b/g, (_m, c: string, w: string, f?: string) => `${c}${thousands(w, f)}`);
  s = s.replace(/\b(\d+)(?:\.(\d{1,3}))?\s?k\s+(?:us\s+)?(dollars?|bucks?|usd|euros?|eur|pounds?|gbp)\b/g, (_m, w: string, f: string | undefined, unit: string) => `${thousands(w, f)} ${unit}`);
  // a currency this reader does not take from words: its name goes (the reader asks), so the amount still reads
  s = s.replace(new RegExp(String.raw`(\d[\d,.]*)\s*${FOREIGN}\b`, 'g'), '$1').replace(new RegExp(String.raw`\b${FOREIGN}\s*(\d)`, 'g'), '$1').replace(/[¥₹₩₽]/g, ' ');
  // "$340 usd": the word after a marked amount adds nothing
  s = s.replace(/([$€£]\d[\d,]*(?:\.\d+)?)\s*(?:usd|eur|gbp|us dollars?|dollars?|bucks?|euros?|pounds?|quid)\b/g, '$1');
  s = s.replace(/\busd\s*(\d)/g, '$$$1').replace(/\beur\s*(\d)/g, '€$1').replace(/\bgbp\s*(\d)/g, '£$1').replace(/\bus\$(\d)/g, '$$$1');
  s = s.replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:us\s+)?(?:dollars?|bucks?|usd)\b/g, '$$$1');
  s = s.replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:euros?|eur)\b/g, '€$1');
  s = s.replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:pounds?|gbp|quid)\b/g, '£$1');
  s = s.replace(/([$€£])\s+(\d)/g, '$1$2').replace(/(\d[\d,]*(?:\.\d{1,2})?)([$€£])(?!\d)/g, '$2$1');
  // "$1 200", "$1'200" and "340,50" (a decimal comma)
  s = s.replace(/([$€£]\d{1,3})[ '’](\d{3})\b/g, '$1,$2').replace(/\b(\d{1,3}),(\d{2})\b(?![\d,])/g, '$1.$2');
  // "1.200" with three digits after the point is a thousands separator, not 1.20 and a stray 0
  s = s.replace(/\b(\d{1,3})\.(\d{3})\b(?![.,]?\d)/g, '$1,$2');
  // "5 30 pm" -> "5:30 pm"
  s = s.replace(/\b(\d{1,2})\s+([0-5]\d)\s*(am|pm)\b/g, '$1:$2 $3');
  // Punctuation becomes a hard break; a comma inside digits (1,200) and a decimal point stay.
  s = s.replace(/[;!?()]+|:(?!\d)/g, ' | ').replace(/,(?!\d{3}(?!\d))/g, ' | ').replace(/\.(?!\d)/g, ' | ');
  return s.replace(/\s+/g, ' ').trim();
}

// ---- money, calendar -------------------------------------------------------------------------------

const SYMBOL: Record<string, Currency> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/** "$340", "340.50" or "$1,200" -> minor units; null when it is not an amount. */
function money(text: string, currency: Currency): number | null {
  return parseMoneyText(text.trim().replace(/^[$€£]/, ''), currency);
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const WD = String.raw`(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)`;
const wdIndex = (w: string): number => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w.slice(0, 3));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const TIME = String.raw`(?:(\d{1,2})(?::(\d{2}))?\s?(am|pm)|(\d{1,2}):(\d{2})|(noon)|(midnight)|(morning|afternoon|evening|night)|(?:the\s+)?end of (?:the\s+)?(?:business\s+|work\s*)?day|close of business|cob|eod)`;
/** The usual close of a working day: what "until Friday" means when no hour is said. */
export const DEFAULT_END_HOUR = 18;

/** Seconds into the day for a TIME match's groups, or null when the hour is not a time. */
function timeOfDay(g: ReadonlyArray<string | undefined>): number | null {
  const [h12, m12, ap, h24, m24, noon, midnight, part] = g;
  if (part) return (({ morning: 9, afternoon: 15, evening: 18, night: 21 } as Record<string, number>)[part] ?? DEFAULT_END_HOUR) * 3600;
  if (noon) return 12 * 3600;
  if (midnight) return 24 * 3600 - 60;
  if (h12 && ap) {
    const h = Number(h12);
    if (h < 1 || h > 12) return null;
    const m = m12 ? Number(m12) : 0;
    if (m > 59) return null;
    return ((h % 12) + (ap === 'pm' ? 12 : 0)) * 3600 + m * 60;
  }
  if (h24 && m24) {
    const h = Number(h24);
    const m = Number(m24);
    return h > 23 || m > 59 ? null : h * 3600 + m * 60;
  }
  return null;
}

/** Local calendar from the injected clock: midnight today (as Unix seconds) and today's weekday. */
function today(ctx: Pick<SayCtx, 'now' | 'offsetMin'>): { midnight: number; wd: number; y: number; m: number; d: number } {
  const off = ctx.offsetMin * 60;
  const local = ctx.now + off;
  const midnightLocal = Math.floor(local / DAY) * DAY;
  const t = new Date(midnightLocal * 1000);
  return { midnight: midnightLocal - off, wd: t.getUTCDay(), y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/** The two readings of a weekday that is today: its end today, or a week from now. Asked, never guessed. */
export function sameDayChoices(ctx: Pick<SayCtx, 'now' | 'offsetMin'>, secs: number): { today: number; next: number } {
  const t = today(ctx);
  return { today: t.midnight + secs, next: t.midnight + 7 * DAY + secs };
}

// ---- the grammar ---------------------------------------------------------------------------------------

const IN = String.raw`(?:up to|at most|max(?:imum)?(?: of)?|no more than|not more than|only|just)`;
const ASKV = String.raw`(?:ask|check with|check in with|check|confirm with|confirm|run (?:it|them|anything|that) (?:by|past)|stop and ask|come to|come back to|call|ping|tell|text|notify|wake)`;
const OVER = String.raw`(?:above|over|more than|beyond|past|exceeds?|exceeding|greater than|higher than|bigger than|north of)`;

const FILLER = new Set([
  'a', 'an', 'the', 'my', 'mine', 'some', 'any', 'for', 'to', 'of', 'on', 'in', 'at', 'by', 'and', 'then', 'but', 'so', 'also', 'just', 'please',
  'i', "i'd", "i'll", "i'm", "i've", 'we', 'you', 'your', 'it', 'its', "it's", 'me', 'us', 'our', 'agent', 'agents', 'assistant', 'wallet', 'table',
  'one', 'like', 'would', 'could', 'can', 'should', 'will', 'shall', 'may', 'let', 'set', 'make', 'up', 'rule',
  'rules', 'new', 'there', 'that', 'this', 'these', 'those', 'is', 'are', 'be', 'been', 'am', 'do', 'does', 'did', 'have', 'has', 'if', 'when',
  'whenever', 'as', 'long', 'much', 'many', 'per', 'each', 'every', 'from', 'into', 'out', 'about', 'start', 'starting', 'now', 'ok', 'okay', 'hey',
  'hi', 'hello', 'alright', 'thanks', 'thank', 'first', 'item', 'price', 'try', 'go',
  'cheapest', 'cheap', 'best', 'good', 'nice', 'decent', 'great', 'really', 'very', 'quite', 'pretty', 'super', 'uh', 'um', 'umm', 'er', 'down', 'basically', 'actually', 'pay', 'paying', 'spend', 'spending',
]);
// Words that must never vanish as filler: they change what a rule means.
const MEANING = new Set(['not', 'never', 'no', "don't", 'dont', 'except', 'unless', 'without', 'above', 'over', 'under', 'below', 'less', 'least', 'min', 'max', 'minimum', 'maximum']);
const BUY = new Set(['haggle', 'haggling', 'bargain', 'bargaining', 'negotiate', 'negotiating', 'buy', 'buying', 'purchase', 'purchasing', 'order', 'ordering', 'grab', 'get', 'getting', 'find', 'finding', 'source', 'sourcing', 'shop', 'shopping', 'restock', 'restocking', 'pick', 'hunt', 'hunting', 'look', 'looking', 'score', 'pay', 'paying', 'spend', 'spending', 'need', 'needs', 'want', 'wants', 'wanna']);
const SELL = new Set(['sell', 'selling', 'flip', 'unload', 'dump', 'offload']);
const ARTICLES = new Set(['a', 'an', 'the', 'my', 'some', 'one']);
/** Words that end an item's name: what follows is a condition the wallet cannot apply, and is shown as not read. */
const STOP_ITEM = new Set(['with', 'over', 'above', 'below', 'under', 'larger', 'bigger', 'smaller', 'older', 'newer', 'between', 'no', 'not', 'that', 'which', 'from', 'than', 'without', 'except', 'unless', 'but', 'or', 'listed', 'delivered', 'having']);
const ANYTHING = new Set(['anything', 'something', 'stuff', 'things', 'supplies', 'items', 'goods', 'whatever', 'stock', 'office', 'equipment']);

const slug = (words: readonly string[]): string => words.join('-').replace(/[^a-z0-9\-_.:@+]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 128);

type Hit = { value: string; heard: string };
type Work = { s: string };

/** Every match of `re` in the working text, each blanked to a break so the rest reads on its own. */
function take(work: Work, re: RegExp): Array<{ m: RegExpExecArray; heard: string }> {
  const out: Array<{ m: RegExpExecArray; heard: string }> = [];
  work.s = work.s.replace(re, (...args) => {
    const groups = args.slice(0, -2) as string[];
    const m = Object.assign(groups, { index: args[args.length - 2] as number, input: args[args.length - 1] as string }) as unknown as RegExpExecArray;
    out.push({ m, heard: groups[0] ?? '' });
    return ' | ';
  });
  return out;
}

const distinct = (xs: readonly Hit[]): Hit[] => xs.filter((x, i) => xs.findIndex((y) => y.value === x.value) === i);

function amountSymbol(text: string): Currency | null {
  const c = /^[$€£]/.exec(text.trim())?.[0];
  return c ? SYMBOL[c] ?? null : null;
}

/** Read one sentence. `answers` carries what the owner answered or edited since. */
export function read(text: string, ctx: SayCtx, answers: Answers = {}): Reading {
  const empty: Facts = { job: null, item: null, itemRef: null, itemTitle: null, anything: null, currency: 'USD', ceiling: null, ask: null, offers: null, ends: null, dayTotal: null, dayDeals: null, who: 'paired' };
  const facts: Facts = { ...empty };
  const from: Partial<Record<Slot, From>> = {};
  const heard: Partial<Record<Slot, string>> = {};
  const questions: Question[] = [];
  const unsure = new Set<Slot>();
  const base = (): Reading => ({ text, facts, from, heard, questions, unsure, leftover: [], selling: false });
  if (text.length > MAX_SAY) {
    questions.push({ id: 'long', slot: 'leftover', text: SAY_Q.tooLong(MAX_SAY), answer: { kind: 'choice', choices: [] } });
    unsure.add('leftover');
    return base();
  }
  const work: Work = { s: normalize(text) };
  const say = (slot: Slot, h: string) => { from[slot] = 'said'; heard[slot] = h.trim(); };
  const ask = (q: Question) => { questions.push(q); unsure.add(q.slot); };

  // -- who: the house seller's practice table
  const house = take(work, /\b(?:only\s+)?(?:with|from|at|through|via)\s+(?:the\s+)?house(?:\s+seller)?(?:'s\s+table)?\b|\bthe house(?:\s+seller)?'s\s+table\b/g);
  if (house[0]) { facts.who = 'house'; say('who', house[0].heard); }

  // -- a day's limits
  const dayDealHits = take(work, new RegExp(String.raw`(?<![$€£\d.,])(?:(?:${IN})\s+)?(?:(\d{1,3})\s+(?:deals?|purchases?|buys?|orders?|haggles?|payments?|tables?)|(\d{1,2}))\s*(?:a|per|each|every|in a|in one)\s*day\b|(?<![$€£\d.,])(\d{1,3})\s+(?:deals?|purchases?|buys?|orders?|haggles?|payments?|tables?)\s+daily\b`, 'g'));
  const dayTotalHits = take(work, new RegExp(String.raw`(?<![\w$€£])(?:(?:${IN}|never (?:more than|above|over)|(?:don't|do not|dont) (?:spend|pay) (?:more than|over)|limit(?: of)?|cap(?: of)?|spend|pay|spending|paying|budget(?: of)?|total of|a total of|in total)\s+)*(${AMT})\s*(?:(?:max(?:imum)?|tops|limit|cap|total)\s+)?(?:a|per|each|every|/|in a|in one)\s*day\b|\b(?:daily|per day|a day|each day)\s+(?:limit|cap|budget|max|maximum|total|spend)(?:\s+(?:of|is))?\s+(${AMT})|(?<![\w$€£])(${AMT})\s+daily\b`, 'g'));

  // -- when it ends
  const t0 = today(ctx);
  const endAt = (daysAhead: number, secs: number): number => t0.midnight + daysAhead * DAY + secs;
  type EndsHit = { at: number | null; heard: string; ask?: { secs: number; label: string } };
  const endsHits: EndsHit[] = [];
  // "until friday 5pm" and "until 5pm friday" are one end: the day, then the hour
  const dayAt = (prefix: string | undefined, wdName: string | undefined, rel: string | undefined, given: number | null, h: string) => {
    const secs = given ?? (rel === 'tonight' ? 24 * 3600 - 60 : DEFAULT_END_HOUR * 3600);
    if (rel) {
      endsHits.push({ at: endAt(rel === 'tomorrow' ? 1 : 0, secs), heard: h });
    } else if (wdName) {
      const wd = wdIndex(wdName);
      let ahead = (wd - t0.wd + 7) % 7;
      if (prefix === 'next' && ahead === 0) ahead = 7;
      if (ahead === 0 && prefix !== 'next') {
        const todayEnd = endAt(0, secs);
        // Today's end is far enough off to mean today; otherwise "Friday" is today or a week away: ask.
        if (todayEnd - ctx.now >= 3 * 3600) endsHits.push({ at: todayEnd, heard: h });
        else endsHits.push({ at: null, heard: h, ask: { secs, label: WEEKDAY_NAMES[wd] ?? '' } });
        return;
      }
      endsHits.push({ at: endAt(ahead, secs), heard: h });
    }
  };
  const dayWords = take(work, new RegExp(String.raw`(?<!\b(?:not|no) )\b(?:until|till|til|through|thru|by|before|ending|ends?|expir(?:es|ing|e)|no later than)\s+(?:(?:the\s+)?end of (?:the\s+)?(?:day\s+)?)?(?:on\s+)?(?:(next|this|coming)\s+)?(?:${WD}|(today|tonight|tomorrow))\b(?:\s+(?:at\s+|by\s+)?${TIME})?(?:\s+(?:at|by)\s+(\d{1,2})\b(?!\s?(?::|am\b|pm\b|%)))?`, 'g'));
  for (const { m, heard: h } of dayWords) {
    const [, prefix, wdName, rel, h12, m12, ap, h24, m24, noon, midnight, part, bare] = m;
    const given = timeOfDay([h12, m12, ap, h24, m24, noon, midnight, part]);
    if (bare && given === null) { endsHits.push({ at: null, heard: h }); continue; }
    dayAt(prefix, wdName, rel, given, h);
  }
  // the hour first: "until 5pm friday", "by noon tomorrow"
  const hourThenDay = take(work, new RegExp(String.raw`(?<!\b(?:not|no) )\b(?:until|till|til|through|by|before)\s+${TIME}\s+(?:on\s+)?(?:(next|this|coming)\s+)?(?:${WD}|(today|tonight|tomorrow))\b`, 'g'));
  for (const { m, heard: h } of hourThenDay) {
    // groups: 1-8 the hour (h12 m12 ap h24 m24 noon midnight part), 9 prefix, 10 weekday, 11 today / tonight / tomorrow
    dayAt(m[9], m[10], m[11], timeOfDay(m.slice(1, 9)), h);
  }
  const relWords = take(work, /(?<!\bme\s)(?<![$€£]\d[\d,.]*\s)\b(?:for|over|within|in|during)\s+(?:the\s+)?(?:next\s+)?(\d{1,3}|a|an)\s+(hours?|days?|weeks?)\b/g);
  for (const { m, heard: h } of relWords) {
    const n = m[1] === 'a' || m[1] === 'an' ? 1 : Number(m[1]);
    const unit = (m[2] ?? '').startsWith('h') ? 3600 : (m[2] ?? '').startsWith('w') ? 7 * DAY : DAY;
    endsHits.push({ at: n * unit >= DAY ? floorHour(ctx.now + n * unit, ctx) : ctx.now + n * unit, heard: h });
  }
  const dateWords = take(work, new RegExp(String.raw`(?<!\b(?:not|no) )\b(?:until|till|by|before|through|ending|ends?)\s+(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH}|${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?)(?:,?\s+(20\d{2})\b)?(?:\s+(?:at\s+|by\s+)?${TIME})?`, 'g'));
  for (const { m, heard: h } of dateWords) {
    const day = Number(m[1] ?? m[4]);
    const mon = MONTHS.indexOf((m[2] ?? m[3] ?? '').slice(0, 3));
    const year = m[5] ? Number(m[5]) : null;
    const given = timeOfDay(m.slice(6, 14));
    const secs = given ?? DEFAULT_END_HOUR * 3600;
    let y = year ?? t0.y;
    let at = Date.UTC(y, mon, day) / 1000 - ctx.offsetMin * 60 + secs;
    // A date that is not one is asked. One long past this year ("jan 3" in October) is next year's; one only just past, or a year
    // in the past, is asked rather than moved on a guess.
    if (day < 1 || day > 31 || new Date(Date.UTC(y, mon, day)).getUTCMonth() !== mon) { endsHits.push({ at: null, heard: h }); continue; }
    if (at <= ctx.now && year === null && ctx.now - at > 45 * DAY) { y += 1; at = Date.UTC(y, mon, day) / 1000 - ctx.offsetMin * 60 + secs; }
    endsHits.push({ at: at > ctx.now ? at : null, heard: h });
  }
  // "until the end of the month": the last day of this month at the close of the day, or next month's once this one's has passed
  for (const { heard: h } of take(work, /\b(?:until|till|by|before|through)\s+(?:the\s+)?end of (?:the\s+)?month\b/g)) {
    const lastOf = (m: number): number => Date.UTC(t0.y, m + 1, 0) / 1000 - ctx.offsetMin * 60 + DEFAULT_END_HOUR * 3600;
    endsHits.push({ at: lastOf(t0.m) > ctx.now ? lastOf(t0.m) : lastOf(t0.m + 1), heard: h });
  }
  const timeOnly = take(work, new RegExp(String.raw`(?<!\b(?:not|no) )\b(?:until|till|by|before|through|ending|ends?)\s+${TIME}`, 'g'));
  for (const { m, heard: h } of timeOnly) {
    const secs = timeOfDay(m.slice(1, 9));
    if (secs === null) { endsHits.push({ at: null, heard: h }); continue; }
    // Today if that hour is still ahead; otherwise tomorrow (the chip names the day, so it can be seen and edited).
    const todayAt = endAt(0, secs);
    endsHits.push({ at: todayAt > ctx.now + 60 ? todayAt : endAt(1, secs), heard: h });
  }

  // -- how many offers
  const offerHits = take(work, new RegExp(String.raw`(?<!\b(?:after|every|each)\s)\b(?:(?:${IN}|make|try|do|allow)\s+)?(\d{1,3})\s+(?:counter-?\s?)?(?:offers?|rounds?|tries|attempts?|bids?|counters?|back and forths?|times)(?:\s+(?:max|maximum|tops|at most|or fewer|or less))?\b`, 'g'));
  // "until the cows come home": an end was asked for and cannot be read
  for (const { heard: h } of take(work, /\b(?:until|till|til)\b[^|]*/g)) endsHits.push({ at: null, heard: h });

  // -- when to ask the owner
  const askUnless = take(work, new RegExp(String.raw`\b(?:don't|do not|dont|never)\s+ask\s+me\s+(?:unless|until)\s+(?:it(?:'s| is| goes| gets)?\s+|the price (?:is|goes|gets)\s+)?${OVER}\s+(${AMT})`, 'g'));
  // "below $320 you decide", "auto approve under $320": the owner decides above that amount
  const autoUnder = take(work, new RegExp(String.raw`\b(?:(?:under|below|up to|less than|within|up till)\s+(${AMT})\s+(?:you (?:decide|can (?:decide|go alone|agree(?: on your own)?|approve|go ahead))|is fine|on your own|alone|without asking(?: me)?)|(?:you (?:decide|can (?:decide|go alone|agree on your own|approve))|auto[- ]?approve|i trust you|alone|on your own|without asking(?: me)?)\s+(?:under|below|up to|less than|within|if (?:it(?:'s| is)) (?:under|below|less than))\s+(${AMT}))`, 'g'));
  const askOver = take(work, new RegExp(String.raw`(?<!\b(?:don't|do not|dont|never|not)\s)\b(?:(?:only|just)\s+)?${ASKV}\s+me\b(?:\s+(?:first|again|before\s+\w+))?[^|$€£\d]{0,30}?\b${OVER}\s+(${AMT})`, 'g'));
  const askBefore = take(work, new RegExp(String.raw`\bask\s+(?:before|if|when)\b[^|$€£\d]{0,30}?\b${OVER}\s+(${AMT})|\bask\s+${OVER}\s+(${AMT})`, 'g'));
  const askAlways = take(work, new RegExp(String.raw`(?<!\b(?:don't|do not|dont|never|not)\s)\b(?:always\s+${ASKV}\s+me|${ASKV}\s+me\s+(?:every time|each time|always|(?:about\s+)?every(?:thing| payment| purchase| deal)|before\s+(?:paying|you pay|any payment|anything|buying|you buy|spending|you spend|every payment|each payment)|first))\b`, 'g'));

  // -- selling is not read from a sentence
  const floorHits = take(work, new RegExp(String.raw`\b(?:at least|no less than|not less than|minimum(?: of)?|min(?: of)?|not (?:below|under)|no lower than|floor(?: of)?|for at least)\s+(${AMT})`, 'g'));

  // -- the most you'll pay
  const ceilingHits = take(work, new RegExp(String.raw`\b(?:up to|at most|max(?:imum)?(?: of| price of)?|a maximum of|no more than|not more than|not (?:above|over|beyond)|under|below|less than|within|limit(?:ed)?(?: to| of)?|cap(?:ped)?(?: at| of)?|budget(?: of| is)?|ceiling(?: of| at)?|tops? out at|as much as|go as high as|not exceeding|never (?:more than|above|over|pay more than)|(?:don't|do not|dont)\s+(?:pay|spend|go|agree(?: to)?)(?:\s+(?:more than|above|over|beyond|past)))\s+(${AMT})|(?<![\w$€£])(${AMT})\s+(?:max(?:imum)?|tops|at most|or less|or under|or below|and under|and below|limit)\b`, 'g'));

  // lone amounts with a currency mark are asked about, never assumed
  const lone = take(work, new RegExp(String.raw`[$€£]\d[\d,]*(?:\.\d{1,2})?`, 'g'));

  // ---- currency: the mark on the amounts, one for the whole set of rules
  const marks = [...ceilingHits.flatMap((h) => [h.m[1], h.m[2]]), ...askOver.map((h) => h.m[1]), ...askBefore.flatMap((h) => [h.m[1], h.m[2]]), ...askUnless.map((h) => h.m[1]), ...autoUnder.flatMap((h) => [h.m[1], h.m[2]]), ...dayTotalHits.flatMap((h) => [h.m[1], h.m[2], h.m[3]]), ...floorHits.map((h) => h.m[1]), ...lone.map((h) => h.heard)]
    .flatMap((a) => (a ? [amountSymbol(a)] : []))
    .filter((c): c is Currency => c !== null);
  const used = [...new Set(marks)];
  if (answers.currency && used.includes(answers.currency as Currency)) facts.currency = answers.currency as Currency;
  else if (used.length === 1 && used[0]) facts.currency = used[0];
  else if (used.length > 1) {
    facts.currency = used[0] ?? 'USD';
    ask({ id: 'currency', slot: 'currency', text: SAY_Q.currency, answer: { kind: 'choice', choices: used.map((c) => ({ value: c, label: c })) } });
  }
  if (used.length) say('currency', used.join(' '));
  // A currency the reader does not take from words ("340 cad", "yen"): asked, never read as dollars.
  const foreign = used.length ? null : foreignMoney(text);
  if (foreign) {
    const picked = answers.currency;
    if (picked === 'USD' || picked === 'EUR' || picked === 'GBP') { facts.currency = picked; say('currency', picked); }
    else ask({ id: 'currency-other', slot: 'currency', text: SAY_Q.currencyOther(foreign), answer: { kind: 'choice', choices: (['USD', 'EUR', 'GBP'] as const).map((c) => ({ value: c, label: c })) } });
  }
  const cur = facts.currency;
  const amount = (a: string | undefined): number | null => (a ? money(a, cur) : null);
  const firstAmt = (m: RegExpExecArray, ...idx: number[]): string | undefined => idx.map((i) => m[i]).find((x) => x !== undefined);

  // ---- who the sentence is about: the job and the one item, from what is left
  let jobWord = false;
  // "Leave it out" on the selling question: the rest of the sentence is read as the buying rule it is.
  const sellingLeft = answers.selling === 'leave';
  let selling = (floorHits.length > 0 || /\b(?:get rid of|for sale)\b/.test(work.s)) && !sellingLeft;
  let itemWords: string[] = [];
  const stray: string[] = [];
  let inItem = false;
  let itemDone = false;
  let verbSeen = false;
  let sawArticle = false;
  for (const seg of work.s.split('|')) {
    const toks = seg.split(/\s+/).filter(Boolean);
    let run: string[] = [];
    const flush = () => { if (run.length) stray.push(run.join(' ')); run = []; };
    for (const [at, tok] of toks.entries()) {
      const w = tok.replace(/^["']+|["']+$/g, '');
      if (!w) continue;
      // a second verb before the item ("want to buy", "need to get") is only a verb
      if (BUY.has(w) && (!verbSeen || (inItem && !itemWords.length))) { verbSeen = true; jobWord = true; inItem = true; flush(); continue; }
      if (SELL.has(w)) { selling = !sellingLeft; flush(); continue; }
      if (inItem && !itemDone) {
        if (itemWords.length && STOP_ITEM.has(w)) { itemDone = true; run.push(w); continue; }
        // "a box of pens", "a pair of shoes": the item runs on through an "of"
        if (w === 'of' && itemWords.length && toks[at + 1] !== undefined && !STOP_ITEM.has(toks[at + 1] ?? '')) { itemWords.push(w); continue; }
        if (FILLER.has(w) && !MEANING.has(w)) { if (ARTICLES.has(w) && !itemWords.length) sawArticle = true; if (itemWords.length) itemDone = true; continue; }
        // "haggle hard for a monitor": a word before the item's own "for a" is a manner, not the item
        if (!itemWords.length && !sawArticle && toks.slice(at + 1, at + 4).some((t, k, rest) => (t === 'for' || t === 'to') && ARTICLES.has(rest[k + 1] ?? ''))) { run.push(w); continue; }
        if (itemWords.length < 6) { itemWords.push(w); continue; }
      }
      if (FILLER.has(w) && !MEANING.has(w)) { flush(); continue; }
      run.push(w);
    }
    flush();
    if (inItem && itemWords.length && toks.length) itemDone = true;
  }
  if (itemWords.length && itemWords.every((w) => ANYTHING.has(w))) { facts.anything = itemWords.join(' '); itemWords = []; }
  else if (itemWords.some((w) => ANYTHING.has(w)) && itemWords.length === 1) { facts.anything = itemWords[0] ?? null; itemWords = []; }
  // "3 monitors": a count is not part of the item's name (the wallet's band is for one item), and is shown as not read
  const first = itemWords[0] ?? '';
  if (itemWords.length > 1 && /^\d{1,2}$/.test(first) && Number(first) > 1 && /s$/.test(itemWords.at(-1) ?? '') && !/^(?:inch|inches|in|gb|tb|mb|hz|mm|cm|pack|packs|k)$/.test(itemWords[1] ?? '')) { stray.push(first); itemWords.shift(); }
  const itemText = itemWords.join(' ');
  const itemRef = slug(itemWords);
  if (itemText && itemRef) { facts.item = itemText; say('item', itemText); }
  else if (facts.anything) say('item', facts.anything);
  if (jobWord && !selling) { facts.job = 'buy'; say('job', 'buy'); }

  // ---- the numbers, each only when it is plain
  const pick = (slot: Slot, hits: Hit[], put: (v: number) => void, ids: { id: string; text: string }) => {
    const ds = distinct(hits);
    if (ds.length === 1 && ds[0]) { put(Number(ds[0].value)); say(slot, ds[0].heard); return; }
    if (ds.length > 1) {
      ask({ id: ids.id, slot, text: ids.text, answer: { kind: 'choice', choices: ds.map((d) => ({ value: d.value, label: `${currencyText(Number(d.value), cur)}` })) } });
      heard[slot] = ds.map((d) => d.heard).join(' / ');
    }
  };
  const asHits = (hits: Array<{ m: RegExpExecArray; heard: string }>, ...idx: number[]): Hit[] =>
    hits.flatMap(({ m, heard: h }) => { const v = amount(firstAmt(m, ...idx)); return v === null ? [] : [{ value: String(v), heard: h }]; });

  pick('ceiling', asHits(ceilingHits, 1, 2), (v) => { facts.ceiling = v; }, { id: 'ceiling-which', text: SAY_Q.ceilingWhich });
  if (facts.ceiling !== null && facts.ceiling <= 0) { facts.ceiling = null; unsure.add('ceiling'); heard.ceiling = heard.ceiling ?? ''; questions.push({ id: 'ceiling', slot: 'ceiling', text: SAY_Q.zero, answer: { kind: 'amount', label: SAY_Q.ceilingLabel } }); delete from.ceiling; }
  const askHits = asHits([...askOver, ...askBefore, ...askUnless, ...autoUnder], 1, 2);
  if (askAlways.length) askHits.push({ value: '0', heard: askAlways[0]?.heard ?? '' });
  pick('ask', askHits, (v) => { facts.ask = v; }, { id: 'ask-which', text: SAY_Q.askWhich });

  const offerVals: Hit[] = offerHits.flatMap(({ m, heard: h }) => (Number(m[1]) >= 1 && Number(m[1]) <= 255 ? [{ value: String(Number(m[1])), heard: h }] : []));
  if (offerHits.length && !offerVals.length) ask({ id: 'offers', slot: 'offers', text: SAY_Q.offersRange, answer: { kind: 'amount', label: SAY_Q.offersLabel } });
  else pick('offers', offerVals, (v) => { facts.offers = v; }, { id: 'offers-which', text: SAY_Q.offersWhich });

  const totals = asHits(dayTotalHits, 1, 2, 3).filter((h) => Number(h.value) > 0);
  pick('dayTotal', totals, (v) => { facts.dayTotal = v; }, { id: 'daytotal-which', text: SAY_Q.dayTotalWhich });
  const dealVals: Hit[] = dayDealHits.flatMap(({ m, heard: h }) => { const n = Number(m[1] ?? m[2] ?? m[3]); return n >= 1 ? [{ value: String(n), heard: h }] : []; });
  pick('dayDeals', dealVals, (v) => { facts.dayDeals = v; }, { id: 'daydeals-which', text: SAY_Q.dayDealsWhich });

  // when it ends: one reading, or a question
  const okEnds = endsHits.filter((h) => h.at !== null || h.ask);
  const endsDistinct = okEnds.filter((x, i) => okEnds.findIndex((y) => y.at === x.at && !!y.ask === !!x.ask) === i);
  if (endsHits.length && !okEnds.length) ask({ id: 'ends', slot: 'ends', text: SAY_Q.endsUnread, answer: { kind: 'text', label: SAY_Q.endsLabel } });
  else if (endsDistinct.length > 1) {
    ask({ id: 'ends-which', slot: 'ends', text: SAY_Q.endsWhich, answer: { kind: 'choice', choices: endsDistinct.flatMap((d) => (d.at === null ? [] : [{ value: String(d.at), label: whenWords(d.at, ctx) }])) } });
    heard.ends = endsDistinct.map((d) => d.heard).join(' / ');
  } else if (endsDistinct[0]) {
    const e = endsDistinct[0];
    if (e.ask) {
      const sd = sameDayChoices(ctx, e.ask.secs);
      ask({ id: 'ends-day', slot: 'ends', text: SAY_Q.endsDay(cap(e.ask.label)), answer: { kind: 'choice', choices: [{ value: String(sd.today), label: whenWords(sd.today, ctx) }, { value: String(sd.next), label: whenWords(sd.next, ctx) }] } });
      heard.ends = e.heard;
    } else if (e.at !== null) {
      if (e.at <= ctx.now + 60) ask({ id: 'ends', slot: 'ends', text: SAY_Q.endsPast, answer: { kind: 'text', label: SAY_Q.endsLabel } });
      else if (e.at > ctx.now + 366 * DAY) ask({ id: 'ends', slot: 'ends', text: SAY_Q.endsFar, answer: { kind: 'text', label: SAY_Q.endsLabel } });
      else { facts.ends = e.at; say('ends', e.heard); }
    }
  }

  // lone amounts: asked about, in the slots still free
  const taken = new Set(distinct([...asHits(ceilingHits, 1, 2), ...askHits, ...totals]).map((h) => h.value));
  const loneAmounts = [...new Set(lone.map((l) => amount(l.heard)).filter((v): v is number => v !== null && v > 0))].filter((v) => !taken.has(String(v)));
  for (const v of loneAmounts) {
    const choices: Array<{ value: string; label: string }> = [];
    if (facts.ceiling === null && !unsure.has('ceiling')) choices.push({ value: 'ceiling', label: SAY_Q.asCeiling(currencyText(v, cur)) });
    if (facts.ask === null && !unsure.has('ask')) choices.push({ value: 'ask', label: SAY_Q.asAsk(currencyText(v, cur)) });
    choices.push({ value: 'leave', label: SAY_Q.leaveOut });
    const id = `lone:${v}`;
    const picked = answers[id];
    if (picked === 'ceiling' && facts.ceiling === null) { facts.ceiling = v; from.ceiling = 'said'; heard.ceiling = currencyText(v, cur); continue; }
    if (picked === 'ask' && facts.ask === null) { facts.ask = v; from.ask = 'said'; heard.ask = currencyText(v, cur); continue; }
    if (picked === 'leave') continue;
    ask({ id, slot: 'leftover', text: SAY_Q.loneAmount(currencyText(v, cur)), answer: { kind: 'choice', choices } });
  }

  // the job, the item, and what stands open
  if (selling) {
    ask({ id: 'selling', slot: 'job', text: SAY_Q.selling, answer: { kind: 'choice', choices: [{ value: 'leave', label: SAY_Q.leaveOut }] } });
  } else if (facts.job === null && (facts.ceiling !== null || facts.item !== null || facts.anything !== null)) {
    ask({ id: 'job', slot: 'job', text: SAY_Q.job, answer: { kind: 'choice', choices: [{ value: 'buy', label: SAY_Q.jobBuy }] } });
  } else if (facts.job === null && !questions.length && stray.length === 0 && !work.s.replace(/\|/g, '').trim()) {
    // nothing readable at all
  }

  // ---- the owner's own answers and edits win over every reading
  applyAnswers(facts, from, heard, questions, unsure, answers, ctx);
  tieItem(facts, ctx, answers, ask);

  // one question where a said value contradicts another: asking above the most is never asked
  if (facts.ask !== null && facts.ceiling !== null && facts.ask >= facts.ceiling && facts.ask > 0 && !answers['ask-over']) {
    ask({ id: 'ask-over', slot: 'ask', text: SAY_Q.askOver(currencyText(facts.ask, cur), currencyText(facts.ceiling, cur)), answer: { kind: 'choice', choices: [{ value: 'every', label: SAY_Q.askEvery }, { value: 'keep', label: SAY_Q.askKeep(currencyText(facts.ceiling, cur)) }] } });
  }
  // "Ask me every time" settles the contradiction, but never overrides what the owner typed into the chip afterwards.
  if (answers['ask-over'] === 'every' && answers.ask === undefined && answers['ask-which'] === undefined) { facts.ask = 0; from.ask = 'said'; }

  if (facts.job === 'buy') {
    if (!facts.item && !facts.anything && !unsure.has('item')) ask({ id: 'item', slot: 'item', text: SAY_Q.item, answer: { kind: 'text', label: SAY_Q.itemLabel } });
    if (facts.ceiling === null && !unsure.has('ceiling')) ask({ id: 'ceiling', slot: 'ceiling', text: facts.item ? SAY_Q.ceilingFor(facts.item) : SAY_Q.ceilingAsk, answer: { kind: 'amount', label: SAY_Q.ceilingLabel } });
  }

  // ---- safe defaults for what was not said (never for what is unsure)
  const fill = <K extends keyof Facts>(slot: Slot, key: K, v: Facts[K]) => { if (facts[key] === null && !unsure.has(slot)) { facts[key] = v; from[slot] = 'filled'; } };
  fill('offers', 'offers', 6);
  fill('ends', 'ends', floorHour(ctx.now + 7 * DAY, ctx));
  fill('ask', 'ask', 0);
  fill('dayDeals', 'dayDeals', facts.item ? 2 : 3);
  if (facts.ceiling !== null) fill('dayTotal', 'dayTotal', facts.ceiling);

  const answeredLeave = (p: string): boolean => answers[`leave:${p}`] === 'leave';
  const leftover = stray.filter((p) => !answeredLeave(p));
  return { text, facts, from, heard, questions, unsure, leftover, selling };
}

// ---- tying "a monitor" to the item the wallet already knows ---------------------------------------------

const STOPWORDS = new Set(['a', 'an', 'the']);
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);

/** The owner's items the said words fit: the one with exactly that reference, else those that carry every said word in
 *  their title or reference, preferring the ones that end the same way ("monitor", not "monitor arm"). */
export function matchItems<T extends { ref: string; title: string }>(said: string, items: ReadonlyArray<T>): T[] {
  const want = wordsOf(said).filter((w) => !STOPWORDS.has(w));
  if (!want.length) return [];
  const asRef = want.join('-');
  const exact = items.filter((i) => i.ref.toLowerCase() === asRef || i.ref.toLowerCase() === said.trim().toLowerCase().replace(/\s+/g, '-'));
  if (exact.length) return exact.slice(0, 1);
  const hits = items.filter((i) => { const have = new Set([...wordsOf(i.title), ...wordsOf(i.ref)]); return want.every((w) => have.has(w)); });
  if (hits.length <= 1) return hits;
  const last = want[want.length - 1];
  const ends = hits.filter((i) => wordsOf(i.title).at(-1) === last);
  return ends.length ? ends : hits;
}

/** After the answers: tie the said item to one of the owner's items (one fit), or ask which (several), never choosing. */
function tieItem(facts: Facts, ctx: SayCtx, answers: Answers, ask: (q: Question) => void): void {
  if (!facts.item) return;
  const picked = answers['item-which'];
  // A pick is trusted as the reference it names (the owner chose it from the list the wallet showed).
  if (picked && picked !== 'other') {
    const known = ctx.items?.find((i) => i.ref === picked);
    facts.itemRef = picked;
    facts.itemTitle = known?.title ?? null;
    return;
  }
  if (picked === 'other' || !ctx.items?.length) return;
  // Tables open now come first: they are the likeliest thing meant.
  const fits = matchItems(facts.item, ctx.items).sort((a, b) => Number(b.open ?? false) - Number(a.open ?? false));
  const [only] = fits;
  if (fits.length === 1 && only) { facts.itemRef = only.ref; facts.itemTitle = only.title; return; }
  if (fits.length > 1) {
    ask({ id: 'item-which', slot: 'item', text: SAY_Q.itemWhich(facts.item), answer: { kind: 'choice', choices: [...fits.slice(0, 4).map((i) => ({ value: i.ref, label: i.title })), { value: 'other', label: SAY_Q.itemOther }] } });
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "$340" or "$340.50": whole amounts without cents, the rest exact. */
export function currencyText(minor: number, currency: Currency): string {
  const e = exponent(currency);
  const unit = 10 ** e;
  const mark = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  const whole = Math.trunc(minor / unit);
  const frac = minor % unit;
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${mark}${w}.${String(frac).padStart(e, '0')}` : `${mark}${w}`;
}

/** "Fri 18:00" in the owner's calendar. */
export function whenWords(at: number, ctx: Pick<SayCtx, 'now' | 'offsetMin'>): string {
  const off = ctx.offsetMin * 60;
  const d = new Date((at + off) * 1000);
  const near = Math.abs(at - ctx.now) < 6 * DAY;
  const day = near ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  return `${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Apply what the owner answered or typed into a chip. A typed value that does not parse is ignored (the chip says so). */
function applyAnswers(facts: Facts, from: Partial<Record<Slot, From>>, heard: Partial<Record<Slot, string>>, questions: Question[], unsure: Set<Slot>, answers: Answers, ctx: SayCtx): void {
  const settle = (slot: Slot, ...ids: string[]) => {
    for (let i = questions.length - 1; i >= 0; i--) if (ids.includes(questions[i]?.id ?? '')) questions.splice(i, 1);
    if (!questions.some((q) => q.slot === slot)) unsure.delete(slot);
  };
  const edited = (slot: Slot, text: string) => { from[slot] = 'said'; heard[slot] = text; };
  const amt = (v: string | undefined): number | null => (v === undefined ? null : money(v, facts.currency));
  const set = (slot: 'ceiling' | 'ask' | 'dayTotal', ids: string[], v: number | null, minOk: number) => {
    if (v === null || v < minOk) return;
    facts[slot] = v;
    edited(slot, currencyText(v, facts.currency));
    settle(slot, ...ids);
  };
  set('ceiling', ['ceiling', 'ceiling-which'], amt(answers.ceiling), 1);
  set('ask', ['ask-which'], amt(answers.ask), 0);
  set('dayTotal', ['daytotal-which'], amt(answers.dayTotal), 1);
  const count = (key: 'offers' | 'dayDeals', slot: Slot, ids: string[], max: number) => {
    const raw = answers[key];
    if (raw === undefined || !/^\d{1,3}$/.test(raw.trim())) return;
    const n = Number(raw);
    if (n < 1 || n > max) return;
    facts[key] = n;
    edited(slot, String(n));
    settle(slot, ...ids);
  };
  count('offers', 'offers', ['offers', 'offers-which'], 255);
  count('dayDeals', 'dayDeals', ['daydeals-which'], 65535);
  // picked from a list of readings
  const inRange = (v: string, lo: number, hi: number): boolean => /^\d{1,12}$/.test(v) && Number(v) >= lo && Number(v) <= hi;
  for (const [id, slot, key] of [['ceiling-which', 'ceiling', 'ceiling'], ['ask-which', 'ask', 'ask'], ['daytotal-which', 'dayTotal', 'dayTotal']] as const) {
    const v = answers[id];
    if (v !== undefined && inRange(v, id === 'ask-which' ? 0 : 1, 99_999_999_999)) { facts[key] = Number(v); edited(slot, currencyText(Number(v), facts.currency)); settle(slot, id); }
  }
  for (const [id, key] of [['offers-which', 'offers'], ['daydeals-which', 'dayDeals']] as const) {
    const v = answers[id];
    if (v !== undefined && inRange(v, 1, key === 'offers' ? 255 : 65535)) { facts[key] = Number(v); edited(key, v); settle(key, id); }
  }
  // the item, typed: words, made into one item name
  if (answers.item !== undefined) {
    const words = normalize(answers.item).split(/[\s|]+/).filter((w) => w && !FILLER.has(w));
    if (words.length && slug(words)) {
      facts.item = words.slice(0, 6).join(' ');
      facts.anything = null;
      edited('item', facts.item);
      settle('item', 'item');
    }
  }
  // when it ends: picked, or typed as a day and an hour ("fri 5pm", "nov 5")
  for (const id of ['ends-day', 'ends-which']) {
    const v = answers[id];
    if (v !== undefined && inRange(v, ctx.now, ctx.now + 366 * DAY)) { facts.ends = Number(v); edited('ends', whenWords(Number(v), ctx)); settle('ends', id, 'ends'); }
  }
  if (answers.ends !== undefined) {
    const typed = readEnds(answers.ends, ctx);
    if (typed !== null) { facts.ends = typed; edited('ends', whenWords(typed, ctx)); settle('ends', 'ends', 'ends-day', 'ends-which'); }
  }
  if (answers.who === 'house' || answers.who === 'paired') { facts.who = answers.who; edited('who', answers.who); }
  if (answers.job === 'buy' || answers.job === 'buy-fixed' || answers.job === '1') { facts.job = 'buy'; edited('job', 'buy'); settle('job', 'job'); }
  if (answers.selling === 'leave') { settle('job', 'selling'); }
  for (const q of [...questions]) if ((q.id === 'currency' || q.id === 'currency-other') && answers.currency) settle('currency', q.id);
  // the lone amounts and the words left over wave through (their ids are answered in read())
  for (const q of [...questions]) if (q.id.startsWith('lone:') && answers[q.id] === 'leave') settle('leftover', q.id);
}

/** A typed end ("fri 5pm", "tomorrow", "nov 5 noon", "3 days") read on its own, for the chip's edit box. */
export function readEnds(typed: string, ctx: SayCtx): number | null {
  const s = normalize(typed);
  const probe = (/^(?:until|till|by|before|in|for|through|ends?)\b/.test(s) ? s : `until ${s}`).replace(/^until (\d+\s+(?:hours?|days?|weeks?))$/, 'in $1');
  const r = read(probe, { ...ctx, payees: [] });
  if (r.facts.ends !== null && r.from.ends === 'said') return r.facts.ends;
  // "Friday" typed on a Friday: the end today if it is still ahead, otherwise a week away.
  const today = r.questions.find((q) => q.id === 'ends-day');
  const picks = today?.answer.kind === 'choice' ? today.answer.choices.map((c) => Number(c.value)) : [];
  return picks.find((at) => at > ctx.now + 3600) ?? null;
}

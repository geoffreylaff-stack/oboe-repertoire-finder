/**
 * Shared instrumentation parser.
 *
 * Runs unmodified in Node (harvester) and in the browser (app). It turns the
 * free-text instrumentation strings used by catalogues and publishers
 * into structured oboe-family counts, then renders them back out in a single
 * canonical form so that "3 ob." , "Three Oboes" and "2 oboes, corno inglese"
 * all display consistently.
 */

/** Canonical oboe-family members, in score order (top of the section down). */
export const OBOE_FAMILY = {
  musette:      { label: 'musette',        plural: 'musettes',        order: 0 },
  oboe:         { label: 'oboe',           plural: 'oboes',           order: 1 },
  oboeDamore:   { label: "oboe d'amore",   plural: "oboes d'amore",   order: 2 },
  oboeDaCaccia: { label: 'oboe da caccia', plural: 'oboes da caccia', order: 3 },
  englishHorn:  { label: 'english horn',   plural: 'english horns',   order: 4 },
  bassOboe:     { label: 'bass oboe',      plural: 'bass oboes',      order: 5 },
  heckelphone:  { label: 'heckelphone',    plural: 'heckelphones',    order: 6 },
};

export const FAMILY_KEYS = Object.keys(OBOE_FAMILY).sort(
  (a, b) => OBOE_FAMILY[a].order - OBOE_FAMILY[b].order
);

/**
 * Match patterns, deliberately ordered most-specific-first: "oboe d'amore"
 * must be consumed before the bare "oboe" pattern can claim its first word.
 */
const PATTERNS = [
  ['heckelphone',  /\bheckelphone?s?\b/i],
  ['bassOboe',     /\b(?:bass|basso)[\s-]+(?:oboe|hautbois|oboi)s?\b/i],
  ['bassOboe',     /\bbaritone[\s-]+oboes?\b/i],
  ['oboeDaCaccia', /\boboe?s?\s+da\s+caccia\b/i],
  ['oboeDamore',   /\boboe?s?\s*d[’']?\s*amou?re?\b/i],
  ['oboeDamore',   /\boboi\s*d[’']?\s*amore\b/i],
  ['englishHorn',  /\bengl(?:ish|isch)[\s-]*h(?:o|ö|oe)rn(?:er|s|e)?\b/i],
  ['englishHorn',  /\bcor(?:s)?\s+anglais\b/i],
  ['englishHorn',  /\bcorn[oi]\s+ingles[ei]\b/i],
  ['englishHorn',  /\bcoranglais\b/i],
  ['englishHorn',  /\be\.?\s?h\.\B/i],
  ['musette',      /\bmusettes?\b/i],
  ['oboe',         /\bobo(?:en|es|e|s)?\b/i],
  ['oboe',         /\bhautbo(?:is|y)s?\b/i],
  ['oboe',         /\bhobo(?:en|es|e|s)?\b/i],
  ['oboe',         /\boboi\b/i],
  ['oboe',         /\bob\.(?!\w)/i],
];

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, solo: 1, single: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  double: 2, triple: 3, quadruple: 4,
};

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Some catalogues write "third doubling bass oboe" where scores write "3rd". */
const ORDINAL_WORDS = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
};

/** Marks a parenthetical as describing a doubling rather than fresh players. */
const DOUBLING_CUE = /doubl|also|alternat|switch|=|raddoppi/i;

/** An ordinal naming a chair: "3rd", "third", or a bare "3". */
const ORDINAL = /\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi;

/**
 * Which chairs take up the doubled instrument, as a readable phrase.
 *
 * Only ordinals BEFORE the cue name players; those after it belong to the
 * instrument being picked up. Mahler 6 writes "3rd and 4th doubling 2nd and
 * 3rd cor anglais" — four ordinals, of which only the first two are chairs.
 */
function doublingPlayers(aside) {
  const cue = DOUBLING_CUE.exec(aside);
  const players = [...new Set(
    [...(cue ? aside.slice(0, cue.index) : aside).matchAll(ORDINAL)]
      .map((m) => ORDINAL_WORDS[m[1].toLowerCase()] ?? m[1]),
  )];
  if (!players.length) return null;
  if (players.length === 1) return players[0];
  return `${players.slice(0, -1).join(', ')} and ${players.at(-1)}`;
}

/** True when the string mentions any oboe-family instrument at all. */
export function mentionsOboeFamily(text) {
  if (!text) return false;
  return PATTERNS.some(([, re]) => re.test(text));
}

/**
 * Split an instrumentation string into segments on commas, semicolons and
 * top-level "and", while keeping parenthesised asides attached to their
 * instrument (so "3 oboes (3rd doubling english horn)" stays one segment).
 */
function splitSegments(text) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);

    if (depth === 0 && (c === ',' || c === ';' || c === '/')) {
      out.push(buf); buf = ''; continue;
    }
    if (depth === 0 && /\s/.test(c)) {
      const rest = text.slice(i);
      const m = /^\s+(?:and|und|et|&)\s+/i.exec(rest);
      if (m) { out.push(buf); buf = ''; i += m[0].length - 1; continue; }
    }
    buf += c;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Pull a leading quantity off a segment: "2 oboes" / "two oboes" / "oboes". */
function leadingCount(segment, matchIndex) {
  const before = segment.slice(0, matchIndex).trim();
  const digits = /(\d+)\s*(?:x\s*)?$/.exec(before);
  if (digits) return parseInt(digits[1], 10);

  const word = /([a-z]+)\s*$/i.exec(before);
  if (word) {
    const n = NUMBER_WORDS[word[1].toLowerCase()];
    if (n) return n;
  }
  return null; // unknown — decided by plurality below
}

/**
 * Parse an instrumentation string into oboe-family counts.
 *
 * @returns {{counts: Record<string, number>, doublings: Array, present: string[],
 *            uncertain: string[], total: number}}
 */
export function parseInstrumentation(text) {
  const counts = {};
  const doublings = [];
  // Counts are NOT accumulated across mentions. Source text routinely names an
  // instrument more than once — a second scoring for a reduced version, or plain
  // narrative ("the oboes are silent for the second movement") — and summing
  // those turned Shostakovich's two oboes into four. The scoring is stated
  // first, so the first explicit number wins; plurality is only a fallback.
  const explicit = {};   // key -> count taken from an actual number
  const inferred = {};   // key -> count read off singular/plural
  const ambiguous = new Set(); // only plurals are a real guess; "oboe" means one
  if (!text) return { counts, doublings, present: [], uncertain: [], total: 0 };

  const normalised = String(text)
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');

  for (const rawSegment of splitSegments(normalised)) {
    // Separate the parenthetical aside; it describes doublings, not new players.
    const asides = [];
    const head = rawSegment.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, a, b) => {
      asides.push(a ?? b ?? '');
      return ' ';
    });

    let primaryKey = null;
    for (const [key, re] of PATTERNS) {
      const m = re.exec(head);
      if (!m) continue;
      primaryKey = key;

      const n = leadingCount(head, m.index);
      if (n !== null) {
        if (explicit[key] === undefined) explicit[key] = n;
      } else {
        // No number given: fall back on plurality, recorded separately so an
        // explicit count stated elsewhere always outranks the guess.
        const isPlural = /(?:oboes|oboen|horns|h(?:ö|oe)rner|hautbois|heckelphones|musettes|oboi|cors)\b/i.test(m[0]);
        if (inferred[key] === undefined) {
          inferred[key] = isPlural ? 2 : 1;
          if (isPlural) ambiguous.add(key); // "oboes" could be any number; "oboe" is one
        }
      }
      break; // one family instrument per segment
    }

    // Doublings named in the aside ("3rd doubling english horn").
    for (const aside of asides) {
      if (!DOUBLING_CUE.test(aside)) continue;
      for (const [key, re] of PATTERNS) {
        if (!re.test(aside)) continue;
        doublings.push({
          instrument: key,
          parent: primaryKey,
          player: doublingPlayers(aside),
          text: aside.trim(),
        });
        if (!primaryKey && explicit[key] === undefined && inferred[key] === undefined) {
          inferred[key] = 0; // named only as a doubling, so no part of its own
        }
        break;
      }
    }
  }

  // Resolve: an explicit number beats a guess; only a guess is "uncertain".
  const uncertain = [];
  for (const key of new Set([...Object.keys(explicit), ...Object.keys(inferred)])) {
    if (explicit[key] !== undefined) {
      counts[key] = explicit[key];
    } else {
      counts[key] = inferred[key];
      if (inferred[key] > 0 && ambiguous.has(key)) uncertain.push(key);
    }
  }

  const present = FAMILY_KEYS.filter((k) => counts[k] > 0);
  const total = present.reduce((s, k) => s + counts[k], 0);
  return { counts, doublings, present, uncertain, total };
}

/** "two oboes, english horn" — words for small numbers, singular gets no number. */
export function formatOboeScoring(parsed, { numerals = false } = {}) {
  // Group doublings under the instrument whose players actually pick them up,
  // so Ravel reads "two oboes (2nd doubling oboe d'amore), english horn".
  const byParent = new Map();
  const orphans = [];
  for (const d of parsed.doublings || []) {
    if (!OBOE_FAMILY[d.instrument]) continue;
    if (parsed.counts[d.instrument]) continue; // listed on its own line already
    const phrase = d.player
      ? `${d.player} doubling ${OBOE_FAMILY[d.instrument].label}`
      : `doubling ${OBOE_FAMILY[d.instrument].label}`;
    if (d.parent && parsed.counts[d.parent]) {
      if (!byParent.has(d.parent)) byParent.set(d.parent, []);
      byParent.get(d.parent).push(phrase);
    } else {
      orphans.push(phrase);
    }
  }

  const parts = [];
  for (const key of FAMILY_KEYS) {
    const n = parsed.counts[key];
    if (!n) continue;
    const meta = OBOE_FAMILY[key];
    const num = !numerals && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
    let piece = n === 1 ? meta.label : `${num} ${meta.plural}`;
    const extra = byParent.get(key);
    if (extra?.length) piece += ` (${extra.join(', ')})`;
    parts.push(piece);
  }

  return [...parts, ...orphans].join(', ');
}

/**
 * Every family instrument the work actually requires a player to pick up,
 * counted parts and doublings alike. A doubled English horn is still an
 * English horn as far as anyone searching for one is concerned.
 */
export function requiredInstruments(parsed) {
  const keys = new Set(FAMILY_KEYS.filter((k) => parsed.counts[k] > 0));
  for (const d of parsed.doublings || []) if (OBOE_FAMILY[d.instrument]) keys.add(d.instrument);
  return [...keys].sort((a, b) => OBOE_FAMILY[a].order - OBOE_FAMILY[b].order);
}

/** Stable signature for de-duplicating identical scorings. */
export function scoringKey(parsed) {
  return FAMILY_KEYS.map((k) => `${k}:${parsed.counts[k] || 0}`).join('|');
}

/**
 * Tidy a catalogue category name into a plain instrumentation string:
 * "For 2 oboes, english horn (arr)" -> { text: "2 oboes, english horn", arrangement: true }
 */
export function fromCategoryName(name) {
  let text = String(name).replace(/^For\s+/i, '').trim();
  const arrangement = /\(arr\)\s*$/i.test(text);
  text = text.replace(/\(arr\)\s*$/i, '').trim();
  return { text, arrangement };
}

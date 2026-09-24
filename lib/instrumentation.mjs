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
 * A chair as scores name it: "third" and a bare "2" both become "3rd", "2nd".
 * Verdi's Rigoletto writes "Oboe 2 doubles English horn", meaning the 2nd.
 */
function asOrdinal(token) {
  const word = ORDINAL_WORDS[token.toLowerCase()];
  if (word) return word;
  if (!/^\d+$/.test(token)) return token; // already "3rd"
  const n = parseInt(token, 10);
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;
}

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
    [...(cue ? aside.slice(0, cue.index) : aside).matchAll(ORDINAL)].map((m) => asOrdinal(m[1])),
  )];
  if (!players.length) return null;
  if (players.length === 1) return players[0];
  return `${players.slice(0, -1).join(', ')} and ${players.at(-1)}`;
}

/**
 * Every family instrument named in a piece of text, most specific first.
 *
 * Each name is blanked once matched so that a broader pattern cannot claim it
 * a second time: "oboe d'amore" must not also register as a plain oboe.
 */
function familyNamesIn(text) {
  const at = new Map();
  let scan = text;
  for (const [key, re] of PATTERNS) {
    const m = re.exec(scan);
    if (!m) continue;
    scan = scan.slice(0, m.index) + ' '.repeat(m[0].length) + scan.slice(m.index + m[0].length);
    if (!at.has(key)) at.set(key, m.index);
  }
  // Blanking keeps the string's length, so the indices stay comparable and the
  // list can be handed back in the order the text names them.
  return [...at].sort((a, b) => a[1] - b[1]).map(([key]) => key);
}

/**
 * Split a doubling aside into one clause per doubling.
 *
 * A comma joins onto the clause so far in two cases. Before the cue arrives,
 * bare ordinals are an incomplete fragment that has to attach to whatever
 * follows: "2nd, 3rd and 4th doubling english horn" lists three chairs
 * taking one instrument, not three separate doublings. After the cue, a
 * comma only still joins when what follows is a pure remark repeating the
 * same instrument, not naming a different one: "…cor anglais; 2nd cor
 * anglais used only in Scherzo" is one doubling with a remark after it — but
 * Stravinsky's Capriccio lists "flutes doubling piccolo, oboes, clarinets
 * doubling piccolo clarinet, and bassoons", a plain four-item roll call of
 * the woodwind section, where "oboes" is its own item, not a remark on the
 * flutes' doubling, and a fresh cue of its own ("clarinets doubling...")
 * always starts a new clause regardless of what either side names.
 */
function doublingClauses(aside) {
  const clauses = [];
  for (const chunk of aside.split(/[,;]/)) {
    const last = clauses.at(-1);
    if (last === undefined) { clauses.push(chunk); continue; }

    const lastNames = familyNamesIn(last);
    const lastIsIncomplete = !DOUBLING_CUE.test(last) && lastNames.length === 0;
    const chunkIsPureRemark = !DOUBLING_CUE.test(chunk)
      && familyNamesIn(chunk).every((key) => lastNames.includes(key));

    if (lastIsIncomplete || chunkIsPureRemark) {
      clauses[clauses.length - 1] = `${last}, ${chunk}`;
    } else {
      clauses.push(chunk);
    }
  }
  return clauses;
}

/**
 * Read every doubling an aside describes, each with the chairs that take it,
 * plus any instrument the aside names without a doubling cue of its own.
 *
 * One aside can name more than one doubled instrument. Ligeti's Le Grand
 * Macabre has "second doubling oboe d'amore, 3rd doubling cor anglais" — two
 * doublings by two different chairs — and his Chamber Concerto has "doubling
 * English horn and oboe d'amore", two instruments taken by the same player.
 * Reading only the first left both works unfindable by anyone searching for
 * English horn.
 *
 * An aside is not always only a doubling, though — see doublingClauses — so
 * a clause with no cue of its own is kept apart as a bare mention rather
 * than credited to whichever doubling happens to sit next to it.
 */
function readDoublings(aside) {
  const found = [];
  const bare = [];
  const seen = new Set();
  for (const clause of doublingClauses(aside)) {
    const hasCue = DOUBLING_CUE.test(clause);
    const player = hasCue ? doublingPlayers(clause) : null;
    for (const key of familyNamesIn(clause)) {
      if (seen.has(key)) continue; // a later remark repeating the name
      seen.add(key);
      (hasCue ? found : bare).push({ key, player, text: clause });
    }
  }
  return { found, bare };
}

/**
 * The count a bare mention (no leading number, found loose in an aside)
 * implies for `key` — an explicit number in front of it if there is one,
 * otherwise the same singular/plural guess a plain segment would make.
 */
function countFor(text, key) {
  for (const [k, re] of PATTERNS) {
    if (k !== key) continue;
    const m = re.exec(text);
    if (!m) continue;
    const n = leadingCount(text, m.index);
    if (n !== null) return { count: n, ambiguous: false };
    const isPlural = /(?:oboes|oboen|horns|h(?:ö|oe)rner|hautbois|heckelphones|musettes|oboi|cors)\b/i.test(m[0]);
    return { count: isPlural ? 2 : 1, ambiguous: isPlural };
  }
  return { count: 1, ambiguous: false }; // familyNamesIn already found it; a pattern must match
}

/** True when the string mentions any oboe-family instrument at all. */
export function mentionsOboeFamily(text) {
  if (!text) return false;
  return PATTERNS.some(([, re]) => re.test(text));
}

/**
 * Index of the text's first oboe-family mention (by whichever pattern
 * matches earliest), or -1 if none. Used to find where a harvested article's
 * scoring prose actually begins, as opposed to matching only a generic word.
 */
export function firstFamilyMentionIndex(text) {
  if (!text) return -1;
  let earliest = -1;
  for (const [, re] of PATTERNS) {
    const m = re.exec(text);
    if (m && (earliest === -1 || m.index < earliest)) earliest = m.index;
  }
  return earliest;
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
      const { found, bare } = readDoublings(aside);
      for (const { key, player } of found) {
        // An aside often restates the instrument it belongs to — "oboe 2
        // doubles English horn" — and nothing doubles itself.
        if (key === primaryKey) continue;
        doublings.push({
          instrument: key,
          parent: primaryKey,
          player,
          text: aside.trim(),
        });
        if (!primaryKey && explicit[key] === undefined && inferred[key] === undefined) {
          inferred[key] = 0; // named only as a doubling, so no part of its own
        }
      }
      // A clause with no cue of its own is a plain mention riding along in
      // the aside, not a doubling — it gets a real, independent count.
      for (const { key, text: clause } of bare) {
        if (key === primaryKey) continue;
        if (explicit[key] === undefined && inferred[key] === undefined) {
          const { count, ambiguous: isAmbiguous } = countFor(clause, key);
          inferred[key] = count;
          if (isAmbiguous) ambiguous.add(key);
        }
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

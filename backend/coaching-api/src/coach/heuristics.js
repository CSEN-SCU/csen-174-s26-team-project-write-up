import nspell from "nspell";
import dictionaryEn from "dictionary-en";
import { tokenize, HEDGE_WORDS, countMatches } from "../lib/nlp.js";
import { isLikelyGibberishToken } from "../lib/word-quality.js";

// ─────────────────────────────────────────────────────────────────────────────
// Seed tables
//
// These tables exist ONLY for cases where the general-purpose engines below
// cannot reason correctly on their own:
//   - SPELLING_OVERRIDES: the Hunspell dictionary would flag the word but give
//     a misleading or wrong suggestion — so we override with a better one.
//   - PHRASE_RULES: multi-word confusions (their/there, should of, etc.) that
//     require matching a phrase rather than a single token.
//   - TYPO_OVERRIDES: very short transpositions the dictionary would accept
//     or misclassify in context.
//
// The dictionary engine, apostrophe-detection engine, and algorithmic checks
// handle everything else dynamically — including patterns not listed here.
// To add a new rule, extend one of these tables; no logic changes are needed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Explicit misspelling overrides: used when the Hunspell dictionary produces
 * a misleading suggestion for a known misspelling (e.g., "pregnate" → "primate").
 * For words the dictionary handles accurately, omit them here and let it work.
 *
 * @type {Array<{ pattern: RegExp, fix: string, note?: string }>}
 */
export const SPELLING_OVERRIDES = [
  // Dictionary suggestions for these are often wrong or unhelpful.
  { pattern: /\bpregnate\b/i,       fix: "pregnant" },
  { pattern: /\bbrib(es|ed|ing)?\b/i, fix: "bribe",    note: "verb/noun for offering money improperly" },
  // Kept for the pedagogical note — explains the i-before-e rule.
  { pattern: /\brecieve\b/i,        fix: "receive",   note: "i before e except after c" },
  { pattern: /\bwierd\b/i,          fix: "weird",     note: "i before e rule" },
];

/**
 * Phrase-level grammar and word-confusion rules.
 * Only include unambiguous patterns where a wrong word is structurally
 * detectable without full sentence parsing (e.g., "their is/are" is
 * always wrong; "their" before a noun is correct).
 *
 * @type {Array<{
 *   pattern: RegExp,
 *   type: string,
 *   title: string,
 *   body: string,
 *   micro_edit: string | null
 * }>}
 */
export const PHRASE_RULES = [
  // their / there confusion — "their" before a verb is almost always "there"
  {
    pattern: /\btheir\s+(?:is|are|was|were|have|has|had|will|would|could|should|may|might|must|been|no\b)/i,
    type: "grammar",
    title: "Word confusion: \u201ctheir\u201d vs \u201cthere\u201d",
    body: "**Their** shows possession (belonging to them). **There** points to a place or introduces a clause. Use **there** here.",
    micro_edit: null,
  },
  // "should / could / would of" — mishearing of the contraction
  {
    pattern: /\bshould\s+of\b/i,
    type: "grammar",
    title: "Grammar: \u201cshould of\u201d",
    body: "This sounds like a contraction but the correct form is **should have** (or *should\u2019ve*).",
    micro_edit: "should have",
  },
  {
    pattern: /\bcould\s+of\b/i,
    type: "grammar",
    title: "Grammar: \u201ccould of\u201d",
    body: "The correct form is **could have** (or *could\u2019ve*).",
    micro_edit: "could have",
  },
  {
    pattern: /\bwould\s+of\b/i,
    type: "grammar",
    title: "Grammar: \u201cwould of\u201d",
    body: "The correct form is **would have** (or *would\u2019ve*).",
    micro_edit: "would have",
  },
  // "your welcome" — possessive vs contraction
  {
    pattern: /\byour\s+welcome\b/i,
    type: "grammar",
    title: "Phrase: \u201cyour welcome\u201d",
    body: "Use the contraction **you're** (*you are welcome*) rather than the possessive **your**.",
    micro_edit: "You're welcome",
  },
  // Subject–verb agreement: "there is + plural quantifier"
  {
    pattern: /\bthere\s+is\s+(?:so\s+)?many\b/i,
    type: "grammar",
    title: "Subject\u2013verb agreement",
    body: "**Many** is plural, so standard English uses **there are** (not *there is*).",
    micro_edit: null,
  },

  // ── Subject–verb agreement ────────────────────────────────────────────────
  // Plural pronouns paired with a singular verb
  {
    pattern: /\b(?:they|we|you)\s+(?:was|is)\b/i,
    type: "grammar",
    title: "Subject\u2013verb agreement: plural pronoun with singular verb",
    body: "**They**, **we**, and **you** take plural verbs: **were** (past) or **are** (present).",
    micro_edit: null,
  },
  // Singular pronouns / indefinites directly before "are"
  {
    pattern: /\b(?:it|he|she|everyone|someone|anyone|nobody|nothing|everything)\s+are\b/i,
    type: "grammar",
    title: "Subject\u2013verb agreement: singular subject with \u201care\u201d",
    body: "This subject is singular\u2014use **is** instead of **are**.",
    micro_edit: null,
  },
  // "this/that + [optional noun phrase] + are" — the subject and verb may be
  // separated by a noun (e.g. "This sentence are incorrect").
  {
    pattern: /\b(?:this|that)\s+(?:\w+\s+)?are\b/i,
    type: "grammar",
    title: "Subject\u2013verb agreement: singular subject with \u201care\u201d",
    body: "**This** and **that** are singular determiners\u2014use **is** instead of **are**.",
    micro_edit: null,
  },
  // Plural nouns (words ending in common unambiguous plural suffixes) + "was"
  // Suffixes: -nts (students, parents), -nds (friends, hands), -cts (objects),
  //           -rds (words, birds), -lts (adults, results)
  // Written as explicit suffix alternatives so the regex engine backtracks
  // reliably on each branch without ambiguity.
  {
    pattern: /\b(?:[a-z]+nts|[a-z]+nds|[a-z]+cts|[a-z]+rds|[a-z]+lts)\s+was\b/i,
    type: "grammar",
    title: "Subject\u2013verb agreement: plural subject with \u201cwas\u201d",
    body: "A plural subject takes **were**, not **was**. Try: the students *were* excited.",
    micro_edit: null,
  },

  // ── Common contractions missing their apostrophe ──────────────────────────
  // Belt-and-suspenders over the dictionary apostrophe-insertion detector:
  // nspell may not rank the apostrophe form first for 4-letter tokens
  // (e.g. "dont" → suggests "done" before "don't"), silently dropping the card.
  { pattern: /\bdont\b/i,     type: "grammar", title: "Missing apostrophe: \u201cdont\u201d",     body: "Standard contraction is **don\u2019t** (*do not*).",      micro_edit: "don't"     },
  { pattern: /\bdidnt\b/i,    type: "grammar", title: "Missing apostrophe: \u201cdidnt\u201d",    body: "Standard contraction is **didn\u2019t** (*did not*).",    micro_edit: "didn't"    },
  { pattern: /\bisnt\b/i,     type: "grammar", title: "Missing apostrophe: \u201cisnt\u201d",     body: "Standard contraction is **isn\u2019t** (*is not*).",      micro_edit: "isn't"     },
  { pattern: /\bwasnt\b/i,    type: "grammar", title: "Missing apostrophe: \u201cwasnt\u201d",    body: "Standard contraction is **wasn\u2019t** (*was not*).",    micro_edit: "wasn't"    },
  { pattern: /\barent\b/i,    type: "grammar", title: "Missing apostrophe: \u201carent\u201d",    body: "Standard contraction is **aren\u2019t** (*are not*).",    micro_edit: "aren't"    },
  { pattern: /\bwerent\b/i,   type: "grammar", title: "Missing apostrophe: \u201cwerent\u201d",   body: "Standard contraction is **weren\u2019t** (*were not*).",  micro_edit: "weren't"   },
  { pattern: /\bhasnt\b/i,    type: "grammar", title: "Missing apostrophe: \u201chasnt\u201d",    body: "Standard contraction is **hasn\u2019t** (*has not*).",    micro_edit: "hasn't"    },
  { pattern: /\bhavent\b/i,   type: "grammar", title: "Missing apostrophe: \u201chavent\u201d",   body: "Standard contraction is **haven\u2019t** (*have not*).",  micro_edit: "haven't"   },
  { pattern: /\bwouldnt\b/i,  type: "grammar", title: "Missing apostrophe: \u201cwouldnt\u201d",  body: "Standard contraction is **wouldn\u2019t** (*would not*).", micro_edit: "wouldn't"  },
  { pattern: /\bcouldnt\b/i,  type: "grammar", title: "Missing apostrophe: \u201ccouldnt\u201d",  body: "Standard contraction is **couldn\u2019t** (*could not*).", micro_edit: "couldn't"  },
  { pattern: /\bshouldnt\b/i, type: "grammar", title: "Missing apostrophe: \u201cshouldnt\u201d", body: "Standard contraction is **shouldn\u2019t** (*should not*).", micro_edit: "shouldn't" },
  { pattern: /\bdoesnt\b/i,   type: "grammar", title: "Missing apostrophe: \u201cdoesnt\u201d",   body: "Standard contraction is **doesn\u2019t** (*does not*).",  micro_edit: "doesn't"   },
  { pattern: /\bhadnt\b/i,    type: "grammar", title: "Missing apostrophe: \u201chadnt\u201d",    body: "Standard contraction is **hadn\u2019t** (*had not*).",    micro_edit: "hadn't"    },
  { pattern: /\bwont\b(?=\s+(?:be\b|have\b|do\b|let\b|stop\b|go\b|give\b|come\b|make\b|take\b|say\b))/i, type: "grammar", title: "Missing apostrophe: \u201cwont\u201d", body: "In this context the intended word is likely **won\u2019t** (*will not*). (Note: \u201cwont\u201d without an apostrophe is a different word meaning \u201chabitual custom.\u201d)", micro_edit: "won't" },

  // ── its / it's confusion ──────────────────────────────────────────────────
  // "its been" → "it's been"  (its = possessive, it's = contraction of it is/has)
  {
    pattern: /\bits\s+been\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cits been\u201d",
    body: "**Its** is the possessive pronoun (no apostrophe). **It\u2019s** is the contraction of *it is* or *it has*. Here the contraction is needed: **it\u2019s been**.",
    micro_edit: "it's been",
  },
  // "it's own" → "its own"  (it's = contraction, its = possessive)
  {
    pattern: /\bit's\s+own\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cit\u2019s own\u201d",
    body: "**It\u2019s** is a contraction (*it is* / *it has*). For possession, drop the apostrophe: **its own**.",
    micro_edit: "its own",
  },
  // "it's" right after a past-tense transitive verb → possessive "its" needed.
  // Excludes verbs commonly used in reporting speech ("noticed it's fine") where
  // "it's [predicate]" = "it is [predicate]" can be valid.
  {
    pattern: /\b(?:changed|updated|modified|altered|replaced|revised|improved|increased|reduced|published|released|launched|introduced|implemented|applied|maintained|enhanced|established|created|built|designed|developed|removed|deleted|expanded|completed|controlled|managed|determined|influenced|structured|organized|formatted|labeled|named|defined|combined|merged|split|converted|transformed)\s+it's\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cit\u2019s\u201d as possessive",
    body: "**It\u2019s** is a contraction (*it is* / *it has*). After a transitive verb like this, possession is intended\u2014use **its** (no apostrophe).",
    micro_edit: null,
  },

  // ── your / you're confusion ───────────────────────────────────────────────
  // "your going [to]" → "you're going"
  {
    pattern: /\byour\s+going\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cyour going\u201d",
    body: "**Your** is possessive (*your bag*). Here the contraction **you\u2019re** (*you are*) is needed: **you\u2019re going**.",
    micro_edit: null,
  },
  // "your being" → "you're being"
  {
    pattern: /\byour\s+being\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cyour being\u201d",
    body: "**Your** is possessive; **you\u2019re** (*you are*) is the contraction. Try: **you\u2019re being**.",
    micro_edit: null,
  },

  // ── were / we're confusion ────────────────────────────────────────────────
  // "Were planning..." at the start of a sentence → "We're planning..."
  // The (?:^|...) branch anchors to a sentence start so "They were planning" is safe.
  {
    pattern: /(?:^|[.!?\n]\s*)[Ww]ere\s+[a-z]+ing\b/,
    type: "grammar",
    title: "Word confusion: \u201cwere\u201d at sentence start",
    body: "**Were** is the past tense of *to be* (e.g., *they were planning*). At the start of a sentence without an explicit subject, the likely intended word is the contraction **we\u2019re** (*we are*).",
    micro_edit: null,
  },
];

/**
 * Short-word typo overrides: common transpositions that the dictionary either
 * accepts or produces poor suggestions for because the word is too short.
 *
 * @type {Array<{ pattern: RegExp, fix: string, note?: string }>}
 */
export const TYPO_OVERRIDES = [
  { pattern: /\bteh\b/i, fix: "the", note: "transposed letters" },
];

/**
 * Thresholds for structural heuristics — tune these without touching logic.
 */
export const HEURISTIC_THRESHOLDS = {
  LONG_SENTENCE_WORDS: 40,
  HEDGE_REPEAT_MIN: 3,
  OBVIOUS_MAX_CARDS: 12,
  STRUCTURAL_MAX_CARDS: 8,
};

/**
 * Tone-shift rules: fire when BOTH a casual-register word AND a formal-topic
 * word appear in the same passage.
 *
 * @type {Array<{ casual: RegExp, formal: RegExp, title: string, body: string }>}
 */
export const TONE_SHIFT_RULES = [
  {
    casual: /\b(shit|fuck|damn|crap|ass)\b/i,
    formal: /\b(vision|product|report|essay|thesis|professor|client|proposal|stakeholder)\b/i,
    title: "Tone shift: casual language in a formal context",
    body: "Casual language can be honest voice\u2014but next to formal topic words, readers may need one bridge sentence to confirm the register is intentional.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dictionary spell checker (Hunspell via nspell)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import("nspell") | null} */
let spellchecker = null;

/**
 * Words the dictionary should skip entirely.
 * Does NOT include contraction-without-apostrophe forms (dont, youre, etc.) —
 * those are handled dynamically by apostrophe-insertion detection below.
 */
const SPELL_ALLOW = new Set(
  `omg lol lmao rofl imo tbh idk btw fr frfr ngl irl ig u ur bc cos cuz tho thru pls plz ppl ok okay yep nah huh hmm hm er um uh kinda sorta gonna wanna gotta hell damn darn shoot dang heck yeet sus cap fax nope haha hahaha woah whoa yall ya'll gonna cv api css html js ts jpg png gif pdf url uri sql dns tcp http https www com org net io co uk app apps ios android bro holy shit fuck fucking freaking crap ass dude man guys gon na`
    .split(/\s+/).filter(Boolean),
);

/**
 * Lowercase forms of words that are ALWAYS correctly capitalized in English
 * (days, months, nationalities, major proper-noun brands).
 * A mid-sentence capital word whose lowercase is in this set is skipped by
 * the unnecessary-capitalization check.
 */
const ALWAYS_PROPER_LOWER = new Set((
  "monday tuesday wednesday thursday friday saturday sunday " +
  "january february march april may june july august " +
  "september october november december " +
  "english french spanish german chinese japanese korean arabic " +
  "russian italian portuguese dutch swedish norwegian danish finnish " +
  "american european asian african latin british australian canadian " +
  "christian muslim jewish buddhist hindu protestant catholic " +
  "internet"
).split(" "));

try {
  spellchecker = nspell(dictionaryEn);
} catch (e) {
  console.warn("Heuristics spellchecker unavailable:", e?.message || e);
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine functions
// ─────────────────────────────────────────────────────────────────────────────

/** Skip the dictionary pass when most tokens look like random typing. */
export function draftHasHeavyUnknownTokens(text) {
  if (!spellchecker) return false;
  const tokens = String(text || "").match(/\b[a-zA-Z]{4,}\b/g) || [];
  if (tokens.length < 4) return false;
  let unknown = 0;
  for (const raw of tokens) {
    const lw = raw.toLowerCase();
    if (SPELL_ALLOW.has(lw)) continue;
    if (lw.length === 4) { unknown += 1; continue; }
    if (isLikelyGibberishToken(raw) || !spellchecker.correct(lw)) unknown += 1;
  }
  return unknown / tokens.length >= 0.4;
}

/**
 * Dictionary-powered spell and apostrophe checker.
 *
 * Apostrophe-insertion detection: when Hunspell's top suggestion for a word
 * is the same word with an apostrophe added (e.g. dont → don't, youre → you're),
 * the card is emitted as "Missing apostrophe" rather than "Spelling". This
 * generalises contraction detection to any contraction Hunspell knows — no
 * explicit list of contraction forms is required.
 *
 * Proper-noun guard: words starting with a capital letter are skipped because
 * the dictionary produces misleading suggestions for names and brands.
 */
export function spellDictionarySuggestions(text, opts = {}) {
  if (!spellchecker) return [];
  const maxCards = Math.max(1, Math.min(14, Number(opts.maxCards) || 8));
  const spell = spellchecker;
  const t = String(text);
  const seen = new Set();
  const cards = [];

  // Check SPELLING_OVERRIDES first so they get priority slots.
  for (const rule of SPELLING_OVERRIDES) {
    const m = rule.pattern.exec(t);
    if (!m) continue;
    const lw = m[0].toLowerCase();
    if (seen.has(lw)) continue;
    seen.add(lw);
    cards.push({
      type: "grammar",
      title: `Spelling: \u201c${m[0]}\u201d`,
      body: `Standard spelling is **${rule.fix}**${rule.note ? ` (${rule.note})` : ""}.`,
      micro_edit: rule.fix,
    });
    if (cards.length >= maxCards) break;
  }

  for (const m of t.matchAll(/\b([a-zA-Z]{4,})\b/g)) {
    if (cards.length >= maxCards) break;
    const raw = m[1];
    const lw = raw.toLowerCase();

    if (SPELL_ALLOW.has(lw)) continue;
    if (seen.has(lw)) continue;
    if (isLikelyGibberishToken(raw)) continue;
    if (/^[A-Z]{2,}$/.test(raw)) continue;      // ALL-CAPS acronyms
    if (/^[A-Z]/.test(raw)) {
      // Mid-sentence capitalization check: if the lowercase form is a known
      // dictionary word AND the word is not at a sentence boundary AND it's
      // not in the always-proper allowlist, flag it as possibly unnecessary.
      if (!seen.has(lw) && !ALWAYS_PROPER_LOWER.has(lw) && spell.correct(lw)) {
        const prevText = t.slice(0, m.index).trimEnd();
        const atBoundary =
          !prevText ||
          /[.!?\n]["'\u201D\u2019]?\s*$/.test(prevText) ||
          /:\s*$/.test(prevText);
        if (!atBoundary) {
          seen.add(lw);
          cards.push({
            type: "grammar",
            title: `Capitalization: \u201c${raw}\u201d`,
            body: `\u201c${raw}\u201d appears mid-sentence. Only proper nouns (names, places, titles) are capitalized in standard English. If this is a common word, use \u201c${lw}\u201d instead.`,
            micro_edit: lw,
          });
        }
      }
      continue; // never run spelling checks on capital-initial words
    }

    // Check SPELLING_OVERRIDES coverage — skip if already emitted above.
    if (SPELLING_OVERRIDES.some((r) => r.pattern.test(raw))) continue;

    // Stretched/elongated words (3+ consecutive same letter, e.g. "sooooo",
    // "weirddd") are handled by the dedicated stretched-word check below.
    // Skip them here so only ONE card is generated per word.
    if (/([a-z])\1{2}/i.test(lw)) continue;

    if (spell.correct(lw)) continue;

    // Detect compound-word fusing before falling through to dictionary suggestions.
    // e.g. "thebook" → "the" + "book".  Only attempt for tokens ≥ 5 characters;
    // 4-letter tokens are already filtered out below.
    if (lw.length >= 5) {
      let splitCard = null;
      for (let cut = 2; cut <= lw.length - 2; cut++) {
        const left = lw.slice(0, cut);
        const right = lw.slice(cut);
        if (spell.correct(left) && spell.correct(right)) {
          splitCard = {
            type: "grammar",
            title: `Possible split: \u201c${raw}\u201d`,
            body: `This looks like two words fused together: **${left} ${right}**. Add a space if that matches your meaning.`,
            micro_edit: `${left} ${right}`,
          };
          break;
        }
      }
      if (splitCard) {
        seen.add(lw);
        cards.push(splitCard);
        continue;
      }
    }

    const sug = spell.suggest(lw);

    // When the dictionary flags a word but has no substitute, still emit a card —
    // the absence of a suggestion should not silently suppress the flag.
    if (!sug?.length) {
      seen.add(lw);
      cards.push({
        type: "grammar",
        title: `Unrecognized word: \u201c${raw}\u201d`,
        body: `\u201c${raw}\u201d isn\u2019t in the dictionary and no substitute was found. Double-check the spelling.`,
        micro_edit: null,
      });
      continue;
    }

    const topSug = sug[0];

    // Detect apostrophe-insertion: suggestion equals original word + apostrophe(s).
    const isApostropheInsertion = topSug.replace(/'/g, "") === lw;

    // For 4-letter words, only proceed for apostrophe-insertions — too many
    // false positives from short keyboard noise otherwise.
    if (lw.length === 4 && !isApostropheInsertion) continue;

    // Skip if suggestions are only capitalisation variants of the same word.
    if (!isApostropheInsertion && sug.every((s) => s.toLowerCase() === lw)) continue;

    seen.add(lw);

    if (isApostropheInsertion) {
      cards.push({
        type: "grammar",
        title: `Missing apostrophe: \u201c${raw}\u201d`,
        body: `\u201c${raw}\u201d is missing an apostrophe. Standard form is **${topSug}**.`,
        micro_edit: topSug,
      });
    } else {
      cards.push({
        type: "grammar",
        title: `Spelling: \u201c${raw}\u201d`,
        body: `Likely typo\u2014dictionary suggests **${topSug}**${sug[1] ? ` or *${sug[1]}*` : ""}. Pick the word that matches your meaning.`,
        micro_edit: topSug,
      });
    }
  }

  return cards;
}

/**
 * Mechanical per-token and phrase checks.
 *
 * Algorithmic checks run before the seed-table loops so they are never
 * displaced by a large number of matches from the phrase or typo tables.
 */
export function obviousSpellingGrammarHeuristics(text) {
  const t = String(text || "");
  const out = [];
  const add = (card) => { if (card?.title) out.push(card); };

  // ── Algorithmic checks (generalise to any input) ───────────────────────────

  // Repeated-word: catches 2+ consecutive identical words (e.g. "very very", "quickly quickly", "has has").
  // Uses matchAll so every unique duplicated word gets its own card, not just the first one found.
  const seenRepeated = new Set();
  for (const m of t.matchAll(/\b(\w{2,})\b(?:\s+\1\b){1,}/gi)) {
    const word = m[1].toLowerCase();
    if (seenRepeated.has(word)) continue;
    seenRepeated.add(word);
    add({
      type: "clarity",
      title: `Repeated word: \u201c${m[1]}\u201d`,
      body: `\u201c${m[1]}\u201d appears back-to-back. This is likely an accidental duplication\u2014delete the extra copy.`,
      micro_edit: m[1],
    });
  }

  // Stretched / elongated words — same letter repeated 3+ times in a row.
  // nspell's top suggestion for e.g. "weirddd" is unpredictable (may be
  // "weirdo" rather than "weird"), so we add a dedicated pass here.
  // Cap at 3 cards per pass to avoid flooding the panel.
  const seenStretched = new Set();
  for (const m of t.matchAll(/\b([a-z]{4,})\b/gi)) {
    const w = m[1];
    if (!/([a-z])\1{2}/i.test(w)) continue;   // need 3+ consecutive same letter
    const lw = w.toLowerCase();
    if (seenStretched.has(lw)) continue;
    seenStretched.add(lw);
    add({
      type: "clarity",
      title: `Stretched word: \u201c${w}\u201d`,
      body: `Repeating a letter for emphasis (*${w}*) is a spoken-language cue. In written form it may not land as intended\u2014consider italics, an em dash, or a stronger word.`,
      micro_edit: null,
    });
  }

  // Sentence-start capitalization — one card per unique lowercase word so
  // every instance is individually visible and highlightable.
  const seenLowerStart = new Set();
  for (const m of t.matchAll(/[.!?]\s+([a-z]\w*)/g)) {
    const word = m[1];
    if (seenLowerStart.has(word)) continue;
    seenLowerStart.add(word);
    add({
      type: "grammar",
      title: `Lowercase letter after sentence end: \u201c${word}\u201d`,
      body: `\u201c${word}\u201d starts a new sentence but isn\u2019t capitalized. Each sentence should begin with a capital letter.`,
      micro_edit: word.charAt(0).toUpperCase() + word.slice(1),
    });
  }

  // Uncapitalized first-person pronoun — mid-sentence occurrences only.
  // Instances that directly follow [.!?] whitespace are already reported as
  // "Lowercase letter after sentence end" cards; emitting both for the same
  // character produces duplicate cards about the same issue.
  const uncapIMatches = [...t.matchAll(/(?:^|\s)(i)(?=\s|[',;.!?]|$)/gm)];
  const hasMidSentenceI = uncapIMatches.some((m) => {
    const iPos = m.index + m[0].indexOf("i");
    const before = t.slice(0, iPos);
    // Exclude when preceded by terminal punctuation + whitespace (sentence-start)
    return !/[.!?]\s*$/.test(before);
  });
  if (hasMidSentenceI) {
    add({
      type: "grammar",
      title: "Uncapitalized \u201cI\u201d",
      body: 'When \u201ci\u201d refers to yourself, it should always be capitalized: **I**.',
      micro_edit: null,
    });
  }

  // ── Seed-table loops ───────────────────────────────────────────────────────

  // PHRASE_RULES
  for (const rule of PHRASE_RULES) {
    if (rule.pattern.test(t)) {
      add({ type: rule.type, title: rule.title, body: rule.body, micro_edit: rule.micro_edit });
    }
  }

  // ── Missing-word patterns ─────────────────────────────────────────────────
  // Each uses matchAll so multiple occurrences each get their own card.
  // Titles quote the specific erroneous phrase so the guardrail can verify it
  // and the highlight overlay can locate it.

  // "went [place]" without preposition — "I went store" → "I went to the store"
  for (const m of t.matchAll(/\bwent\s+(?:the\s+)?(?:store|market|grocery|mall|hospital|clinic|pharmacy|gym|office|school|class|library|museum|theater|theatre|restaurant|cafe|bank|shop|church|temple|salon|courthouse|airport|station)\b/gi)) {
    const phrase = m[0].trim();
    add({
      type: "grammar",
      title: `Missing preposition: \u201c${phrase}\u201d`,
      body: "A preposition is likely missing between **went** and the destination. Standard form: **went to [the] [place]**.",
      micro_edit: null,
    });
  }

  // Subject pronoun directly before a present participle — missing auxiliary.
  // "She looking forward" → "She is looking forward"
  // Only fires when the pronoun is immediately adjacent (no auxiliary in between).
  for (const m of t.matchAll(/\b(I|he|she|we|they|you)\s+([a-z]{4,}ing)\b/gi)) {
    const phrase = `${m[1]} ${m[2]}`;
    add({
      type: "grammar",
      title: `Missing auxiliary verb: \u201c${phrase}\u201d`,
      body: `A verb like **is**, **are**, **was**, or **were** may be missing between **${m[1]}** and **${m[2]}**. Example: *${m[1]} is ${m[2]}*.`,
      micro_edit: null,
    });
  }

  // "needs + past participle" — missing "to be".
  // "The report needs submitted" → "needs to be submitted"
  for (const m of t.matchAll(/\bneeds\s+([a-z]+(?:ed|en))\b/gi)) {
    const phrase = `needs ${m[1]}`;
    add({
      type: "grammar",
      title: `Missing words: \u201c${phrase}\u201d`,
      body: `**Needs** followed directly by a past participle is non-standard. The usual form is **needs to be ${m[1]}**.`,
      micro_edit: `needs to be ${m[1]}`,
    });
  }

  // Verb directly before "than" — missing comparative adjective.
  // "He arrived than expected" → "He arrived earlier than expected"
  for (const m of t.matchAll(/\b(arrived|came|got|left|started|ended|finished|completed|returned|appeared|ran|drove|flew|woke|landed)\s+(than)\b/gi)) {
    const phrase = `${m[1]} ${m[2]}`;
    add({
      type: "grammar",
      title: `Missing comparative word: \u201c${phrase}\u201d`,
      body: `A comparative word (*earlier*, *later*, *sooner*, *faster*, *slower*, etc.) appears to be missing between **${m[1]}** and **than**.`,
      micro_edit: null,
    });
  }

  // TYPO_OVERRIDES (short transpositions the dict misses)
  for (const rule of TYPO_OVERRIDES) {
    const m = rule.pattern.exec(t);
    if (m) {
      add({
        type: "grammar",
        title: `Typo: \u201c${m[0]}\u201d`,
        body: `Looks like **${rule.fix}**${rule.note ? ` (${rule.note})` : ""}.`,
        micro_edit: rule.fix,
      });
    }
  }

  return out.slice(0, HEURISTIC_THRESHOLDS.OBVIOUS_MAX_CARDS);
}

/**
 * Structural / style heuristics (whole-draft analysis).
 * @param {string} text
 * @param {"typing" | "paused"} mode
 */
export function heuristicSuggestions(text, mode = "paused") {
  const suggestions = [];
  const pausedOnly = mode === "paused";

  if (pausedOnly) {
    // TONE_SHIFT_RULES (casual near formal context)
    for (const rule of TONE_SHIFT_RULES) {
      if (rule.casual.test(text) && rule.formal.test(text)) {
        suggestions.push({ type: "voice", title: rule.title, body: rule.body, micro_edit: null });
      }
    }

    // Standalone heavy casual/profane density — fires even without formal context.
    // Uses 3+ *distinct* informal tokens as the threshold to avoid flagging a
    // single casual word (which may be intentional voice).
    const casualHits = text.match(
      /\b(?:shit|fuck(?:ing|ed|er)?|damn(?:it)?|crap|ass(?:hole)?|bitch(?:ing|ed)?|wtf|pissed|bullshit|bastard|dumbass|hell(?:uva)?|bloody|bugger|dickhead|cunt|screw(?:ing|ed)|freaking|friggin|effing)\b/gi,
    ) || [];
    const distinctCasual = new Set(casualHits.map((w) => w.toLowerCase()));
    const alreadyCoveredByShift = TONE_SHIFT_RULES.some(
      (r) => r.casual.test(text) && r.formal.test(text),
    );
    if (distinctCasual.size >= 3 && !alreadyCoveredByShift) {
      const examples = [...distinctCasual].slice(0, 3).map((w) => `\u201c${w}\u201d`).join(", ");
      suggestions.push({
        type: "voice",
        title: "Heavy informal/profane register",
        body: `This draft uses strong casual language throughout (${examples}\u2026). That can be authentic voice\u2014but if the audience is mixed or formal, one grounding sentence that signals the register is intentional can help readers follow the tone shift.`,
        micro_edit: null,
      });
    }

    // Question phrasing without "?"
    const asksWithoutMark = text.match(/\b(?:friend|they|she|he)\s+asks?\b(?![^.!?\n]*\?)/gi);
    if (asksWithoutMark?.length) {
      suggestions.push({
        type: "punctuation",
        title: "Question phrasing without \u201c?\u201d",
        body: `Phrases like \u201c${asksWithoutMark[0]}\u201d read as questions to many readers. A question mark (or rephrasing as a statement) makes the conversation easier to follow.`,
        micro_edit: null,
      });
    }

    // Very long sentences
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      const longOnes = sentences.filter(
        (s) => s.split(/\s+/).length > HEURISTIC_THRESHOLDS.LONG_SENTENCE_WORDS,
      );
      if (longOnes.length) {
        suggestions.push({
          type: "coherence",
          title: "Very long sentence(s)",
          body: "Readers track one main idea per sentence. Try splitting the longest sentence into two\u2014give each sentence a single job.",
          micro_edit: null,
        });
      }
    }

    // Overused hedge/filler words
    const words = tokenize(text);
    const counts = new Map();
    for (const w of words) {
      if (HEDGE_WORDS.includes(w)) counts.set(w, (counts.get(w) || 0) + 1);
    }
    for (const [w, c] of counts) {
      if (c >= HEURISTIC_THRESHOLDS.HEDGE_REPEAT_MIN) {
        suggestions.push({
          type: "pattern",
          title: `Repeated hedge/filler: \u201c${w}\u201d`,
          body: "This is often how people talk\u2014and that is fine. If it clusters, readers may read it as uncertainty. Try cutting half of them on a second pass, not all.",
          micro_edit: null,
        });
        break;
      }
    }

    // Repeated punctuation clusters
    if (countMatches(text, /[!?]{2,}|\.{4,}/g) > 0) {
      suggestions.push({
        type: "punctuation",
        title: "Repeated punctuation clusters",
        body: "Repeated punctuation can be expressive. In formal or mixed audiences, reserve it for emphasis points so your main ideas still read as precise.",
        micro_edit: null,
      });
    }

    // Missing comma after introductory adverbial clause.
    // Catches: "When I arrived the party had already started."
    //          "Although she was tired she kept writing."
    // Uses matchAll so every introductory clause in the document generates its
    // own card.  Capped at 3 to avoid flooding.
    // Exclude ; from the middle so this doesn't double-fire with "Semicolon after
    // subordinate clause" (e.g. "Because it rained; we stayed").
    {
      const introRe = /(?:^|[.!?]\s+)(When|While|After|Before|Since|Although|Because|If|Though|As|Once|Until|Unless|Even though|Whenever)\s+[^,;\n]{15,60}?\s+(I|he|she|we|they|you|the|it|this|that|there)\b/gi;
      const seenIntro = new Set();
      let introCount = 0;
      for (const m of text.matchAll(introRe)) {
        if (introCount >= 3) break;
        // Strip any leading non-letter chars (e.g. the consumed period from (?:[.!?]\s+))
        // so the snippet starts cleanly with the introductory word.
        const snippet = m[0].trim().replace(/^[^a-zA-Z]+/, "").slice(0, 55).trimEnd();
        const key = snippet.toLowerCase();
        if (seenIntro.has(key)) continue;
        seenIntro.add(key);
        suggestions.push({
          type: "punctuation",
          title: `Missing comma after introductory clause: \u201c${snippet}\u201d`,
          body: `When a sentence opens with an introductory clause starting with *${m[1]}*, a comma typically follows before the main clause.`,
          micro_edit: null,
        });
        introCount++;
      }
    }

    // Semicolon before coordinating conjunction — matchAll so every occurrence
    // gets its own card.  ("I love dogs; and I have two" → use a comma instead)
    {
      const semiConjRe = /;\s*(and|but|or|so|for|nor|yet)\b/gi;
      const seenSemiConj = new Set();
      let semiConjCount = 0;
      for (const m of text.matchAll(semiConjRe)) {
        if (semiConjCount >= 3) break;
        const idx = m.index;
        const snippet = text
          .slice(Math.max(0, idx - 20), Math.min(text.length, idx + m[0].length + 20))
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 50)
          .trimEnd();
        const key = snippet.toLowerCase();
        if (seenSemiConj.has(key)) continue;
        seenSemiConj.add(key);
        suggestions.push({
          type: "punctuation",
          title: `Semicolon before conjunction: \u201c${snippet}\u201d`,
          body: `A semicolon before *${m[1]}* is usually a sign to use a comma instead. Semicolons connect two independent clauses on their own; coordinating conjunctions (and/but/or) pair with a comma.`,
          micro_edit: null,
        });
        semiConjCount++;
      }
    }

    // Semicolon after a subordinate clause — matchAll for every occurrence.
    // "Because it was raining; we stayed inside." → dependent clause cannot end with ;
    {
      const semiSubordRe = /(?:^|[.!?\n]\s*)(Because|Although|Since|When|While|If|Though|Unless|Until|After|Before|Once|Even though)\b([^;.!?\n]{4,50});/gi;
      const seenSemiSubord = new Set();
      let semiSubordCount = 0;
      for (const m of text.matchAll(semiSubordRe)) {
        if (semiSubordCount >= 3) break;
        const snippet = (m[1] + m[2]).trim().replace(/^[^a-zA-Z]+/, "").slice(0, 50).trimEnd();
        const key = snippet.toLowerCase();
        if (seenSemiSubord.has(key)) continue;
        seenSemiSubord.add(key);
        suggestions.push({
          type: "punctuation",
          title: `Semicolon after subordinate clause: \u201c${snippet}\u201d`,
          body: `*${m[1]}* opens a dependent clause, not an independent one. A semicolon joins two independent clauses\u2014replace the semicolon here with a comma.`,
          micro_edit: null,
        });
        semiSubordCount++;
      }
    }

    // Run-on sentence: multiple independent-clause signals without enough
    // conjunctions to link them all.
    //
    // Old approach bailed on ANY conjunction — that hid sentences like
    // "I went to the store because I was hungry I bought nothing I left."
    // New approach compares subject-pronoun count against available conjunctions:
    // if pronouns outnumber conjunctions by 2+, the segment is likely fused.
    // Only checks comma-free segments (8–45 words) to avoid overlap with
    // the "very long sentence" card.
    // Each run-on gets its own card with a unique snippet-based title so
    // dedupeSuggestionTitles keeps them all and the highlight overlay can
    // locate each one in the textarea.  Cap at 4 cards to avoid flooding.
    const runOnSegments = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
    let runOnCount = 0;
    for (const seg of runOnSegments) {
      if (runOnCount >= 4) break;
      const trimmed = seg.trim();
      const wordCount = trimmed.split(/\s+/).length;
      if (wordCount < 8 || wordCount > 45) continue;
      if (/[,;]/.test(trimmed)) continue;

      // Only count true clause-linking conjunctions.
      // "for" is almost always a preposition ("for the exam"), not a coordinator.
      // "then" is almost always an adverb in these constructions ("went home then I slept").
      // Keeping both would inflate conjCount and raise the threshold incorrectly.
      const conjCount = (trimmed.match(
        /\b(?:and|but|or|so|nor|yet|because|although|while|since|if|when|that|which|who|whom|however|therefore|though)\b/gi,
      ) || []).length;

      // Subject list: personal + "it" (very common clause-head: "it was great it helped me")
      // + indefinite pronouns that can open a clause.
      const pronounHits = trimmed.match(
        /\b(?:I|he|she|we|they|you|it|nobody|everyone|someone|anyone)\b/gi,
      ) || [];

      // Signal 1: more subject pronouns than conjunctions to link them
      const fusedByCounts = pronounHits.length >= Math.max(2, conjCount + 2);

      // Signal 2: past-tense (or common irregular) verb immediately before a
      // new subject pronoun — catches "The rain stopped we decided."
      const fusedByVerb = !fusedByCounts &&
        /\b(?:[a-z]+ed|went|came|got|told|saw|heard|felt|knew|left|ran|fell|sat|stood|woke|found|lost|won|brought|caught|stopped|ended|finished|started)\s+(?:I|he|she|we|they|you|it|nobody|everyone|someone)\b/i
          .test(trimmed);

      if (fusedByCounts || fusedByVerb) {
        // Strip any leading quote character so the snippet starts with the actual text.
        // Keep ≤55 chars (no ellipsis) so the guardrail can verify it against the draft.
        const snippet = trimmed.replace(/^["\u201c\u2018']+/, "").slice(0, 55).trimEnd();
        suggestions.push({
          type: "coherence",
          title: `Possible run-on sentence: \u201c${snippet}\u201d`,
          body: "Two or more thoughts appear fused without enough punctuation or joining words. Try a period, a comma + conjunction, or a semicolon to separate them.",
          micro_edit: null,
        });
        runOnCount++;
      }
    }
  }

  // Extra spaces (all modes)
  if (text.includes("  ")) {
    suggestions.push({
      type: "clarity",
      title: "Extra spaces",
      body: "Small formatting glitches can distract in polished contexts. Not a voice issue\u2014just cleanup.",
      micro_edit: null,
    });
  }

  // Comma splice — broadened pattern catches "canceled, nobody told me, I still drove"
  const commaSplicePatterns = [
    /,\s+(?:I\b|(?:he|she|they|we|it|nobody|everyone|somebody|someone|anyone|no\s+one)\s)/i,
    /\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/i,
  ];
  let commaSpliceMatch = null;
  for (const p of commaSplicePatterns) {
    const m = p.exec(text);
    if (m) { commaSpliceMatch = m; break; }
  }
  if (commaSpliceMatch) {
    const idx = commaSpliceMatch.index;
    const snippetStart = Math.max(0, idx - 25);
    const snippetEnd = Math.min(text.length, idx + commaSpliceMatch[0].length + 25);
    const snippet = text.slice(snippetStart, snippetEnd).trim().replace(/\s+/g, " ");
    suggestions.push({
      type: "grammar",
      title: "Possible comma splice",
      body: `Near \u201c\u2026${snippet}\u2026\u201d \u2014 a comma may be joining two or more full thoughts without a conjunction. Try a period, semicolon, or a connector (e.g. *because* / *so* / *and*) to make the structure clear.`,
      micro_edit: null,
    });
  }

  return suggestions.slice(0, HEURISTIC_THRESHOLDS.STRUCTURAL_MAX_CARDS);
}

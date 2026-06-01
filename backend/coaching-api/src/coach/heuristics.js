import nspell from "nspell";
import dictionaryEn from "dictionary-en";
import { tokenize, HEDGE_WORDS, countMatches } from "../lib/nlp.js";
import { isLikelyGibberishToken } from "../lib/word-quality.js";
import { makeCard, CONFIDENCE_MIN } from "./issue-types.js";
import { coachDebug } from "./coach-log.js";
import { logDetectorInput } from "./mechanics-debug.js";
import { isSerialNounList } from "./mechanics-detect.js";

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
  { pattern: /\bdefinately\b/i,     fix: "definitely" },
  { pattern: /\brecieved\b/i,       fix: "received" },
];

/** Lowercase tokens that should be capitalized as names/places/brands — not split or spell-corrected. */
const COMMON_PROPER_LOWERCASE = new Set(
  (
    "sarah chicago paris london michael canada microsoft apple google amazon boston seattle " +
    "toronto vancouver denver atlanta dallas houston phoenix detroit minneapolis portland " +
    "john mary david james robert jennifer amanda alexander benjamin christopher elizabeth " +
    "acme york california texas florida virginia colorado"
  ).split(/\s+/),
);

/** Fused tokens: missing space between common word pairs (companyis → company is). */
const FUSED_SPACING_PATTERNS = [
  { pattern: /\bcompanyis\b/gi, fix: "company is" },
  { pattern: /\bprojectis\b/gi, fix: "project is" },
  { pattern: /\bsendthe\b/gi, fix: "send the" },
  { pattern: /\bmeetafter\b/gi, fix: "meet after" },
  { pattern: /\breportthe\b/gi, fix: "report the" },
  { pattern: /\bemailthe\b/gi, fix: "email the" },
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
    micro_edit: "you're going",
  },
  // "your being" → "you're being"
  {
    pattern: /\byour\s+being\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cyour being\u201d",
    body: "**Your** is possessive; **you\u2019re** (*you are*) is the contraction. Try: **you\u2019re being**.",
    micro_edit: "you're being",
  },
  // "your probably/right/wrong/…" → "you're probably/…"
  {
    pattern: /\byour\s+(?:probably|definitely|certainly|surely|clearly|obviously|right|wrong|late|early|ready|done|finished|supposed|crazy|lucky|kidding|joking)\b/i,
    type: "grammar",
    title: "Apostrophe confusion: \u201cyour\u201d vs \u201cyou\u2019re\u201d",
    body: "**Your** shows possession (*your bag*). Before an adjective or adverb like this, the contraction **you\u2019re** (*you are*) is almost always intended.",
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

  // ── their / they're confusion ─────────────────────────────────────────────
  // "their going to [verb]" is almost always "they're going to [verb]".
  // Possessive "their" cannot precede the "going to" future construction.
  {
    pattern: /\btheir\s+going\s+to\b/i,
    type: "grammar",
    title: "Homophone: \u201ctheir going to\u201d",
    body: "**Their** is a possessive pronoun (*their car*). In the phrase **their going to**, the intended word is the contraction **they\u2019re** (*they are*): **they\u2019re going to**.",
    micro_edit: "they're going to",
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
  LONG_SENTENCE_WORDS: 28,
  HEDGE_REPEAT_MIN: 3,
  OBVIOUS_MAX_CARDS: 48,
  STRUCTURAL_MAX_CARDS: 40,
  MAX_LOWERCASE_START_CARDS: 6,
  MAX_STRETCHED_CARDS: 5,
};

/**
 * Tone-shift rules: fire when BOTH a casual-register word AND a formal-topic
 * word appear in the same passage.
 *
 * @type {Array<{ casual: RegExp, formal: RegExp, title: string, body: string }>}
 */
export const TONE_SHIFT_RULES = [
  {
    casual: /\b(shit|fuck(?:ing|ed|er)?|damn(?:it)?|crap|ass(?:hole)?|hell(?:uva)?|freaking|friggin|effing|wtf|bullshit|pissed|dumbass|bastard|bitch(?:ing)?|screw(?:ing|ed)?)\b/i,
    formal: /\b(professional|vision|product|report|essay|thesis|professor|client|proposal|stakeholder|project|meeting|workplace|business|company|executive|management|corporate|enterprise|deadline|deliverable|strategy)\b/i,
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
  console.warn("[coaching-api] Heuristics spellchecker unavailable:", e?.message || e);
}

/** @returns {boolean} */
export function isSpellcheckerReady() {
  return Boolean(spellchecker);
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
  coachDebug("RUNNING SPELLING DETECTOR");
  logDetectorInput("SPELLING", text);
  if (!spellchecker) {
    coachDebug("SPELLING SKIP spellchecker null");
    return [];
  }
  const maxCards = Math.max(1, Math.min(40, Number(opts.maxCards) || 12));
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
    cards.push(
      makeCard(
        "spelling",
        `Spelling: \u201c${m[0]}\u201d`,
        `Standard spelling is **${rule.fix}**${rule.note ? ` (${rule.note})` : ""}.`,
        rule.fix,
        0.97,
      ),
    );
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
          cards.push(
            makeCard(
              "capitalization",
              `Capitalization: \u201c${raw}\u201d`,
              `\u201c${raw}\u201d appears mid-sentence. Only proper nouns (names, places, titles) are capitalized in standard English. If this is a common word, use \u201c${lw}\u201d instead.`,
              lw,
            ),
          );
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

    const sug = spell.suggest(lw);
    const capitalForm = lw.charAt(0).toUpperCase() + lw.slice(1);

    // Known names/places — never spell-correct or bogus-split (e.g. chic+ago).
    if (COMMON_PROPER_LOWERCASE.has(lw)) {
      seen.add(lw);
      cards.push(
        makeCard(
          "capitalization",
          `Capitalization: \u201c${raw}\u201d`,
          `\u201c${raw}\u201d looks like a proper noun (a name or place). Capitalize it: **${capitalForm}**.`,
          capitalForm,
          0.95,
        ),
      );
      continue;
    }

    // Dictionary lists Title Case form — proper noun missing capitalization.
    if (sug?.includes(capitalForm)) {
      seen.add(lw);
      cards.push(
        makeCard(
          "capitalization",
          `Capitalization: \u201c${raw}\u201d`,
          `\u201c${raw}\u201d looks like a proper noun (a name or place). If so, capitalize it: **${capitalForm}**.`,
          capitalForm,
        ),
      );
      continue;
    }

    // Fused words: only split when the left part is a common function word (avoids chic+ago).
    const FUSE_LEFT = new Set(
      "the send meet company project report account team file email with for from to in on at by".split(" "),
    );
    if (lw.length >= 5) {
      let splitCard = null;
      for (let cut = 2; cut <= lw.length - 2; cut++) {
        const left = lw.slice(0, cut);
        const right = lw.slice(cut);
        if (!FUSE_LEFT.has(left) || !spell.correct(right)) continue;
        if (spell.correct(left) || FUSE_LEFT.has(left)) {
          splitCard = makeCard(
            "spacing",
            `Missing space: \u201c${raw}\u201d`,
            `This looks like two words fused together: **${left} ${right}**. Add a space if that matches your meaning.`,
            `${left} ${right}`,
          );
          break;
        }
      }
      if (splitCard) {
        seen.add(lw);
        cards.push(splitCard);
        continue;
      }
    }

    // When the dictionary flags a word but has no substitute, still emit a card —
    // the absence of a suggestion should not silently suppress the flag.
    if (!sug?.length) {
      seen.add(lw);
      cards.push(
        makeCard(
          "spelling",
          `Unrecognized word: \u201c${raw}\u201d`,
          `\u201c${raw}\u201d isn\u2019t in the dictionary and no substitute was found. Double-check the spelling.`,
          null,
        ),
      );
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
      cards.push(
        makeCard(
          "apostrophe",
          `Missing apostrophe: \u201c${raw}\u201d`,
          `\u201c${raw}\u201d is missing an apostrophe. Standard form is **${topSug}**.`,
          topSug,
          0.96,
        ),
      );
    } else {
      cards.push(
        makeCard(
          "spelling",
          `Spelling: \u201c${raw}\u201d`,
          `Likely typo\u2014dictionary suggests **${topSug}**${sug[1] ? ` or *${sug[1]}*` : ""}. Pick the word that matches your meaning.`,
          topSug,
          0.91,
        ),
      );
    }
  }

  coachDebug("SPELLING RESULTS", cards.length);
  return cards;
}

/**
 * Mechanical per-token and phrase checks.
 *
 * Algorithmic checks run before the seed-table loops so they are never
 * displaced by a large number of matches from the phrase or typo tables.
 */
/** Infer canonical issue type from a PHRASE_RULE template title. */
function phraseRuleIssueType(rule) {
  const title = rule.title || "";
  if (/should of|could of|would of|your welcome|their\s|Homophone/i.test(title)) return "homophone";
  if (/Apostrophe|its been|your going|your being/i.test(title)) return "apostrophe";
  if (/Subject/i.test(title)) return "grammar";
  if (/Word confusion/i.test(title)) return "homophone";
  return "grammar";
}

function phraseRuleConfidence(rule) {
  const t = phraseRuleIssueType(rule);
  if (t === "homophone") return 0.96;
  if (t === "apostrophe") return 0.94;
  if (/Subject/i.test(rule.title || "")) return 0.88;
  return 0.84;
}

export function obviousSpellingGrammarHeuristics(text) {
  coachDebug("RUNNING OBVIOUS HEURISTICS DETECTOR");
  logDetectorInput("OBVIOUS HEURISTICS", text);
  const t = String(text || "");
  const out = [];
  const add = (card, confidence = card?.confidence ?? 0.9) => {
    if (!card?.title || confidence < CONFIDENCE_MIN) return;
    out.push({ ...card, confidence });
  };

  // ── High-priority mechanics first (before repetition/capitalization flood) ──

  // PHRASE_RULES — matchAll so each hit gets a title quoting the exact phrase
  // (needed for editor highlighting and stale-card detection).
  for (const rule of PHRASE_RULES) {
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
    const re = new RegExp(rule.pattern.source, flags);
    const seenPhrase = new Set();
    for (const m of t.matchAll(re)) {
      const key = m[0].toLowerCase();
      if (seenPhrase.has(key)) continue;
      seenPhrase.add(key);
      const title = /[\u201C"]/.test(rule.title)
        ? rule.title.replace(/[\u201C"]([^\u201D"]*)[\u201D"]/, `\u201c${m[0]}\u201d`)
        : `${rule.title}: \u201c${m[0]}\u201d`;
      add(
        makeCard(phraseRuleIssueType(rule), title, rule.body, rule.micro_edit, phraseRuleConfidence(rule)),
        phraseRuleConfidence(rule),
      );
    }
  }

  for (const rule of SPELLING_OVERRIDES) {
    const m = rule.pattern.exec(t);
    if (m) {
      add(
        makeCard(
          "spelling",
          `Spelling: \u201c${m[0]}\u201d`,
          `Standard spelling is **${rule.fix}**${rule.note ? ` (${rule.note})` : ""}.`,
          rule.fix,
        ),
      );
    }
  }

  for (const { pattern, fix } of FUSED_SPACING_PATTERNS) {
    for (const m of t.matchAll(pattern)) {
      add(
        makeCard(
          "spacing",
          `Missing space: \u201c${m[0]}\u201d`,
          `Two words appear fused. Standard form: **${fix}**.`,
          fix,
        ),
      );
    }
  }

  for (const m of t.matchAll(/\b(dogs|cats)\s+(leash|collar|house|bed|bowl|food|toy|crate)\b/gi)) {
    const phrase = m[0];
    const before = t.slice(Math.max(0, m.index - 50), m.index);
    const pluralOwner =
      /\b(?:their|our|both|those|these|several|many)\s+dogs\b/i.test(before + phrase) ||
      /\bdogs'\s+/i.test(t.slice(m.index, m.index + 20));
    const owner = m[1].toLowerCase() === "dogs" ? "dog" : "cat";
    const fix = pluralOwner ? `${m[1].toLowerCase()}' ${m[2]}` : `${owner}'s ${m[2]}`;
    add(
      makeCard(
        "apostrophe",
        `Apostrophe: \u201c${phrase}\u201d`,
        pluralOwner
          ? `Plural possession may fit here: **${fix}**.`
          : `Use singular possessive **${owner}\u2019s ${m[2]}** (the leash belongs to one ${owner}).`,
        fix,
        0.92,
      ),
    );
  }

  for (const m of t.matchAll(/\bcant\b/gi)) {
    add(
      makeCard(
        "apostrophe",
        `Missing apostrophe: \u201ccant\u201d`,
        `Standard contraction is **can\u2019t** (*cannot*).`,
        "can't",
      ),
    );
  }

  for (const m of t.matchAll(/\b(mis|non|pre|re|un|up)\s+(configured|dated|placed|paid|profit|stop|treated|known)\b/gi)) {
    add(
      makeCard(
        "spacing",
        `Compound word: \u201c${m[0]}\u201d`,
        `These words are usually written as one word or with a hyphen: **${m[1]}-${m[2]}** or **${m[1]}${m[2]}**.`,
        `${m[1]}-${m[2]}`,
      ),
    );
  }

  for (const m of t.matchAll(
    /\b([a-z]{3,})\s+([a-z]{3,})\s+([a-z]{3,})\s+and\s+([a-z]{3,})\b/gi,
  )) {
    if (!isSerialNounList(m[0])) continue;
    add(
      makeCard(
        "punctuation",
        `Missing commas in list: \u201c${m[0]}\u201d`,
        `Items in a list usually need commas: *${m[1]}, ${m[2]}, ${m[3]}, and ${m[4]}*.`,
        null,
        0.88,
      ),
    );
  }

  // ── Missing-word patterns ─────────────────────────────────────────────────
  // Each uses matchAll so multiple occurrences each get their own card.
  // Titles quote the specific erroneous phrase so the guardrail can verify it
  // and the highlight overlay can locate it.

  // "went [place]" without preposition — "I went store" → "I went to the store"
  for (const m of t.matchAll(/\bwent\s+(?:the\s+)?(?:store|market|grocery|mall|hospital|clinic|pharmacy|gym|office|school|class|library|museum|theater|theatre|restaurant|cafe|bank|shop|church|temple|salon|courthouse|airport|station)\b/gi)) {
    const phrase = m[0].trim();
    add(
      makeCard(
        "grammar",
        `Missing preposition: \u201c${phrase}\u201d`,
        "A preposition is likely missing between **went** and the destination. Standard form: **went to [the] [place]**.",
        null,
        0.75,
      ),
      0.75,
    );
  }

  // Subject pronoun directly before a present participle — missing auxiliary.
  // "She looking forward" → "She is looking forward"
  // Only fires when the pronoun is immediately adjacent (no auxiliary in between).
  for (const m of t.matchAll(/\b(I|he|she|we|they|you)\s+([a-z]{4,}ing)\b/gi)) {
    const phrase = `${m[1]} ${m[2]}`;
    add(
      makeCard(
        "grammar",
        `Missing auxiliary verb: \u201c${phrase}\u201d`,
        `A verb like **is**, **are**, **was**, or **were** may be missing between **${m[1]}** and **${m[2]}**. Example: *${m[1]} is ${m[2]}*.`,
        null,
        0.72,
      ),
      0.72,
    );
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
      add(
        makeCard(
          "spelling",
          `Typo: \u201c${m[0]}\u201d`,
          `Looks like **${rule.fix}**${rule.note ? ` (${rule.note})` : ""}.`,
          rule.fix,
        ),
      );
    }
  }

  // ── "its [predicate adjective]" → "it's [adjective]" ─────────────────────
  // "its" is 3 chars so it escapes the 4-char spell-check floor — catch it here.
  // Only fire when "its" is followed by a clear predicate adjective, not a noun.
  for (const m of t.matchAll(/\bits\s+(ready|fine|done|finished|complete|correct|right|wrong|okay|ok|good|bad|better|worse|working|running|available|possible|clear|obvious|easy|hard|difficult|necessary|important|amazing|great|perfect|broken|stuck|gone|late|early|real|true|false|safe|dangerous|impossible)\b/gi)) {
    const phrase = m[0].toLowerCase();
    add(
      makeCard(
        "apostrophe",
        `Apostrophe confusion: \u201c${phrase}\u201d`,
        `**Its** (no apostrophe) is the possessive pronoun. Before a predicate adjective like *${m[1].toLowerCase()}*, the contraction **it\u2019s** (*it is*) is intended: **it\u2019s ${m[1].toLowerCase()}**.`,
        `it's ${m[1].toLowerCase()}`,
      ),
    );
  }

  // ── "were" after a question word → "we're" ───────────────────────────────
  // "why were here", "what were doing" — quotes the full matched phrase so
  // findHighlightRange lands on the exact location, not any earlier "were".
  const seenWereQ = new Set();
  for (const m of t.matchAll(/\b(?:why|what|how)\s+were\s+(?:here|there|doing|going|saying|talking|waiting|leaving|staying|working|meeting|watching|helping|trying|looking)\b/gi)) {
    const phrase = m[0].toLowerCase();
    if (seenWereQ.has(phrase)) continue;
    seenWereQ.add(phrase);
    add(
      makeCard(
        "homophone",
        `Word confusion: \u201c${phrase}\u201d`,
        "**Were** is the past-tense plural of *to be*. After a question word like *why* or *what*, the contraction **we\u2019re** (*we are*) is almost always intended.",
        null,
      ),
    );
  }

  const seenRepeated = new Set();
  for (const m of t.matchAll(/\b(\w{2,})\b(?:\s+\1\b){1,}/gi)) {
    const word = m[1].toLowerCase();
    if (seenRepeated.has(word)) continue;
    seenRepeated.add(word);
    add(
      makeCard(
        "repetition",
        `Repeated word: \u201c${m[1]}\u201d`,
        `\u201c${m[1]}\u201d appears back-to-back. This is likely an accidental duplication\u2014delete the extra copy.`,
        m[1],
        0.92,
      ),
      0.92,
    );
  }

  const seenStretched = new Set();
  let stretchedCount = 0;
  for (const m of t.matchAll(/\b([a-z]{4,})\b/gi)) {
    if (stretchedCount >= HEURISTIC_THRESHOLDS.MAX_STRETCHED_CARDS) break;
    const w = m[1];
    if (!/([a-z])\1{2}/i.test(w)) continue;
    const lw = w.toLowerCase();
    if (seenStretched.has(lw)) continue;
    seenStretched.add(lw);
    stretchedCount += 1;
    add(
      makeCard(
        "stretched_word",
        `Stretched word: \u201c${w}\u201d`,
        `Repeating a letter for emphasis (*${w}*) is a spoken-language cue. In written form it may not land as intended\u2014consider italics, an em dash, or a stronger word.`,
        null,
        0.72,
      ),
      0.72,
    );
  }

  const seenLowerStart = new Set();
  let lowerStartCount = 0;
  for (const m of t.matchAll(/[.!?]\s+([a-z]\w*)/g)) {
    if (lowerStartCount >= HEURISTIC_THRESHOLDS.MAX_LOWERCASE_START_CARDS) break;
    const word = m[1];
    if (seenLowerStart.has(word)) continue;
    seenLowerStart.add(word);
    lowerStartCount += 1;
    add(
      makeCard(
        "capitalization",
        `Lowercase letter after sentence end: \u201c${word}\u201d`,
        `\u201c${word}\u201d starts a new sentence but isn\u2019t capitalized. Each sentence should begin with a capital letter.`,
        word.charAt(0).toUpperCase() + word.slice(1),
      ),
    );
  }

  const uncapIMatches = [...t.matchAll(/(?:^|\s)(i)(?=\s|[',;.!?]|$)/gm)];
  const hasMidSentenceI = uncapIMatches.some((m) => {
    const iPos = m.index + m[0].indexOf("i");
    const before = t.slice(0, iPos);
    return !/[.!?]\s*$/.test(before);
  });
  if (hasMidSentenceI) {
    add(
      makeCard(
        "capitalization",
        "Uncapitalized \u201cI\u201d",
        'When \u201ci\u201d refers to yourself, it should always be capitalized: **I**.',
        null,
      ),
    );
  }

  const capped = out.slice(0, HEURISTIC_THRESHOLDS.OBVIOUS_MAX_CARDS);
  coachDebug("OBVIOUS HEURISTICS RESULTS", capped.length);
  return capped;
}

/**
 * Punctuation mechanics — run in typing and paused modes (not gated on pause).
 * @param {string} text
 */
export function collectPunctuationMechanics(text) {
  coachDebug("RUNNING PUNCTUATION DETECTOR");
  logDetectorInput("PUNCTUATION", text);
  const suggestions = [];

  const push = (card, confidence = card?.confidence ?? 0.9) => {
    if (confidence < CONFIDENCE_MIN) return;
    suggestions.push({ ...card, confidence });
  };

  for (const m of text.matchAll(
    /(?:^|[.!?]\s+)(Wait|Hey|Well|Oh)\s+,?\s*(what|who|where|why|how)\b/gi,
  )) {
    const tail = text.slice(m.index, m.index + 80);
    if (/\?/.test(tail.split(/\n/)[0])) continue;
    push(
      makeCard(
        "punctuation",
        `Missing question mark: \u201c${m[0].trim()}\u201d`,
        `This reads as a question. Add a **?** or rephrase as a statement.`,
        null,
        0.88,
      ),
      0.88,
    );
  }

  const commaSplicePatterns = [
    /,\s+(?:I\b|(?:he|she|they|we|it|nobody|everyone|somebody|someone|anyone|no\s+one)\s)/i,
    /\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/i,
  ];
  for (const p of commaSplicePatterns) {
    const m = p.exec(text);
    if (!m) continue;
    const idx = m.index;
    const snippet = text
      .slice(Math.max(0, idx - 25), Math.min(text.length, idx + m[0].length + 25))
      .trim()
      .replace(/\s+/g, " ");
    push(
      makeCard(
        "punctuation",
        `Possible comma splice: \u201c${snippet}\u201d`,
        `A comma may be joining two full thoughts without a conjunction. Try a period, semicolon, or connector (*because*, *so*, *and*).`,
        null,
        0.88,
      ),
      0.88,
    );
    break;
  }

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
      push(
        makeCard(
          "punctuation",
          `Semicolon before conjunction: \u201c${snippet}\u201d`,
          `A semicolon before *${m[1]}* is usually a sign to use a comma instead.`,
          null,
          0.95,
        ),
        0.95,
      );
      semiConjCount++;
    }
  }

  {
    const semiBeforeSubordRe =
      /;\s*(because|although|since|while|if|though|unless|until|after|before|once|even though)\b/gi;
    const seen = new Set();
    let count = 0;
    for (const m of text.matchAll(semiBeforeSubordRe)) {
      if (count >= 3) break;
      const idx = m.index;
      const snippet = text
        .slice(Math.max(0, idx - 20), Math.min(text.length, idx + m[0].length + 20))
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 55)
        .trimEnd();
      const key = snippet.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      push(
        makeCard(
          "punctuation",
          `Semicolon before subordinating conjunction: \u201c${snippet}\u201d`,
          `*${m[1]}* opens a dependent clause — remove the semicolon before it.`,
          null,
          0.96,
        ),
        0.96,
      );
      count++;
    }
  }

  {
    const colonConjRe = /:\s*(and|but|or|so|for|nor|yet)\b/gi;
    const seen = new Set();
    for (const m of text.matchAll(colonConjRe)) {
      const idx = m.index;
      const snippet = text
        .slice(Math.max(0, idx - 20), Math.min(text.length, idx + m[0].length + 20))
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 55)
        .trimEnd();
      const key = snippet.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      push(
        makeCard(
          "punctuation",
          `Colon before conjunction: \u201c${snippet}\u201d`,
          `A colon should not precede the coordinating conjunction *${m[1]}*. Use a comma instead.`,
          null,
          0.96,
        ),
        0.96,
      );
    }
  }

  {
    const conjAdvRe =
      /\b(however|therefore|furthermore|moreover|nevertheless|nonetheless|consequently|accordingly|hence)\b/gi;
    const seen = new Set();
    for (const m of text.matchAll(conjAdvRe)) {
      const adv = m[1].toLowerCase();
      if (seen.has(adv)) continue;
      const before = text.slice(0, m.index).trimEnd();
      if (!before || /[.!?\n;:]\s*$/.test(before) || /,\s*$/.test(before)) continue;
      seen.add(adv);
      push(
        makeCard(
          "punctuation",
          `Missing punctuation before \u201c${adv}\u201d`,
          `**${m[1]}** joins independent clauses — precede it with a semicolon or start a new sentence.`,
          null,
          0.9,
        ),
        0.9,
      );
    }
  }

  {
    const introRe =
      /(?:^|[.!?]\s+)(When|While|After|Before|Since|Although|Because|If|Though|As|Once|Until|Unless|Even though|Whenever)\s+[^,;\n]{15,60}?\s+(I|he|she|we|they|you|the|it|this|that|there)\b/gi;
    const seenIntro = new Set();
    let introCount = 0;
    for (const m of text.matchAll(introRe)) {
      if (introCount >= 3) break;
      const snippet = m[0].trim().replace(/^[^a-zA-Z]+/, "").slice(0, 55).trimEnd();
      const key = snippet.toLowerCase();
      if (seenIntro.has(key)) continue;
      seenIntro.add(key);
      if (snippet.split(/\s+/).length >= 6) {
        push(
          makeCard(
            "punctuation",
            `Missing comma after introductory clause: \u201c${snippet}\u201d`,
            `When a sentence opens with *${m[1]}*, a comma typically follows before the main clause.`,
            null,
            0.82,
          ),
          0.82,
        );
        introCount++;
      }
    }
  }

  const runOnSegments = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
  let runOnCount = 0;
  for (const seg of runOnSegments) {
    if (runOnCount >= 4) break;
    const trimmed = seg.trim();
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount < 8 || wordCount > 55) continue;
    if (/[,;]/.test(trimmed)) continue;
    const conjCount = (
      trimmed.match(
        /\b(?:and|but|or|so|nor|yet|because|although|while|since|if|when|that|which|who|whom|however|therefore|though)\b/gi,
      ) || []
    ).length;
    const pronounHits =
      trimmed.match(/\b(?:I|he|she|we|they|you|it|nobody|everyone|someone|anyone)\b/gi) || [];
    const fusedByCounts = pronounHits.length >= Math.max(2, conjCount + 2);
    const fusedByVerb =
      !fusedByCounts &&
      /\b(?:[a-z]+ed|went|came|got|told|saw|heard|felt|knew|left|ran|fell|sat|stood|woke|found|lost|won|brought|caught|stopped|ended|finished|started|closed|walked|watched|talked)\s+(?:I|he|she|we|they|you|it|nobody|everyone|someone)\b/i.test(
        trimmed,
      );
    if (fusedByCounts || fusedByVerb) {
      const snippet = trimmed.replace(/^["\u201c\u2018']+/, "").slice(0, 55).trimEnd();
      push(
        makeCard(
          "punctuation",
          `Possible run-on sentence: \u201c${snippet}\u201d`,
          "Two or more thoughts appear fused. Try a period, comma + conjunction, or semicolon.",
          null,
          0.92,
        ),
        0.92,
      );
      runOnCount++;
    }
  }

  coachDebug("PUNCTUATION RESULTS", suggestions.length);
  return suggestions;
}

/**
 * Structural / style heuristics (whole-draft analysis).
 * @param {string} text
 * @param {"typing" | "paused"} mode
 */
/**
 * @param {string} text
 * @param {"typing"|"paused"} mode
 * @param {{ includePunctuation?: boolean }} [opts]
 */
export function heuristicSuggestions(text, mode = "paused", opts = {}) {
  const suggestions =
    opts.includePunctuation === false ? [] : [...collectPunctuationMechanics(text)];
  const pausedOnly = mode === "paused";

  if (pausedOnly) {
    // TONE_SHIFT_RULES (casual near formal context)
    for (const rule of TONE_SHIFT_RULES) {
      if (rule.casual.test(text) && rule.formal.test(text)) {
        suggestions.push({ type: "voice", title: rule.title, body: rule.body, micro_edit: null });
      }
    }

    // Standalone heavy casual/profane density — fires even without formal context.
    // Uses 2+ *distinct* informal tokens as the threshold to avoid flagging a
    // single casual word (which may be intentional voice).
    const casualHits = text.match(
      /\b(?:shit|fuck(?:ing|ed|er)?|damn(?:it)?|crap|ass(?:hole)?|bitch(?:ing|ed)?|wtf|pissed|bullshit|bastard|dumbass|hell(?:uva)?|bloody|bugger|dickhead|cunt|screw(?:ing|ed)|freaking|friggin|effing|dammit|goddamn|moron|idiot|jerk)\b/gi,
    ) || [];
    const distinctCasual = new Set(casualHits.map((w) => w.toLowerCase()));
    const alreadyCoveredByShift = TONE_SHIFT_RULES.some(
      (r) => r.casual.test(text) && r.formal.test(text),
    );
    if (distinctCasual.size >= 2 && !alreadyCoveredByShift) {
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

    if (
      /\brecord profits\b/i.test(text) &&
      /\bdeclining\b/i.test(text) &&
      /\b(?:shrinking|shrink)\b/i.test(text)
    ) {
      suggestions.push(
        makeCard(
          "coherence",
          "Contradictory statements",
          "The passage claims record profits and growth while also describing declining sales and shrinking revenue. Clarify which direction is accurate.",
          null,
        ),
      );
    }
  }

  if (text.includes("  ")) {
    suggestions.push(
      makeCard(
        "spacing",
        "Extra spaces",
        "Small formatting glitches can distract in polished contexts. Not a voice issue\u2014just cleanup.",
        null,
      ),
    );
  }

  return suggestions.slice(0, HEURISTIC_THRESHOLDS.STRUCTURAL_MAX_CARDS);
}

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
    body: "For \u201cyou are welcome,\u201d use the contraction **you\u2019re** (not the possessive *your*).",
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

  // Repeated-word nonsense: "words words words words"
  const repeatedWord = t.match(/\b(\w{3,})\b(?:\s+\1\b){3,}/i);
  if (repeatedWord) {
    add({
      type: "clarity",
      title: `Repeated word: \u201c${repeatedWord[1]}\u201d`,
      body: `\u201c${repeatedWord[1]}\u201d appears many times in a row. This reads as placeholder or test text rather than intended content.`,
      micro_edit: null,
    });
  }

  // Sentence-start capitalization
  if (/[.!?]\s+[a-z]/.test(t)) {
    add({
      type: "grammar",
      title: "Lowercase letter after sentence end",
      body: "Each new sentence should begin with a capital letter. A lowercase letter was found after a period, question mark, or exclamation mark.",
      micro_edit: null,
    });
  }

  // Uncapitalized first-person pronoun
  if (/(?:^|\s)i(?=\s|[',;.!?]|$)/m.test(t)) {
    add({
      type: "grammar",
      title: "Uncapitalized \u201cI\u201d",
      body: 'When \u201ci\u201d refers to yourself, it should always be capitalized: **I**.',
      micro_edit: null,
    });
  }

  // Letter elongation: goooood, heeello, noiseeeee
  const elongMatch = t.match(/\b[a-zA-Z]*([a-zA-Z])\1{2,}[a-zA-Z]*\b/);
  if (elongMatch) {
    add({
      type: "grammar",
      title: `Letter extension: \u201c${elongMatch[0]}\u201d`,
      body: "Standard spelling doesn\u2019t repeat letters for emphasis. Remove the extra letters to use the standard form.",
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
    // TONE_SHIFT_RULES
    for (const rule of TONE_SHIFT_RULES) {
      if (rule.casual.test(text) && rule.formal.test(text)) {
        suggestions.push({ type: "voice", title: rule.title, body: rule.body, micro_edit: null });
      }
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

    // Semicolon before coordinating conjunction
    // ("I love dogs; and I have two" → should use a comma, not a semicolon)
    const semiConjMatch = /;\s*(and|but|or|so|for|nor|yet)\b/i.exec(text);
    if (semiConjMatch) {
      const idx = semiConjMatch.index;
      const snippet = text
        .slice(Math.max(0, idx - 20), Math.min(text.length, idx + semiConjMatch[0].length + 20))
        .trim()
        .replace(/\s+/g, " ");
      suggestions.push({
        type: "punctuation",
        title: "Semicolon before conjunction",
        body: `Near \u201c\u2026${snippet}\u2026\u201d \u2014 a semicolon before *${semiConjMatch[1]}* is usually a sign to use a comma instead. Semicolons connect two independent clauses on their own; coordinating conjunctions (and/but/or\u2026) pair with a comma.`,
        micro_edit: null,
      });
    }

    // Run-on sentence: two subject-pronoun clauses in one sentence with no
    // comma, semicolon, or connecting word separating them.
    // Only checks segments 8–40 words long to avoid overlap with "Very long sentence".
    const runOnSegments = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
    for (const seg of runOnSegments) {
      const trimmed = seg.trim();
      const wordCount = trimmed.split(/\s+/).length;
      if (wordCount < 8 || wordCount > HEURISTIC_THRESHOLDS.LONG_SENTENCE_WORDS) continue;
      if (/[,;]/.test(trimmed)) continue;
      if (/\b(?:and|but|or|so|for|nor|yet|because|although|while|since|if|when|that|which|who|whom|however|therefore|then|though)\b/i.test(trimmed)) continue;
      const pronounHits = trimmed.match(/\b(?:I|he|she|we|they|you)\b/gi) || [];
      if (pronounHits.length >= 2) {
        const snippet = trimmed.length > 70 ? `${trimmed.slice(0, 70)}\u2026` : trimmed;
        suggestions.push({
          type: "coherence",
          title: "Possible run-on sentence",
          body: `Near \u201c${snippet}\u201d \u2014 two thoughts may be fused without punctuation or a joining word. Try a period, a comma + conjunction, or a semicolon between them.`,
          micro_edit: null,
        });
        break;
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

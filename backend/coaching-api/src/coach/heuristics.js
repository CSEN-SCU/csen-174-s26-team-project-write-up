import nspell from "nspell";
import dictionaryEn from "dictionary-en";
import { tokenize, HEDGE_WORDS, countMatches } from "../lib/nlp.js";

/** @type {import("nspell") | null} */
let spellchecker = null;

const SPELL_ALLOW = new Set(
  `omg lol lmao rofl imo tbh idk btw fr frfr ngl irl ig u ur bc cos cuz tho thru pls plz ppl ok okay yep nah huh hmm hm er um uh kinda sorta gonna wanna gotta hell damn darn shoot dang heck yeet sus cap fax nope haha hahaha woah whoa yall ya'll gonna cv api css html js ts jpg png gif pdf url uri sql dns tcp http https www com org net io co uk app apps ios android`
    .split(/\s+/),
);

try {
  spellchecker = nspell(dictionaryEn);
} catch (e) {
  console.warn("Heuristics spellchecker unavailable:", e?.message || e);
}

export function spellDictionarySuggestions(text) {
  if (!spellchecker) return [];
  const spell = spellchecker;
  const t = String(text);
  const seen = new Set();
  const cards = [];
  for (const m of t.matchAll(/\b([a-zA-Z]{4,})\b/g)) {
    const raw = m[1];
    const lw = raw.toLowerCase();
    if (SPELL_ALLOW.has(lw)) continue;
    if (seen.has(lw)) continue;
    if (/^[A-Z]{2,}$/.test(raw)) continue;
    if (spell.correct(lw)) continue;
    const sug = spell.suggest(lw);
    if (!sug?.length) continue;
    seen.add(lw);
    cards.push({
      type: "grammar",
      title: `Spelling: “${raw}”`,
      body: `Likely typo—dictionary suggests **${sug[0]}**${sug[1] ? ` or *${sug[1]}*` : ""}. Pick the word that matches your meaning; keep your tone.`,
      micro_edit: sug[0],
    });
    if (cards.length >= 6) break;
  }
  return cards;
}

export function obviousSpellingGrammarHeuristics(text) {
  const t = String(text || "");
  const out = [];
  const add = (card) => {
    if (card?.title) out.push(card);
  };

  if (/\bpregnate\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “pregnate”",
      body: "Standard spelling is **pregnant** (expecting a baby).",
      micro_edit: "pregnant",
    });
  }
  if (/\bbrib(es|ed|ing|e)?\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “brib”",
      body: "Use **bribe** for the verb/noun (offer money improperly).",
      micro_edit: "bribe",
    });
  }
  if (/\bdeat\b/i.test(t)) {
    add({
      type: "clarity",
      title: "Word check: “deat”",
      body: "Readers will stumble here. Common fixes: **dead**, **debt**, or **deaf**—pick the one you mean.",
      micro_edit: null,
    });
  }
  if (/\bthere\s+is\s+so\s+many\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Grammar: “there is” with a plural",
      body: "**Many things** are plural, so standard English uses **there are** (not *there is*).",
      micro_edit: "There are so many",
    });
  }
  if (/\bthere\s+is\s+many\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Grammar: “there is many”",
      body: "Use **there are many** so the verb agrees with the plural subject.",
      micro_edit: null,
    });
  }
  if (/\bdefinately\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “definately”",
      body: "Standard spelling is **definitely**.",
      micro_edit: "definitely",
    });
  }
  if (/\brecieve\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “recieve”",
      body: "Standard spelling is **receive** (i before e except after c pattern does not apply here).",
      micro_edit: "receive",
    });
  }
  if (/\boccured\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “occured”",
      body: "Standard spelling is **occurred** (double r).",
      micro_edit: "occurred",
    });
  }
  if (/\bseperate\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Spelling: “seperate”",
      body: "Standard spelling is **separate**.",
      micro_edit: "separate",
    });
  }
  if (/\bteh\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Typo: “teh”",
      body: "Looks like **the** with letters swapped.",
      micro_edit: "the",
    });
  }
  if (/\byour\s+welcome\b/i.test(t)) {
    add({
      type: "grammar",
      title: "Phrase: “your welcome”",
      body: "For “you are welcome,” use the contraction **you're**.",
      micro_edit: "You're welcome",
    });
  }
  return out.slice(0, 5);
}

/**
 * @param {string} text
 * @param {"typing" | "paused"} mode
 */
export function heuristicSuggestions(text, mode = "paused") {
  const suggestions = [];
  const pausedOnly = mode === "paused";

  if (pausedOnly) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length > 1) {
      const longOnes = sentences.filter((s) => s.split(/\s+/).length > 40);
      if (longOnes.length) {
        suggestions.push({
          type: "coherence",
          title: "Very long sentence(s)",
          body:
            "Readers track one main idea per sentence. Try splitting the longest sentence into two: keep your voice, but give each sentence a single job.",
          micro_edit: null,
        });
      }
    }
    const words = tokenize(text);
    const filler = HEDGE_WORDS;
    const counts = new Map();
    for (const w of words) {
      if (filler.includes(w)) counts.set(w, (counts.get(w) || 0) + 1);
    }
    for (const [w, c] of counts) {
      if (c >= 3) {
        suggestions.push({
          type: "pattern",
          title: `Repeated hedge/filler: “${w}”`,
          body:
            "This is often how people talk—and that is fine. If it clusters, readers may read it as uncertainty. Try cutting half of them on a second pass, not all.",
          micro_edit: null,
        });
        break;
      }
    }
  }

  if (text.includes("  ")) {
    suggestions.push({
      type: "clarity",
      title: "Extra spaces",
      body: "Small formatting glitches can distract in polished contexts. Not a voice issue—just cleanup.",
      micro_edit: null,
    });
  }

  if (pausedOnly) {
    const punctClusters = countMatches(text, /[!?]{2,}|\.{4,}/g);
    if (punctClusters > 0) {
      suggestions.push({
        type: "punctuation",
        title: "Repeated punctuation clusters",
        body:
          "Repeated punctuation can be expressive. In formal or mixed audiences, reserve it for emphasis points so your main ideas still read as precise.",
        micro_edit: null,
      });
    }
  }

  const commaSplice = String(text).match(/\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/i);
  if (commaSplice) {
    suggestions.push({
      type: "grammar",
      title: "Possible comma splice",
      body:
        "A comma may be joining two full thoughts. Try a period, semicolon, or a connector (for example, because/so) to keep your logic clear.",
      micro_edit: null,
    });
  }

  return suggestions.slice(0, 5);
}

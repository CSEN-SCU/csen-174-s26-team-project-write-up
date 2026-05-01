import { retrieveForWritingCoach } from "../rag/index.js";
import {
  readProfileStore,
  createEmptyProfile,
  analyzeWritingSignals,
  mergeProfile,
  summarizeProfile,
  appendProfile,
} from "../profile/index.js";
import {
  obviousSpellingGrammarHeuristics,
  heuristicSuggestions,
  spellDictionarySuggestions,
} from "./heuristics.js";
import { dedupeSuggestionTitles, suggestionsToFeedback } from "./format.js";
import { applyRagFeedbackGuardrails } from "./guardrails.js";
import { coachWithChatCompletions, resolveCoachLlmAttempts } from "../llm/index.js";

const RAG_TOP_K = Math.max(1, Math.min(24, Number(process.env.RAG_TOP_K || 8)));

/**
 * @param {object} body
 * @param {string} [body.text]
 * @param {string} [body.userId]
 * @param {string} [body.surface]
 * @param {string} [body.coachMode]
 * @param {string[]} [body.focus]
 */
export async function runCoach(body) {
  const {
    text,
    userId = "anonymous",
    surface = "extension",
    coachMode: rawMode,
    focus: rawFocus,
  } = body || {};

  if (text == null || typeof text !== "string") {
    return { error: "Missing text", status: 400 };
  }

  const coachMode = rawMode === "typing" ? "typing" : "paused";
  const focus = Array.isArray(rawFocus) ? rawFocus.map((f) => String(f)) : [];

  const trimmed = text.trim().slice(0, 12000);
  if (!trimmed) {
    return {
      error:
        "Empty text after trim. Paste draft text, or ensure your MCP bridge forwards document content into the `text` field.",
      status: 400,
    };
  }

  const retrieved = retrieveForWritingCoach(trimmed, RAG_TOP_K);
  const store = await readProfileStore();
  const profileNotes = store[userId]?.notes?.map((n) => n.summary) || [];
  const existingProfile = store[userId]?.profile || createEmptyProfile();
  const signals = analyzeWritingSignals(trimmed);
  const predictedProfile = summarizeProfile(mergeProfile(existingProfile, signals));

  const heur = heuristicSuggestions(trimmed, coachMode);
  let llmCards = [];
  let modelUsed = null;
  const attempts = resolveCoachLlmAttempts();
  for (const cfg of attempts) {
    try {
      const ai = await coachWithChatCompletions(
        trimmed,
        retrieved,
        profileNotes,
        predictedProfile,
        cfg,
        coachMode,
        focus,
      );
      if (Array.isArray(ai) && ai.length) {
        llmCards = ai;
        modelUsed = cfg.model;
        break;
      }
    } catch (e) {
      console.error(e);
    }
  }

  const typoCards = obviousSpellingGrammarHeuristics(trimmed);
  const dictCards = spellDictionarySuggestions(trimmed);
  const suggestions = applyRagFeedbackGuardrails(
    dedupeSuggestionTitles([
      ...typoCards,
      ...dictCards,
      ...(llmCards.length ? llmCards : []),
      ...heur,
    ]),
    { userText: trimmed, max: 10 },
  );

  const summary = `surface=${surface}; coachMode=${coachMode}; top retrieval: ${retrieved[0]?.chunk?.id || "none"}; words=${signals.wordCount}; longSentenceCount=${signals.longSentenceCount}; commaSpliceSignals=${signals.commaSpliceSignals}`;
  const profileSnapshot = await appendProfile(userId, summary, signals).catch(() => predictedProfile);

  const retrievedChunks = retrieved.map((r) => ({
    id: r.chunk.id,
    score: r.score,
    text: r.chunk.text,
    source: r.chunk.source,
  }));

  const feedback = suggestionsToFeedback(suggestions);

  return {
    status: 200,
    payload: {
      suggestions,
      cards: suggestions,
      feedback,
      source: "coaching-api",
      model: modelUsed,
      profileSnapshot,
      retrievedChunks,
      vocabulary_pairs_saved: 0,
    },
  };
}

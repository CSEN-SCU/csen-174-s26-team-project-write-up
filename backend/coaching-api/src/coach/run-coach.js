import { retrieveForWritingCoach, retrieveFromUserDrafts } from "../rag/index.js";
import {
  readProfileStore,
  createEmptyProfile,
  analyzeWritingSignals,
  mergeProfile,
  summarizeProfile,
  appendProfile,
  appendUserDraft,
} from "../profile/index.js";
import {
  obviousSpellingGrammarHeuristics,
  heuristicSuggestions,
  spellDictionarySuggestions,
} from "./heuristics.js";
import { dedupeSuggestionTitles, suggestionsToFeedback } from "./format.js";
import { applyRagFeedbackGuardrails } from "./guardrails.js";
import { coachWithChatCompletions, resolveCoachLlmAttempts } from "../llm/index.js";

const RAG_TOP_K = 8;
const PAUSED_SUGGESTION_MAX = 14;

/** Drop prior draft snapshots that are almost the same as the current pass (reduces Sources noise). */
function draftsForRetrieval(drafts, currentText) {
  const rows = Array.isArray(drafts) ? drafts : [];
  const norm = String(currentText || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!norm) return rows;
  return rows.filter((d) => {
    const t = String(d?.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!t || t === norm) return false;
    const shorter = t.length < norm.length ? t : norm;
    const longer = t.length < norm.length ? norm : t;
    if (longer.includes(shorter) && shorter.length / longer.length > 0.88) return false;
    return true;
  });
}

/** Prefer coaching guides in the Sources panel over recycled draft history. */
function orderRetrievedChunksForDisplay(chunks) {
  const list = Array.isArray(chunks) ? [...chunks] : [];
  const guides = list.filter((c) => !String(c.id || "").startsWith("user-draft:"));
  const drafts = list.filter((c) => String(c.id || "").startsWith("user-draft:"));
  return [...guides, ...drafts.slice(0, 2)].slice(0, RAG_TOP_K);
}

/**
 * @param {object} body
 * @param {{ requestId?: string }} [meta] from HTTP `X-Request-Id` (e.g. app-api) for log correlation with `[coach-llm]`
 */
export async function runCoach(body, meta = {}) {
  const {
    userId: rawUserId,
    surface = "extension",
    coachMode: rawMode,
    focus: rawFocus,
    goals: rawGoals,
    audience: rawAudience,
    tonePreference: rawTonePreference,
  } = body || {};

  const text = typeof body?.text === "string" ? body.text : null;
  if (text == null) {
    return { error: "Missing text", status: 400 };
  }
  const userId = String(rawUserId || "").trim();
  if (!userId || userId.toLowerCase() === "anonymous") {
    return {
      error: "Missing stable userId. Personalization requires a persistent non-anonymous userId.",
      status: 400,
    };
  }

  const coachMode = rawMode === "typing" ? "typing" : "paused";
  const focus = Array.isArray(rawFocus) ? rawFocus.map((f) => String(f)) : [];
  const personalization = {
    goals: typeof rawGoals === "string" ? rawGoals.trim().slice(0, 300) : "",
    audience: typeof rawAudience === "string" ? rawAudience.trim().slice(0, 200) : "",
    tonePreference:
      rawTonePreference === "formal" || rawTonePreference === "casual" || rawTonePreference === "neutral"
        ? rawTonePreference
        : "neutral",
  };

  const trimmed = text.trim().slice(0, 12000);
  if (!trimmed) {
    return {
      error:
        "Empty text after trim. Paste draft text, or ensure your MCP bridge forwards document content into the `text` field.",
      status: 400,
    };
  }

  const store = await readProfileStore();
  const globalRetrieved = retrieveForWritingCoach(trimmed, RAG_TOP_K);
  const userRetrieved = retrieveFromUserDrafts(
    draftsForRetrieval(store[userId]?.drafts || [], trimmed),
    trimmed,
    2,
  );
  const retrieved = [...globalRetrieved, ...userRetrieved]
    .reduce((acc, item) => {
      const prev = acc.get(item.chunk.id);
      if (!prev || item.score > prev.score) {
        acc.set(item.chunk.id, item);
      }
      return acc;
    }, new Map())
    .values();
  const retrievedSorted = [...retrieved].sort((a, b) => b.score - a.score).slice(0, RAG_TOP_K);

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
        personalization,
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
  const dictCards = spellDictionarySuggestions(trimmed, {
    maxCards: coachMode === "paused" ? 10 : 4,
  });
  const merged =
    coachMode === "paused"
      ? [
          ...typoCards,
          ...dictCards,
          ...heur,
          ...(llmCards.length ? llmCards : []),
        ]
      : [
          ...typoCards,
          ...dictCards,
          ...(llmCards.length ? llmCards : []),
          ...heur,
        ];
  const suggestionMax = coachMode === "paused" ? PAUSED_SUGGESTION_MAX : 10;
  const suggestions = applyRagFeedbackGuardrails(dedupeSuggestionTitles(merged), {
    userText: trimmed,
    max: suggestionMax,
  });

  const summary = `surface=${surface}; coachMode=${coachMode}; top retrieval: ${retrievedSorted[0]?.chunk?.id || "none"}; words=${signals.wordCount}; longSentenceCount=${signals.longSentenceCount}; commaSpliceSignals=${signals.commaSpliceSignals}`;
  const profileSnapshot = await appendProfile(userId, summary, signals).catch(() => predictedProfile);
  await appendUserDraft(userId, trimmed).catch(() => {});

  const retrievedChunks = orderRetrievedChunksForDisplay(
    retrievedSorted.map((r) => ({
      id: r.chunk.id,
      score: r.score,
      text: r.chunk.text,
      source: r.chunk.source,
    })),
  );

  const feedback = suggestionsToFeedback(suggestions);

  return {
    status: 200,
    payload: {
      suggestions,
      cards: suggestions,
      feedback,
      source: "coaching-api",
      model: modelUsed,
      userId,
      personalization,
      profileSnapshot,
      retrievedChunks,
      vocabulary_pairs_saved: 0,
    },
  };
}

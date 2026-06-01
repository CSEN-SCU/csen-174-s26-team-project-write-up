import { retrieveForCoachingGuidance, retrieveFromUserDrafts } from "../rag/index.js";
import {
  readProfileStore,
  createEmptyProfile,
  analyzeWritingSignals,
  mergeProfile,
  summarizeProfile,
  appendProfile,
  appendUserDraft,
} from "../profile/index.js";
import { heuristicSuggestions, isSpellcheckerReady } from "./heuristics.js";
import { suggestionsToFeedback } from "./format.js";
import { finalizeMechanicsSuggestions } from "./mechanics-pipeline.js";
import { filterToCoachingOnly, isCoachingCard } from "./issue-categories.js";
import { mergeDeterministicAndCoaching } from "./merge-suggestions.js";
import { coachLogSummary } from "./coach-log.js";
import { coachWithChatCompletions, resolveCoachLlmAttempts } from "../llm/index.js";

const RAG_TOP_K = 8;
/** Separate budgets so mechanics are not crowded out by coaching cards. */
const PAUSED_DETERMINISTIC_MAX = 80;
const PAUSED_COACHING_MAX = 30;
const PAUSED_TOTAL_MAX = 100;
const TYPING_DETERMINISTIC_MAX = 30;
const TYPING_TOTAL_MAX = 30;

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

function mergeRetrievedHits(globalRetrieved, userRetrieved, topK) {
  const retrieved = [...globalRetrieved, ...userRetrieved]
    .reduce((acc, item) => {
      const prev = acc.get(item.chunk.id);
      if (!prev || item.score > prev.score) {
        acc.set(item.chunk.id, item);
      }
      return acc;
    }, new Map())
    .values();
  return [...retrieved].sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * @param {object} body
 * @param {{ requestId?: string }} [meta] from HTTP `X-Request-Id` (e.g. app-api) for log correlation with `[coach-llm]`
 */
export async function runCoach(body, meta = {}) {
  const requestId = String(meta?.requestId || "").trim() || undefined;
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
  const signals = analyzeWritingSignals(trimmed);
  const existingProfile = store[userId]?.profile || createEmptyProfile();
  const predictedProfile = summarizeProfile(mergeProfile(existingProfile, signals));

  const detCap = coachMode === "paused" ? PAUSED_DETERMINISTIC_MAX : TYPING_DETERMINISTIC_MAX;
  const mechanicsSuggestions = finalizeMechanicsSuggestions(trimmed, coachMode, detCap);

  let coachingSuggestions = [];
  let modelUsed = null;
  let retrievedSorted = [];

  if (coachMode === "paused") {
    const globalRetrieved = retrieveForCoachingGuidance(trimmed, RAG_TOP_K);
    const userRetrieved = retrieveFromUserDrafts(
      draftsForRetrieval(store[userId]?.drafts || [], trimmed),
      trimmed,
      2,
    );
    retrievedSorted = mergeRetrievedHits(globalRetrieved, userRetrieved, RAG_TOP_K);

    const profileNotes = store[userId]?.notes?.map((n) => n.summary) || [];
    const styleHeur = heuristicSuggestions(trimmed, coachMode, { includePunctuation: false }).filter((c) =>
      isCoachingCard(c),
    );

    const attempts = resolveCoachLlmAttempts();
    let llmCards = [];
    for (const cfg of attempts) {
      try {
        const ai = await coachWithChatCompletions(
          trimmed,
          retrievedSorted,
          profileNotes,
          predictedProfile,
          cfg,
          coachMode,
          focus,
          personalization,
        );
        if (Array.isArray(ai) && ai.length) {
          llmCards = filterToCoachingOnly(ai);
          modelUsed = cfg.model;
          break;
        }
      } catch (e) {
        console.error("[coaching-api] coach LLM error:", e?.message || e);
      }
    }
    coachingSuggestions = [...styleHeur, ...llmCards];
  }

  const suggestions = mergeDeterministicAndCoaching(mechanicsSuggestions, coachingSuggestions, {
    userText: trimmed,
    detMax: detCap,
    coachMax: coachMode === "paused" ? PAUSED_COACHING_MAX : 0,
    totalMax: coachMode === "paused" ? PAUSED_TOTAL_MAX : TYPING_TOTAL_MAX,
  });

  coachLogSummary({
    requestId,
    surface,
    coachMode,
    textLength: trimmed.length,
    wordCount: signals.wordCount,
    mechanicsCount: mechanicsSuggestions.length,
    coachingCount: coachingSuggestions.length,
    mergedCount: suggestions.length,
    spellcheckerReady: isSpellcheckerReady(),
    llmModel: modelUsed || null,
    retrievalTopId: retrievedSorted[0]?.chunk?.id || null,
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

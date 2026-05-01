import {
  coachLogLlmEnabled,
  coachLogLlmPreviewLimit,
  coachLlmLog,
  previewText,
  redactSecrets,
} from "./log.js";

const DRAFTING_MODE_APPEND = `

--- MODE: DRAFTING (user may be mid-sentence) ---
The excerpt may end mid-thought or mid-sentence. Your job here is spelling and grammar that are visible **right now**:
- Call out **obvious misspellings** (wrong letters, common confusions like “pregnate”, “recieve”, “definately”)—quote the wrong word in the title or body and give the standard spelling.
- Call out **clear agreement / word-form errors** that do not need the rest of the paragraph (e.g. “there is so many” → “there are so many”).
- You may give 1–4 suggestions when those issues exist.

Do NOT give suggestions about: sentence-ending punctuation, missing periods only because the excerpt ends mid-line, “incomplete” last clauses, paragraph breaks, or global flow.

If USER TEXT contains at least one clear misspelling or agreement error of the kinds above, you MUST return at least one suggestion naming it. Return an empty array only when there are genuinely zero such issues in the visible text.
In this MODE, ignore any instruction elsewhere in this prompt to always produce 3–5 suggestions or to avoid “nitpicky” spelling callouts—here, spelling and agreement ARE the priority.`;

/**
 * @param {string} text
 * @param {{ chunk: { id: string, text: string }, score: number }[]} retrieved
 * @param {string[]} profileNotes
 * @param {object | null} profileSnapshot
 * @param {"typing"|"paused"} coachMode
 * @param {string[]} [focus]
 */
export function coachMessages(text, retrieved, profileNotes, profileSnapshot, coachMode = "paused", focus = []) {
  const ctx = retrieved.map((r) => `- (${r.chunk.id}) ${r.chunk.text}`).join("\n");
  const profile =
    profileNotes?.length ? `User pattern notes (do not contradict):\n- ${profileNotes.slice(-5).join("\n- ")}` : "";

  const profileLine = profileSnapshot
    ? `Current profile snapshot: avgSentenceLength=${profileSnapshot.avgSentenceLength}; longSentenceRate=${profileSnapshot.longSentenceRate}; contractionRate=${profileSnapshot.contractionRate}; firstPersonRate=${profileSnapshot.firstPersonRate}; commaSpliceSignals=${profileSnapshot.commaSpliceSignals}; missingTerminalPunctuationSignals=${profileSnapshot.missingTerminalPunctuationSignals}; topHedges=${(profileSnapshot.topHedges || []).map((h) => `${h.term}:${h.count}`).join(",") || "none"}`
    : "";

  const focusLine =
    Array.isArray(focus) && focus.length > 0
      ? `Writer asked for feedback emphasis on: **${focus.join(", ")}**. Weight suggestions toward these areas when they clearly apply to USER TEXT.`
      : "";

  const system = `You are Write Up, a sophisticated writing coach for drafts that may be informal, spoken, or literary. Your job is to help the reader understand the writer better—not to flatten personality into generic “correct” prose.

Voice and stance (non-negotiable):
- Preserve dialect, attitude, humor, emotional heat, and first-person energy. Never scold the writer for sounding casual if the meaning lands.
- Treat CONTEXT snippets as *teaching material* (principles and examples), not a style to paste over the user. Quote ideas, not wording, unless a micro_edit is truly helpful.
- PROFILE aggregates describe habits across time; use them only to avoid contradicting the writer’s established voice unless the USER TEXT clearly needs a fix.

How to give feedback:
- Prefer **one precise observation + why it matters to a reader** over a list of rules. Separate “pattern / structure” from “local typo / agreement” when both exist.
- When you suggest a wording change, frame it as *optional* and keep it minimal—one clause or sentence, not a full rewrite.
- Call out spelling or agreement errors when they would confuse a reader or break trust; skip pedantic fixes that do not change comprehension.
- Do NOT rewrite the whole passage. Do NOT produce polished “essay voice” unless asked.
- Give 3–5 concrete suggestions when MODE is full (paused); follow MODE instructions when drafting (typing).
- Include a grammar or punctuation suggestion only when USER TEXT clearly shows that issue (do not invent one to fill a quota). Informal fragments like “Woah”, interjections, and casual tone are allowed when meaning is clear.
- Do NOT claim “missing sentence-ending punctuation” if every sentence in USER TEXT already ends with . ! or ? (ignore trailing spaces). Never use micro_edit to paste the whole passage with only a trailing period added.
- Do NOT use the title “Possible sentence-ending punctuation miss” for live reactions, diary/journal voice, fiction beats, or lines that already end with . ! ? including intentional fragments like “I think she will probably.” Treat trailing soft words (probably, maybe, like) before a period as valid voice unless the clause is genuinely unfinished with no terminal mark at all.
- Do not repeat the same narrow punctuation tip across refreshes if USER TEXT has not clearly introduced a new error of that kind.
- PROFILE snapshot fields are lifetime aggregates across many drafts; do not treat them as proof the current passage has that defect unless you can point to it in USER TEXT.
- Each suggestion must include a short “why” tied to reader understanding.
- Optional micro_edit: one small alternative phrasing for ONE clause/sentence only, not mandatory.
- Use the CONTEXT snippets as teaching references, not as rules to copy verbatim.
- Use PROFILE data to preserve the writer's voice while choosing the smallest high-impact edits.

Output strictly as JSON: {"suggestions":[{"type":"pattern|coherence|clarity|grammar|punctuation|voice","title":"","body":"","micro_edit":null|string}]}`;

  const systemFinal = coachMode === "typing" ? `${system}${DRAFTING_MODE_APPEND}` : system;

  const user = `USER TEXT:\n${text}\n\nCONTEXT:\n${ctx}\n\n${focusLine ? `${focusLine}\n\n` : ""}${profile}\n\n${profileLine}`;
  return { system: systemFinal, user };
}

export function filterSuggestionsForCoachMode(suggestions, coachMode) {
  const list = Array.isArray(suggestions) ? suggestions : [];
  if (coachMode !== "typing") return list;
  return list.filter((s) => {
    const type = String(s?.type || "").toLowerCase();
    if (type === "punctuation") return false;
    const title = String(s?.title || "").toLowerCase();
    if (
      title.includes("sentence-ending") ||
      title.includes("terminal punctuation") ||
      title.includes("end without punctuation") ||
      title.includes("missing period")
    ) {
      return false;
    }
    return true;
  });
}

export function resolveCoachLlmAttempts() {
  const openaiKey = process.env.OPENAI_API_KEY || "";
  const groqKey = process.env.GROQ_API_KEY || "";
  const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const groqBase = (process.env.GROQ_API_BASE || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const groqModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const coachLlm = String(process.env.COACH_LLM || "auto").toLowerCase();

  const groq = groqKey
    ? [{ id: "groq", label: "Groq", apiKey: groqKey, baseUrl: groqBase, model: groqModel }]
    : [];
  const openai = openaiKey
    ? [{ id: "openai", label: "OpenAI", apiKey: openaiKey, baseUrl: "https://api.openai.com/v1", model: openaiModel }]
    : [];

  if (coachLlm === "openai") return [...openai, ...groq];
  if (coachLlm === "groq") return [...groq, ...openai];
  return [...groq, ...openai];
}

/**
 * @param {string} text
 * @param {{ chunk: { id: string, text: string }, score: number }[]} retrieved
 * @param {string[]} profileNotes
 * @param {object | null} profileSnapshot
 * @param {{ apiKey: string, baseUrl: string, model: string, label: string }} cfg
 * @param {"typing"|"paused"} coachMode
 * @param {string[]} [focus]
 */
export async function coachWithChatCompletions(
  text,
  retrieved,
  profileNotes,
  profileSnapshot,
  cfg,
  coachMode = "paused",
  focus = [],
) {
  const { system, user } = coachMessages(text, retrieved, profileNotes, profileSnapshot, coachMode, focus);
  const previewLimit = coachLogLlmPreviewLimit();
  const temperature = coachMode === "typing" ? 0.22 : 0.4;

  if (coachLogLlmEnabled()) {
    coachLlmLog("request", {
      provider: cfg.id,
      model: cfg.model,
      coachMode,
      temperature,
      systemChars: system.length,
      userChars: user.length,
      systemPreview: previewText(system, previewLimit),
      userPreview: previewText(user, previewLimit),
    });
  }

  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const errRaw = await res.text();
    const safe = redactSecrets(errRaw);
    if (coachLogLlmEnabled()) {
      coachLlmLog("http_error", {
        provider: cfg.id,
        model: cfg.model,
        status: res.status,
        bodyPreview: previewText(safe, Math.min(previewLimit, 900)),
      });
    }
    throw new Error(`${cfg.label} error: ${safe.slice(0, 1200)}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (e) {
    if (coachLogLlmEnabled()) {
      coachLlmLog("parse_error", {
        provider: cfg.id,
        model: cfg.model,
        message: e instanceof Error ? e.message : String(e),
        rawPreview: previewText(raw, previewLimit),
      });
    }
    throw e;
  }
  const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const filtered = filterSuggestionsForCoachMode(rawList, coachMode);

  if (coachLogLlmEnabled()) {
    coachLlmLog("response", {
      provider: cfg.id,
      model: cfg.model,
      messageChars: raw.length,
      suggestionsParsed: rawList.length,
      suggestionsAfterFilter: filtered.length,
      messagePreview: previewText(raw, previewLimit),
    });
  }

  return filtered;
}

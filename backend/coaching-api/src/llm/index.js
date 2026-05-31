const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OPENAI_MODEL = "gpt-4o-mini";
const LLM_TIMEOUT_MS = 90_000;

const DRAFTING_MODE_APPEND = `

--- MODE: DRAFTING (user may be mid-sentence) ---
The excerpt may end mid-thought or mid-sentence. Your job here is spelling and grammar that are visible **right now**:
- Call out **obvious misspellings** (wrong letters, common confusions like "pregnate", "recieve", "definately")—quote the wrong word in the title or body and give the standard spelling.
- Call out **clear agreement / word-form errors** that do not need the rest of the paragraph (e.g. "there is so many" → "there are so many").
- You may give 1–4 suggestions when those issues exist.

Do NOT give suggestions about: sentence-ending punctuation, missing periods only because the excerpt ends mid-line, "incomplete" last clauses, paragraph breaks, or global flow.

If USER TEXT contains at least one clear misspelling or agreement error of the kinds above, you MUST return at least one suggestion naming it. Return an empty array only when there are genuinely zero such issues in the visible text.
In this MODE, ignore any instruction elsewhere in this prompt to always produce 3–5 suggestions or to avoid "nitpicky" spelling callouts—here, spelling and agreement ARE the priority.`;

const FULL_REVIEW_MODE_APPEND = `

--- MODE: FULL REVIEW (paused) ---
The writer wants **comprehensive** feedback on the **entire** USER TEXT (all paragraphs), aligned with Write Up's product vision: surface issues *and* pedagogy, without flattening voice.

You MUST cover four layers in one pass (separate cards, not one vague summary):
1. **Mechanics** — List **every** clear spelling mistake, wrong word form, and agreement error in passages a human can read. Quote the exact wrong word or phrase in the title. Skip random keyboard-mash tokens at the top unless the writer clearly meant them as words. Do not invent issues.
2. **Tone / voice** — Describe how the draft sounds: casual, heated, uncertain, mixed register, profane, formal, or otherwise. **You MUST produce at least one \`voice\` card** whenever the draft contains 3 or more informal or profane terms (e.g. swearing, slang, heated language) — even when that register is intentional. Note what a reader would feel. Preserve intentional informality; when tone clashes with the stated purpose, suggest one small bridge sentence.
3. **Word choice** — Identify 1–2 vague, weak, or overused words (e.g. *very*, *really*, *a lot*, *nice*, *good*, *thing*, *stuff*, *big*, *bad*, *get*) and offer a more vivid or precise alternative as \`micro_edit\`.
4. **Improvement** — Give concrete, optional next-step edits (micro_edit when helpful) for clarity, flow, or stronger phrasing on the **readable** sentences—including new material at the end of the draft, not only the opening.

Return **6–12** suggestions when the draft has enough readable content; use fewer only if issues are truly sparse. Include at least one \`voice\` card when informal/emotional language is present, at least one \`word choice\` or \`clarity\` card, and at least two \`grammar\`/\`punctuation\` cards when those issues exist.`;

/**
 * @param {string} text
 * @param {{ chunk: { id: string, text: string }, score: number }[]} retrieved
 * @param {string[]} profileNotes
 * @param {object | null} profileSnapshot
 * @param {"typing"|"paused"} coachMode
 * @param {string[]} [focus]
 * @param {{ goals?: string, audience?: string, tonePreference?: "formal"|"neutral"|"casual" }} [personalization]
 */
export function coachMessages(
  text,
  retrieved,
  profileNotes,
  profileSnapshot,
  coachMode = "paused",
  focus = [],
  personalization = {},
) {
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
  const audienceLine = personalization?.audience
    ? `Target audience: ${String(personalization.audience).slice(0, 200)}.`
    : "";
  const goalsLine = personalization?.goals
    ? `Writer goals: ${String(personalization.goals).slice(0, 300)}.`
    : "";
  const tonePreference = String(personalization?.tonePreference || "").toLowerCase();
  const toneLine =
    tonePreference === "formal" || tonePreference === "casual" || tonePreference === "neutral"
      ? `Requested tone direction: ${tonePreference}. Respect this preference without flattening voice.`
      : "";

  const system = `You are Write Up, a sophisticated writing coach for drafts that may be informal, spoken, or literary. Your job is to help the reader understand the writer better—not to flatten personality into generic "correct" prose.

Voice and stance (non-negotiable):
- Preserve dialect, attitude, humor, emotional heat, and first-person energy. Never scold the writer for sounding casual if the meaning lands.
- Treat CONTEXT snippets as *teaching material* (principles and examples), not a style to paste over the user. Quote ideas, not wording, unless a micro_edit is truly helpful.
- PROFILE aggregates describe habits across time; use them only to avoid contradicting the writer's established voice unless the USER TEXT clearly needs a fix.

How to give feedback:
- Prefer **one precise observation + why it matters to a reader** over a list of rules. Separate "pattern / structure" from "local typo / agreement" when both exist.
- When you suggest a wording change, frame it as *optional* and keep it minimal—one clause or sentence, not a full rewrite.
- On **full review (paused)**, enumerate clear spelling/grammar issues in readable prose and add tone + improvement cards; see MODE appendix.
- On **drafting (typing)**, prioritize visible spelling/agreement only.
- Do NOT rewrite the whole passage. Do NOT produce polished "essay voice" unless asked.
- Include a grammar or punctuation suggestion only when USER TEXT clearly shows that issue (do not invent one to fill a quota). Informal fragments like "Woah", interjections, and casual tone are allowed when meaning is clear.
- Do NOT claim "missing sentence-ending punctuation" if every sentence in USER TEXT already ends with . ! or ? (ignore trailing spaces). Never use micro_edit to paste the whole passage with only a trailing period added.
- Do NOT use the title "Possible sentence-ending punctuation miss" for live reactions, diary/journal voice, fiction beats, or lines that already end with . ! ? including intentional fragments like "I think she will probably." Treat trailing soft words (probably, maybe, like) before a period as valid voice unless the clause is genuinely unfinished with no terminal mark at all.
- Do not repeat the same narrow punctuation tip across refreshes if USER TEXT has not clearly introduced a new error of that kind.
- PROFILE snapshot fields are lifetime aggregates across many drafts; do not treat them as proof the current passage has that defect unless you can point to it in USER TEXT.
- Each suggestion must include a short "why" tied to reader understanding.
- Optional micro_edit: one small alternative phrasing for ONE clause/sentence only, not mandatory.
- Use the CONTEXT snippets as teaching references, not as rules to copy verbatim.
- Use PROFILE data to preserve the writer's voice while choosing the smallest high-impact edits.
- If audience/goals/tone preference are provided, align advice to them while still preserving authentic voice.

Output strictly as JSON: {"suggestions":[{"type":"pattern|coherence|clarity|grammar|punctuation|voice","title":"","body":"","micro_edit":null|string}]}`;

  const systemFinal =
    coachMode === "typing" ? `${system}${DRAFTING_MODE_APPEND}` : `${system}${FULL_REVIEW_MODE_APPEND}`;

  const personalizationBlock = [audienceLine, goalsLine, toneLine].filter(Boolean).join("\n");
  const scopeLine =
    coachMode === "paused"
      ? "Read and respond to the **entire** USER TEXT from start to finish—including the last sentences and new paragraphs—not only the opening lines. Ignore keyboard-mash fragments unless the writer clearly intended them as words.\n\n"
      : "";
  const user = `${scopeLine}USER TEXT:\n${text}\n\nCONTEXT:\n${ctx}\n\n${focusLine ? `${focusLine}\n\n` : ""}${personalizationBlock ? `PERSONALIZATION:\n${personalizationBlock}\n\n` : ""}${profile}\n\n${profileLine}`;
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
  const groqKey = process.env.GROQ_API_KEY || "";
  const openaiKey = process.env.OPENAI_API_KEY || "";

  const groq = groqKey
    ? [{ id: "groq", label: "Groq", apiKey: groqKey, baseUrl: GROQ_BASE, model: GROQ_MODEL }]
    : [];
  const openai = openaiKey
    ? [{ id: "openai", label: "OpenAI", apiKey: openaiKey, baseUrl: "https://api.openai.com/v1", model: OPENAI_MODEL }]
    : [];

  // Try Groq first (faster/cheaper), fall back to OpenAI
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
 * @param {{ goals?: string, audience?: string, tonePreference?: "formal"|"neutral"|"casual" }} [personalization]
 */
export async function coachWithChatCompletions(
  text,
  retrieved,
  profileNotes,
  profileSnapshot,
  cfg,
  coachMode = "paused",
  focus = [],
  personalization = {},
) {
  const { system, user } = coachMessages(
    text,
    retrieved,
    profileNotes,
    profileSnapshot,
    coachMode,
    focus,
    personalization,
  );
  const temperature = coachMode === "typing" ? 0.22 : 0.35;

  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);

  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let res;
  try {
    res = await fetch(url, {
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
      signal: ac.signal,
    });
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${cfg.label} error ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  const rawList = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  return filterSuggestionsForCoachMode(rawList, coachMode);
}

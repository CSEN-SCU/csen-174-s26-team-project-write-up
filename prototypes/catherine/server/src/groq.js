/**
 * Primary LLM for Write Up (Catherine) — Groq OpenAI-compatible API.
 * Weak wording is identified by the model from the passage + writing level (no static word list).
 * Free tier: https://console.groq.com/
 */

/** On-demand tiers often cap a single request near ~6k TPM; keep prompt + max_tokens under that. */
const DEFAULT_GROQ_PASSAGE_CHARS = 5200;
const DEFAULT_GROQ_MAX_TOKENS = 1408;

function parsePositiveInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function groqPassageCharCap() {
  const fromEnv = parsePositiveInt(process.env.GROQ_PASSAGE_CHARS, 0);
  if (fromEnv) return Math.min(12_000, Math.max(800, fromEnv));
  return DEFAULT_GROQ_PASSAGE_CHARS;
}

function groqMaxOutputTokens() {
  const fromEnv = parsePositiveInt(process.env.GROQ_MAX_TOKENS, 0);
  if (fromEnv) return Math.min(4096, Math.max(256, fromEnv));
  return DEFAULT_GROQ_MAX_TOKENS;
}

function stripJsonFence(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  return t.trim();
}

function levelGuidance(writingLevel) {
  const w = String(writingLevel || "college").toLowerCase();
  const map = {
    middle_school:
      "Audience: middle school. Flag informal fillers, vague intensifiers, empty nouns, and word choices below this level—not grammar spelling unless tied to weak diction.",
    high_school:
      "Audience: high school. Flag casual absolutes that outrun evidence, thin intensifiers, generic descriptors, and vague claims.",
    college:
      "Audience: college. Flag padded transitions, vague quantifiers, hand-wavy abstractions, and generic “academic” diction where precision would help.",
    professional:
      "Audience: professional workplace prose. Flag corporate filler and vague business language that hides concrete detail; keep necessary domain terms.",
  };
  return map[w] || map.college;
}

/** User goals from onboarding — steers synonym tone and note depth. */
function goalsGuidance(writingGoals) {
  const raw = Array.isArray(writingGoals) ? writingGoals : [];
  const g = new Set(raw.map((x) => String(x || "").toLowerCase()));
  const lines = [];
  if (g.has("vocabulary")) {
    lines.push(
      "Vocabulary lift: favor synonyms that are concrete, level-appropriate, and more precise; avoid swapping one vague word for another."
    );
  }
  if (g.has("pedagogy")) {
    lines.push(
      "Pedagogical mentor: in reason and pedagogicalNote, explain the logic behind the weakness (why it reads weak at this level), not just “pick another word.”"
    );
  }
  if (g.has("patterns")) {
    lines.push(
      "Pattern awareness: where it fits, note words that often function as crutch habits so the writer can watch for repetition across drafts."
    );
  }
  if (g.has("practice")) {
    lines.push(
      "Practice angle: optionalRewrite should read like a one-sentence exercise the writer could try in their own voice, not a full paragraph rewrite."
    );
  }
  if (!lines.length) {
    lines.push(
      "Balanced feedback: vocabulary upgrades plus brief pedagogical notes suitable for the chosen writing level."
    );
  }
  return lines.map((s) => `- ${s}`).join("\n");
}

/** Free-text: email, lab report, informal essay, etc. — steers register for synonyms and rewrites. */
function pieceContextBlock(pieceContext) {
  const t = String(pieceContext || "").trim();
  if (!t) {
    return `Piece / genre context: (not specified — infer register cautiously from the passage alone; stay neutral if unclear.)`;
  }
  return `Piece / genre context — the writer says this excerpt is for:
"""${t}"""

Apply this to every item: synonyms and optionalRewrite MUST match this genre, audience, and tone (e.g., workplace email vs chemistry lab report vs reflective informal essay). Prefer discipline-appropriate vocabulary when the context implies a technical field; avoid slang or chatty phrasing in formal STEM or professional writing unless the context explicitly allows it. Do not invent jargon the passage does not support.`;
}

/** Generic function words only — do not bake in passage-specific tokens. */
const REPETITION_STOP = new Set(
  `a an the and or nor but if so as at by for in of on to up we he she it
  its is am are was were be been being has have had do does did can could
  will would should may might must not no yes all any both each few more
  most other some such than that this these those them they their what
  which who whom whose when where why how about after again against before
  between during from into through under over out off then once here there
  very just also only even ever still just own same such both into onto
  your our my her his its your i me my mine
  with like well back away come came goes went gone
  week year years work works word words used uses take took
  part parts case cases help helps look looks seem seems
  want wants need needs give gave make made says said`.split(/\s+/)
);

/** Short vague evaluators — flag when repeated, not when they appear once. */
const VAGUE_REPEAT_WATCH = [
  "good",
  "bad",
  "nice",
  "fine",
  "real",
  "sure",
  "big",
  "old",
  "new",
];

/**
 * Exact-word repetition in passage (length bounds reduce noise).
 * Surfaces "same plain word many times" for the model without a stemmer.
 * Includes 4-letter content words so repeats like *good*×3 surface for the model.
 */
function repetitionSummary(text) {
  const lower = text.toLowerCase();
  const counts = new Map();
  const re = /\b[a-z]{4,14}\b/g;
  let m;
  while ((m = re.exec(lower)) !== null) {
    const w = m[0];
    if (REPETITION_STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const reps = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16);
  const repWords = new Set(reps.map(([w]) => w));
  const vagueHits = [];
  for (const w of VAGUE_REPEAT_WATCH) {
    const n = (lower.match(new RegExp(`\\b${w}\\b`, "g")) || []).length;
    if (n < 2) continue;
    if (repWords.has(w)) continue;
    vagueHits.push(`"${w}"×${n} (vague / thin if repeated—consider one vocabulary item)`);
  }
  const main =
    reps.length > 0
      ? reps.map(([w, c]) => `"${w}"×${c}`).join(", ")
      : "(No general content words repeat ≥2× after filtering — still scan for spelling and thin evaluative words.)";
  if (!vagueHits.length) return main;
  return `${main}\nThin / evaluative repeats: ${vagueHits.join("; ")}`;
}

/** True if two surface forms are likely the same lemma (snark / snarky, run / runs). */
function sameMorphFamily(termA, termB) {
  const a = String(termA || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const b = String(termB || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(short)) return false;
  if (short.length < 4) return false;
  const extra = long.slice(short.length);
  if (extra.length === 0) return true;
  if (extra.length > 5) return false;
  const suffixes = [
    "ingly",
    "edly",
    "ness",
    "ment",
    "tion",
    "ally",
    "ies",
    "ing",
    "ous",
    "ive",
    "ful",
    "est",
    "ed",
    "es",
    "ly",
    "er",
    "s",
    "y",
  ];
  return suffixes.includes(extra);
}

/** Merge vocabulary rows that differ only by inflection (model split snark vs snarky). */
function mergeMorphologicalFamilies(items, text) {
  const n = items.length;
  if (n <= 1) return items;
  const parent = [...Array(n).keys()];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) parent[pi] = pj;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameMorphFamily(items[i].term, items[j].term)) union(i, j);
    }
  }
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(items[i]);
  }
  return [...buckets.values()].map((cluster) => mergeVocabCluster(cluster, text));
}

function mergeVocabCluster(cluster, text) {
  cluster.sort((a, b) => b.term.length - a.term.length);
  const synSet = new Set();
  const reasons = [];
  const defs = [];
  const notes = [];
  const rewrites = [];
  let term = cluster[0].term;
  for (const c of cluster) {
    (c.synonyms || []).forEach((s) => synSet.add(String(s).trim()));
    if (c.reason) reasons.push(c.reason);
    if (c.definition) defs.push(c.definition);
    if (c.pedagogicalNote) notes.push(c.pedagogicalNote);
    if (c.optionalRewrite) rewrites.push(c.optionalRewrite);
    if (text.includes(c.term) && c.term.length >= term.length) term = c.term;
  }
  const head = cluster[0];
  return {
    ...head,
    term,
    synonyms: [...synSet].filter(Boolean).slice(0, 4),
    reason: reasons.join(" ").slice(0, 450) || head.reason,
    definition: defs[0] || head.definition,
    pedagogicalNote: notes.join(" ").slice(0, 500) || head.pedagogicalNote,
    optionalRewrite: rewrites[0] || head.optionalRewrite,
  };
}

/** Drop model items that are usually fine phrasing in news / tech copy. */
function filterLowValueVocabularyItems(items) {
  const banned = [
    (t) => /\bsocial\s+media\b/i.test(t),
    (t) => /\bai[\s-]?generated\b/i.test(t),
    (t) => /\blego\b/i.test(t),
    (t) => /^x$/i.test(t),
    (t) => /regime[\s-]*change/i.test(t),
  ];
  return items.filter((it) => {
    const t = String(it.term || "").trim();
    if (!t) return false;
    const lower = t.toLowerCase();
    if (banned.some((fn) => fn(lower))) return false;
    return true;
  });
}

/** Lowercase letter tokens from a flagged term (handles "President Trump", "U.S."). */
function bareTokensFromTerm(term) {
  return String(term || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

const LEADER_SURNAMES = new Set(
  [
    "trump", "biden", "harris", "pence", "obama", "clinton", "bush", "reagan",
    "putin", "zelensky", "zelenskyy", "netanyahu", "khamenei", "rouhani",
    "macron", "merkel", "scholz", "xi", "jinping", "modi", "trudeau", "meloni",
    "sunak", "starmer", "musk",
  ]
);

const DEMONYMS = new Set(
  [
    "iranian", "american", "israeli", "palestinian", "saudi", "iraqi", "syrian",
    "lebanese", "yemeni", "egyptian", "jordanian", "kuwaiti", "qatari", "emirati",
    "russian", "ukrainian", "chinese", "japanese", "korean", "taiwanese",
    "vietnamese", "british", "french", "german", "italian", "spanish", "turkish",
    "polish", "canadian", "mexican", "brazilian", "indian", "pakistani", "afghan",
    "kurdish", "armenian", "azerbaijani", "nigerian", "ethiopian", "somali",
    "sudanese", "libyan", "tunisian", "algerian", "moroccan", "european", "asian",
    "african", "arab", "jewish", "muslim", "christian", "catholic", "orthodox",
  ]
);

/** Country / region tokens — not synonym drills in straight news. */
const GEO_PROPER = new Set(
  [
    "iran", "israel", "china", "russia", "ukraine", "syria", "iraq", "yemen",
    "lebanon", "qatar", "kuwait", "oman", "bahrain", "egypt", "jordan", "india",
    "pakistan", "afghanistan", "turkiye", "palestine", "gaza", "tehran",
    "jerusalem", "hormuz", "pentagon", "nato", "washington", "kremlin",
  ]
);

/**
 * Literal defense / trade / shipping nouns in foreign-affairs reporting — not
 * weak diction when used once in context (e.g. blockade, waterway).
 */
const MECHANICAL_NEWS_TERMS = new Set(
  [
    "blockade", "embargo", "sanctions", "tariff", "naval", "navy", "army", "marine",
    "fleet", "warship", "convoy", "waterway", "strait", "cargo", "seaborne",
    "transited", "transit", "ports", "port", "sovereign", "diplomatic", "embassy",
    "outpost", "waters", "missile", "drone", "troops", "invasion", "combat",
  ]
);

/** Single-token school / discipline names — not “vague” diction when naming a field of study. */
const SCHOOL_SUBJECT_LEXEMES = new Set(
  [
    "chemistry",
    "biology",
    "physics",
    "mathematics",
    "math",
    "algebra",
    "geometry",
    "calculus",
    "statistics",
    "economics",
    "psychology",
    "sociology",
    "anthropology",
    "linguistics",
    "philosophy",
    "history",
    "literature",
    "geography",
    "engineering",
    "medicine",
    "neuroscience",
    "biochemistry",
    "microbiology",
    "astronomy",
    "ecology",
    "genetics",
    "immunology",
    "pathology",
    "pharmacology",
    "epidemiology",
    "informatics",
    "robotics",
    "aeronautics",
  ]
);

function filterSchoolSubjectLexemes(items) {
  return items.filter((it) => {
    const t = String(it.term || "").trim();
    if (!t || /\s/.test(t)) return true;
    const w = t.toLowerCase().replace(/[^a-z]/g, "");
    return !SCHOOL_SUBJECT_LEXEMES.has(w);
  });
}

/** Remove person names, demonyms, geography, and mechanical news jargon the model should never flag. */
function filterProperAndNewsTerms(items) {
  return items.filter((it) => {
    const raw = String(it.term || "").trim();
    if (!raw) return false;
    if (/^(mr|mrs|ms|dr|sen|rep)\.?\s+/i.test(raw)) return false;

    const parts = bareTokensFromTerm(raw);
    if (!parts.length) return false;

    for (const p of parts) {
      if (LEADER_SURNAMES.has(p)) return false;
      if (DEMONYMS.has(p)) return false;
      if (GEO_PROPER.has(p)) return false;
    }

    if (parts.length === 1 && MECHANICAL_NEWS_TERMS.has(parts[0])) return false;

    if (parts.length > 1) {
      const onlyNewsJargon = parts.every(
        (p) =>
          MECHANICAL_NEWS_TERMS.has(p) ||
          GEO_PROPER.has(p) ||
          LEADER_SURNAMES.has(p) ||
          DEMONYMS.has(p)
      );
      if (onlyNewsJargon) return false;
    }

    return true;
  });
}

/** Clean model output when analyzing noisy Google Doc DOM (menus, etc.). */
function filterLikelyUiTerms(items) {
  const junk = new Set(
    [
      "file",
      "edit",
      "view",
      "insert",
      "format",
      "tools",
      "help",
      "share",
      "undo",
      "redo",
      "zoom",
      "tab",
      "tabs",
    ].map((s) => s.toLowerCase())
  );
  return items.filter((it) => {
    const t = it.term.toLowerCase().replace(/[^a-z]/g, "");
    if (t.length <= 1) return false;
    if (junk.has(it.term.toLowerCase())) return false;
    return true;
  });
}

function grammarDictionaryBlock(grammarDictionary) {
  const list = Array.isArray(grammarDictionary)
    ? grammarDictionary.slice(0, 36)
    : [];
  const lines = list
    .map((e) => {
      const w = String(e.wrong || e.wrongForm || "").trim().slice(0, 120);
      const r = String(e.right || e.correct || "").trim().slice(0, 120);
      const n = String(e.note || "").trim().slice(0, 160);
      const rule = String(e.rule || "").trim().slice(0, 120);
      if (!w && !r) return null;
      const wq = w.replace(/"/g, "'");
      const rq = r.replace(/"/g, "'");
      const nq = n.replace(/"/g, "'");
      if (rule) {
        const ex = r ? `“${wq}” → “${rq}”` : `“${wq}”`;
        const tail = n ? ` (${nq})` : "";
        return `- **${rule.replace(/"/g, "'")}**: ${ex}${tail}`;
      }
      const a = w ? `watch for “${wq}”` : "";
      const b = r ? ` → “${rq}”` : "";
      const c = n ? ` (${nq})` : "";
      return `- ${a}${b}${c}`;
    })
    .filter(Boolean);
  if (!lines.length) {
    return "User personal grammar notes: (none on file — skip inventing rules.)";
  }
  return `User personal grammar / usage dictionary (apply when you see these patterns; do not contradict unless clearly wrong in context):\n${lines.join("\n")}`;
}

function buildPromptCleanPassage(
  text,
  writingLevel,
  textAcquisition,
  writingGoals,
  pieceContext,
  grammarDictionary
) {
  const len = text.replace(/\s+/g, " ").trim().length;
  const isDocScrape = textAcquisition === "google_doc_body";

  const docWarning = isDocScrape
    ? "The passage may include Google Docs menus, toolbar labels, or sidebar UI mixed with real prose. IGNORE menu words (File, Edit, View, Share, etc.). Only flag words that appear inside actual sentences. If the excerpt is mostly UI, return {\"items\":[]}."
    : "";

  const countRules = isDocScrape
    ? "Return at most **5** distinct issues (prefer fewer). Only obvious weak diction in real sentences—not vivid journalism, not quoted-voice color."
    : `Longer passages: aim for **2–5** distinct issues; **hard maximum 6**. Competent news/analysis: bias toward **2–4** or even **0–2** if the prose is already tight. Short excerpts (under about 400 characters): at most **3** issues unless the text is clearly padded. Prefer **silence over nitpicks**.
If the passage is already **clear, specific, and well-suited** to its genre, return **{"items":[]}** with **zero** items—do **not** invent marginal critiques or “synonyms” for strong, conventional phrasing (including fixed political/journalistic compounds).`;

  const goalsBlock = goalsGuidance(writingGoals);
  const pieceBlock = pieceContextBlock(pieceContext);
  const repLine = repetitionSummary(text);
  const grammarUserBlock = grammarDictionaryBlock(grammarDictionary);

  return `You are a pedagogical writing mentor. Return ONLY valid JSON (no markdown).

Writing level (rubric): ${writingLevel}
${levelGuidance(writingLevel)}

${pieceBlock}

Writer goals (shape synonyms and notes accordingly):
${goalsBlock}

${grammarUserBlock}

Repetition signal (exact tokens; heuristic — use judgment):
${repLine}
Prioritize issues where the **same plain word** appears multiple times and variety or precision would help the **author/narrator voice** (mention repetition in reason when relevant). Do **not** flag a word just because it appears here if it is geographic, institutional, technical, or a fixed phrase.
If the signal includes **Thin / evaluative repeats**, treat that as a strong cue: add **one** vocabulary **items** row for that word (per rule 11) unless the passage is clearly quoted speech where repetition is deliberate.

${docWarning}

Passage (${len} characters; analyze this excerpt only):
"""
${text}
"""

You have **three** jobs in one JSON object:
**(A) Vocabulary / diction** — put in **items** only (not grammar or spelling).
**(B) Spelling & obvious typos** — put in **spellingItems** only (misspelled words, keyboard garbage, wrong letter runs — not grammar agreement or punctuation).
**(C) Grammar, agreement, punctuation, and sentence flow** — put in **grammarItems** only. Do **not** duplicate the same token or mistake across **items**, **spellingItems**, and **grammarItems**.

Return JSON shape:
{"items":[...],"spellingItems":[{"term":"","issue":"","fix":"","flowTip":""}],"grammarItems":[{"term":"","issue":"","fix":"","flowTip":""}],"grammarFlow":""}

- **spellingItems**: at most **5** rows. **term** = exact misspelled or nonsense token from the passage. **issue** = short label such as \`Spelling\` or \`Typo\`; **fix** = corrected word when clear else a brief hint; **flowTip** optional. **Never** put spelling here if the token is a proper name, intentional slang, or a technical term you are unsure about.
- **grammarItems**: at most **4** real issues (no spelling — use **spellingItems**). Each **term** must be an **exact** substring (agreement, tense, punctuation, run-on, etc.). **issue** = short rule; **fix** = corrected wording or "" if stylistic; **flowTip** optional.
- **grammarFlow**: one sentence on overall cohesion / sentence variety / clarity (can briefly praise strong flow). If **grammarItems**, **spellingItems**, and **items** are all empty, **grammarFlow** must be one short encouraging sentence (never leave **grammarFlow** blank when all three lists are empty).
- If grammar and flow are already **strong** for this level, return **grammarItems: []** — do not invent grammar nits.
- **Morphology**: do **not** list the same lemma twice in **items** (e.g. *snark* and *snarky* → one item only, using the surface form that best matches the passage).

Rules (vocabulary / **items**):
1) ${countRules}
2) Each item: reason, learner-friendly definition, **2–4** strong synonyms (not a long thesaurus list), pedagogicalNote, optionalRewrite (one sentence or "").
3) Never list the same "term" twice (case-insensitive).
4) Do NOT flag: articles, bare prepositions/pronouns, digits, URLs, or **standard compounds / modifiers** that readers expect (e.g. *social media*, *AI-generated*, *-powered*, *-based*), **product + generic noun** vivid references (*Lego characters*), platform names in quoted posts, **one-off** concrete imagery that is already specific, or **stock political / news phrases** that are already precise (*regime change*, *regime change war*, *war footing*, *fact pattern*, etc.).
5) Do NOT invent terms that are not in the passage.
6) Synonyms and optionalRewrite MUST respect the piece/genre context when specified.
7) For **strong default verbs** (*force*, *drive*, *set*, *make*): flag **only** if repetition, vague collocation, or softening hurts the line—not a single crisp news use.
8) When the passage mixes **quoted voice** (snark, dialogue) with **reporter voice**, only flag diction that weakens the **reporter** unless the quoted line is genuinely confusing.
9) **Never** return an item for: **people’s names or surnames** (Trump, Biden, …), **demonyms** (Iranian, American, Israeli, …), **country / capital / region names** used literally (Iran, Israel, Hormuz, …), or **standard defense / maritime / sanctions vocabulary** in news (*blockade*, *embargo*, *navy*, *waterway*, *strait*, *cargo*, *sanctions*, …). These are not “find a synonym” exercises when used in their ordinary sense.
10) Do **not** flag **course / discipline names** that simply name the subject of study (*chemistry*, *biology*, *algebra*, *physics*, …) as “vague,” “repetitive,” or needing synonyms—especially when the piece is about school, research, or a major. Using the field name twice (e.g. *chemistry* and *chemistry research*) is normal, not a diction problem.
11) If the **repetition signal** (or plain reading) shows the **same vague evaluator** (*good*, *nice*, *bad*, *fine*, *real*, …) **two or more times** in a short passage, include **one** vocabulary **items** row for that word: explain how repetition flattens praise, and give **2–4** stronger, context-appropriate substitutes writers could rotate (*sound*, *solid*, *rigorous*, *compelling*, … for academic praise—not generic “positive” filler).

Rules (**grammarItems** only):
G1) Subject–verb agreement, pronoun reference, wrong article, tense shifts, fused commas, run-ons, fragments **when clearly wrong** — not optional style splits.
G2) Do not move vocabulary weak-word work into grammarItems or spellingItems.
G3) Prefer **empty grammarItems** when the passage is already clean.
G4) For **one** agreement or tense mistake, use **one** grammarItems row whose **term** is the **shortest contiguous span** that shows the error together (e.g. \`She are\`, \`they is\`) — **not** separate rows for the pronoun and the verb alone.
G5) Never put the same mistake in **grammarItems**, **spellingItems**, and **items** (no vocabulary “synonyms” for words that are only wrong grammatically or misspelled).
G6) When the fix is agreement or tense, **fix** should usually give the **correct little phrase** (e.g. \`She is\`), not only a bare verb like \`is\`.

Rules (**spellingItems** only):
S1) Only **orthography**: wrong letters, missing letters, doubled letters, or obvious **non-words** / keyboard noise — not word-choice or “sounds informal.”
S2) **One row per distinct misspelled token**; **term** must match the passage exactly (case-sensitive match to the passage substring).
S3) Do **not** put spelling rows in **grammarItems** or **items**.
`;
}

function buildPrompt(
  text,
  writingLevel,
  textAcquisition,
  writingGoals,
  pieceContext,
  grammarDictionary
) {
  return buildPromptCleanPassage(
    text,
    writingLevel,
    textAcquisition,
    writingGoals,
    pieceContext,
    grammarDictionary
  );
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} [p.model]
 * @param {string} p.text
 * @param {string} p.writingLevel
 * @param {object[]} p.heuristicHits unused (AI-only)
 * @param {string} [p.textAcquisition] selection | clipboard | google_doc_body | focused_field | context_menu
 * @param {string[]} [p.writingGoals] onboarding goal ids (vocabulary, pedagogy, patterns, practice)
 * @param {string} [p.pieceContext] genre / task description for this draft (email, lab report, etc.)
 * @param {object[]} [p.grammarDictionary] { wrong, right, note } from extension storage
 */
export async function enrichWithGroq({
  apiKey,
  model,
  text,
  writingLevel,
  heuristicHits: _heuristicHits,
  textAcquisition = "selection",
  writingGoals = [],
  pieceContext = "",
  grammarDictionary = [],
}) {
  const m =
    model ||
    process.env.GROQ_MODEL ||
    "llama-3.1-8b-instant";

  const passageCap = groqPassageCharCap();
  const textForModel =
    text.length <= passageCap ? text : text.slice(0, passageCap);
  const maxTokens = groqMaxOutputTokens();

  const prompt = buildPrompt(
    textForModel,
    writingLevel,
    textAcquisition,
    writingGoals,
    pieceContext,
    grammarDictionary
  );
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
      temperature: textAcquisition === "google_doc_body" ? 0.15 : 0.38,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      body?.error?.message || body?.message || `Groq HTTP ${res.status}`;
    throw new Error(err);
  }

  const raw = body?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Groq returned empty content");

  const parsed = JSON.parse(stripJsonFence(raw));
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  let out = items
    .map((it) => ({
      term: String(it.term || "").trim(),
      reason: String(it.reason || "").trim(),
      definition: String(it.definition || "").trim(),
      synonyms: Array.isArray(it.synonyms)
        ? it.synonyms.map((s) => String(s).trim()).filter(Boolean)
        : [],
      pedagogicalNote: String(it.pedagogicalNote || "").trim(),
      optionalRewrite: String(it.optionalRewrite || "").trim(),
    }))
    .filter((it) => it.term.length > 0);

  const seen = new Set();
  out = out.filter((it) => {
    const k = it.term.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  out = out.filter((it) => {
    const term = String(it.term || "").trim();
    if (!term) return false;
    if (textForModel.includes(term)) return true;
    return textForModel.toLowerCase().includes(term.toLowerCase());
  });

  out = mergeMorphologicalFamilies(out, textForModel);
  const seen2 = new Set();
  out = out.filter((it) => {
    const k = it.term.toLowerCase();
    if (seen2.has(k)) return false;
    seen2.add(k);
    return true;
  });

  if (textAcquisition === "google_doc_body") {
    out = filterLikelyUiTerms(out);
  }

  out = filterLowValueVocabularyItems(out);
  out = filterProperAndNewsTerms(out);
  out = filterSchoolSubjectLexemes(out);

  for (const it of out) {
    if (Array.isArray(it.synonyms) && it.synonyms.length > 4) {
      it.synonyms = it.synonyms.slice(0, 4);
    }
  }

  const MAX_ITEMS = 6;
  if (out.length > MAX_ITEMS) out = out.slice(0, MAX_ITEMS);

  const grammarFlow = String(
    parsed.grammarFlow || parsed.grammarSummary || ""
  ).trim().slice(0, 450);

  const SPELLING_ISSUE =
    /spelling|typo|misspell|orthograph|non-?word|keyboard/i;

  let grammarOut = Array.isArray(parsed.grammarItems)
    ? parsed.grammarItems
    : [];
  grammarOut = grammarOut
    .map((g) => ({
      term: String(g.term || g.snippet || "").trim(),
      issue: String(g.issue || g.reason || "").trim(),
      fix: String(g.fix || g.correction || "").trim(),
      flowTip: String(g.flowTip || "").trim(),
    }))
    .filter((g) => {
      if (!g.term) return false;
      if (textForModel.includes(g.term)) return true;
      return textForModel.toLowerCase().includes(g.term.toLowerCase());
    });

  const spellingMigrated = [];
  grammarOut = grammarOut.filter((g) => {
    if (SPELLING_ISSUE.test(g.issue)) {
      spellingMigrated.push({
        ...g,
        issue: g.issue || "Spelling",
      });
      return false;
    }
    return true;
  });

  let spellingOut = Array.isArray(parsed.spellingItems)
    ? parsed.spellingItems
    : [];
  spellingOut = spellingOut
    .map((g) => ({
      term: String(g.term || g.snippet || "").trim(),
      issue: String(g.issue || g.reason || "Spelling").trim(),
      fix: String(g.fix || g.correction || "").trim(),
      flowTip: String(g.flowTip || "").trim(),
    }))
    .filter((g) => {
      if (!g.term) return false;
      if (textForModel.includes(g.term)) return true;
      return textForModel.toLowerCase().includes(g.term.toLowerCase());
    });

  const spellByKey = new Map();
  for (const s of [...spellingMigrated, ...spellingOut]) {
    const k = s.term.toLowerCase();
    if (!spellByKey.has(k)) spellByKey.set(k, s);
  }
  spellingOut = [...spellByKey.values()].slice(0, 6);
  grammarOut = grammarOut.slice(0, 5);

  return {
    items: out,
    spellingItems: spellingOut,
    grammarItems: grammarOut,
    grammarFlow,
    passageTruncated: text.length > textForModel.length,
    passageAnalyzedChars: textForModel.length,
  };
}

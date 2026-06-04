import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, api } from "../lib/api";
import {
  COACH_PAUSE_MS,
  COACH_POLL_MS,
  MIN_COACH_CHARS,
  useLiveCoach,
} from "../hooks/useLiveCoach";
import "./Write.css";

function hashSuggestion(parts) {
  const text = parts.join("|");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

/**
 * Returns true when a suggestion card no longer applies to the current draft.
 *
 * Strategy by card type:
 *  - Word-level cards (Spelling, Typo, Apostrophe, Possible split, Unrecognized word,
 *    Letter extension): the first quoted phrase in the title IS the wrong form —
 *    hide the card once that exact text is gone from the draft.
 *  - Multi-word Grammar/Phrase corrections ("should of", "your welcome"): same —
 *    single-word grammar confusions ("their") are intentionally left alone because
 *    the word might still appear elsewhere used correctly.
 *  - Repeated word: re-check the specific word still appears back-to-back (2+ times).
 *  - Structural cards (comma splice, extra spaces, etc.): re-run the lightweight
 *    pattern inline so the card disappears as soon as the issue is resolved.
 */
function isCardStale(s, content) {
  const titleStr = s.title || "";

  // Repeated-word check needs its own regex rather than a plain word search.
  if (/^Repeated word:/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,60})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`\\b${esc}\\b(?:\\s+\\b${esc}\\b){1,}`, "i").test(content);
    }
  }

  // Word-level cards: quoted phrase = the exact wrong token → stale when gone.
  if (/^(?:Spelling|Typo|Missing apostrophe|Possible split|Unrecognized word|Letter extension|Capitalization):/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,80})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b${esc}\\b`, "i").test(content)) return true;
    }
  }

  // Multi-word Grammar / Phrase corrections: only check when the quoted segment
  // contains a space (single-word confusions like "their" might still appear
  // correctly elsewhere, so we leave those alone).
  if (/^(?:Grammar|Phrase):/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,60})[\u201D"]/);
    if (qm?.[1] && /\s/.test(qm[1])) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(esc, "i").test(content)) return true;
    }
  }

  // Structural cards — re-run the lightweight pattern.
  if (/extra spaces/i.test(titleStr)) return !content.includes("  ");
  if (/comma splice/i.test(titleStr)) {
    return ![
      /,\s+(?:I\b|(?:he|she|they|we|it|nobody|everyone|somebody|someone|anyone|no\s+one)\s)/i,
      /\b[^.!?\n]{6,},\s+[a-z]+\s+(?:i|you|we|they|he|she|it)\b/i,
    ].some((p) => p.test(content));
  }
  if (/repeated punctuation/i.test(titleStr)) return !/[!?]{2,}|\.{4,}/.test(content);
  if (/question phrasing/i.test(titleStr)) {
    return !/\b(?:friend|they|she|he)\s+asks?\b(?![^.!?\n]*\?)/gi.test(content);
  }
  if (/lowercase letter after sentence/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,80})[\u201D"]/);
    if (qm?.[1]) {
      // New format: stale when this specific word no longer follows terminal punctuation.
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`[.!?]\\s+${esc}\\b`, "i").test(content);
    }
    return !/[.!?]\s+[a-z]/.test(content);
  }
  if (/uncapitalized/i.test(titleStr)) {
    return !/(?:^|\s)i(?=\s|[',;.!?]|$)/m.test(content);
  }
  if (/subject.{0,5}verb agreement/i.test(titleStr)) {
    // Re-run whichever agreement pattern this card matched.
    if (/plural pronoun/i.test(titleStr))
      return !/\b(?:they|we|you)\s+(?:was|is)\b/i.test(content);
    if (/singular subject/i.test(titleStr))
      return !/\b(?:it|he|she|everyone|someone|anyone|nobody|nothing|everything)\s+are\b/i.test(content) &&
             !/\b(?:this|that)\s+(?:\w+\s+)?are\b/i.test(content);
    if (/plural subject/i.test(titleStr))
      return !/\b(?:[a-z]+nts|[a-z]+nds|[a-z]+cts|[a-z]+rds|[a-z]+lts)\s+was\b/i.test(content);
    // Fallback: original "there is many" check
    return !/\bthere\s+is\s+(?:so\s+)?many\b/i.test(content);
  }
  if (/^Missing apostrophe:/i.test(titleStr)) {
    // Stale when the exact unformatted contraction is gone from the draft.
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,30})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`\\b${esc}\\b`, "i").test(content);
    }
  }
  // Snippet-titled punctuation cards: stale once the specific quoted snippet
  // is gone from the draft (each occurrence gets its own card now).
  if (/semicolon before conjunction/i.test(titleStr) ||
      /semicolon after subordinate clause/i.test(titleStr) ||
      /missing comma after introductory clause/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{3,})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(esc, "i").test(content);
    }
    return false;
  }
  // its/it's, your/you're, were/we're confusion cards: stale once the
  // quoted error phrase is no longer present in the draft.
  if (/apostrophe confusion/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{2,40})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`\\b${esc}\\b`, "i").test(content);
    }
    return false;
  }
  if (/word confusion.*sentence start/i.test(titleStr)) {
    return !/(?:^|[.!?\n]\s*)[Ww]ere\s+[a-z]+ing\b/.test(content);
  }
  if (/stretched word/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{2,30})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`\\b${esc}\\b`, "i").test(content);
    }
    return false;
  }
  // Missing-word cards: stale once the quoted erroneous phrase is gone.
  if (/missing preposition|missing auxiliary|missing words|missing comparative/i.test(titleStr)) {
    const qm = titleStr.match(/[\u201C"]([^\u201D"]{2,50})[\u201D"]/);
    if (qm?.[1]) {
      const esc = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(esc, "i").test(content);
    }
    return false;
  }
  // "Possible run-on sentence: …" cards — stale when the specific snippet in
  // the title is gone, OR when no run-on segments remain using the same logic
  // as the backend (pronoun/conjunction ratio + verb-subject adjacency).
  if (/possible run-on/i.test(titleStr)) {
    // First check: if the card has a quoted snippet, verify it's still in the draft.
    const snippetMatch = titleStr.match(/[\u201C"]([^\u201D"]{3,})[\u201D"]/);
    if (snippetMatch?.[1]) {
      const esc = snippetMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(esc, "i").test(content)) return true;
    }
    // Second check: re-run the same detection logic as the backend.
    const segs = content.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
    const stillPresent = segs.some((seg) => {
      const tr = seg.trim();
      const wc = tr.split(/\s+/).length;
      if (wc < 8 || wc > 45) return false;
      if (/[,;]/.test(tr)) return false;
      const conjCount = (tr.match(/\b(?:and|but|or|so|nor|yet|because|although|while|since|if|when|that|which|who|whom|however|therefore|though)\b/gi) || []).length;
      const pronounHits = (tr.match(/\b(?:I|he|she|we|they|you|it|nobody|everyone|someone|anyone)\b/gi) || []);
      if (pronounHits.length >= Math.max(2, conjCount + 2)) return true;
      return /\b(?:[a-z]+ed|went|came|got|told|saw|heard|felt|knew|left|ran|fell|sat|stood|woke|found|lost|won|brought|caught|stopped|ended|finished|started)\s+(?:I|he|she|we|they|you|it|nobody|everyone|someone)\b/i.test(tr);
    });
    return !stillPresent;
  }

  return false; // default: keep showing
}

/**
 * Finds the {start, end} character range of the text a suggestion refers to.
 *
 * Most cards: extract the first smart-quoted phrase from the title and locate
 * it with a plain case-insensitive search.
 *
 * Special cases where a plain search would land on the wrong occurrence:
 *  - "Lowercase letter after sentence end: …" — the word must be preceded by
 *    terminal punctuation so we skip correctly-capitalized earlier occurrences.
 *  - "Uncapitalized "I"" — must find standalone lowercase "i", not the
 *    correctly-capitalised pronoun that appears everywhere else.
 */
function findHighlightRange(suggestion, content) {
  const titleStr = suggestion?.title || "";
  const qm = titleStr.match(/[\u201C"]([^\u201D"]{1,80})[\u201D"]/);
  if (!qm?.[1]) return null;
  const phrase = qm[1];

  // "Lowercase letter after sentence end: "word"" — anchor after [.!?].
  // No case-insensitive flag: the phrase is already lowercase, and we must NOT
  // match the correctly-capitalised form that appears earlier in the text.
  if (/^Lowercase letter after sentence end/i.test(titleStr)) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`[.!?]\\s+(${esc})\\b`).exec(content);
    if (!m) return null;
    const start = m.index + m[0].length - m[1].length;
    return { start, end: start + phrase.length };
  }

  // "Uncapitalized "I"" — find standalone lowercase i, not the correct form
  if (/^Uncapitalized/i.test(titleStr)) {
    const m = /(?:^|[ \t\n])(i)(?=[ \t\n',;.!?]|$)/m.exec(content);
    if (!m) return null;
    const start = m.index + m[0].length - 1;
    return { start, end: start + 1 };
  }

  // Default: first case-insensitive occurrence
  const idx = content.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx === -1) return null;
  return { start: idx, end: idx + phrase.length };
}

function suggestionToFeedbackRecord(docId, suggestion, idx) {
  const category = String(suggestion?.type || "").trim().toLowerCase() || "coaching";
  const issue = String(suggestion?.title || "").trim() || "Suggestion";
  const why = String(suggestion?.body || "").trim();
  const micro = String(suggestion?.micro_edit || "").trim();
  const cardId = `web-${hashSuggestion([docId, category, issue, why, micro, String(idx)])}`;
  return {
    cardId,
    category,
    issue,
    why,
    fixOptions: micro ? [micro] : [],
  };
}

export default function Write() {
  const { user, loading: authLoading, sessionReady, signInWithGoogle } = useAuth();
  const [googleError, setGoogleError] = useState(null);
  const canUseBackend = Boolean(user && sessionReady);

  const [documents, setDocuments] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [topError, setTopError] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const lastSyncedCoachAtRef = useRef(null);
  const [decisionByCardId, setDecisionByCardId] = useState({});
  const [savingDecisionByCardId, setSavingDecisionByCardId] = useState({});

  // Highlight overlay state.
  //   activeHighlight  — the range pinned by clicking a correction card.
  //   hoverHighlight   — the transient range while the mouse is over a card.
  // The displayed highlight is `hoverHighlight ?? activeHighlight`, so a
  // hover always wins, but the pinned highlight comes back when the mouse
  // leaves. Shape for both: { cardId, start, end } | null.
  const [activeHighlight, setActiveHighlight] = useState(null);
  const [hoverHighlight, setHoverHighlight] = useState(null);
  const displayedHighlight = hoverHighlight ?? activeHighlight;
  const textareaRef = useRef(null);
  const highlightLayerRef = useRef(null);

  const loadList = useCallback(async () => {
    if (!canUseBackend) return;
    setListLoading(true);
    setTopError(null);
    try {
      const data = await api.documents.list();
      setDocuments(data.documents || []);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unknown_error";
      setTopError(`Could not load documents (${code}).`);
    } finally {
      setListLoading(false);
    }
  }, [canUseBackend]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const {
    saveState,
    coachPhase,
    suggestions,
    retrievedChunks,
    profileSnapshot,
    lastCoachAt,
    coachError,
    resetCoachState,
    markSaved,
    bumpCoachGeneration,
  } = useLiveCoach({
    enabled: canUseBackend,
    currentId,
    title,
    content,
    onSave: loadList,
  });

  const visibleSuggestionCount = useMemo(() => {
    if (!currentId) return 0;
    return suggestions.filter((s, i) => {
      const record = suggestionToFeedbackRecord(currentId, s, i);
      if (decisionByCardId[record.cardId] === "declined") return false;
      if (isCardStale(s, content)) return false;
      return true;
    }).length;
  }, [suggestions, currentId, content, decisionByCardId]);

  useEffect(() => {
    // Load persisted decisions from localStorage when switching documents,
    // so declined suggestions stay hidden across page refreshes and doc switches.
    if (!currentId) {
      setDecisionByCardId({});
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem(`writeup-decisions-${currentId}`) || "{}");
        setDecisionByCardId(stored);
      } catch {
        setDecisionByCardId({});
      }
    }
    setSavingDecisionByCardId({});
  }, [currentId]);

  useEffect(() => {
    if (!canUseBackend || !currentId || !lastCoachAt || coachPhase !== "ready") return;
    if (lastSyncedCoachAtRef.current === lastCoachAt) return;
    lastSyncedCoachAtRef.current = lastCoachAt;
    void api.markCoachSession().catch(() => {
      // Profile snapshot updates are best-effort; do not block writing flow.
    });
  }, [canUseBackend, currentId, lastCoachAt, coachPhase]);

  // When the displayed highlight changes, scroll the textarea to reveal it.
  // We measure the <mark>'s actual rendered offsetTop inside the highlight
  // layer rather than computing `newlines * lineHeight`, because the latter
  // only counts hard newlines and silently mis-positions long word-wrapped
  // paragraphs. Reading offsetTop works correctly for wrapped text because
  // the browser has already laid out the visual lines.
  useEffect(() => {
    const target = hoverHighlight ?? activeHighlight;
    if (!target || !textareaRef.current || !highlightLayerRef.current) return;
    const layer = highlightLayerRef.current;
    const textarea = textareaRef.current;
    const mark = layer.querySelector(".write-highlight-mark");
    if (!mark) return;
    const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
    const targetScrollTop = Math.max(
      0,
      mark.offsetTop - textarea.clientHeight / 3 + lineHeight / 2,
    );
    textarea.scrollTop = targetScrollTop;
    layer.scrollTop = targetScrollTop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHighlight, hoverHighlight]);

  // Clear both pinned and hover highlights whenever the document text changes
  // (user typing, switching documents, or an auto-applied accept fix). The
  // stored ranges would otherwise point at the wrong characters.
  useEffect(() => {
    setActiveHighlight(null);
    setHoverHighlight(null);
  }, [content]);

  const handleSuggestionDecision = useCallback(
    async (suggestion, idx, decision) => {
      if (!canUseBackend || !currentId) return;
      const record = suggestionToFeedbackRecord(currentId, suggestion, idx);
      if (savingDecisionByCardId[record.cardId]) return;
      if (decisionByCardId[record.cardId] === decision) return;

      // Auto-apply the suggested fix to the document text when accepting a
      // spelling / typo / contraction card that has a micro_edit.
      if (decision === "accepted" && suggestion.micro_edit) {
        const titleStr = suggestion.title || "";
        const isAutoFixable = /^(?:Spelling|Typo|Missing apostrophe|Phrase|Grammar|Capitalization):/i.test(titleStr);
        if (isAutoFixable) {
          // Extract the original word/phrase from the quoted portion of the title
          const quotedMatch = titleStr.match(/[\u201C"]([^\u201D"]+)[\u201D"]/);
          if (quotedMatch?.[1]) {
            const original = quotedMatch[1];
            const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            setContent((prev) => prev.replace(new RegExp(escaped, "i"), suggestion.micro_edit));
          }
        }
      }

      setSavingDecisionByCardId((prev) => ({ ...prev, [record.cardId]: true }));
      try {
        await api.saveFeedback({ docId: currentId, ...record, decision });
        setDecisionByCardId((prev) => {
          const next = { ...prev, [record.cardId]: decision };
          // Persist decisions so they survive page refreshes and doc switches.
          try {
            localStorage.setItem(`writeup-decisions-${currentId}`, JSON.stringify(next));
          } catch {
            // localStorage may be unavailable in some environments; non-fatal.
          }
          return next;
        });
      } finally {
        setSavingDecisionByCardId((prev) => ({ ...prev, [record.cardId]: false }));
      }
    },
    [canUseBackend, currentId, decisionByCardId, savingDecisionByCardId],
  );

  const openDocument = useCallback(
    async (id) => {
      if (!canUseBackend) return;
      setTopError(null);
      bumpCoachGeneration();
      try {
        const doc = await api.documents.get(id);
        const body = String(doc.content || "");
        const docTitle = doc.title || "Untitled";
        setCurrentId(doc.id);
        setTitle(docTitle);
        setContent(body);
        markSaved(doc.id, docTitle, body);
        resetCoachState(body);
      } catch {
        setTopError("Could not open that document.");
      }
    },
    [canUseBackend, bumpCoachGeneration, markSaved, resetCoachState],
  );

  const deleteDocument = useCallback(
    async (id, event) => {
      event?.stopPropagation?.();
      if (!canUseBackend || deletingDocId) return;
      const doc = documents.find((d) => d.id === id);
      const titleLabel = doc?.title?.trim() || "Untitled";
      if (!window.confirm(`Delete "${titleLabel}"? This cannot be undone.`)) return;

      setDeletingDocId(id);
      setTopError(null);
      try {
        await api.documents.delete(id);
        try {
          localStorage.removeItem(`writeup-decisions-${id}`);
        } catch {
          /* non-fatal */
        }
        if (currentId === id) {
          setCurrentId(null);
          setTitle("");
          setContent("");
          resetCoachState("");
          bumpCoachGeneration();
        }
        await loadList();
      } catch (err) {
        const code = err instanceof ApiError ? err.code : "unknown_error";
        setTopError(`Could not delete document (${code}).`);
      } finally {
        setDeletingDocId(null);
      }
    },
    [
      canUseBackend,
      deletingDocId,
      documents,
      currentId,
      loadList,
      resetCoachState,
      bumpCoachGeneration,
    ],
  );

  const createDocument = useCallback(async () => {
    if (!canUseBackend) return;
    setTopError(null);
    try {
      const doc = await api.documents.create("Untitled");
      await loadList();
      await openDocument(doc.id);
    } catch {
      setTopError("Could not create a document.");
    }
  }, [canUseBackend, loadList, openDocument]);

  async function handleGoogleSignIn() {
    setGoogleError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = e?.code || (e instanceof Error ? e.message : "sign_in_failed");
      setGoogleError(code);
    }
  }

  const onSelectDoc = (id) => {
    if (id === currentId) return;
    void openDocument(id);
  };

  if (authLoading) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <p className="profile-page__lede">Checking session…</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <div className="profile-page__sign-in-shell">
            <header className="profile-page__sign-header">
              <p className="dashboard__eyebrow">Your writing workspace</p>
              <h2 className="profile-page__title">Write</h2>
              <p className="profile-page__lede">
                Sign in with Google to save drafts to your account and use live coaching.
              </p>
            </header>

            <div className="profile-page__sign-card">
              <button
                type="button"
                className="profile-page__submit dashboard__btn dashboard__btn--primary"
                onClick={handleGoogleSignIn}
              >
                Sign in with Google
              </button>
              <p className="profile-page__hint">You can also use Sign in in the top bar.</p>
              {googleError && (
                <p className="profile-page__hint" role="alert">
                  {googleError}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!sessionReady) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <p className="profile-page__lede">Restoring your session…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="write-page" aria-label="Writing editor">
        <div className="write-shell">
          <aside className="write-panel">
            <h1 className="write-brand">
              Write <span>Up</span>
            </h1>
            <p className="write-muted">Drafts stored in your Write Up account.</p>
            <button type="button" className="write-btn write-btn--primary" onClick={() => void createDocument()}>
              New document
            </button>
            <ul className="write-doc-list" aria-label="Documents">
              {documents.map((d) => (
                <li key={d.id} className="write-doc-row">
                  <button
                    type="button"
                    className={`write-doc-item${d.id === currentId ? " active" : ""}`}
                    onClick={() => onSelectDoc(d.id)}
                  >
                    <p className="write-doc-title">{d.title || "Untitled"}</p>
                    <p className="write-doc-meta">
                      {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : ""}
                    </p>
                  </button>
                  <button
                    type="button"
                    className="write-doc-delete"
                    onClick={(e) => void deleteDocument(d.id, e)}
                    disabled={deletingDocId === d.id}
                    aria-label={`Delete ${d.title || "Untitled"}`}
                    title="Delete document"
                  >
                    {deletingDocId === d.id ? "…" : "×"}
                  </button>
                </li>
              ))}
            </ul>
            {listLoading ? (
              <p className="write-muted write-loading-indicator" role="status" aria-live="polite">
                Loading…
              </p>
            ) : null}
          </aside>

          <main className="write-editor-wrap">
            {topError ? <div className="write-error-banner">{topError}</div> : null}
            {!currentId ? (
              <div className="write-empty-state">
                <p>Create a document to start writing. Edits autosave while you type.</p>
              </div>
            ) : (
              <>
                <div className="write-editor-toolbar">
                  <input
                    className="write-title-input"
                    aria-label="Document title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                  />
                  <span
                    className={`write-status-pill${saveState === "saved" ? " ok" : ""}${saveState === "error" ? " warn" : ""}`}
                  >
                    {saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved"
                        : saveState === "error"
                          ? "Save issue"
                          : ""}
                  </span>
                </div>
                <div className="write-editor-surface">
                  {/* Highlight layer: mirrors the textarea content so we can
                      colour-mark the exact span the hovered suggestion refers to. */}
                  <div
                    ref={highlightLayerRef}
                    className="write-editor-highlight-layer"
                    aria-hidden="true"
                  >
                    {displayedHighlight ? (
                      <>
                        {content.substring(0, displayedHighlight.start)}
                        <mark className="write-highlight-mark">
                          {content.substring(displayedHighlight.start, displayedHighlight.end)}
                        </mark>
                        {content.substring(displayedHighlight.end)}
                        {/* Trailing zero-width space gives the mirror layer the same
                            phantom bottom line a textarea reserves for the cursor.
                            Without it the layer's scrollHeight is one line shorter
                            than the textarea's, so marks near the end of the document
                            land one line higher than the underlying text. */}
                        {"\u200B"}
                      </>
                    ) : null}
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="write-editor"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onScroll={() => {
                      if (highlightLayerRef.current && textareaRef.current) {
                        highlightLayerRef.current.scrollTop = textareaRef.current.scrollTop;
                      }
                    }}
                    placeholder="Start typing… Quick spelling/grammar checks run while you write; punctuation and flow after a longer pause."
                    spellCheck
                  />
                </div>
              </>
            )}
          </main>

          <aside className="write-panel write-coach-panel">
            <h2>Suggestions</h2>
            <div
              className={`write-coach-status${coachPhase === "waiting_pause" ? " waiting_pause" : ""}${coachPhase === "fetching" ? " fetching" : ""}${coachPhase === "error" ? " error" : ""}${coachPhase === "ready" ? " ready" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span className="write-dot" aria-hidden />
              <p className="write-coach-status-text">
                {!currentId ? (
                  <>
                    <strong>No document open.</strong> Create or pick a document to see coaching here.
                  </>
                ) : coachPhase === "inactive" ? (
                  <>
                    <strong>Coach idle.</strong> Start typing in the editor.
                  </>
                ) : coachPhase === "needs_more_text" ? (
                  <>
                    <strong>Coach paused.</strong> Add a little more text (about {MIN_COACH_CHARS} characters).
                  </>
                ) : coachPhase === "waiting_pause" ? (
                  <>
                    <strong>Watching your draft.</strong> Lighter checks about every{" "}
                    {Math.round(COACH_POLL_MS / 1000)}s; full pass after ~{Math.round(COACH_PAUSE_MS / 1000)}s pause.
                  </>
                ) : coachPhase === "fetching" ? (
                  <>
                    <strong>Refreshing suggestions…</strong> Previous cards stay until new ones arrive.
                  </>
                ) : coachPhase === "error" ? (
                  <>
                    <strong>Could not refresh.</strong> {coachError || "Something went wrong."}
                  </>
                ) : (
                  <>
                    <strong>Up to date.</strong>
                    {lastCoachAt ? ` Last refresh ${new Date(lastCoachAt).toLocaleTimeString()}.` : ""}
                  </>
                )}
              </p>
            </div>
            {profileSnapshot ? (
              <p className="write-muted write-profile-line">
                Avg sentence ~{profileSnapshot.avgSentenceLength} words · requests {profileSnapshot.requests}
              </p>
            ) : null}
            <div
              className={`write-suggestions-wrap${coachPhase === "needs_more_text" || coachPhase === "waiting_pause" || coachPhase === "fetching" ? " stale" : ""}`}
            >
              <div className="write-suggestions">
                {suggestions.map((s, i) => {
                  const record = suggestionToFeedbackRecord(currentId, s, i);
                  const decision = decisionByCardId[record.cardId] || null;

                  // Hide suggestions the user has already declined.
                  if (decision === "declined") return null;

                  // Hide cards whose referenced issue is no longer present in the draft.
                  if (isCardStale(s, content)) return null;

                  const saving = Boolean(savingDecisionByCardId[record.cardId]);
                  const highlightRange = findHighlightRange(s, content);
                  const isActiveHighlight =
                    highlightRange && activeHighlight?.cardId === record.cardId;
                  const toggleHighlight = () => {
                    if (!highlightRange) return;
                    if (activeHighlight?.cardId === record.cardId) {
                      setActiveHighlight(null);
                    } else {
                      setActiveHighlight({
                        cardId: record.cardId,
                        start: highlightRange.start,
                        end: highlightRange.end,
                      });
                    }
                  };
                  return (
                    <article
                      key={`${s.title}-${i}`}
                      className={`write-card${
                        highlightRange ? " write-card--highlightable" : ""
                      }${isActiveHighlight ? " is-active" : ""}`}
                      role={highlightRange ? "button" : undefined}
                      tabIndex={highlightRange ? 0 : undefined}
                      aria-pressed={highlightRange ? Boolean(isActiveHighlight) : undefined}
                      onClick={(e) => {
                        if (!highlightRange) return;
                        if (e.target.closest("button")) return;
                        toggleHighlight();
                      }}
                      onKeyDown={(e) => {
                        if (!highlightRange) return;
                        if (e.key !== "Enter" && e.key !== " ") return;
                        if (e.target.closest("button")) return;
                        e.preventDefault();
                        toggleHighlight();
                      }}
                      onMouseEnter={() => {
                        if (!highlightRange) return;
                        setHoverHighlight({
                          cardId: record.cardId,
                          start: highlightRange.start,
                          end: highlightRange.end,
                        });
                      }}
                      onMouseLeave={() => setHoverHighlight(null)}
                    >
                      {s.issueType || s.type ? (
                        <span className="write-type-tag">{s.issueType || s.type}</span>
                      ) : null}
                      <h3>{s.title}</h3>
                      <p>{s.body}</p>
                      {s.micro_edit ? (
                        <div className="write-micro">
                          <strong>Suggested fix:</strong> {s.micro_edit}
                        </div>
                      ) : null}
                      {currentId ? (
                        <div className="write-card-actions">
                          <button
                            type="button"
                            className={`write-card-btn${decision === "accepted" ? " is-selected" : ""}`}
                            onClick={() => void handleSuggestionDecision(s, i, "accepted")}
                            disabled={saving}
                          >
                            {saving && decision !== "declined" ? "Saving..." : "Accept"}
                          </button>
                          <button
                            type="button"
                            className={`write-card-btn write-card-btn--ghost${decision === "declined" ? " is-selected" : ""}`}
                            onClick={() => void handleSuggestionDecision(s, i, "declined")}
                            disabled={saving}
                          >
                            {saving && decision !== "accepted" ? "Saving..." : "Decline"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
              {coachPhase === "ready" && visibleSuggestionCount === 0 ? (
                <p className="write-suggestions-empty">
                  {suggestions.length > 0
                    ? "Tips from the last pass no longer match this draft—pause again to refresh."
                    : "No tips from the last pass—confirm coaching-api is running, then pause again."}
                </p>
              ) : null}
              {(coachPhase === "needs_more_text" || coachPhase === "waiting_pause") &&
              visibleSuggestionCount === 0 ? (
                <p className="write-suggestions-empty">
                  Keep writing; suggestions appear after your first pause with enough text.
                </p>
              ) : null}
            </div>
            {retrievedChunks.length ? (
              <div className="write-details">
                <details>
                  <summary>Sources ({retrievedChunks.length})</summary>
                  {retrievedChunks.map((c) => (
                    <p key={c.id} className="write-chunk">
                      <strong>{c.source}</strong> · score {c.score?.toFixed?.(3) ?? c.score}
                      <br />
                      {c.text}
                    </p>
                  ))}
                </details>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
  );
}


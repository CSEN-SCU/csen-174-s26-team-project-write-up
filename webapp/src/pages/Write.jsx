import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, api } from "../lib/api";
import {
  COACH_PAUSE_MS,
  COACH_POLL_MS,
  MIN_COACH_CHARS,
  useLiveCoach,
} from "../hooks/useLiveCoach";
import "./Write.css";

const INTRO_DISMISSED_KEY = "writeup-web-intro-dismissed";

function hashSuggestion(parts) {
  const text = parts.join("|");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
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
  const canWrite = Boolean(user);
  const canFetchDocs = canWrite && sessionReady;

  const [documents, setDocuments] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [topError, setTopError] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [showIntro, setShowIntro] = useState(
    () => localStorage.getItem(INTRO_DISMISSED_KEY) !== "1",
  );
  const lastSyncedCoachAtRef = useRef(null);
  const [decisionByCardId, setDecisionByCardId] = useState({});
  const [savingDecisionByCardId, setSavingDecisionByCardId] = useState({});

  const loadList = useCallback(async () => {
    if (!canFetchDocs) return;
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
  }, [canFetchDocs]);

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
    enabled: canWrite,
    currentId,
    title,
    content,
    onSave: loadList,
  });

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
    if (!currentId || !lastCoachAt || coachPhase !== "ready") return;
    if (lastSyncedCoachAtRef.current === lastCoachAt) return;
    lastSyncedCoachAtRef.current = lastCoachAt;
    void api.markCoachSession().catch(() => {
      // Profile snapshot updates are best-effort; do not block writing flow.
    });
  }, [currentId, lastCoachAt, coachPhase]);

  const handleSuggestionDecision = useCallback(
    async (suggestion, idx, decision) => {
      if (!currentId) return;
      const record = suggestionToFeedbackRecord(currentId, suggestion, idx);
      if (savingDecisionByCardId[record.cardId]) return;
      if (decisionByCardId[record.cardId] === decision) return;

      // Auto-apply the suggested fix to the document text when accepting a
      // spelling / typo / contraction card that has a micro_edit.
      if (decision === "accepted" && suggestion.micro_edit) {
        const titleStr = suggestion.title || "";
        const isAutoFixable = /^(?:Spelling|Typo|Missing apostrophe|Phrase|Grammar):/i.test(titleStr);
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
    [currentId, decisionByCardId, savingDecisionByCardId],
  );

  const dismissIntro = useCallback(() => {
    localStorage.setItem(INTRO_DISMISSED_KEY, "1");
    setShowIntro(false);
  }, []);

  const openDocument = useCallback(
    async (id) => {
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
    [bumpCoachGeneration, markSaved, resetCoachState],
  );

  const createDocument = useCallback(async () => {
    setTopError(null);
    try {
      const doc = await api.documents.create("Untitled");
      await loadList();
      await openDocument(doc.id);
    } catch {
      setTopError("Could not create a document.");
    }
  }, [loadList, openDocument]);

  const onSelectDoc = (id) => {
    if (id === currentId) return;
    void openDocument(id);
  };

  if (authLoading || (canWrite && !sessionReady)) {
    return (
      <section className="page write-page">
        <p className="write-muted">{authLoading ? "Checking sign-in…" : "Restoring your session…"}</p>
      </section>
    );
  }

  if (!canWrite) {
    return (
      <section className="page write-page write-page--gate">
        <h2 className="write-brand">
          Write <span>Up</span> editor
        </h2>
        <p className="write-muted">
          Sign in with Google so your drafts and coaching profile stay on your account. Coaching runs through app-api
          and coaching-api (same stack as the extension).
        </p>
        <button type="button" className="write-btn write-btn--primary" onClick={() => signInWithGoogle()}>
          Sign in with Google
        </button>
        <Link className="write-link" to="/">
          Back to dashboard
        </Link>
      </section>
    );
  }

  return (
    <>
      {showIntro ? (
        <div className="write-intro-overlay" role="dialog" aria-modal="true" aria-labelledby="write-intro-title">
          <div className="write-intro-card">
            <h2 id="write-intro-title" className="write-intro-title">
              Write Up — web editor
            </h2>
            <p className="write-intro-lead">
              Same live coaching as the Chris prototype: lighter checks while you type, a full pass after you
              pause. Documents save to your account; coaching uses app-api with your Firebase session.
            </p>
            <ol className="write-intro-steps">
              <li>Run <code>npm run dev:all</code> (or app-api + coaching-api + this webapp).</li>
              <li>Click <strong>New document</strong>, write a paragraph in your voice.</li>
              <li>Pause ~2s for punctuation and flow; watch cards on the right.</li>
            </ol>
            <button type="button" className="write-btn write-btn--primary" onClick={dismissIntro}>
              Enter the editor
            </button>
          </div>
        </div>
      ) : null}

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
                <li key={d.id}>
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
                  <textarea
                    className="write-editor"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
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

                  // Immediately hide spelling/typo cards whose referenced word is
                  // no longer present in the draft (e.g. the user deleted it).
                  if (/^(?:Spelling|Typo|Missing apostrophe):/i.test(s.title || "")) {
                    const qm = (s.title || "").match(/[\u201C"]([^\u201D"]+)[\u201D"]/);
                    if (qm?.[1]) {
                      const escaped = qm[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                      if (!new RegExp(`\\b${escaped}\\b`, "i").test(content)) return null;
                    }
                  }

                  const saving = Boolean(savingDecisionByCardId[record.cardId]);
                  return (
                    <article key={`${s.title}-${i}`} className="write-card">
                      {s.type ? <span className="write-type-tag">{s.type}</span> : null}
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
              {coachPhase === "ready" && suggestions.length === 0 ? (
                <p className="write-suggestions-empty">
                  No tips from the last pass—confirm coaching-api is running, then pause again.
                </p>
              ) : null}
              {(coachPhase === "needs_more_text" || coachPhase === "waiting_pause") &&
              suggestions.length === 0 ? (
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
    </>
  );
}


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const SAVE_MS = 450;
/** After this quiet period, run a full coach pass (punctuation, flow, coherence). */
const COACH_PAUSE_MS = 2200;
/** While typing, lighter passes (spelling / grammar) on this interval (throttled by in-flight guard). */
const COACH_POLL_MS = 3500;
const MIN_COACH_CHARS = 32;
/** Persists after dismiss so gallery-walk visitors who already tried can skip. */
const INTRO_DISMISSED_KEY = "writeup-intro-dismissed";

function getOrCreateUserId() {
  const key = "writeup-user-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

function useDebouncedEffect(deps, delay, onFire) {
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  useEffect(() => {
    const t = setTimeout(() => onFireRef.current(), delay);
    return () => clearTimeout(t);
    // deps drives the debounce timer; callback always reads latest state via closure + ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}

export default function App() {
  const userId = useMemo(() => getOrCreateUserId(), []);
  const coachGenRef = useRef(0);
  const coachInFlightRef = useRef(false);
  const currentIdRef = useRef(null);
  const contentRef = useRef("");
  /** Last draft text that got a full (paused) coach pass. */
  const lastPausedCoachTextRef = useRef("");
  /** Last draft text that got a typing-only coach pass. */
  const lastTypingCoachTextRef = useRef("");
  /** If set, /coach failed for this exact trimmed draft; keep error until the draft changes. */
  const coachFailedForTextRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState("idle");
  /** inactive | needs_more_text | waiting_pause | fetching | ready | error */
  const [coachPhase, setCoachPhase] = useState("inactive");
  const [suggestions, setSuggestions] = useState([]);
  const [retrievedChunks, setRetrievedChunks] = useState([]);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [lastCoachAt, setLastCoachAt] = useState(null);
  const [topError, setTopError] = useState(null);
  const [coachError, setCoachError] = useState(null);
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem(INTRO_DISMISSED_KEY) !== "1");

  const dismissIntro = useCallback(() => {
    localStorage.setItem(INTRO_DISMISSED_KEY, "1");
    setShowIntro(false);
  }, []);

  const loadList = useCallback(async () => {
    setTopError(null);
    const res = await fetch("/api/documents");
    if (!res.ok) {
      setTopError("Could not load documents.");
      return;
    }
    const data = await res.json();
    setDocuments(data.documents || []);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  currentIdRef.current = currentId;
  contentRef.current = content;

  const runCoach = useCallback(async (mode) => {
    const m = mode === "typing" ? "typing" : "paused";
    const id = currentIdRef.current;
    const trimmed = String(contentRef.current || "").trim();
    if (!id || trimmed.length < MIN_COACH_CHARS) return;
    if (coachInFlightRef.current) return;
    if (coachFailedForTextRef.current !== null && trimmed === coachFailedForTextRef.current) return;
    if (
      m === "paused" &&
      trimmed === lastPausedCoachTextRef.current &&
      coachFailedForTextRef.current === null
    ) {
      return;
    }
    if (
      m === "typing" &&
      trimmed === lastTypingCoachTextRef.current &&
      coachFailedForTextRef.current === null
    ) {
      return;
    }

    coachInFlightRef.current = true;
    const gen = ++coachGenRef.current;
    setCoachPhase("fetching");
    setCoachError(null);
    try {
      const res = await fetch("/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, userId, surface: "web", coachMode: m }),
      });
      if (!res.ok) throw new Error("coach failed");
      const data = await res.json();
      if (gen !== coachGenRef.current) return;
      coachFailedForTextRef.current = null;
      if (m === "paused") {
        lastPausedCoachTextRef.current = trimmed;
        lastTypingCoachTextRef.current = trimmed;
      } else {
        lastTypingCoachTextRef.current = trimmed;
      }
      const raw = Array.isArray(data.suggestions) ? data.suggestions : [];
      const nextChunks = Array.isArray(data.retrievedChunks) ? data.retrievedChunks : [];
      // Server already merges typing vs paused rules; always apply its suggestion list as-is so we
      // never drop spelling/grammar cards (the old typing-only merge could leave an empty panel).
      setSuggestions((prev) => (raw.length > 0 ? raw : prev));
      setRetrievedChunks((prev) => (nextChunks.length > 0 ? nextChunks : prev));
      setProfileSnapshot(data.profileSnapshot ?? null);
      setLastCoachAt(new Date().toISOString());
      setCoachPhase("ready");
    } catch {
      if (gen !== coachGenRef.current) return;
      coachFailedForTextRef.current = trimmed;
      setCoachError("Could not refresh suggestions (network or server). Your previous tips stay below.");
      setCoachPhase("error");
    } finally {
      coachInFlightRef.current = false;
    }
  }, [userId]);

  const openDocument = useCallback(async (id) => {
    setTopError(null);
    setCoachError(null);
    coachFailedForTextRef.current = null;
    coachGenRef.current += 1;
    const res = await fetch(`/api/documents/${id}`);
    if (!res.ok) {
      setTopError("Could not open that document.");
      return;
    }
    const doc = await res.json();
    const body = String(doc.content || "");
    setCurrentId(doc.id);
    setTitle(doc.title || "Untitled");
    setContent(body);
    setSuggestions([]);
    setRetrievedChunks([]);
    setProfileSnapshot(null);
    setLastCoachAt(null);
    lastPausedCoachTextRef.current = "";
    lastTypingCoachTextRef.current = "";
    setCoachPhase(body.trim().length < MIN_COACH_CHARS ? "needs_more_text" : "waiting_pause");
  }, []);

  const createDocument = useCallback(async () => {
    setTopError(null);
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled" }),
    });
    if (!res.ok) {
      setTopError("Could not create a document.");
      return;
    }
    const doc = await res.json();
    await loadList();
    await openDocument(doc.id);
  }, [loadList, openDocument]);

  useDebouncedEffect([currentId, title, content], SAVE_MS, async () => {
    const id = currentId;
    const t = title;
    const c = content;
    if (!id) return;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, content: c }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaveState("saved");
      await loadList();
    } catch {
      setSaveState("error");
      setTopError("Autosave failed. Check that the server is running.");
    }
  });

  useEffect(() => {
    if (!currentId) {
      setCoachPhase("inactive");
      return;
    }
    const trimmed = content.trim();
    if (trimmed.length < MIN_COACH_CHARS) {
      setCoachPhase((p) => (p === "fetching" ? p : "needs_more_text"));
      return;
    }
    if (coachFailedForTextRef.current !== null && trimmed === coachFailedForTextRef.current) {
      setCoachPhase((p) => (p === "fetching" ? p : "error"));
      return;
    }
    if (coachFailedForTextRef.current !== null && trimmed !== coachFailedForTextRef.current) {
      coachFailedForTextRef.current = null;
      setCoachError(null);
    }
    if (trimmed === lastPausedCoachTextRef.current) {
      setCoachPhase((p) => (p === "fetching" ? p : "ready"));
      return;
    }
    setCoachPhase((p) => (p === "fetching" ? p : "waiting_pause"));
  }, [currentId, content]);

  useDebouncedEffect([currentId, content], COACH_PAUSE_MS, () => {
    void runCoach("paused");
  });

  useEffect(() => {
    if (!currentId) return undefined;
    const id = setInterval(() => {
      void runCoach("typing");
    }, COACH_POLL_MS);
    return () => clearInterval(id);
  }, [currentId, runCoach]);

  const onSelectDoc = (id) => {
    if (id === currentId) return;
    void openDocument(id);
  };

  return (
    <>
      {showIntro ? (
        <div
          className="intro-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="intro-title"
        >
          <div className="intro-card">
            <h2 id="intro-title" className="intro-title">
              Write Up — prototype
            </h2>
            <p className="intro-lead">
              This is a <strong>working prototype</strong> for the team&apos;s product vision: a writing coach that
              tracks your <em>patterns</em> over time (not just one-off corrections), explains feedback in plain
              language, and keeps your voice.
            </p>
            <dl className="intro-dl">
              <div>
                <dt>Who it&apos;s for</dt>
                <dd>Aspiring writers and students who want a roadmap of habits—not only a spellcheck.</dd>
              </div>
              <div>
                <dt>Problem it probes</dt>
                <dd>
                  Can an AI-backed coach plus a lightweight &quot;linguistic profile&quot; feel more like tutoring
                  than an automated rewrite (the risk this build tests)?
                </dd>
              </div>
              <div>
                <dt>How to try it (30 seconds)</dt>
                <dd>
                  <ol className="intro-steps">
                    <li>Confirm the local server is running (see repo <code>README</code> in this prototype folder).</li>
                    <li>Click <strong>New document</strong>, write a short paragraph in your own voice.</li>
                    <li>
                      Pause typing for a few seconds—coaching cards appear on the right; open <strong>Sources</strong>{" "}
                      to see teaching snippets the model used.
                    </li>
                    <li>Watch the small <strong>profile</strong> line update as you request more passes.</li>
                  </ol>
                </dd>
              </div>
            </dl>
            <div className="intro-actions">
              <button type="button" className="btn btn-primary" onClick={dismissIntro}>
                Enter the app
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="shell">
      <aside className="panel">
        <h1 className="brand">
          Write <span>Up</span>
        </h1>
        <p className="muted">Documents stay on your machine via the local server.</p>
        <button type="button" className="btn btn-primary" onClick={() => void createDocument()}>
          New document
        </button>
        <ul className="doc-list" aria-label="Documents">
          {documents.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={`doc-item${d.id === currentId ? " active" : ""}`}
                onClick={() => onSelectDoc(d.id)}
              >
                <p className="doc-title">{d.title || "Untitled"}</p>
                <p className="doc-meta">
                  {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : ""}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="editor-wrap">
        {topError ? <div className="error-banner">{topError}</div> : null}
        {!currentId ? (
          <div className="empty-state">
            <p>Create a document to start writing. Edits autosave while you type.</p>
          </div>
        ) : (
          <>
            <div className="editor-toolbar">
              <input
                className="title-input"
                aria-label="Document title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
              />
              <span
                className={`status-pill${saveState === "saved" ? " ok" : ""}${saveState === "error" ? " warn" : ""}`}
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
            <div className="editor-surface">
              <textarea
                className="editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Start typing… Quick spelling/grammar checks run while you write; punctuation and flow after a longer pause."
                spellCheck
              />
            </div>
          </>
        )}
      </main>

      <aside className="panel coach-panel">
        <h2>Suggestions</h2>
        <div
          className={`coach-status${coachPhase === "waiting_pause" ? " waiting_pause" : ""}${coachPhase === "fetching" ? " fetching" : ""}${coachPhase === "error" ? " error" : ""}${coachPhase === "ready" ? " ready" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="dot" aria-hidden />
          <p className="coach-status-text">
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
                <strong>Coach paused.</strong> Add a little more text (about {MIN_COACH_CHARS} characters) so the
                coach has enough context. {suggestions.length ? "Tips below may not match a very short draft." : ""}
              </>
            ) : coachPhase === "waiting_pause" ? (
              <>
                <strong>Watching your draft.</strong> About every {Math.round(COACH_POLL_MS / 1000)}s while you type we
                check spelling and clear grammar only (mid-sentence safe). After you pause for ~{Math.round(COACH_PAUSE_MS / 1000)}s we run a full pass (punctuation, flow, coherence). Cards stay until new ones replace them.
              </>
            ) : coachPhase === "fetching" ? (
              <>
                <strong>Refreshing suggestions…</strong> Your last cards stay visible until new ones arrive.
              </>
            ) : coachPhase === "error" ? (
              <>
                <strong>Could not refresh.</strong> {coachError || "Something went wrong."} Previous tips stay below
                so nothing suddenly disappears.
              </>
            ) : (
              <>
                <strong>Up to date.</strong> Last refresh{" "}
                {lastCoachAt ? `(${new Date(lastCoachAt).toLocaleTimeString()})` : ""} — full punctuation pass uses your
                last ~{Math.round(COACH_PAUSE_MS / 1000)}s pause; lighter checks can appear while you type.
              </>
            )}
          </p>
        </div>
        {profileSnapshot ? (
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Avg sentence length ~{profileSnapshot.avgSentenceLength} words · requests{" "}
            {profileSnapshot.requests}
          </p>
        ) : null}
        <div
          className={`suggestions-wrap${coachPhase === "needs_more_text" || coachPhase === "waiting_pause" || coachPhase === "fetching" ? " stale" : ""}`}
        >
          <div className="suggestions">
            {suggestions.map((s, i) => (
              <article key={`${s.title}-${i}`} className="card">
                {s.type ? <span className="type-tag">{s.type}</span> : null}
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.micro_edit ? (
                  <div className="micro">
                    <strong>Optional phrasing:</strong> {s.micro_edit}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {coachPhase === "ready" && suggestions.length === 0 ? (
            <p className="suggestions-empty">
              No tips came back from the last refresh—check that the coach server is running, then try a short pause
              again. If this keeps happening, open <code>/health</code> and confirm <code>spellchecker: true</code>.
            </p>
          ) : null}
          {(coachPhase === "needs_more_text" || coachPhase === "waiting_pause") && suggestions.length === 0 ? (
            <p className="suggestions-empty">Keep writing; suggestions will appear after your first pause with enough text.</p>
          ) : null}
        </div>
        {retrievedChunks.length ? (
          <div className="details">
            <details>
              <summary>Sources used for this pass ({retrievedChunks.length})</summary>
              {retrievedChunks.map((c) => (
                <p key={c.id} className="chunk">
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
    </>
  );
}

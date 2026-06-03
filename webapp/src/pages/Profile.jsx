import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, api } from "../lib/api";

const DEFAULT_PREFS = {
  writingLevel: "Undergraduate",
  feedbackTone: "Warm & encouraging",
  focusArea: "Grammar & sentence clarity",
  explainCorrections: true,
};

const WRITING_LEVEL_OPTIONS = [
  "Middle school",
  "High school",
  "Undergraduate",
  "Graduate / post-graduate",
  "Professional",
];

const FEEDBACK_TONE_OPTIONS = ["Warm & encouraging", "Direct & efficient", "Academic / formal"];

const FOCUS_AREA_OPTIONS = [
  "Grammar & sentence clarity",
  "Organization & structure",
  "Voice & word choice",
  "Citations & source use",
];

function normalizeLegacyPreferenceValue(kind, value) {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return value;

  if (kind === "writingLevel") {
    const map = {
      middle: "Middle school",
      high: "High school",
      undergraduate: "Undergraduate",
      graduate: "Graduate / post-graduate",
      professional: "Professional",
    };
    return map[raw.toLowerCase()] || raw;
  }

  if (kind === "feedbackTone") {
    const map = {
      supportive: "Warm & encouraging",
      direct: "Direct & efficient",
      academic: "Academic / formal",
    };
    return map[raw.toLowerCase()] || raw;
  }

  if (kind === "focusArea") {
    const map = {
      clarity: "Grammar & sentence clarity",
      structure: "Organization & structure",
      voice: "Voice & word choice",
      citations: "Citations & source use",
    };
    return map[raw.toLowerCase()] || raw;
  }

  return raw;
}

function formatJoined(isoOrMillis) {
  if (!isoOrMillis) return "—";
  const d = new Date(isoOrMillis);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function mergePrefs(stored) {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_PREFS };
  const writingLevel = normalizeLegacyPreferenceValue("writingLevel", stored.writingLevel);
  const feedbackTone = normalizeLegacyPreferenceValue("feedbackTone", stored.feedbackTone);
  const focusArea = normalizeLegacyPreferenceValue("focusArea", stored.focusArea);

  return {
    writingLevel:
      typeof writingLevel === "string" && WRITING_LEVEL_OPTIONS.includes(writingLevel)
        ? writingLevel
        : DEFAULT_PREFS.writingLevel,
    feedbackTone:
      typeof feedbackTone === "string" && FEEDBACK_TONE_OPTIONS.includes(feedbackTone)
        ? feedbackTone
        : DEFAULT_PREFS.feedbackTone,
    focusArea:
      typeof focusArea === "string" && FOCUS_AREA_OPTIONS.includes(focusArea)
        ? focusArea
        : DEFAULT_PREFS.focusArea,
    explainCorrections:
      typeof stored.explainCorrections === "boolean"
        ? stored.explainCorrections
        : DEFAULT_PREFS.explainCorrections,
  };
}

function prefsPayload(writingLevel, feedbackTone, focusArea, explainCorrections) {
  return { writingLevel, feedbackTone, focusArea, explainCorrections };
}

export default function Profile() {
  const { user, loading, sessionReady, signInWithGoogle, signOut, serverProfile, meLoading, meError } =
    useAuth();
  const [googleError, setGoogleError] = useState(null);
  const [writingLevel, setWritingLevel] = useState(DEFAULT_PREFS.writingLevel);
  const [feedbackTone, setFeedbackTone] = useState(DEFAULT_PREFS.feedbackTone);
  const [focusArea, setFocusArea] = useState(DEFAULT_PREFS.focusArea);
  const [explainCorrections, setExplainCorrections] = useState(DEFAULT_PREFS.explainCorrections);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState(null);
  const [snapshotData, setSnapshotData] = useState({ acceptedCount: 0, lastCoachedAt: null });
  const skipSaveRef = useRef(true);

  const email = serverProfile?.email?.trim() || user?.email?.trim() || "";
  const displayName =
    serverProfile?.displayName?.trim() ||
    user?.displayName?.trim() ||
    (email ? email.split("@")[0].replace(/\./g, " ") : "") ||
    (user?.uid ? `User ${user.uid.slice(0, 8)}` : "");
  const accountCreated = serverProfile?.createdAt || user?.metadata?.creationTime || null;
  const initial = displayName.slice(0, 1).toUpperCase() || "?";
  const photoURL = user?.photoURL || "";
  const learningSnapshotRows = useMemo(
    () => [
      { label: "Corrections you confirmed", value: String(snapshotData?.acceptedCount ?? 0) },
      { label: "Last coached session", value: formatJoined(snapshotData?.lastCoachedAt) },
    ],
    [snapshotData],
  );

  useEffect(() => {
    if (!user || !sessionReady) {
      setPrefsLoaded(false);
      skipSaveRef.current = true;
      return undefined;
    }

    let cancelled = false;
    setPrefsLoading(true);
    setPrefsError(null);
    skipSaveRef.current = true;

    (async () => {
      try {
        const body = await api.preferences.get();
        if (cancelled) return;
        const merged = mergePrefs(body?.preferences);
        setWritingLevel(merged.writingLevel);
        setFeedbackTone(merged.feedbackTone);
        setFocusArea(merged.focusArea);
        setExplainCorrections(merged.explainCorrections);
      } catch (err) {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : "unknown_error";
        setPrefsError(code);
      } finally {
        if (!cancelled) {
          setPrefsLoading(false);
          setPrefsLoaded(true);
          skipSaveRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, sessionReady]);

  useEffect(() => {
    if (!user || !sessionReady || !prefsLoaded || skipSaveRef.current) return undefined;

    const timer = window.setTimeout(() => {
      setPrefsSaving(true);
      setPrefsError(null);
      void api
        .preferences.update(prefsPayload(writingLevel, feedbackTone, focusArea, explainCorrections))
        .catch((err) => {
          const code =
            err instanceof ApiError ? err.code : err instanceof Error ? err.message : "unknown_error";
          setPrefsError(code);
        })
        .finally(() => setPrefsSaving(false));
    }, 400);

    return () => window.clearTimeout(timer);
  }, [user, sessionReady, prefsLoaded, writingLevel, feedbackTone, focusArea, explainCorrections]);

  useEffect(() => {
    if (!user || !sessionReady) {
      setSnapshotData({ acceptedCount: 0, lastCoachedAt: null });
      setSnapshotLoading(false);
      setSnapshotError(null);
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);
    void api
      .profileSnapshot()
      .then((body) => {
        if (cancelled) return;
        const acceptedCount =
          body && Number.isFinite(Number(body.acceptedCount)) ? Number(body.acceptedCount) : 0;
        const lastCoachedAt =
          body && typeof body.lastCoachedAt === "string" && body.lastCoachedAt.trim()
            ? body.lastCoachedAt
            : null;
        setSnapshotData({ acceptedCount, lastCoachedAt });
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : err instanceof Error ? err.message : "unknown_error";
        setSnapshotError(code);
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, sessionReady]);

  async function handleGoogleSignIn() {
    setGoogleError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = e?.code || (e instanceof Error ? e.message : "sign_in_failed");
      setGoogleError(code);
    }
  }

  const prefsDisabled = prefsLoading || !sessionReady;

  if (loading) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <p className="profile-page__lede">Checking session…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page profile-page">
      <div className="dashboard__inner dashboard__inner--wide">
        {!user ? (
          <div className="profile-page__sign-in-shell">
            <header className="profile-page__sign-header">
              <p className="dashboard__eyebrow">Your account</p>
              <h2 className="profile-page__title">Profile</h2>
              <p className="profile-page__lede">
                Sign in with Google to sync your Write Up profile to the server and see your account details here.
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
        ) : (
          <div className="profile-page__signed-shell">
            <header className="profile-page__signed-header">
              <div className="profile-page__heading-block">
                <p className="dashboard__eyebrow">Your account</p>
                <h2 className="profile-page__title">Profile</h2>
              </div>
              <button
                type="button"
                className="profile-page__sign-out dashboard__btn dashboard__btn--ghost"
                onClick={() => signOut()}
              >
                Sign out
              </button>
            </header>

            <div className="profile-page__grid">
              <div className="profile-page__user-stack">
                <aside className="profile-page__panel profile-page__panel--identity">
                  <div
                    className={`profile-page__avatar${photoURL ? " profile-page__avatar--photo" : ""}`}
                    aria-hidden="true"
                  >
                    {photoURL ? (
                      <img src={photoURL} alt="" className="profile-page__avatar-img" referrerPolicy="no-referrer" />
                    ) : (
                      initial
                    )}
                  </div>
                  <p className="profile-page__name">{displayName}</p>
                  <p className="profile-page__email-line">{email || "No email on this account"}</p>
                  <dl className="profile-page__joined">
                    <dt>Account created</dt>
                    <dd>{formatJoined(accountCreated)}</dd>
                  </dl>
                  {meLoading && (
                    <p className="profile-page__email-line" aria-live="polite">
                      Syncing profile with server…
                    </p>
                  )}
                  {meError && (
                    <p className="profile-page__hint" role="alert">
                      Could not load server profile ({meError}). Check that app-api is running and reachable.
                    </p>
                  )}
                </aside>

                <section className="profile-page__panel profile-page__panel--stats" aria-labelledby="stats-heading">
                  <h3 id="stats-heading" className="profile-page__stats-title">
                    Learning snapshot
                  </h3>
                  {snapshotLoading && (
                    <p className="profile-page__email-line" aria-live="polite">
                      Refreshing learning snapshot…
                    </p>
                  )}
                  {snapshotError && (
                    <p className="profile-page__hint" role="alert">
                      Could not refresh snapshot ({snapshotError}).
                    </p>
                  )}
                  <ul className="profile-page__stat-list">
                    {learningSnapshotRows.map((row) => (
                      <li key={row.label} className="profile-page__stat-row">
                        <span className="profile-page__stat-label">{row.label}</span>
                        <span className="profile-page__stat-value">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>

              <section
                className="profile-page__panel profile-page__panel--customize"
                aria-labelledby="customize-heading"
              >
                <h3 id="customize-heading" className="profile-page__customize-title">
                  Writing preferences
                </h3>
                <p className="profile-page__customize-lede">
                  Tune how the coach frames feedback. Changes save automatically to your account.
                </p>
                {prefsLoading && (
                  <p className="profile-page__email-line" aria-live="polite">
                    Loading saved preferences…
                  </p>
                )}
                {prefsSaving && !prefsLoading && (
                  <p className="profile-page__email-line" aria-live="polite">
                    Saving…
                  </p>
                )}
                {prefsError && (
                  <p className="profile-page__hint" role="alert">
                    Could not save preferences ({prefsError}). Check that app-api is running and reachable.
                  </p>
                )}

                <fieldset className="profile-page__customize-fields" disabled={prefsDisabled}>
                  <label className="profile-page__label" htmlFor="profile-writing-level">
                    Level you write at
                  </label>
                  <select
                    id="profile-writing-level"
                    className="profile-page__select"
                    value={writingLevel}
                    onChange={(e) => setWritingLevel(e.target.value)}
                  >
                    {WRITING_LEVEL_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <label className="profile-page__label" htmlFor="profile-feedback-tone">
                    Feedback tone
                  </label>
                  <select
                    id="profile-feedback-tone"
                    className="profile-page__select"
                    value={feedbackTone}
                    onChange={(e) => setFeedbackTone(e.target.value)}
                  >
                    {FEEDBACK_TONE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <label className="profile-page__label" htmlFor="profile-focus">
                    Main focus this term
                  </label>
                  <select
                    id="profile-focus"
                    className="profile-page__select"
                    value={focusArea}
                    onChange={(e) => setFocusArea(e.target.value)}
                  >
                    {FOCUS_AREA_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>

                  <label className="profile-page__checkbox">
                    <input
                      type="checkbox"
                      checked={explainCorrections}
                      onChange={(e) => setExplainCorrections(e.target.checked)}
                    />
                    <span>Show short explanations with suggestions</span>
                  </label>
                </fieldset>
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

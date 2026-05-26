import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

const STAT_ROWS = [
  { label: "Corrections you confirmed", value: "47" },
  { label: "Mini practice loops", value: "12" },
  { label: "Documents with feedback streak", value: "6" },
  { label: "Voice notes archived", value: "3" },
  { label: "Last coached session", value: "Today · 10:42 a.m." },
];

const DEFAULT_PREFS = {
  writingLevel: "undergraduate",
  feedbackTone: "supportive",
  focusArea: "clarity",
  explainCorrections: true,
};

function formatJoined(isoOrMillis) {
  if (!isoOrMillis) return "—";
  const d = new Date(isoOrMillis);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Profile() {
  const { user, loading, signInWithGoogle, signOut, serverProfile, meLoading, meError } = useAuth();
  const [googleError, setGoogleError] = useState(null);
  const [writingLevel, setWritingLevel] = useState(DEFAULT_PREFS.writingLevel);
  const [feedbackTone, setFeedbackTone] = useState(DEFAULT_PREFS.feedbackTone);
  const [focusArea, setFocusArea] = useState(DEFAULT_PREFS.focusArea);
  const [explainCorrections, setExplainCorrections] = useState(DEFAULT_PREFS.explainCorrections);

  const email = user?.email?.trim() || "";
  const displayName =
    user?.displayName?.trim() ||
    (email ? email.split("@")[0].replace(/\./g, " ") : "") ||
    (user?.uid ? `User ${user.uid.slice(0, 8)}` : "");
  const initial = displayName.slice(0, 1).toUpperCase() || "?";
  const photoURL = user?.photoURL || "";

  async function handleGoogleSignIn() {
    setGoogleError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = e?.code || (e instanceof Error ? e.message : "sign_in_failed");
      setGoogleError(code);
    }
  }

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
              <h3 className="profile-page__card-title">Sign in</h3>
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
                    <dd>{formatJoined(user.metadata?.creationTime)}</dd>
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
                  {!meLoading && serverProfile && Object.keys(serverProfile).length > 0 && (
                    <dl className="profile-page__joined">
                      {serverProfile.createdAt && (
                        <>
                          <dt>Profile stored</dt>
                          <dd>{formatJoined(serverProfile.createdAt)}</dd>
                        </>
                      )}
                    </dl>
                  )}
                  <div className="dashboard__ribbon" aria-hidden="true">
                    <span>Learning snapshot below is sample data until wired to analytics</span>
                  </div>
                </aside>

                <section className="profile-page__panel profile-page__panel--stats" aria-labelledby="stats-heading">
                  <h3 id="stats-heading" className="profile-page__stats-title">
                    Learning snapshot
                  </h3>
                  <ul className="profile-page__stat-list">
                    {STAT_ROWS.map((row) => (
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
                  Tune how the coach frames feedback. These controls are preview-only until the app saves them to your
                  account.
                </p>

                <div className="profile-page__customize-fields">
                  <label className="profile-page__label" htmlFor="profile-writing-level">
                    Level you write at
                  </label>
                  <select
                    id="profile-writing-level"
                    className="profile-page__select"
                    value={writingLevel}
                    onChange={(e) => setWritingLevel(e.target.value)}
                  >
                    <option value="middle">Middle school</option>
                    <option value="high">High school</option>
                    <option value="undergraduate">Undergraduate</option>
                    <option value="graduate">Graduate / post-graduate</option>
                    <option value="professional">Professional</option>
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
                    <option value="supportive">Warm &amp; encouraging</option>
                    <option value="direct">Direct &amp; efficient</option>
                    <option value="academic">Academic / formal</option>
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
                    <option value="clarity">Grammar &amp; sentence clarity</option>
                    <option value="structure">Organization &amp; structure</option>
                    <option value="voice">Voice &amp; word choice</option>
                    <option value="citations">Citations &amp; source use</option>
                  </select>

                  <label className="profile-page__checkbox">
                    <input
                      type="checkbox"
                      checked={explainCorrections}
                      onChange={(e) => setExplainCorrections(e.target.checked)}
                    />
                    <span>Show short explanations with suggestions</span>
                  </label>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

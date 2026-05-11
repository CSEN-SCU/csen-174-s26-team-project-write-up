import { useState } from "react";

const DUMMY_JOINED_LABEL = "When you joined";
const DUMMY_JOINED_VALUE = "March 4, 2026";

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

export default function Profile() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [writingLevel, setWritingLevel] = useState(DEFAULT_PREFS.writingLevel);
  const [feedbackTone, setFeedbackTone] = useState(DEFAULT_PREFS.feedbackTone);
  const [focusArea, setFocusArea] = useState(DEFAULT_PREFS.focusArea);
  const [explainCorrections, setExplainCorrections] = useState(DEFAULT_PREFS.explainCorrections);

  const canSubmit = email.trim().length > 0 && password.length > 0;
  const displayName = signedIn ? email.trim().split("@")[0].replace(/\./g, " ") || "writer" : "";

  function handleSignIn(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSignedIn(true);
  }

  function handleSignOut() {
    setSignedIn(false);
    setPassword("");
    setWritingLevel(DEFAULT_PREFS.writingLevel);
    setFeedbackTone(DEFAULT_PREFS.feedbackTone);
    setFocusArea(DEFAULT_PREFS.focusArea);
    setExplainCorrections(DEFAULT_PREFS.explainCorrections);
  }

  return (
    <section className="page profile-page">
      <div className="dashboard__inner dashboard__inner--wide">
        {!signedIn ? (
          <div className="profile-page__sign-in-shell">
            <header className="profile-page__sign-header">
              <p className="dashboard__eyebrow">Your account</p>
              <h2 className="profile-page__title">Profile</h2>
              <p className="profile-page__lede">
                Sign in to preview how progress and activity will appear. No account is created—this is layout-only for now.
              </p>
            </header>

            <form className="profile-page__sign-card" onSubmit={handleSignIn} aria-labelledby="profile-sign-heading">
              <h3 id="profile-sign-heading" className="profile-page__card-title">
                Sign in
              </h3>
              <label className="profile-page__label" htmlFor="profile-email">
                Email
              </label>
              <input
                id="profile-email"
                className="profile-page__input"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
              />

              <label className="profile-page__label" htmlFor="profile-password">
                Password
              </label>
              <input
                id="profile-password"
                className="profile-page__input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter any text for demo"
              />

              <button
                className="profile-page__submit dashboard__btn dashboard__btn--primary"
                type="submit"
                disabled={!canSubmit}
              >
                Sign in
              </button>
              {!canSubmit && (
                <p className="profile-page__hint">
                  Fill in email and password, then tap Sign in to load sample profile data.
                </p>
              )}
            </form>
          </div>
        ) : (
          <div className="profile-page__signed-shell">
            <header className="profile-page__signed-header">
              <div className="profile-page__heading-block">
                <p className="dashboard__eyebrow">Signed-in preview</p>
                <h2 className="profile-page__title">Profile</h2>
              </div>
              <button
                type="button"
                className="profile-page__sign-out dashboard__btn dashboard__btn--ghost"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            </header>

            <div className="profile-page__grid">
              <div className="profile-page__user-stack">
                <aside className="profile-page__panel profile-page__panel--identity">
                  <div className="profile-page__avatar" aria-hidden="true">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <p className="profile-page__name">{displayName}</p>
                  <p className="profile-page__email-line">{email.trim()}</p>
                  <dl className="profile-page__joined">
                    <dt>{DUMMY_JOINED_LABEL}</dt>
                    <dd>{DUMMY_JOINED_VALUE}</dd>
                  </dl>
                  <div className="dashboard__ribbon" aria-hidden="true">
                    <span>Sample metrics · Replace with Firestore/App API counts later</span>
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
                  Tune how the coach frames feedback. These controls are preview-only until the app saves them to your account.
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

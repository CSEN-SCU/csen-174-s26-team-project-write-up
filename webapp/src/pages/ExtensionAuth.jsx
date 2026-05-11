import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/**
 * Dedicated page for signing in from a normal browser tab. After Google sign-in,
 * the extension receives the ID token via chrome.runtime (see extension manifest
 * externally_connectable + background.js).
 */
export default function ExtensionAuth() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [err, setErr] = useState(null);

  async function onSignIn() {
    setErr(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  const extConfigured = Boolean(import.meta.env.VITE_EXTENSION_ID);

  return (
    <section className="page onboarding-page">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="onboarding-page__header">
          <p className="dashboard__eyebrow">Chrome extension</p>
          <h1 className="onboarding-page__title">Connect Write Up extension</h1>
          <p className="onboarding-page__lede">
            Sign in with the same Google account you use for Write Up. Your session will sync to the
            extension so it can call the app API with a valid token (or use local debug headers only
            on localhost without signing in).
          </p>
        </header>

        {!extConfigured ? (
          <p className="onboarding-page__status" role="status">
            Set <code>VITE_EXTENSION_ID</code> in <code>webapp/.env</code> to your unpacked extension ID
            (from <code>chrome://extensions</code>) so this page can deliver tokens to the extension.
          </p>
        ) : null}

        {loading ? (
          <p className="onboarding-page__hint">Loading auth…</p>
        ) : user ? (
          <div>
            <p className="onboarding-page__status" role="status">
              Signed in as <strong>{user.email || user.uid}</strong>. You can close this tab and return
              to the Write Up side panel — the extension should have received your token.
            </p>
            <button type="button" className="dashboard__btn dashboard__btn--ghost" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="dashboard__btn dashboard__btn--primary"
              onClick={onSignIn}
              disabled={!extConfigured}
            >
              Sign in with Google
            </button>
            {err ? (
              <p className="onboarding-page__status" role="alert">
                {err}
              </p>
            ) : null}
          </div>
        )}

        <p className="onboarding-page__hint" style={{ marginTop: "1.5rem" }}>
          <Link to="/">Back to dashboard</Link>
        </p>
      </div>
    </section>
  );
}

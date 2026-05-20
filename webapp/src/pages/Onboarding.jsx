import { useState } from "react";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../auth/AuthContext";

export default function Onboarding() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [draft, setDraft] = useState("");
  const [ack, setAck] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiErr, setApiErr] = useState(null);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || !user) return;
    setApiErr(null);
    setSubmitting(true);
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    try {
      await api.submitOnboarding({ writingSample: trimmed });
      setAck({
        words: wordCount,
        preview:
          "Saved to your account. Coaching and history will use this sample context as we add richer scoring.",
      });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.code}${err.status ? ` (${err.status})` : ""}`
          : err?.message || String(err);
      setApiErr(msg);
      setAck(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page onboarding-page">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="onboarding-page__header">
          <p className="dashboard__eyebrow">Calibration write</p>
          <h2 id="onboarding-title" className="onboarding-page__title">
            Onboarding
          </h2>
          <p className="onboarding-page__lede">
            Write a short passage in your own voice—about your day, an idea you care about, or a draft you are working on.
            This sample is stored on your Write Up profile (Firestore) when you submit.
          </p>
        </header>

        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Requires app-api · Sign in with Google before submitting</span>
        </div>

        {!authLoading && !user ? (
          <p className="onboarding-page__hint">
            <button type="button" className="dashboard__btn dashboard__btn--primary" onClick={() => signInWithGoogle()}>
              Sign in with Google
            </button>{" "}
            to save your sample to your account.
          </p>
        ) : null}

        <form className="onboarding-page__form" onSubmit={handleSubmit} aria-labelledby="onboarding-title">
          <label className="onboarding-page__label" htmlFor="onboarding-sample">
            Your writing sample
          </label>
          <textarea
            id="onboarding-sample"
            className="onboarding-page__textarea"
            name="sample"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setAck(null);
              setApiErr(null);
            }}
            placeholder="Type or paste a few sentences here…"
            aria-describedby="onboarding-hint"
          />
          <p id="onboarding-hint" className="onboarding-page__hint">
            Submit is enabled once there is some text. Your sample is sent to <code>POST /onboarding</code> on app-api.
          </p>

          <div className="onboarding-page__actions">
            <button
              type="submit"
              className="onboarding-page__submit dashboard__btn dashboard__btn--primary"
              disabled={!canSubmit || submitting || !user || authLoading}
            >
              {submitting ? "Saving…" : "Submit sample"}
            </button>
          </div>

          {apiErr ? (
            <p className="onboarding-page__status" role="alert">
              Could not save: {apiErr}
            </p>
          ) : null}

          {ack ? (
            <p className="onboarding-page__status" role="status">
              <strong>Received ({ack.words} words).</strong> {ack.preview}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}

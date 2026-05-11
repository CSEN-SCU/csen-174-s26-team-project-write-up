import { useState } from "react";

export default function Onboarding() {
  const [draft, setDraft] = useState("");
  const [ack, setAck] = useState(null);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0;

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    setAck({
      words: wordCount,
      preview:
        "This is a layout-only response. Later, your coach will estimate writing level from samples like this and ask what you want help with (grammar, clarity, citations, and more).",
    });
  }

  return (
    <section className="page onboarding-page">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="onboarding-page__header">
          <p className="dashboard__eyebrow">Calibration write</p>
          <h2 id="onboarding-title" className="onboarding-page__title">Onboarding</h2>
          <p className="onboarding-page__lede">
            Write a short passage in your own voice—about your day, an idea you care about, or a draft you are working on.
            This sample will help gauge your writing level and what you want the system to focus on when it suggests edits.
          </p>
        </header>

        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Preview only · No scoring or API call yet</span>
        </div>

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
            }}
            placeholder="Type or paste a few sentences here…"
            aria-describedby="onboarding-hint"
          />
          <p id="onboarding-hint" className="onboarding-page__hint">
            Submit is enabled once there is some text. There is no timer in this mock—just enough to see how the page
            could feel.
          </p>

          <div className="onboarding-page__actions">
            <button
              type="submit"
              className="onboarding-page__submit dashboard__btn dashboard__btn--primary"
              disabled={!canSubmit}
            >
              Submit sample
            </button>
          </div>

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

import { useState } from "react";

const DEMO_PAIRS = [
  {
    correction: "They're going to the store tomorrow.",
    mistake: "Their going to the store tomorrow.",
  },
  {
    correction: "It's a beautiful day.",
    mistake: "Its a beautiful day.",
  },
  {
    correction: "She should have gone earlier.",
    mistake: "She should of gone earlier.",
  },
  {
    correction: "Who left this here?",
    mistake: "Whom left this here?",
  },
];

export default function History() {
  const [items, setItems] = useState([]);

  function addItem() {
    setItems((prev) => {
      const pair = DEMO_PAIRS[prev.length % DEMO_PAIRS.length];
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          correction: pair.correction,
          mistake: pair.mistake,
        },
      ];
    });
  }

  return (
    <section className="page history-page">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="history-page__header">
          <div className="history-page__heading">
            <p className="dashboard__eyebrow">Feedback timeline</p>
            <h2 className="history-page__title">History</h2>
          </div>
          <button
            type="button"
            className="history-page__add-btn dashboard__btn dashboard__btn--primary"
            onClick={addItem}
          >
            Add entry
          </button>
        </header>
        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Placeholder rows · Wired to demo data until App API feeds this view</span>
        </div>
        <p className="history-page__note">
          TODO WEB-3: render feedback history from App API.
        </p>
        <p className="history-page__hint">
          The &ldquo;Add entry&rdquo; control is temporary so reviewers can mimic how entries stack.
        </p>
        <div className="history-page__container" role="list" aria-label="History entries">
          {items.length === 0 ? (
            <p className="history-page__empty">
              No entries yet. Use &ldquo;Add entry&rdquo; to add sample corrections
              and mistakes.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="history-page__item history-page__split"
                role="listitem"
              >
                <div className="history-page__correction">
                  <span className="history-page__col-label">Correction</span>
                  <p className="history-page__col-text">{item.correction}</p>
                </div>
                <div className="history-page__mistake">
                  <span className="history-page__col-label">Mistake</span>
                  <p className="history-page__col-text">{item.mistake}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

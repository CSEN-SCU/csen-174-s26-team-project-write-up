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
      <header className="history-page__header">
        <h2 className="history-page__title">History</h2>
        <button
          type="button"
          className="history-page__add-btn"
          onClick={addItem}
        >
          Add entry
        </button>
      </header>
      <p className="history-page__note">
        TODO WEB-3: render feedback history from App API.
      </p>
      <p>Also the "Add Entry" button is temporary.</p>
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
    </section>
  );
}

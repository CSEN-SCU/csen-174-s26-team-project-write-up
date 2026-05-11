import { useState } from "react";

const TAB_CORRECTIONS = "corrections";
const TAB_LEAVE_AS_WRITTEN = "leaveAsWritten";

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

/** Demo rows: system suggestion the user dismissed—won't be recommended again. */
const DEMO_LEAVE_AS_WRITTEN_PAIRS = [
  {
    correction: 'Treat "data" as plural: "The data are conclusive."',
    mistake: "The data is conclusive.",
  },
  {
    correction: "Add a comma before the coordinating conjunction.",
    mistake: "She finished the report and went home.",
  },
  {
    correction: "Use an en dash for the numeric range.",
    mistake: "Read pages 12-14 for context.",
  },
  {
    correction: "Prefer active voice here.",
    mistake: "The experiment was run by the lab team.",
  },
];

export default function History() {
  const [items, setItems] = useState([]);
  const [leaveAsWrittenItems, setLeaveAsWrittenItems] = useState([]);
  const [activeTab, setActiveTab] = useState(TAB_CORRECTIONS);

  function addItem() {
    if (activeTab === TAB_CORRECTIONS) {
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
    } else {
      setLeaveAsWrittenItems((prev) => {
        const pair = DEMO_LEAVE_AS_WRITTEN_PAIRS[prev.length % DEMO_LEAVE_AS_WRITTEN_PAIRS.length];
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
  }

  const listForTab = activeTab === TAB_CORRECTIONS ? items : leaveAsWrittenItems;
  const listAriaLabel =
    activeTab === TAB_CORRECTIONS ? "Correction history entries" : "Leave as written entries";
  const tabPanelLabelledBy =
    activeTab === TAB_CORRECTIONS ? "history-tab-corrections" : "history-tab-leave";

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

        <div className="history-page__tabs" role="tablist" aria-label="History categories">
          <button
            id="history-tab-corrections"
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_CORRECTIONS}
            aria-controls="history-tabpanel"
            className={
              activeTab === TAB_CORRECTIONS
                ? "history-page__tab history-page__tab--active"
                : "history-page__tab"
            }
            onClick={() => setActiveTab(TAB_CORRECTIONS)}
          >
            Correction history
          </button>
          <button
            id="history-tab-leave"
            type="button"
            role="tab"
            aria-selected={activeTab === TAB_LEAVE_AS_WRITTEN}
            aria-controls="history-tabpanel"
            className={
              activeTab === TAB_LEAVE_AS_WRITTEN
                ? "history-page__tab history-page__tab--active"
                : "history-page__tab"
            }
            onClick={() => setActiveTab(TAB_LEAVE_AS_WRITTEN)}
          >
            Leave as written
          </button>
        </div>

        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Placeholder rows · Wired to demo data until App API feeds this view</span>
        </div>
        <p className="history-page__note">
          TODO WEB-3: render feedback history from App API.
        </p>
        <p className="history-page__hint">
          The &ldquo;Add entry&rdquo; button adds a sample row to whichever tab is open. The
          &ldquo;Leave as written&rdquo; list is for wording you do not want suggested edits for
          again.
        </p>
        <div
          id="history-tabpanel"
          role="tabpanel"
          aria-labelledby={tabPanelLabelledBy}
        >
          <div className="history-page__container" role="list" aria-label={listAriaLabel}>
            {listForTab.length === 0 ? (
              <p className="history-page__empty">
                {activeTab === TAB_CORRECTIONS ? (
                  <>
                    No entries yet. Use &ldquo;Add entry&rdquo; to add sample corrections and
                    mistakes.
                  </>
                ) : (
                  <>
                    Nothing here yet. When you tell the coach not to change a phrase, those choices
                    will appear so the system stops recommending the same fix.
                  </>
                )}
              </p>
            ) : (
              listForTab.map((item) => (
                <div
                  key={item.id}
                  className="history-page__item history-page__split"
                  role="listitem"
                >
                  <div className="history-page__correction">
                    <span className="history-page__col-label">
                      {activeTab === TAB_CORRECTIONS ? "Correction" : "Suggested change"}
                    </span>
                    <p className="history-page__col-text">{item.correction}</p>
                  </div>
                  <div className="history-page__mistake">
                    <span className="history-page__col-label">
                      {activeTab === TAB_CORRECTIONS ? "Mistake" : "Your text (kept)"}
                    </span>
                    <p className="history-page__col-text">{item.mistake}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

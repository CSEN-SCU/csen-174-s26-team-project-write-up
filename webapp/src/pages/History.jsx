import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";

const TAB_CORRECTIONS = "corrections";
const TAB_LEAVE_AS_WRITTEN = "leaveAsWritten";

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

function mapFirestoreRow(raw, idx) {
  const cardId = raw.cardId ?? "card";
  const createdAt = raw.createdAt ?? "";
  const doc = raw.docId ?? "";
  const id = `${doc}-${cardId}-${createdAt}-${idx}`;
  const mistake = String(raw.issue || "").trim() || "(untitled)";
  const fixes = Array.isArray(raw.fixOptions) ? raw.fixOptions : [];
  const correction = String(fixes[0] || "").trim() || String(raw.why || "").trim() || "—";
  return { id, mistake, correction };
}

export default function History() {
  const [searchParams] = useSearchParams();
  const docId = searchParams.get("docId") || "active";

  const { data, loading, error, retry } = useApi(
    useCallback(() => api.history(docId), [docId]),
    [docId],
  );

  const correctionRows = useMemo(() => {
    const items = (data && Array.isArray(data.items) && data.items) || [];
    return items.map(mapFirestoreRow);
  }, [data]);

  const [leaveAsWrittenItems, setLeaveAsWrittenItems] = useState([]);
  const [activeTab, setActiveTab] = useState(TAB_CORRECTIONS);

  function addDemoLeaveAsWritten() {
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

  const listForTab = activeTab === TAB_CORRECTIONS ? correctionRows : leaveAsWrittenItems;
  const listAriaLabel =
    activeTab === TAB_CORRECTIONS ? "Correction history entries" : "Leave as written entries";
  const tabPanelLabelledBy =
    activeTab === TAB_CORRECTIONS ? "history-tab-corrections" : "history-tab-leave";

  const emptyCorrections = activeTab === TAB_CORRECTIONS && correctionRows.length === 0 && !loading;

  return (
    <section className="page history-page">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="history-page__header">
          <div className="history-page__heading">
            <p className="dashboard__eyebrow">Feedback timeline</p>
            <h2 className="history-page__title">History</h2>
          </div>
          {activeTab === TAB_LEAVE_AS_WRITTEN ? (
            <button
              type="button"
              className="history-page__add-btn dashboard__btn dashboard__btn--primary"
              onClick={addDemoLeaveAsWritten}
            >
              Add demo entry
            </button>
          ) : (
            <button
              type="button"
              className="history-page__add-btn dashboard__btn dashboard__btn--primary"
              onClick={() => retry()}
              disabled={loading}
            >
              Refresh
            </button>
          )}
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

        {activeTab === TAB_CORRECTIONS && error && (
          <p className="history-page__note" role="alert">
            Could not load history ({error.code || error.message}). Set{" "}
            <code>VITE_DEBUG_APP_USER</code> for local app-api bypass, or sign in with Firebase.
          </p>
        )}
        <p className="history-page__hint">
          <strong>Correction history</strong> lists suggestions saved from the extension after each
          coach run. <strong>Leave as written</strong> is still a local demo until dismissals are
          stored in app-api.
        </p>

        <div id="history-tabpanel" role="tabpanel" aria-labelledby={tabPanelLabelledBy}>
          {activeTab === TAB_CORRECTIONS && loading ? (
            <p className="history-page__empty">Loading…</p>
          ) : (
            <div className="history-page__container" role="list" aria-label={listAriaLabel}>
              {listForTab.length === 0 ? (
                <p className="history-page__empty">
                  {activeTab === TAB_CORRECTIONS ? (
                    <>
                      {emptyCorrections ? "No saved suggestions for this document yet." : null}
                    </>
                  ) : (
                    <>
                      Nothing here yet. When you tell the coach not to change a phrase, those
                      choices will appear so the system stops recommending the same fix.
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
                        {activeTab === TAB_CORRECTIONS ? "Suggestion / fix" : "Suggested change"}
                      </span>
                      <p className="history-page__col-text">{item.correction}</p>
                    </div>
                    <div className="history-page__mistake">
                      <span className="history-page__col-label">
                        {activeTab === TAB_CORRECTIONS ? "Observation" : "Your text (kept)"}
                      </span>
                      <p className="history-page__col-text">{item.mistake}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

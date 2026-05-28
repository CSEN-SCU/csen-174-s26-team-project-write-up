import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";

const TAB_CORRECTIONS = "corrections";
const TAB_LEAVE_AS_WRITTEN = "leaveAsWritten";

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
  const { user, loading: authLoading, sessionReady, signInWithGoogle } = useAuth();
  const [googleError, setGoogleError] = useState(null);
  const canLoadHistory = Boolean(user && sessionReady);
  const [searchParams] = useSearchParams();
  const rawDocId = searchParams.get("docId");
  const docId = rawDocId && rawDocId.trim() ? rawDocId.trim() : null;
  const [activeTab, setActiveTab] = useState(TAB_CORRECTIONS);
  const decisionFilter = activeTab === TAB_CORRECTIONS ? "accepted" : "declined";

  const { data, loading, error, retry } = useApi(
    useCallback(
      () => (canLoadHistory ? api.history(docId, { decision: decisionFilter }) : Promise.resolve({ items: [] })),
      [canLoadHistory, docId, decisionFilter],
    ),
    [canLoadHistory, docId, decisionFilter],
  );

  const correctionRows = useMemo(() => {
    if (!canLoadHistory) return [];
    const items = (data && Array.isArray(data.items) && data.items) || [];
    return items.map(mapFirestoreRow);
  }, [canLoadHistory, data]);

  const listForTab = correctionRows;
  const listAriaLabel =
    activeTab === TAB_CORRECTIONS ? "Correction history entries" : "Leave as written entries";
  const tabPanelLabelledBy =
    activeTab === TAB_CORRECTIONS ? "history-tab-corrections" : "history-tab-leave";

  const emptyCorrections = activeTab === TAB_CORRECTIONS && correctionRows.length === 0 && !loading;

  async function handleGoogleSignIn() {
    setGoogleError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = e?.code || (e instanceof Error ? e.message : "sign_in_failed");
      setGoogleError(code);
    }
  }

  if (authLoading) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <p className="profile-page__lede">Checking session…</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="page profile-page">
        <div className="dashboard__inner dashboard__inner--wide">
          <div className="profile-page__sign-in-shell">
            <header className="profile-page__sign-header">
              <p className="dashboard__eyebrow">Your account</p>
              <h2 className="profile-page__title">History</h2>
              <p className="profile-page__lede">
                Sign in with Google to sync your Write Up hisstory to the server and see your saved writing history details here.
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
        </div>
      </section>
    );
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
            onClick={() => retry()}
            disabled={loading}
          >
            Refresh
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

        {activeTab === TAB_CORRECTIONS && canLoadHistory && error && (
          <p className="history-page__note" role="alert">
            Could not load history ({error.code || error.message}). Set <code>VITE_DEBUG_APP_USER</code> for local
            app-api bypass, or sign in with Firebase.
          </p>
        )}
        {!canLoadHistory && (
          <p className="history-page__note" role="alert">
            Syncing your session…
          </p>
        )}
        <p className="history-page__hint">
          <strong>Correction history</strong> lists suggestions you accepted. <strong>Leave as written</strong> lists
          suggestions you declined.
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
                      {emptyCorrections
                        ? docId
                          ? "No saved suggestions for this document yet."
                          : "No saved suggestions for your account yet."
                        : null}
                    </>
                  ) : (
                    <>
                      {docId
                        ? "No declined suggestions for this document yet."
                        : "No declined suggestions for your account yet."}
                    </>
                  )}
                </p>
              ) : (
                listForTab.map((item) => (
                  <div key={item.id} className="history-page__item history-page__split" role="listitem">
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

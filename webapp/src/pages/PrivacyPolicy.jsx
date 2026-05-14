const policySections = [
  {
    title: "Google account and authentication",
    body:
      "Write Up centers on signing in with a Google account so feedback can be connected to the right user. We may save account identifiers such as your name, email address, profile image, user id, session state, and authentication tokens needed to keep you signed in. Google sign-in does not give Write Up your raw Google password.",
  },
  {
    title: "Writing and coaching activity",
    body:
      "The product may save writing samples, document identifiers, feedback history, suggested corrections, explanations, accepted suggestions, dismissed suggestions, profile preferences, and onboarding responses. This helps the coach notice patterns over time instead of treating each draft as a one-time correction.",
  },
  {
    title: "User activity and interaction context",
    body:
      "When the browser extension is active, Write Up may use interaction context such as the active page, selected text, focus state, cursor or mouse position, scroll position, and coaching button activity. These signals help the assistant understand where you are writing and which suggestion belongs to which part of the page.",
  },
  {
    title: "Website and document content",
    body:
      "To provide writing guidance, Write Up may process text you write, surrounding document text, website content, images, sounds, or other page material when that context is needed for a useful suggestion. The goal is to support the writing task in front of you, not to monitor unrelated browsing.",
  },
];

export default function PrivacyPolicy() {
  return (
    <section className="page privacy-page" aria-labelledby="privacy-title">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="privacy-page__header">
          <p className="dashboard__eyebrow">Data transparency</p>
          <h2 id="privacy-title" className="privacy-page__title">
            Privacy Policy
          </h2>
          <p className="privacy-page__lede">
            Write Up helps signed-in users improve their writing by observing writing context,
            generating AI coaching suggestions, and saving useful feedback history. This page
            explains the main kinds of information the product may collect, process, and store.
          </p>
        </header>

        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Google sign-in | AI writing support | saved feedback history</span>
        </div>

        <section className="privacy-page__intro" aria-labelledby="privacy-summary-title">
          <h3 id="privacy-summary-title" className="privacy-page__section-title">
            What Write Up is designed to do
          </h3>
          <p>
            Users sign in with Google, write in supported websites or documents, and receive
            AI-generated suggestions that explain how their writing can become clearer, stronger,
            or more intentional. Write Up may save information from those coaching sessions so the
            experience can remember progress, show history, and personalize future feedback.
          </p>
        </section>

        <section className="privacy-page__section" aria-labelledby="privacy-data-title">
          <h3 id="privacy-data-title" className="privacy-page__section-title">
            Information we may save or process
          </h3>
          <div className="privacy-page__card-grid">
            {policySections.map((section) => (
              <article className="privacy-page__card" key={section.title}>
                <h4>{section.title}</h4>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="privacy-page__notice" aria-labelledby="privacy-ai-title">
          <h3 id="privacy-ai-title" className="privacy-page__section-title">
            AI processing and storage
          </h3>
          <p>
            Writing context and feedback requests may be sent to backend services and AI systems to
            generate suggestions. Saved information may be associated with your signed-in account so
            you can review past coaching, continue onboarding, and help the assistant avoid repeating
            suggestions you dismissed.
          </p>
        </section>

        <section className="privacy-page__notice privacy-page__notice--muted" aria-labelledby="privacy-control-title">
          <h3 id="privacy-control-title" className="privacy-page__section-title">
            Your control
          </h3>
          <p>
            You can choose whether to sign in, whether to use the extension on a page, and whether
            to submit writing samples or request feedback. If a feature is not active, Write Up
            should not need to collect the related writing or interaction context.
          </p>
        </section>
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";

const pillars = [
  {
    title: "Patterns, not patches",
    body:
      "Writers deserve a roadmap of recurring issues across drafts—syntax, tone, vocabulary—not only the last typo an algorithm noticed.",
  },
  {
    title: "Teach beside you—not over you",
    body:
      "Write Up separates “help me learn” from “fix it for me”: plain explanations and small practice loops so understanding sticks.",
  },
  {
    title: "Your voice stays yours",
    body:
      "Feedback should not flatten dialect or polish away how you sound. Improvement means clearer choices, not a homogenized template.",
  },
];

const audiences = [
  "Students and multilingual writers balancing school or work deadlines",
  "People rebuilding confidence after uneven writing instruction",
  "Anyone told they “already know English” yet rarely get nuanced, sustained support",
];

export default function Dashboard() {
  return (
    <section className="page dashboard dashboard--home" aria-labelledby="dash-home-title">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="dashboard__hero">
          <p className="dashboard__eyebrow">Browser extension · learning-first writing coach</p>
          <h2 id="dash-home-title" className="dashboard__headline">
            Write better with guidance that learns <em className="dashboard__emph">with</em> you—not for you.
          </h2>
          <p className="dashboard__lede">
            Write Up sits alongside you as you compose, similar in spirit to tools you already know—but it resists turning every draft into
            an instant rewrite. It focuses on longitudinal insight, pedagogical explanations, and practice that respects your context and style.
          </p>
          <div className="dashboard__hero-actions">
            <Link className="dashboard__btn dashboard__btn--primary" to="/onboarding">
              Start onboarding
            </Link>
            <Link className="dashboard__btn dashboard__btn--ghost" to="/history">
              View History demo
            </Link>
          </div>
        </header>

        <div className="dashboard__ribbon" aria-hidden="true">
          <span>Draft with clarity · Keep your stance · Improve over time</span>
        </div>

        <section className="dashboard__section" aria-labelledby="pillars-heading">
          <h3 id="pillars-heading" className="dashboard__section-title">
            Built for mastery, not dependency
          </h3>
          <p className="dashboard__section-intro">
            Most products optimize for corrections you accept right away or full rewrites from an assistant. Writers plateau when feedback is
            one-off and ignores their blind spots across essays and reports—especially when reviewers misread dialect, multilingual phrasing,
            or neurodiverse patterns. Write Up treats voice preservation and real learning as design constraints from day one.
          </p>
          <ul className="dashboard__pillar-grid">
            {pillars.map((p) => (
              <li key={p.title} className="dashboard__pillar-card">
                <h4 className="dashboard__pillar-title">{p.title}</h4>
                <p className="dashboard__pillar-body">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="dashboard__section dashboard__section--split" aria-labelledby="audience-heading">
          <div>
            <h3 id="audience-heading" className="dashboard__section-title">
              Who stands to gain most
            </h3>
            <p className="dashboard__section-intro">
              Uneven access to mentorship, brittle trust in grammar tools, and implicit bias against non-dominant Englishes make writing
              support deeply unfair. We aim to widen the aperture for learners who routinely get punished for sounding like themselves or for
              using English differently.
            </p>
          </div>
          <ul className="dashboard__audience-list">
            {audiences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <figure className="dashboard__pullquote">
          <blockquote>
            How might we help writers see persistent patterns in their own work, get plain-language explanations, and complete targeted
            practice anchored in their real contexts and voice—without rewriting for them or flattening dialect—as we build lasting skill?
          </blockquote>
          <figcaption className="dashboard__cite">Prompt from the Write Up Problem Framing Canvas · April&nbsp;2026</figcaption>
        </figure>

        <footer className="dashboard__footer-cta">
          <p className="dashboard__footer-copy">
            The extension is shaping up as a conscientious collaborator: diagnosing trends, illuminating why something matters pedagogically,
            and offering bite-sized rehearsals instead of laundering your prose through generic “perfect English.” Explore the onboarding flow or
            open History to skim the scaffolding we iterate on inside the classroom.
          </p>
          <div className="dashboard__hero-actions">
            <Link className="dashboard__btn dashboard__btn--primary" to="/onboarding">
              Continue to onboarding
            </Link>
            <Link className="dashboard__btn dashboard__btn--ghost" to="/profile">
              Open profile
            </Link>
          </div>
        </footer>
      </div>
    </section>
  );
}

import { Link } from "react-router-dom";

const pillars = [
  {
    title: "Patterns, not patches",
    body:
      "See recurring issues across drafts—syntax, tone, vocabulary—not just the last typo an algorithm noticed.",
  },
  {
    title: "Teach beside you",
    body:
      "Write Up separates “help me learn” from “fix it for me”: plain explanations and small practice loops so understanding sticks.",
  },
  {
    title: "Your voice stays yours",
    body:
      "Feedback shouldn’t flatten dialect or polish away how you sound - improvement means clearer choices.",
  },
];

export default function Dashboard() {
  return (
    <section className="page dashboard dashboard--home" aria-labelledby="dash-home-title">
      <div className="dashboard__inner dashboard__inner--wide">
        <header className="dashboard__hero">
          <p className="dashboard__eyebrow">Learning-first writing coach</p>
          <h2 id="dash-home-title" className="dashboard__headline">
            Write better with guidance that learns <em className="dashboard__emph">with</em> you—not for you.
          </h2>
          <p className="dashboard__lede">
            Write Up sits alongside you as you compose. Instead of rewriting your draft, it points out
            recurring patterns, explains feedback in plain language, and keeps your voice intact.
          </p>
          <div className="dashboard__hero-actions">
            <Link className="dashboard__btn dashboard__btn--primary" to="/write">
              Open web editor
            </Link>
            <Link className="dashboard__btn dashboard__btn--ghost" to="/history">
              View History
            </Link>
          </div>
        </header>

        <section className="dashboard__section" aria-labelledby="pillars-heading">
          <h3 id="pillars-heading" className="dashboard__section-title">
            What makes Write Up different
          </h3>
          <ul className="dashboard__pillar-grid">
            {pillars.map((p) => (
              <li key={p.title} className="dashboard__pillar-card">
                <h4 className="dashboard__pillar-title">{p.title}</h4>
                <p className="dashboard__pillar-body">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

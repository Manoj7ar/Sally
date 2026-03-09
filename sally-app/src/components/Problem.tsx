import { useScrollReveal } from '../hooks/useScrollReveal';

const stats = [
  { number: '2.2B', label: 'PEOPLE WITH VISION IMPAIRMENT WORLDWIDE' },
  { number: '96%', label: 'OF WEBSITES FAIL BASIC ACCESSIBILITY' },
  { number: '3–5×', label: 'LONGER TO COMPLETE BASIC TASKS' },
  { number: '1', label: 'VOICE IS ALL YOU NEED' },
];

export function Problem() {
  const textRef = useScrollReveal<HTMLDivElement>(0);
  const visualRef = useScrollReveal<HTMLDivElement>(150);
  const statsRef = useScrollReveal<HTMLDivElement>(300);

  return (
    <section className="problem-section" aria-label="The problem">
      <div className="problem-bg" aria-hidden="true" />
      <div className="container">
        <div className="problem-grid">
          <div className="problem-content reveal" ref={textRef}>
            <div className="problem-accent" aria-hidden="true" />
            <h2 className="problem-headline">
              Blind and low-vision users<br />
              <span className="problem-headline-gold">are locked out of the web.</span>
            </h2>

            <div className="problem-paragraphs">
              <p>
                Students applying for university. Job seekers filling out applications. People managing their finances or booking a GP appointment. For 2.2 billion people with vision impairment, these everyday tasks are daily battles.
              </p>
              <p>
                Screen readers haven't fundamentally changed in decades. They read elements one by one, left to right — forcing users to memorise the layout of every page. And 96% of websites are still built without accessibility in mind.
              </p>
              <p>
                The result: blind and low-vision users spend 3&ndash;5× longer on tasks sighted users complete in seconds. Online banking, job applications, healthcare portals — entire workflows become impossible.
              </p>
              <p>
                Claude AI can now understand web pages, reason about their content, and take action. We built Sally to put that power directly in the hands of the people who need it most — while keeping them in full control.
              </p>
            </div>
          </div>

          {/* Visual: mock inaccessible screen with Sally scan overlay */}
          <div className="problem-visual reveal" ref={visualRef} aria-hidden="true">
            <div className="pv-screen">
              <div className="pv-topbar">
                <div className="pv-dots">
                  <span /><span /><span />
                </div>
                <div className="pv-url" />
              </div>
              <div className="pv-body">
                {/* Simulated chaotic UI elements */}
                <div className="pv-row">
                  <div className="pv-block pv-block--nav" />
                  <div className="pv-block pv-block--nav pv-block--short" />
                  <div className="pv-block pv-block--nav pv-block--short" />
                  <div className="pv-block pv-block--nav" />
                </div>
                <div className="pv-hero-block" />
                <div className="pv-row pv-row--icons">
                  <div className="pv-icon-btn" />
                  <div className="pv-icon-btn" />
                  <div className="pv-icon-btn" />
                  <div className="pv-icon-btn" />
                  <div className="pv-icon-btn" />
                </div>
                <div className="pv-row pv-row--text">
                  <div className="pv-text-line" style={{ width: '80%' }} />
                  <div className="pv-text-line" style={{ width: '65%' }} />
                  <div className="pv-text-line" style={{ width: '90%' }} />
                  <div className="pv-text-line" style={{ width: '40%' }} />
                </div>
                <div className="pv-row pv-row--cards">
                  <div className="pv-card" />
                  <div className="pv-card" />
                  <div className="pv-card" />
                </div>

                {/* Gold scanning line */}
                <div className="pv-scan-line" />
              </div>

              {/* Sally overlay badge */}
              <div className="pv-sally-badge">
                <div className="pv-sally-dot" />
                <span>Sally is reading this screen</span>
              </div>
            </div>
          </div>
        </div>

        <div className="problem-stats reveal" ref={statsRef}>
          {stats.map((s, i) => (
            <div className="problem-stat" key={i}>
              <div className="problem-stat-number">{s.number}</div>
              <div className="problem-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

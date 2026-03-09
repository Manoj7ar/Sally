import { useState } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

interface Scenario {
  task: string;
  before: { steps: string[]; time: string; frustration: string };
  after: { steps: string[]; time: string };
}

const scenarios: Scenario[] = [
  {
    task: 'Check and reply to an email',
    before: {
      steps: [
        'Open screen reader',
        'Tab through 40+ elements to reach inbox',
        'Arrow-key through message list',
        'Listen to full headers for each email',
        'Open message, navigate to reply button',
        'Tab into text field, compose, tab to send',
      ],
      time: '8–12 minutes',
      frustration: 'Missing the reply button requires starting over',
    },
    after: {
      steps: [
        '"Hey Sally, read my latest email"',
        '"Reply: Sounds good, see you at 3"',
      ],
      time: '30 seconds',
    },
  },
  {
    task: 'Fill out a job application',
    before: {
      steps: [
        'Navigate to form — often unlabeled fields',
        'Guess which field is "name" vs "email"',
        'Tab through dropdowns with no descriptions',
        'Upload resume — file picker is inaccessible',
        'Find and click submit (if you can find it)',
      ],
      time: '25–45 minutes',
      frustration: 'Many users give up entirely',
    },
    after: {
      steps: [
        '"Sally, fill out this application for me"',
        'Sally reads each field and asks for your answers',
        '"Submit it"',
      ],
      time: '3 minutes',
    },
  },
  {
    task: 'Shop for groceries online',
    before: {
      steps: [
        'Search for items — results are image-heavy',
        'Can\'t tell product images from ads',
        'Add-to-cart buttons are unlabeled icons',
        'Cart total is hidden in a dynamic widget',
        'Checkout form has CAPTCHA',
      ],
      time: '30+ minutes',
      frustration: 'Wrong items, missed deals, abandoned carts',
    },
    after: {
      steps: [
        '"Add milk, bread, and eggs to my cart"',
        '"What\'s my total?"',
        '"Check out"',
      ],
      time: '2 minutes',
    },
  },
];

export function Journey() {
  const [activeIdx, setActiveIdx] = useState(0);
  const sectionRef = useScrollReveal<HTMLDivElement>(0);
  const contentRef = useScrollReveal<HTMLDivElement>(200);

  const scenario = scenarios[activeIdx];

  return (
    <>
      <style>{`
        .journey-section {
          background: #0a0a0f;
          padding: 100px 0;
        }

        .journey-section .section-tag {
          color: var(--accent-gold);
        }

        .journey-section .section-label {
          color: #ffffff;
        }

        .journey-section .section-sub {
          color: rgba(255, 255, 255, 0.5);
        }

        .journey-tabs {
          display: flex;
          gap: 12px;
          margin-bottom: 48px;
          flex-wrap: wrap;
        }

        .journey-tab {
          padding: 10px 22px;
          border-radius: 100px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-family: var(--font-body);
          font-size: 0.88rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
        }

        .journey-tab:hover {
          border-color: rgba(37, 99, 235, 0.3);
          color: rgba(255, 255, 255, 0.8);
        }

        .journey-tab--active {
          border-color: var(--accent-gold);
          background: rgba(37, 99, 235, 0.1);
          color: var(--accent-gold);
        }

        .journey-comparison {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          align-items: start;
        }

        .journey-col {
          border-radius: 16px;
          padding: 32px;
          position: relative;
        }

        .journey-col--before {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .journey-col--after {
          background: rgba(37, 99, 235, 0.06);
          border: 1px solid rgba(37, 99, 235, 0.2);
        }

        .journey-col-badge {
          display: inline-block;
          font-family: var(--font-mono);
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 4px 12px;
          border-radius: 100px;
          margin-bottom: 20px;
        }

        .journey-col--before .journey-col-badge {
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.4);
        }

        .journey-col--after .journey-col-badge {
          background: rgba(37, 99, 235, 0.15);
          color: var(--accent-gold);
        }

        .journey-steps {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
        }

        .journey-step {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .journey-col--before .journey-step {
          color: rgba(255, 255, 255, 0.45);
        }

        .journey-col--after .journey-step {
          color: rgba(255, 255, 255, 0.8);
        }

        .journey-step-num {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-mono);
          font-size: 0.65rem;
          font-weight: 700;
          margin-top: 1px;
        }

        .journey-col--before .journey-step-num {
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.3);
        }

        .journey-col--after .journey-step-num {
          background: rgba(37, 99, 235, 0.2);
          color: var(--accent-gold);
        }

        .journey-meta {
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .journey-col--after .journey-meta {
          border-top-color: rgba(37, 99, 235, 0.15);
        }

        .journey-meta-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
        }

        .journey-meta-label {
          font-family: var(--font-mono);
          font-size: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.3);
          min-width: 80px;
        }

        .journey-meta-value {
          font-weight: 600;
        }

        .journey-col--before .journey-meta-value {
          color: rgba(255, 255, 255, 0.5);
        }

        .journey-col--after .journey-meta-value {
          color: var(--accent-gold);
        }

        .journey-frustration {
          font-size: 0.8rem;
          color: rgba(239, 68, 68, 0.6);
          font-style: italic;
          margin-top: 4px;
        }

        @media (max-width: 768px) {
          .journey-comparison {
            grid-template-columns: 1fr;
            gap: 20px;
          }

          .journey-col {
            padding: 24px 20px;
          }

          .journey-tabs {
            justify-content: center;
          }

          .journey-section {
            padding: 64px 0;
          }
        }
      `}</style>

      <section className="journey-section" id="journey" aria-label="Before and after Sally">
        <div className="container">
          <div className="reveal" ref={sectionRef}>
            <SectionHeader
              tag="BEFORE & AFTER"
              label="The difference Sally makes"
              sub="Real tasks. Real time savings. See how Sally transforms everyday computing."
            />
          </div>

          <div className="reveal" ref={contentRef}>
            <div className="journey-tabs" role="tablist">
              {scenarios.map((s, i) => (
                <button
                  key={i}
                  className={`journey-tab${activeIdx === i ? ' journey-tab--active' : ''}`}
                  onClick={() => setActiveIdx(i)}
                  role="tab"
                  aria-selected={activeIdx === i}
                >
                  {s.task}
                </button>
              ))}
            </div>

            <div className="journey-comparison" role="tabpanel">
              <div className="journey-col journey-col--before">
                <span className="journey-col-badge">Without Sally</span>
                <ol className="journey-steps">
                  {scenario.before.steps.map((step, i) => (
                    <li className="journey-step" key={i}>
                      <span className="journey-step-num">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="journey-meta">
                  <div className="journey-meta-row">
                    <span className="journey-meta-label">Time</span>
                    <span className="journey-meta-value">{scenario.before.time}</span>
                  </div>
                  <p className="journey-frustration">{scenario.before.frustration}</p>
                </div>
              </div>

              <div className="journey-col journey-col--after">
                <span className="journey-col-badge">With Sally</span>
                <ol className="journey-steps">
                  {scenario.after.steps.map((step, i) => (
                    <li className="journey-step" key={i}>
                      <span className="journey-step-num">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="journey-meta">
                  <div className="journey-meta-row">
                    <span className="journey-meta-label">Time</span>
                    <span className="journey-meta-value">{scenario.after.time}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

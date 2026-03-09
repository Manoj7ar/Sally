import { useEffect, useRef, useState } from 'react';
import { useInView } from '../hooks/useInView';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

const issues = [
  '4 unlabeled buttons',
  '2 images missing alt text',
  'Confusing navigation structure',
  'Low color contrast in footer',
];

const WarningIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M10 2L1 17h18L10 2z" />
    <line x1="10" y1="8" x2="10" y2="12" />
    <circle cx="10" cy="14.5" r="0.8" fill="currentColor" />
  </svg>
);

export function AccessibilityScore() {
  const { ref: sectionRef, inView } = useInView<HTMLElement>(0.3);
  const [scoreValue, setScoreValue] = useState(0);
  const [circleAnimated, setCircleAnimated] = useState(false);
  const animatedRef = useRef(false);
  const containerRef = useScrollReveal<HTMLDivElement>();

  useEffect(() => {
    if (inView && !animatedRef.current) {
      animatedRef.current = true;
      setCircleAnimated(true);

      // Animate number
      const start = performance.now();
      const duration = 1500;
      const target = 62;

      function step(timestamp: number) {
        const progress = Math.min((timestamp - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setScoreValue(Math.round(target * eased));
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }

      requestAnimationFrame(step);
    }
  }, [inView]);

  return (
    <section className="score-section" id="score-section" aria-label="Accessibility scoring" ref={sectionRef}>
      <div className="container">
        <SectionHeader
          tag="SCORING"
          label="Every site, scored"
          sub="Sally analyzes accessibility in real-time."
          subStyle={{ margin: '0 auto 56px' }}
        />

        <div className="score-container reveal" ref={containerRef}>
          <div className="score-gauge" role="img" aria-label="Accessibility score: 62 out of 100">
            <svg width="200" height="200" viewBox="0 0 200 200">
              <defs>
                <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2563EB" />
                  <stop offset="100%" stopColor="#1D4ED8" />
                </linearGradient>
              </defs>
              <circle className="score-circle-bg" cx="100" cy="100" r="90" />
              <circle
                className={`score-circle-fill${circleAnimated ? ' animated' : ''}`}
                cx="100"
                cy="100"
                r="90"
              />
            </svg>
            <div className="score-number">
              <div className="score-value">{scoreValue}</div>
              <div className="score-total">/ 100</div>
            </div>
          </div>

          <ul className="score-issues" role="list" aria-label="Accessibility issues found">
            {issues.map((issue, i) => (
              <li className="score-issue" key={i}>
                <WarningIcon />
                {issue}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

const steps = [
  {
    label: 'You speak',
    desc: 'Just say what you need \u2014 no menus, no buttons',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="9" y="3" width="10" height="15" rx="5" />
        <path d="M5 15a9 9 0 0018 0" />
        <line x1="14" y1="24" x2="14" y2="27" />
      </svg>
    ),
  },
  {
    label: 'Sally listens',
    desc: 'Your words are captured instantly',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M3 20h3l2-6 3 10 3-14 3 10 2-4h6" />
      </svg>
    ),
  },
  {
    label: 'Claude reasons',
    desc: 'Claude AI interprets your intent in full context',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="14" cy="14" r="10" />
        <path d="M14 8v4l3 3" />
        <circle cx="14" cy="14" r="3" />
      </svg>
    ),
  },
  {
    label: 'Reads the page',
    desc: 'Sally sees and understands the full web page',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="3" width="22" height="22" rx="3" />
        <line x1="3" y1="10" x2="25" y2="10" />
        <line x1="10" y1="10" x2="10" y2="25" />
      </svg>
    ),
  },
  {
    label: 'Takes action',
    desc: 'Clicks, types, and navigates for you',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="5" width="22" height="18" rx="2" />
        <line x1="3" y1="10" x2="25" y2="10" />
        <circle cx="7" cy="7.5" r="1" fill="currentColor" />
        <circle cx="10" cy="7.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Speaks back',
    desc: 'You hear the results read aloud',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M14 3v5" />
        <path d="M9 10h10a3 3 0 013 3v1a8 8 0 01-16 0v-1a3 3 0 013-3z" />
        <path d="M10 22l-2 4" />
        <path d="M18 22l2 4" />
      </svg>
    ),
  },
];

export function HowItWorks() {
  const pipelineRef = useScrollReveal<HTMLDivElement>();

  return (
    <section className="how-it-works" id="how-it-works" aria-label="How it works">
      <div className="container">
        <SectionHeader
          tag="HOW IT WORKS"
          label="How Sally works"
          sub="Hold a key, speak naturally, hear the result. Claude AI handles the rest — and always asks before acting on anything important."
        />
        <div className="pipeline reveal" ref={pipelineRef} role="list" aria-label="Pipeline steps">
          {steps.map((step, i) => (
            <div className="pipeline-step" role="listitem" key={i}>
              <div className="pipeline-icon" aria-hidden="true">
                {step.icon}
              </div>
              <span>{step.label}</span>
              <p className="pipeline-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

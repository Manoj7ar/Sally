import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

const platforms = [
  {
    name: 'macOS',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    name: 'Windows',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 12V6.75l6-1.32v6.48L3 12zm6.13.18l.01 6.55-6.14.93V12.3l6.13-.12zm.77-8.08l8.08-2.08v9.87l-8.08.09V4.1zM18 13.18l-.01 9.8-8.08-1.16V13.08l8.09.1z"/>
      </svg>
    ),
  },
  {
    name: 'Chrome',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3a7 7 0 016.33 4H12a5 5 0 00-4.9 4H3.07A10 10 0 0112 5zm-5 7a5 5 0 015-5 5 5 0 015 5 5 5 0 01-5 5 5 5 0 01-5-5zm5 3a3 3 0 100-6 3 3 0 000 6z"/>
      </svg>
    ),
  },
  {
    name: 'Safari',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1.31-4.13l1.77-5.25 5.25-1.77-1.77 5.25-5.25 1.77zm1.31-4.2a1.33 1.33 0 100 2.66 1.33 1.33 0 000-2.66z"/>
      </svg>
    ),
  },
  {
    name: 'Gmail',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
      </svg>
    ),
  },
  {
    name: 'Word',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 17H8l-.5-2.5h-.03L7 19H4l-1.5-6h1.3l.85 3.5h.03L5.5 13h1l.82 3.5h.03L8.2 13h1.3L8 19zm5-9h-5V4l5 5z"/>
      </svg>
    ),
  },
  {
    name: 'Sheets',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h4v4H7V7zm6 0h4v4h-4V7zM7 13h4v4H7v-4zm6 0h4v4h-4v-4z"/>
      </svg>
    ),
  },
  {
    name: 'Finder',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
      </svg>
    ),
  },
  {
    name: 'Slack',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 15a2 2 0 01-2 2 2 2 0 01-2-2 2 2 0 012-2h2v2zm1 0a2 2 0 012-2 2 2 0 012 2v5a2 2 0 01-2 2 2 2 0 01-2-2v-5zm2-8a2 2 0 01-2-2 2 2 0 012-2 2 2 0 012 2v2H9zm0 1a2 2 0 012 2 2 2 0 01-2 2H4a2 2 0 01-2-2 2 2 0 012-2h5zm8 2a2 2 0 012-2 2 2 0 012 2 2 2 0 01-2 2h-2v-2zm-1 0a2 2 0 01-2 2 2 2 0 01-2-2V5a2 2 0 012-2 2 2 0 012 2v5zm-2 8a2 2 0 012 2 2 2 0 01-2 2 2 2 0 01-2-2v-2h2zm0-1a2 2 0 01-2-2 2 2 0 012-2h5a2 2 0 012 2 2 2 0 01-2 2h-5z"/>
      </svg>
    ),
  },
  {
    name: 'Zoom',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M2 6a2 2 0 012-2h10a2 2 0 012 2v4.5l4-3v9l-4-3V18a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
      </svg>
    ),
  },
  {
    name: 'Spotify',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.2.3-.56.4-.88.24-2.4-1.47-5.42-1.8-8.98-.99-.34.08-.7-.14-.78-.48s.14-.7.48-.78c3.88-.89 7.22-.5 9.92 1.13.32.2.42.56.24.88zm1.22-2.72c-.24.38-.76.5-1.14.26-2.76-1.7-6.96-2.19-10.22-1.2-.42.12-.86-.12-.98-.54s.12-.86.54-.98c3.72-1.13 8.34-.58 11.54 1.36.36.24.5.76.26 1.1zm.1-2.84c-3.3-1.96-8.76-2.14-11.92-1.18-.5.16-1.04-.12-1.2-.62s.12-1.04.62-1.2c3.62-1.1 9.64-.89 13.44 1.36.46.28.6.86.34 1.32-.28.44-.86.6-1.32.32z"/>
      </svg>
    ),
  },
  {
    name: 'VS Code',
    logo: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 2l4 2v16l-4 2-8.5-7L5 18.5 2 17V7l3-1.5L8.5 9 17 2zm0 3.5v13l-5.5-6.5L17 5.5zM5 7.72v8.56l3-3.56L5 7.72z"/>
      </svg>
    ),
  },
];

export function Platforms() {
  const ref = useScrollReveal<HTMLDivElement>();

  // Duplicate for seamless loop
  const doubled = [...platforms, ...platforms];

  return (
    <>
      <style>{`
        .platform-logo {
          width: 28px;
          height: 28px;
          color: var(--text-secondary);
          flex-shrink: 0;
          transition: color 0.3s;
        }

        .platform-card:hover .platform-logo {
          color: var(--accent-gold);
        }
      `}</style>

      <section className="platforms-section" aria-label="Supported platforms">
        <div className="container">
          <SectionHeader
            tag="WORKS EVERYWHERE"
            label="One voice, every app"
            sub="Sally works across your operating system, browsers, and applications."
          />
        </div>
        <div className="platforms-marquee-wrap reveal" ref={ref}>
          <div className="platforms-marquee">
            {doubled.map((p, i) => (
              <div className="platform-card" key={i}>
                <span className="platform-logo" aria-hidden="true">{p.logo}</span>
                <span className="platform-name">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

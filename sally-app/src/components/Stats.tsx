import { useScrollReveal } from '../hooks/useScrollReveal';

interface Stat {
  number: string;
  label: string;
  desc: string;
}

const stats: Stat[] = [
  { number: '100%', label: 'Voice Controlled', desc: 'No keyboard or mouse needed' },
  { number: '5+', label: 'Platforms', desc: 'macOS, Windows, web browsers, and more' },
  { number: '\u221E', label: 'Possibilities', desc: 'If you can say it, Sally can do it' },
];

export function Stats() {
  const ref = useScrollReveal<HTMLDivElement>();
  return (
    <section className="stats-section" aria-label="Impact numbers">
      <div className="container">
        <div className="stats-grid reveal" ref={ref}>
          {stats.map((s, i) => (
            <div className="stats-item" key={i}>
              <div className="stats-number">{s.number}</div>
              <div className="stats-label">{s.label}</div>
              <p className="stats-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

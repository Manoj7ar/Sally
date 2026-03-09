import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

const rows = [
  {
    feature: 'Navigation',
    traditional: 'Linear, element-by-element',
    sally: 'Contextual, intent-based',
  },
  {
    feature: 'Learning Curve',
    traditional: 'Weeks of training',
    sally: 'Start talking immediately',
  },
  {
    feature: 'Web Compatibility',
    traditional: 'Only ARIA-labelled sites',
    sally: 'Any website, accessible or not',
  },
  {
    feature: 'Screen Understanding',
    traditional: 'Reads labels/ARIA tags only',
    sally: 'Claude AI sees and reasons about the full page',
  },
  {
    feature: 'Voice Feedback',
    traditional: 'Robotic, monotone narration',
    sally: 'Natural, conversational responses via ElevenLabs',
  },
  {
    feature: 'Form Filling',
    traditional: 'Manual tab-through every field',
    sally: 'Automatic, intelligent — even on unlabelled forms',
  },
  {
    feature: 'User Control',
    traditional: 'No safeguards for mistakes',
    sally: 'Confirms with you before every irreversible action',
  },
  {
    feature: 'Multi-step Tasks',
    traditional: 'Manual, step-by-step',
    sally: 'Single voice command, narrated throughout',
  },
];

export function Comparison() {
  const tableRef = useScrollReveal<HTMLDivElement>(200);

  return (
    <>
      <style>{`
        .comp-section {
          padding: 120px 0;
          background: var(--bg-secondary);
        }

        .comp-table-wrap {
          max-width: 900px;
          margin: 48px auto 0;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: var(--bg-card);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
        }

        .comp-table {
          width: 100%;
          border-collapse: collapse;
        }

        .comp-table thead th {
          padding: 20px 24px;
          font-family: var(--font-heading);
          font-size: 0.875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .comp-th-feature {
          color: var(--text-muted);
          background: var(--bg-card);
          width: 26%;
        }

        .comp-th-traditional {
          color: var(--text-secondary);
          background: #f8f8f8;
          width: 37%;
          border-left: 1px solid var(--border);
        }

        .comp-th-sally {
          color: var(--accent-gold);
          background: rgba(37, 99, 235, 0.06);
          border-top: 3px solid var(--accent-gold);
          width: 37%;
          border-left: 1px solid var(--border);
        }

        .comp-th-sally-inner {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .comp-badge {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--accent-gold);
          color: #fff;
          line-height: 1.6;
        }

        .comp-table tbody tr {
          border-bottom: 1px solid var(--border);
        }

        .comp-table tbody tr:last-child {
          border-bottom: none;
        }

        .comp-table tbody td {
          padding: 16px 24px;
          font-family: var(--font-body);
          font-size: 0.938rem;
          line-height: 1.5;
          vertical-align: middle;
        }

        .comp-td-feature {
          font-weight: 600;
          color: var(--text-primary);
        }

        .comp-td-traditional {
          color: var(--text-secondary);
          background: #fafafa;
          border-left: 1px solid var(--border);
        }

        .comp-td-sally {
          color: var(--text-primary);
          background: rgba(37, 99, 235, 0.04);
          border-left: 1px solid var(--border);
          font-weight: 500;
        }

        .comp-icon-x {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #f1f1f1;
          color: #a1a1aa;
          font-size: 0.75rem;
          font-weight: 700;
          margin-right: 10px;
          flex-shrink: 0;
        }

        .comp-icon-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(37, 99, 235, 0.15);
          color: var(--accent-gold);
          font-size: 0.75rem;
          font-weight: 700;
          margin-right: 10px;
          flex-shrink: 0;
        }

        .comp-cell-content {
          display: flex;
          align-items: center;
        }

        /* Mobile: card layout */
        .comp-cards {
          display: none;
          max-width: 500px;
          margin: 48px auto 0;
          flex-direction: column;
          gap: 16px;
        }

        .comp-card {
          border-radius: 14px;
          border: 1px solid var(--border);
          overflow: hidden;
          background: var(--bg-card);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
        }

        .comp-card-feature {
          padding: 14px 20px;
          font-family: var(--font-heading);
          font-weight: 700;
          font-size: 0.938rem;
          color: var(--text-primary);
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
        }

        .comp-card-row {
          display: flex;
          align-items: flex-start;
          padding: 12px 20px;
          gap: 10px;
          font-family: var(--font-body);
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .comp-card-row + .comp-card-row {
          border-top: 1px solid var(--border);
        }

        .comp-card-row--trad {
          color: var(--text-secondary);
          background: #fafafa;
        }

        .comp-card-row--sally {
          color: var(--text-primary);
          background: rgba(37, 99, 235, 0.04);
          font-weight: 500;
        }

        .comp-card-label {
          font-size: 0.688rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          min-width: 80px;
          flex-shrink: 0;
          padding-top: 1px;
        }

        .comp-card-label--sally {
          color: var(--accent-gold);
        }

        @media (max-width: 740px) {
          .comp-table-wrap {
            display: none;
          }
          .comp-cards {
            display: flex;
          }
          .comp-section {
            padding: 80px 0;
          }
        }
      `}</style>

      <section id="comparison" className="comp-section" aria-label="Comparison">
        <div className="container">
          <SectionHeader
            tag="COMPARISON"
            label="A better way forward"
            sub="See how Sally compares to traditional assistive technology."
          />

          {/* Desktop table */}
          <div className="comp-table-wrap reveal" ref={tableRef}>
            <table className="comp-table">
              <thead>
                <tr>
                  <th className="comp-th-feature">Feature</th>
                  <th className="comp-th-traditional">Traditional Screen Readers</th>
                  <th className="comp-th-sally">
                    <span className="comp-th-sally-inner">
                      Sally <span className="comp-badge">NEW</span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="comp-td-feature">{row.feature}</td>
                    <td className="comp-td-traditional">
                      <span className="comp-cell-content">
                        <span className="comp-icon-x" aria-hidden="true">✕</span>
                        {row.traditional}
                      </span>
                    </td>
                    <td className="comp-td-sally">
                      <span className="comp-cell-content">
                        <span className="comp-icon-check" aria-hidden="true">✓</span>
                        {row.sally}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="comp-cards">
            {rows.map((row, i) => (
              <div className="comp-card" key={i}>
                <div className="comp-card-feature">{row.feature}</div>
                <div className="comp-card-row comp-card-row--trad">
                  <span className="comp-card-label">Traditional</span>
                  <span className="comp-cell-content">
                    <span className="comp-icon-x" aria-hidden="true">✕</span>
                    {row.traditional}
                  </span>
                </div>
                <div className="comp-card-row comp-card-row--sally">
                  <span className="comp-card-label comp-card-label--sally">Sally</span>
                  <span className="comp-cell-content">
                    <span className="comp-icon-check" aria-hidden="true">✓</span>
                    {row.sally}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

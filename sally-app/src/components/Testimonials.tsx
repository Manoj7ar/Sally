import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

const testimonials = [
  {
    quote:
      "Before Sally, filling out a simple online form could take me twenty minutes of tab-cycling and guesswork. Now I just say what I need and it's done. I registered for my college courses in under three minutes.",
    name: 'Marcus J.',
    role: 'College Student',
  },
  {
    quote:
      "I retired from teaching, not from life. But every website redesign made me feel more and more shut out. Sally gave me back my email, my photo albums, my independence. My grandkids can't believe how fast I reply now.",
    name: 'Dorothy R.',
    role: 'Retired Teacher',
  },
  {
    quote:
      "I'm a developer who lost most of my sight two years ago. Screen readers helped, but complex IDEs and code review tools were brutal. Sally understands the layout and reads me exactly what I need. I shipped three PRs my first week using it.",
    name: 'Amir K.',
    role: 'Software Developer',
  },
  {
    quote:
      "Running a small business means invoices, spreadsheets, supplier portals — none of them built with accessibility in mind. Sally navigates all of it for me by voice. For the first time in years, I don't need someone looking over my shoulder.",
    name: 'Linda C.',
    role: 'Business Owner',
  },
];

function GoldStar() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="var(--accent-gold)"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function Testimonials() {
  const cardRefs = [
    useScrollReveal<HTMLDivElement>(0),
    useScrollReveal<HTMLDivElement>(100),
    useScrollReveal<HTMLDivElement>(200),
    useScrollReveal<HTMLDivElement>(300),
  ];

  return (
    <>
      <style>{`
        .testimonial-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
          max-width: 1000px;
          margin: 0 auto;
        }

        .testimonial-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 32px 28px;
          transition: border-color 0.4s, box-shadow 0.4s;
          position: relative;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .testimonial-card::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 13px;
          padding: 1px;
          background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-dark));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.4s;
          pointer-events: none;
        }

        .testimonial-card:hover {
          border-color: transparent;
          box-shadow: 0 0 40px rgba(37, 99, 235, 0.06);
        }

        .testimonial-card:hover::before {
          opacity: 1;
        }

        .testimonial-stars {
          display: flex;
          gap: 2px;
        }

        .testimonial-quote {
          font-size: 0.95rem;
          line-height: 1.7;
          color: var(--text-secondary);
          flex: 1;
        }

        .testimonial-quote::before {
          content: '\\201C';
          font-family: var(--font-heading);
          font-size: 1.6rem;
          font-weight: 700;
          color: var(--accent-gold);
          line-height: 0;
          vertical-align: -0.25em;
          margin-right: 2px;
        }

        .testimonial-quote::after {
          content: '\\201D';
          font-family: var(--font-heading);
          font-size: 1.6rem;
          font-weight: 700;
          color: var(--accent-gold);
          line-height: 0;
          vertical-align: -0.25em;
          margin-left: 2px;
        }

        .testimonial-author {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }

        .testimonial-name {
          font-family: var(--font-heading);
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-primary);
        }

        .testimonial-role {
          font-family: var(--font-mono);
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--accent-gold);
        }

        @media (max-width: 640px) {
          .testimonial-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <section id="testimonials" aria-label="Testimonials">
        <div className="container">
          <SectionHeader
            tag="IMPACT"
            label="Independence restored"
            sub="Real stories from blind and low-vision users whose relationship with the web has changed."
          />

          <div className="testimonial-grid">
            {testimonials.map((t, i) => (
              <div
                className="testimonial-card reveal"
                ref={cardRefs[i]}
                key={i}
              >
                <div className="testimonial-stars" aria-label="5 out of 5 stars">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <GoldStar key={j} />
                  ))}
                </div>
                <p className="testimonial-quote">{t.quote}</p>
                <div className="testimonial-author">
                  <span className="testimonial-name">{t.name}</span>
                  <span className="testimonial-role">{t.role}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

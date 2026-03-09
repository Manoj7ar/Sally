import { useScrollReveal } from '../hooks/useScrollReveal';

const founders = [
  { name: 'Denis', img: '/denis.jpeg', linkedin: 'https://www.linkedin.com/in/denis-romain-9b99b5294/' },
  { name: 'Aryaa', img: '/aryaa.jpeg', linkedin: 'https://www.linkedin.com/in/aryaa-sk-1b343992/' },
  { name: 'Nalin', img: '/nalin.jpeg', linkedin: 'https://www.linkedin.com/in/nalin-atmakur' },
];

export function Founders() {
  const headlineRef = useScrollReveal<HTMLHeadingElement>(0);
  const subRef = useScrollReveal<HTMLParagraphElement>(100);
  const gridRef = useScrollReveal<HTMLDivElement>(200);

  return (
    <>
      <style>{`
        .team-section {
          background: #0a0a0f;
          padding: 100px 0;
          text-align: center;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .team-icon {
          width: 40px;
          height: 40px;
          margin: 0 auto 48px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .team-icon-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-gold);
          animation: teamPulse 2.5s ease-in-out infinite;
        }

        @keyframes teamPulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }

        .team-headline {
          font-family: var(--font-heading);
          font-weight: 800;
          font-size: 3.5rem;
          letter-spacing: -0.04em;
          color: #ffffff;
          margin-bottom: 20px;
          line-height: 1.1;
        }

        .team-sub {
          font-size: 1.05rem;
          color: rgba(255, 255, 255, 0.45);
          max-width: 600px;
          margin: 0 auto 64px;
          line-height: 1.6;
        }

        .team-grid {
          display: flex;
          justify-content: center;
          gap: 32px;
          max-width: 900px;
          margin: 0 auto;
        }

        .team-card {
          flex: 1;
          max-width: 280px;
        }

        .team-card-img-wrap {
          width: 100%;
          aspect-ratio: 1;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.08);
          margin-bottom: 18px;
          transition: border-color 0.3s, box-shadow 0.3s;
          position: relative;
        }

        .team-card:hover .team-card-img-wrap {
          border-color: rgba(37, 99, 235, 0.3);
          box-shadow: 0 0 40px rgba(37, 99, 235, 0.08);
        }

        .team-card-img-wrap img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: transform 0.4s, filter 0.4s;
        }

        .team-card:hover .team-card-img-wrap img {
          transform: scale(1.05);
          filter: brightness(0.7);
        }

        .team-card-linkedin {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 0.3s;
        }

        .team-card:hover .team-card-linkedin {
          opacity: 1;
        }

        .team-card-linkedin-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.95);
          color: #0a66c2;
          font-family: var(--font-heading);
          font-weight: 600;
          font-size: 0.85rem;
          border-radius: 100px;
          text-decoration: none;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .team-card-linkedin-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 28px rgba(0, 0, 0, 0.4);
        }

        .team-card-linkedin-btn svg {
          width: 18px;
          height: 18px;
        }

        .team-card-name {
          font-family: var(--font-heading);
          font-weight: 700;
          font-size: 1.1rem;
          color: #ffffff;
          margin-bottom: 4px;
        }

        .team-card-role {
          font-family: var(--font-mono);
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(255, 255, 255, 0.3);
        }

        @media (max-width: 640px) {
          .team-section {
            padding: 64px 0;
          }

          .team-headline {
            font-size: 2.2rem;
          }

          .team-grid {
            flex-direction: column;
            align-items: center;
            gap: 28px;
          }

          .team-card {
            max-width: 240px;
          }
        }
      `}</style>

      <section className="team-section" id="team" aria-label="The team">
        <div className="container">
          <div className="team-icon" aria-hidden="true">
            <div className="team-icon-dot" />
          </div>

          <h2 className="team-headline reveal" ref={headlineRef}>
            Built with purpose, for real people
          </h2>
          <p className="team-sub reveal" ref={subRef}>
            We built Sally for the 2.2 billion people with vision impairment who deserve independent access to the web. Sally assists — it never decides. Every important action requires your explicit confirmation, and you can cancel at any time. Built at the Claude AI Hackathon: Machines of Loving Grace.
          </p>

          <div className="team-grid reveal" ref={gridRef}>
            {founders.map((f, i) => (
              <div className="team-card" key={i}>
                <div className="team-card-img-wrap">
                  <img src={f.img} alt={f.name} loading="lazy" />
                  <div className="team-card-linkedin">
                    <a
                      href={f.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="team-card-linkedin-btn"
                      aria-label={`${f.name} on LinkedIn`}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/>
                      </svg>
                      LinkedIn
                    </a>
                  </div>
                </div>
                <div className="team-card-name">{f.name}</div>
                <div className="team-card-role">Founder</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

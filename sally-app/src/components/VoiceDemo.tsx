import { useState, useEffect, useCallback } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

interface Command {
  label: string;
  response: string;
  screenType: 'settings' | 'email' | 'form' | 'shopping';
}

const commands: Command[] = [
  {
    label: 'Read me this page',
    response:
      'This is a settings page with 4 sections: Account, Privacy, Notifications, and Billing. You\u2019re currently in the Account section. There\u2019s a form with your name and email, and a Save button at the bottom.',
    screenType: 'settings',
  },
  {
    label: 'Open my email',
    response:
      'Opening Gmail\u2026 You have 3 unread messages. The first one is from Sarah Chen about the project deadline tomorrow.',
    screenType: 'email',
  },
  {
    label: 'Find the submit button',
    response:
      'Found it. There\u2019s a blue Submit button at the bottom right of the form. Would you like me to click it?',
    screenType: 'form',
  },
  {
    label: 'What\u2019s on my screen?',
    response:
      'You\u2019re looking at a web browser with two tabs open. The active tab shows a shopping cart with 2 items totaling $47.99. There\u2019s a checkout button in the top right.',
    screenType: 'shopping',
  },
];

type Phase = 'idle' | 'listening' | 'thinking' | 'responding' | 'done';

function MockScreen({ screenType, phase }: { screenType: Command['screenType']; phase: Phase }) {
  const highlight = phase === 'done';

  if (screenType === 'settings') {
    return (
      <div className="vd-mock-ui">
        <div className="vd-mock-row">
          <div className={`vd-mock-tab vd-mock-tab--active ${highlight ? 'vd-highlight' : ''}`}>Account</div>
          <div className={`vd-mock-tab ${highlight ? 'vd-highlight' : ''}`}>Privacy</div>
          <div className={`vd-mock-tab ${highlight ? 'vd-highlight' : ''}`}>Notifs</div>
          <div className={`vd-mock-tab ${highlight ? 'vd-highlight' : ''}`}>Billing</div>
        </div>
        <div className={`vd-mock-field ${highlight ? 'vd-highlight' : ''}`}>
          <div className="vd-mock-field-label" />
          <div className="vd-mock-field-input" />
        </div>
        <div className={`vd-mock-field ${highlight ? 'vd-highlight' : ''}`}>
          <div className="vd-mock-field-label" />
          <div className="vd-mock-field-input" />
        </div>
        <div className="vd-mock-spacer" />
        <div className={`vd-mock-btn ${highlight ? 'vd-highlight' : ''}`}>Save</div>
      </div>
    );
  }

  if (screenType === 'email') {
    return (
      <div className="vd-mock-ui">
        <div className={`vd-mock-email-row vd-mock-email-row--unread ${highlight ? 'vd-highlight' : ''}`}>
          <div className="vd-mock-email-dot" />
          <div className="vd-mock-email-from">Sarah Chen</div>
          <div className="vd-mock-email-subj">Project deadline tomorrow</div>
        </div>
        <div className={`vd-mock-email-row vd-mock-email-row--unread ${highlight ? 'vd-highlight' : ''}`}>
          <div className="vd-mock-email-dot" />
          <div className="vd-mock-email-from">HR Team</div>
          <div className="vd-mock-email-subj">Benefits enrollment reminder</div>
        </div>
        <div className={`vd-mock-email-row vd-mock-email-row--unread ${highlight ? 'vd-highlight' : ''}`}>
          <div className="vd-mock-email-dot" />
          <div className="vd-mock-email-from">Alex Rivera</div>
          <div className="vd-mock-email-subj">Lunch plans?</div>
        </div>
        <div className="vd-mock-email-row">
          <div className="vd-mock-email-from">Newsletter</div>
          <div className="vd-mock-email-subj">Weekly digest</div>
        </div>
      </div>
    );
  }

  if (screenType === 'form') {
    return (
      <div className="vd-mock-ui">
        <div className="vd-mock-field">
          <div className="vd-mock-field-label" />
          <div className="vd-mock-field-input" />
        </div>
        <div className="vd-mock-field">
          <div className="vd-mock-field-label" />
          <div className="vd-mock-field-input vd-mock-field-input--tall" />
        </div>
        <div className="vd-mock-field">
          <div className="vd-mock-field-label" />
          <div className="vd-mock-field-input" />
        </div>
        <div className="vd-mock-spacer" />
        <div className="vd-mock-row vd-mock-row--end">
          <div className={`vd-mock-btn vd-mock-btn--submit ${highlight ? 'vd-highlight-btn' : ''}`}>Submit</div>
        </div>
      </div>
    );
  }

  // shopping
  return (
    <div className="vd-mock-ui">
      <div className="vd-mock-row vd-mock-row--between">
        <div className="vd-mock-row">
          <div className="vd-mock-browser-tab vd-mock-browser-tab--active" />
          <div className="vd-mock-browser-tab" />
        </div>
        <div className={`vd-mock-btn vd-mock-btn--small ${highlight ? 'vd-highlight-btn' : ''}`}>Checkout</div>
      </div>
      <div className="vd-mock-divider" />
      <div className={`vd-mock-cart-item ${highlight ? 'vd-highlight' : ''}`}>
        <div className="vd-mock-cart-thumb" />
        <div className="vd-mock-cart-details">
          <div className="vd-mock-field-label" style={{ width: '60%' }} />
          <div className="vd-mock-field-label" style={{ width: '30%', marginTop: 6 }} />
        </div>
        <div className="vd-mock-cart-price">$24.99</div>
      </div>
      <div className={`vd-mock-cart-item ${highlight ? 'vd-highlight' : ''}`}>
        <div className="vd-mock-cart-thumb" />
        <div className="vd-mock-cart-details">
          <div className="vd-mock-field-label" style={{ width: '50%' }} />
          <div className="vd-mock-field-label" style={{ width: '25%', marginTop: 6 }} />
        </div>
        <div className="vd-mock-cart-price">$23.00</div>
      </div>
      <div className="vd-mock-divider" />
      <div className="vd-mock-row vd-mock-row--end">
        <div className="vd-mock-cart-total">Total: $47.99</div>
      </div>
    </div>
  );
}

export function VoiceDemo() {
  const screenRef = useScrollReveal<HTMLDivElement>(150);
  const chipsRef = useScrollReveal<HTMLDivElement>(300);

  const [activeCmd, setActiveCmd] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [displayedText, setDisplayedText] = useState('');

  const runSequence = useCallback((idx: number) => {
    if (phase !== 'idle' && phase !== 'done') return;
    setActiveCmd(idx);
    setPhase('listening');
    setDisplayedText('');

    const t1 = setTimeout(() => setPhase('thinking'), 1200);
    const t2 = setTimeout(() => {
      setPhase('responding');
    }, 2400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  // Typing effect during 'responding' phase
  useEffect(() => {
    if (phase !== 'responding' || activeCmd === null) return;
    const fullText = commands[activeCmd].response;
    let i = 0;
    setDisplayedText('');
    const interval = setInterval(() => {
      i++;
      setDisplayedText(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(interval);
        setPhase('done');
      }
    }, 18);
    return () => clearInterval(interval);
  }, [phase, activeCmd]);

  return (
    <>
      <style>{`
        .vd-section {
          background: transparent;
          text-align: center;
        }

        .vd-screen-wrap {
          max-width: 700px;
          margin: 0 auto 40px;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid var(--border);
          background: var(--bg-card);
          box-shadow: 0 24px 80px rgba(0,0,0,0.08), 0 0 120px rgba(37,99,235,0.04);
          position: relative;
        }

        .vd-screen-wrap::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: 15px;
          padding: 1px;
          background: linear-gradient(180deg, rgba(37,99,235,0.2) 0%, var(--border) 50%, rgba(37,99,235,0.15) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          z-index: 10;
        }

        .vd-topbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 18px;
          background: #1a1a2e;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .vd-dots {
          display: flex;
          gap: 7px;
        }

        .vd-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .vd-dot--red { background: #ff5f57; }
        .vd-dot--yellow { background: #febc2e; }
        .vd-dot--green { background: #28c840; }

        .vd-url-bar {
          flex: 1;
          height: 28px;
          background: rgba(255,255,255,0.06);
          border-radius: 6px;
        }

        .vd-body {
          background: #111118;
          min-height: 320px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        /* Idle state */
        .vd-idle-msg {
          font-family: var(--font-mono);
          font-size: 0.85rem;
          color: rgba(255,255,255,0.25);
          letter-spacing: 0.02em;
        }

        /* Waveform */
        .vd-waveform {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 60px;
        }

        .vd-wave-bar {
          width: 6px;
          border-radius: 3px;
          background: var(--accent-gold);
          animation: vdWave 0.8s ease-in-out infinite alternate;
        }

        .vd-wave-bar:nth-child(1) { height: 20px; animation-delay: 0s; animation-duration: 0.6s; }
        .vd-wave-bar:nth-child(2) { height: 35px; animation-delay: 0.1s; animation-duration: 0.75s; }
        .vd-wave-bar:nth-child(3) { height: 50px; animation-delay: 0.05s; animation-duration: 0.5s; }
        .vd-wave-bar:nth-child(4) { height: 30px; animation-delay: 0.15s; animation-duration: 0.7s; }
        .vd-wave-bar:nth-child(5) { height: 24px; animation-delay: 0.08s; animation-duration: 0.65s; }

        @keyframes vdWave {
          0% { transform: scaleY(0.3); opacity: 0.5; }
          100% { transform: scaleY(1); opacity: 1; }
        }

        .vd-wave-label {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: var(--accent-gold);
          margin-top: 14px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        /* Thinking */
        .vd-thinking {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 0.85rem;
          color: rgba(255,255,255,0.5);
        }

        .vd-thinking-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-gold);
          opacity: 0.4;
          animation: vdBounce 1.2s infinite;
        }

        .vd-thinking-dot:nth-child(2) { animation-delay: 0.15s; }
        .vd-thinking-dot:nth-child(3) { animation-delay: 0.3s; }

        @keyframes vdBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-8px); opacity: 1; }
        }

        /* Response */
        .vd-response-area {
          width: 100%;
          text-align: left;
        }

        .vd-response-text {
          font-size: 0.9rem;
          color: rgba(255,255,255,0.75);
          line-height: 1.65;
          padding: 16px 20px;
          background: rgba(37,99,235,0.06);
          border-left: 3px solid var(--accent-gold);
          border-radius: 0 8px 8px 0;
          margin-bottom: 20px;
        }

        .vd-response-cursor {
          display: inline-block;
          width: 2px;
          height: 14px;
          background: var(--accent-gold);
          margin-left: 2px;
          vertical-align: text-bottom;
          animation: vdBlink 0.6s step-end infinite;
        }

        @keyframes vdBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        /* Mock UI elements inside screen */
        .vd-mock-ui {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .vd-mock-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .vd-mock-row--end {
          justify-content: flex-end;
        }

        .vd-mock-row--between {
          justify-content: space-between;
        }

        .vd-mock-tab {
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-family: var(--font-mono);
          color: rgba(255,255,255,0.3);
          background: rgba(255,255,255,0.04);
          transition: background 0.5s, box-shadow 0.5s;
        }

        .vd-mock-tab--active {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.5);
        }

        .vd-mock-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: background 0.5s, box-shadow 0.5s;
          padding: 8px 10px;
          border-radius: 8px;
        }

        .vd-mock-field-label {
          width: 40%;
          height: 8px;
          background: rgba(255,255,255,0.08);
          border-radius: 4px;
        }

        .vd-mock-field-input {
          width: 100%;
          height: 28px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 6px;
        }

        .vd-mock-field-input--tall {
          height: 56px;
        }

        .vd-mock-spacer {
          height: 8px;
        }

        .vd-mock-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 20px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-family: var(--font-mono);
          color: rgba(255,255,255,0.4);
          background: rgba(255,255,255,0.06);
          transition: background 0.5s, box-shadow 0.5s, color 0.5s;
        }

        .vd-mock-btn--submit {
          background: rgba(60,130,246,0.15);
          color: rgba(96,165,250,0.6);
        }

        .vd-mock-btn--small {
          padding: 5px 12px;
          font-size: 0.65rem;
        }

        .vd-mock-divider {
          height: 1px;
          background: rgba(255,255,255,0.06);
          margin: 4px 0;
        }

        /* Email rows */
        .vd-mock-email-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 8px;
          transition: background 0.5s, box-shadow 0.5s;
        }

        .vd-mock-email-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-gold);
          flex-shrink: 0;
        }

        .vd-mock-email-from {
          font-size: 0.72rem;
          font-family: var(--font-heading);
          font-weight: 600;
          color: rgba(255,255,255,0.45);
          width: 90px;
          flex-shrink: 0;
        }

        .vd-mock-email-row--unread .vd-mock-email-from {
          color: rgba(255,255,255,0.7);
        }

        .vd-mock-email-subj {
          font-size: 0.7rem;
          color: rgba(255,255,255,0.25);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Cart items */
        .vd-mock-cart-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 10px 12px;
          border-radius: 8px;
          transition: background 0.5s, box-shadow 0.5s;
        }

        .vd-mock-cart-thumb {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: rgba(255,255,255,0.06);
          flex-shrink: 0;
        }

        .vd-mock-cart-details {
          flex: 1;
        }

        .vd-mock-cart-price {
          font-family: var(--font-mono);
          font-size: 0.75rem;
          color: rgba(255,255,255,0.4);
          flex-shrink: 0;
        }

        .vd-mock-cart-total {
          font-family: var(--font-mono);
          font-size: 0.8rem;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
        }

        .vd-mock-browser-tab {
          width: 60px;
          height: 8px;
          border-radius: 4px;
          background: rgba(255,255,255,0.06);
        }

        .vd-mock-browser-tab--active {
          background: rgba(255,255,255,0.12);
          width: 80px;
        }

        /* Gold highlight effect */
        .vd-highlight {
          background: rgba(37,99,235,0.1) !important;
          box-shadow: inset 0 0 0 1px rgba(37,99,235,0.3), 0 0 20px rgba(37,99,235,0.06);
        }

        .vd-highlight-btn {
          background: rgba(37,99,235,0.2) !important;
          box-shadow: 0 0 16px rgba(37,99,235,0.2), inset 0 0 0 1px rgba(37,99,235,0.4);
          color: var(--accent-gold) !important;
        }

        /* Command chips */
        .vd-chips {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 12px;
        }

        .vd-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 22px;
          border-radius: 100px;
          border: 1px solid var(--border);
          background: var(--bg-card);
          font-family: var(--font-body);
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: border-color 0.3s, box-shadow 0.3s, color 0.3s, background 0.3s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }

        .vd-chip:hover {
          border-color: rgba(37,99,235,0.4);
          color: var(--text-primary);
          box-shadow: 0 0 24px rgba(37,99,235,0.08);
        }

        .vd-chip--active {
          border-color: var(--accent-gold);
          background: rgba(37,99,235,0.06);
          color: var(--accent-gold-dark);
          box-shadow: 0 0 24px rgba(37,99,235,0.1);
        }

        .vd-chip--disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .vd-chip-mic {
          width: 16px;
          height: 16px;
          color: var(--accent-gold);
          flex-shrink: 0;
        }

        /* Fade-in for body content transitions */
        .vd-fade-enter {
          animation: vdFadeIn 0.4s ease forwards;
        }

        @keyframes vdFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Responsive */
        @media (max-width: 640px) {
          .vd-body {
            min-height: 280px;
            padding: 18px 14px;
          }

          .vd-chips {
            gap: 8px;
          }

          .vd-chip {
            padding: 10px 16px;
            font-size: 0.82rem;
          }

          .vd-mock-email-from {
            width: 70px;
          }

          .vd-mock-email-subj {
            display: none;
          }
        }
      `}</style>

      <section className="vd-section" id="voice-demo" aria-label="Experience Sally">
        <div className="container">
          <SectionHeader
            tag="EXPERIENCE"
            label="See Sally in action"
            sub="Click a command below to watch Sally respond in real time."
            subStyle={{ margin: '0 auto 56px' }}
          />

          <div className="vd-screen-wrap reveal" ref={screenRef}>
            <div className="vd-topbar" aria-hidden="true">
              <div className="vd-dots">
                <span className="vd-dot vd-dot--red" />
                <span className="vd-dot vd-dot--yellow" />
                <span className="vd-dot vd-dot--green" />
              </div>
              <div className="vd-url-bar" />
            </div>

            <div className="vd-body" aria-live="polite">
              {phase === 'idle' && (
                <div className="vd-idle-msg vd-fade-enter" key="idle">
                  Select a command to begin
                </div>
              )}

              {phase === 'listening' && (
                <div className="vd-fade-enter" key="listening" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div className="vd-waveform" aria-label="Listening to voice input">
                    <div className="vd-wave-bar" />
                    <div className="vd-wave-bar" />
                    <div className="vd-wave-bar" />
                    <div className="vd-wave-bar" />
                    <div className="vd-wave-bar" />
                  </div>
                  <div className="vd-wave-label">
                    &ldquo;{activeCmd !== null ? commands[activeCmd].label : ''}&rdquo;
                  </div>
                </div>
              )}

              {phase === 'thinking' && (
                <div className="vd-fade-enter" key="thinking" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                  <div className="vd-thinking">
                    <span style={{ marginRight: 8 }}>Sally is thinking</span>
                    <span className="vd-thinking-dot" />
                    <span className="vd-thinking-dot" />
                    <span className="vd-thinking-dot" />
                  </div>
                </div>
              )}

              {(phase === 'responding' || phase === 'done') && activeCmd !== null && (
                <div className="vd-response-area vd-fade-enter" key={`response-${activeCmd}`}>
                  <div className="vd-response-text">
                    {displayedText}
                    {phase === 'responding' && <span className="vd-response-cursor" />}
                  </div>
                  <MockScreen screenType={commands[activeCmd].screenType} phase={phase} />
                </div>
              )}
            </div>
          </div>

          <div className="vd-chips reveal" ref={chipsRef} role="group" aria-label="Voice command options">
            {commands.map((cmd, i) => {
              const isRunning = phase !== 'idle' && phase !== 'done';
              const isActive = activeCmd === i && phase !== 'idle';
              return (
                <button
                  key={i}
                  className={`vd-chip${isActive ? ' vd-chip--active' : ''}${isRunning && !isActive ? ' vd-chip--disabled' : ''}`}
                  onClick={() => runSequence(i)}
                  disabled={isRunning && !isActive}
                  aria-label={`Voice command: ${cmd.label}`}
                >
                  <svg className="vd-chip-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                  {cmd.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

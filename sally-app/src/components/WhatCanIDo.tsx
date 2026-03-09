import { useScrollReveal } from '../hooks/useScrollReveal';
import { SectionHeader } from './SectionHeader';

export function WhatCanIDo() {
  const mockRef = useScrollReveal<HTMLDivElement>();
  const responseRef = useScrollReveal<HTMLDivElement>();

  return (
    <section className="what-section" aria-label="What can I do right now">
      <div className="container">
        <SectionHeader
          tag="USE CASE"
          label="The most powerful question you can ask"
          sub="One question replaces navigating menus and scanning screens entirely."
          subStyle={{ marginBottom: 48 }}
        />

        <div className="what-layout">
          <div className="what-screen reveal" ref={mockRef} aria-hidden="true">
            <div className="what-screen-topbar">
              <div className="what-screen-dots">
                <span className="what-screen-dot--red" />
                <span className="what-screen-dot--yellow" />
                <span className="what-screen-dot--green" />
              </div>
              <div className="what-screen-url" />
            </div>
            <div className="what-screen-body">
              <div className="what-mock-nav">
                <div className="what-mock-nav-item" />
                <div className="what-mock-nav-item" />
                <div className="what-mock-nav-item" />
              </div>
              <div className="what-mock-hero" />
              <div className="what-mock-cols">
                <div className="what-mock-sidebar">
                  <div className="what-mock-sidebar-item" />
                  <div className="what-mock-sidebar-item" />
                  <div className="what-mock-sidebar-item" />
                  <div className="what-mock-sidebar-item" />
                </div>
                <div className="what-mock-main">
                  <div className="what-mock-card" />
                  <div className="what-mock-card" />
                </div>
              </div>
              <div className="what-mock-btns">
                <div className="what-mock-btn" />
                <div className="what-mock-btn what-mock-btn--gold" />
              </div>

              <div className="what-scan-line" />
              <div className="what-speech">
                I see a settings page with 3 nav items, a hero section, a sidebar, and 2 content cards. There's a submit button at the bottom right.
              </div>
              <div className="what-sally-badge">
                <div className="what-sally-dot" />
                <span>Sally is reading this screen</span>
              </div>
            </div>
          </div>

          <div className="what-response reveal" ref={responseRef}>
            <div className="what-response-q">"What can I do right now?"</div>
            <ul>
              <li>Read and reply to emails in Gmail</li>
              <li>Search the web and hear results read back</li>
              <li>Fill in forms on any website</li>
              <li>Book travel or shop online</li>
              <li>Navigate banking or government portals</li>
            </ul>
            <p className="what-response-note">
              For blind and low-vision users, this single question replaces every visual menu, toolbar, and icon on any website.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Problem } from './components/Problem';
import { Features } from './components/Features';
import { Stats } from './components/Stats';
import { Comparison } from './components/Comparison';
import { Founders } from './components/Founders';
import { HowItWorks } from './components/HowItWorks';
import { VoiceDemo } from './components/VoiceDemo';
import { Demo } from './components/Demo';
import { Journey } from './components/Journey';
import { WhatCanIDo } from './components/WhatCanIDo';
import { Testimonials } from './components/Testimonials';
import { Platforms } from './components/Platforms';
import { CTA } from './components/CTA';
import { Footer } from './components/Footer';

// Block loading inside Electron — this website is browser-only
const isElectron = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electron;

function App() {
  if (isElectron) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', textAlign: 'center', padding: '2rem' }}>
        <div>
          <h1>Browser Only</h1>
          <p>This website is meant to be viewed in your browser. The Sally desktop app is already installed.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Navbar />
      <main id="main-content">
        <Hero />
        <Demo />
        <div className="content-with-line">
          <Problem />
          <Features />
          <Stats />
          <Comparison />
          <HowItWorks />
          <VoiceDemo />
          <Journey />
          <WhatCanIDo />
          <Testimonials />
          <Platforms />
          <CTA />
        </div>
      </main>
      <Founders />
      <Footer />
    </>
  );
}

export default App;

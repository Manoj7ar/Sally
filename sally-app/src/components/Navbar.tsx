import { useState, useEffect, useCallback } from 'react';
import { useScrolled } from '../hooks/useScrolled';

export function Navbar() {
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) {
        closeMenu();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [menuOpen, closeMenu]);

  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <a href="#" className="nav-logo" aria-label="Sally home">
          <img src="/logo-sally-cropped.png" alt="Sally logo" />
        </a>
        <ul className={`nav-links${menuOpen ? ' open' : ''}`} role="list">
          <li><a href="#features" onClick={closeMenu}>Features</a></li>
          <li><a href="#how-it-works" onClick={closeMenu}>How It Works</a></li>
          <li><a href="#demo" onClick={closeMenu}>Demo</a></li>
        </ul>
        <a href="#early-access" className="nav-cta" role="button">Get Early Access</a>
        <button
          className={`hamburger${menuOpen ? ' active' : ''}`}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>
  );
}

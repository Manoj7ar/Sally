export function Footer() {
  return (
    <footer className="footer" role="contentinfo">
      <div className="footer-top">
        <div className="container">
          <div className="footer-inner">
            <div className="footer-brand">
              <img src="/logo-sally.png" alt="Sally" />
            </div>
            <div className="footer-columns">
              <div>
                <div className="footer-col-title">Product</div>
                <ul className="footer-links" role="list">
                  <li><a href="#features">Features</a></li>
                  <li><a href="#how-it-works">How It Works</a></li>
                  <li><a href="#demo">Demo</a></li>
                </ul>
              </div>
              <div>
                <div className="footer-col-title">Company</div>
                <ul className="footer-links" role="list">
                  <li><a href="#">About</a></li>
                  <li><a href="#">Accessibility</a></li>
                  <li><a href="#">Privacy</a></li>
                </ul>
              </div>
              <div>
                <div className="footer-col-title">Connect</div>
                <ul className="footer-links" role="list">
                  <li><a href="https://github.com/manoj7ar" target="_blank" rel="noopener noreferrer">GitHub</a></li>
                  <li><a href="#">Twitter</a></li>
                  <li><a href="#">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container">
          <div className="footer-bottom-inner">
            <p className="footer-a11y-badge">Built for the blind and low-vision community &mdash; Claude Builder Club Hackathon 2026</p>
            <p className="footer-copy">&copy; 2026 Sally. Built by <a href="https://github.com/manoj7ar" target="_blank" rel="noopener noreferrer">manoj7ar</a>.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}

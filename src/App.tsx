import { useState, useEffect, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import ConfigWindow from './windows/config/ConfigWindow';
import SallyBarWindow from './windows/sallyBar/SallyBarWindow';
import BorderOverlay from './windows/borderOverlay/BorderOverlay';
import BrowserWindow from './windows/browser/BrowserWindow';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', textAlign: 'center', padding: '2rem' }}>
          <div>
            <h2>Something went wrong</h2>
            <p>Please restart Sally.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const isElectron = !!window.electron;

function App() {
  const [windowType, setWindowType] = useState<'config' | 'sallyBar' | 'borderOverlay' | 'browser'>('config');

  useEffect(() => {
    if (!isElectron) return;
    const params = new URLSearchParams(window.location.search);
    const type = params.get('window');
    if (type === 'sallyBar') {
      setWindowType('sallyBar');
      document.body.classList.add('transparent-window');
    } else if (type === 'borderOverlay') {
      setWindowType('borderOverlay');
      document.body.classList.add('transparent-window');
    } else if (type === 'browser') {
      setWindowType('browser');
    } else {
      setWindowType('config');
    }
  }, []);

  // This app requires the Electron runtime — block browser access
  if (!isElectron) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', textAlign: 'center', padding: '2rem' }}>
        <div>
          <h1>Desktop App Only</h1>
          <p>This application requires the Sally desktop app. Please download it to continue.</p>
        </div>
      </div>
    );
  }

  if (windowType === 'borderOverlay') return <ErrorBoundary><BorderOverlay /></ErrorBoundary>;
  if (windowType === 'sallyBar') return <ErrorBoundary><SallyBarWindow /></ErrorBoundary>;
  if (windowType === 'browser') return <ErrorBoundary><BrowserWindow /></ErrorBoundary>;
  return <ErrorBoundary><ConfigWindow /></ErrorBoundary>;
}

export default App;

import { createRequire } from 'node:module';
import process from 'node:process';
import { findBrowserLaunchTarget } from '../electron/main/utils/browserDiscovery.js';

const require = createRequire(import.meta.url);

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS ${message}`);
}

function warn(message: string): void {
  console.warn(`WARN ${message}`);
}

const majorNodeVersion = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
if (majorNodeVersion < 20) {
  fail(`Node ${process.versions.node} detected. Sally requires Node 20+ for the full platform.`);
}
pass(`Node ${process.versions.node} satisfies the documented runtime requirement.`);

try {
  require('uiohook-napi');
  pass('uiohook-napi loads in the local Node environment.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`uiohook-napi could not be loaded. Reinstall dependencies so native modules rebuild for Electron. (${message})`);
}

const browserTarget = findBrowserLaunchTarget();
if (!browserTarget) {
  fail('No supported Chrome, Chromium, or Edge installation/profile was detected for Playwright automation.');
}

if (browserTarget.executablePath) {
  pass(`Browser automation target detected: ${browserTarget.label} at ${browserTarget.executablePath}`);
} else if (browserTarget.channel) {
  pass(`Browser automation target detected via Playwright channel: ${browserTarget.label} (${browserTarget.channel})`);
}

if (browserTarget.userDataDir) {
  pass(`Existing browser profile detected at ${browserTarget.userDataDir}`);
} else {
  warn('No reusable browser profile detected. Sally will fall back to a temporary profile and may lose logged-in sessions.');
}

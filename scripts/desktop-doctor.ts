import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function pass(message: string): void {
  console.log(`PASS ${message}`);
}

const isDarwin = process.platform === 'darwin';
const isWin32 = process.platform === 'win32';

if (isDarwin) {
  pass(`Platform ${process.platform} is a supported Sally desktop target (macOS).`);
} else if (isWin32) {
  pass(`Platform ${process.platform} is a supported Sally desktop target (Windows).`);
} else {
  console.warn(
    `WARN Sally officially supports macOS and Windows; detected "${process.platform}". Node and native checks still run — use a supported OS for release builds.`,
  );
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

pass('Electron browser runtime is built into Sally, so no external Chrome or Playwright target is required.');

if (isWin32) {
  console.log('');
  console.log('Manual Windows smoke checklist (run against an installed build):');
  console.log('  - Launch Sally, open Settings, confirm Config + Sally Bar windows appear.');
  console.log('  - Grant microphone in Windows Settings; verify voice capture in the Sally Bar.');
  console.log('  - Set a global push-to-talk shortcut; hold it and confirm listen/stop behavior.');
  console.log('  - Ask a screen/vision question once; confirm any OS capture prompt is accepted.');
  console.log('  - Toggle Open at login; sign out/in or verify Task Manager Startup entry if applicable.');
  console.log('  - Second instance: launch again and confirm focus returns to existing Sally.');
}

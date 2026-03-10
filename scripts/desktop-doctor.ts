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

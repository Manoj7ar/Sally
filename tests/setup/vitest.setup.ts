import { afterEach } from 'vitest';

afterEach(() => {
  globalThis.fetch = fetch;
});

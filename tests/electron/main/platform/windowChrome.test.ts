import { describe, it, expect, vi, afterEach } from 'vitest';
import { browserWindowChrome, configWindowChrome } from '../../../../electron/main/platform/windowChrome.js';

describe('windowChrome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits traffic light fields on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const cfg = configWindowChrome();
    expect(cfg).not.toHaveProperty('trafficLightPosition');
    expect(cfg).not.toHaveProperty('titleBarStyle');
    expect(cfg.title).toBe('Sally');

    const browser = browserWindowChrome();
    expect(browser).not.toHaveProperty('trafficLightPosition');
    expect(browser.title).toBe('Sally Browser');
  });

  it('includes mac traffic light options on darwin', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const cfg = configWindowChrome();
    expect(cfg.titleBarStyle).toBe('hiddenInset');
    expect(cfg.trafficLightPosition).toEqual({ x: 16, y: 16 });

    const browser = browserWindowChrome();
    expect(browser.titleBarStyle).toBe('hiddenInset');
    expect(browser.trafficLightPosition).toEqual({ x: 14, y: 16 });
  });
});

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type BrowserChannel = 'chrome' | 'msedge';

interface BrowserCandidate {
  label: string;
  executablePaths: string[];
  profilePaths: string[];
  channel?: BrowserChannel;
}

export interface BrowserLaunchTarget {
  label: string;
  executablePath?: string;
  userDataDir?: string;
  channel?: BrowserChannel;
}

function existingPath(paths: string[]): string | undefined {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Skip unreadable candidates.
    }
  }
  return undefined;
}

function getBrowserCandidates(): BrowserCandidate[] {
  const home = homedir();

  switch (process.platform) {
    case 'darwin':
      return [
        {
          label: 'Google Chrome',
          executablePaths: [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          ],
          profilePaths: [
            join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
          ],
          channel: 'chrome',
        },
        {
          label: 'Microsoft Edge',
          executablePaths: [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ],
          profilePaths: [
            join(home, 'Library', 'Application Support', 'Microsoft Edge'),
          ],
          channel: 'msedge',
        },
      ];
    case 'linux':
      return [
        {
          label: 'Google Chrome',
          executablePaths: [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
          ],
          profilePaths: [
            join(home, '.config', 'google-chrome'),
          ],
          channel: 'chrome',
        },
        {
          label: 'Chromium',
          executablePaths: [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ],
          profilePaths: [
            join(home, '.config', 'chromium'),
          ],
        },
        {
          label: 'Microsoft Edge',
          executablePaths: [
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable',
          ],
          profilePaths: [
            join(home, '.config', 'microsoft-edge'),
          ],
          channel: 'msedge',
        },
      ];
    case 'win32':
    default: {
      const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
      return [
        {
          label: 'Google Chrome',
          executablePaths: [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            join(localAppData, 'Google', 'Chrome SxS', 'Application', 'chrome.exe'),
          ],
          profilePaths: [
            join(localAppData, 'Google', 'Chrome', 'User Data'),
          ],
          channel: 'chrome',
        },
        {
          label: 'Microsoft Edge',
          executablePaths: [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ],
          profilePaths: [
            join(localAppData, 'Microsoft', 'Edge', 'User Data'),
          ],
          channel: 'msedge',
        },
      ];
    }
  }
}

export function findBrowserLaunchTarget(): BrowserLaunchTarget | null {
  const candidates = getBrowserCandidates();

  for (const candidate of candidates) {
    const executablePath = existingPath(candidate.executablePaths);
    if (!executablePath) continue;

    return {
      label: candidate.label,
      executablePath,
      userDataDir: existingPath(candidate.profilePaths),
      channel: candidate.channel,
    };
  }

  for (const candidate of candidates) {
    if (!candidate.channel) continue;
    const userDataDir = existingPath(candidate.profilePaths);
    if (!userDataDir) continue;
    return {
      label: candidate.label,
      userDataDir,
      channel: candidate.channel,
    };
  }

  return null;
}

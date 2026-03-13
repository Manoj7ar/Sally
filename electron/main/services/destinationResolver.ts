import { mainLogger } from '../utils/logger.js';

const GOOGLE_SEARCH_BASE = 'https://www.google.com/search?hl=en&q=';
const GOOGLE_LUCKY_BASE = 'https://www.google.com/search?btnI=I&hl=en&q=';
const RESOLVE_TIMEOUT_MS = 6000;
const BROWSERLIKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

interface ResolvedDestination {
  url: string;
  via: 'direct' | 'resolved' | 'search';
}

const KNOWN_DESTINATIONS: Array<{ aliases: string[]; url: string }> = [
  {
    aliases: ['gmail', 'google mail', 'mail', 'my gmail', 'my email', 'email inbox', 'inbox'],
    url: 'https://mail.google.com/',
  },
  {
    aliases: ['google calendar', 'calendar', 'my calendar'],
    url: 'https://calendar.google.com/',
  },
  {
    aliases: ['google drive', 'drive', 'my drive'],
    url: 'https://drive.google.com/',
  },
  {
    aliases: ['google docs', 'docs', 'my docs'],
    url: 'https://docs.google.com/document/',
  },
  {
    aliases: ['youtube', 'you tube'],
    url: 'https://www.youtube.com/',
  },
  {
    aliases: ['linkedin', 'my linkedin'],
    url: 'https://www.linkedin.com/feed/',
  },
  {
    aliases: ['github'],
    url: 'https://github.com/',
  },
  {
    aliases: ['notion'],
    url: 'https://www.notion.so/',
  },
  {
    aliases: ['slack'],
    url: 'https://app.slack.com/client',
  },
  {
    aliases: ['canva'],
    url: 'https://www.canva.com/',
  },
  {
    aliases: ['amazon'],
    url: 'https://www.amazon.com/',
  },
  {
    aliases: ['reddit'],
    url: 'https://www.reddit.com/',
  },
];

function buildGoogleSearchUrl(query: string): string {
  return `${GOOGLE_SEARCH_BASE}${encodeURIComponent(query.trim())}`;
}

function normalizeKnownDestinationQuery(candidate: string): string {
  return candidate
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(?:open|go to|navigate to|visit|take me to|bring me to|show me)\b/g, ' ')
    .replace(/\b(?:the|my|a|an)\b/g, ' ')
    .replace(/\b(?:website|site|homepage|home page|app|page)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveKnownDestination(target: string): string | null {
  const normalizedTarget = normalizeKnownDestinationQuery(target);
  if (!normalizedTarget) {
    return null;
  }

  const match = KNOWN_DESTINATIONS.find((entry) => entry.aliases.includes(normalizedTarget));
  return match?.url || null;
}

function normalizeDirectUrl(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const explicitUrl = trimmed.match(/\bhttps?:\/\/[^\s]+/i)?.[0];
  if (explicitUrl) {
    return explicitUrl;
  }

  const domainLike = trimmed.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?\b/i)?.[0];
  if (!domainLike) {
    return null;
  }

  return domainLike.startsWith('http') ? domainLike : `https://${domainLike}`;
}

function isGoogleSearchPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('google.') && parsed.pathname.startsWith('/search');
  } catch {
    return false;
  }
}

function isResolvedWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.hostname.includes('google.');
  } catch {
    return false;
  }
}

async function tryFeelingLucky(query: string): Promise<string | null> {
  const luckyUrl = `${GOOGLE_LUCKY_BASE}${encodeURIComponent(query.trim())}`;
  const response = await fetch(luckyUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': BROWSERLIKE_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
  });

  const finalUrl = response.url || '';
  if (!finalUrl || isGoogleSearchPage(finalUrl) || !isResolvedWebUrl(finalUrl)) {
    return null;
  }

  return finalUrl;
}

async function tryCompanyWebsiteGuess(companyName: string): Promise<string | null> {
  const compact = companyName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '').trim();
  const dashed = companyName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const candidates = Array.from(new Set([
    compact ? `https://www.${compact}.com` : '',
    compact ? `https://${compact}.com` : '',
    dashed ? `https://www.${dashed}.com` : '',
    dashed ? `https://${dashed}.com` : '',
  ].filter(Boolean)));

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': BROWSERLIKE_USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      });

      const finalUrl = response.url || candidate;
      if (response.ok && isResolvedWebUrl(finalUrl)) {
        return finalUrl;
      }
    } catch (error) {
      mainLogger.warn('[DestinationResolver] Company website guess failed for candidate:', candidate, error);
    }
  }

  return null;
}

class DestinationResolverService {
  buildSearchUrl(query: string): string {
    return buildGoogleSearchUrl(query);
  }

  async resolveNavigationTarget(target: string): Promise<ResolvedDestination> {
    const directUrl = normalizeDirectUrl(target);
    if (directUrl) {
      return { url: directUrl, via: 'direct' };
    }

    const cleanedTarget = target.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!cleanedTarget) {
      return { url: buildGoogleSearchUrl(target), via: 'search' };
    }

    const knownDestination = resolveKnownDestination(cleanedTarget);
    if (knownDestination) {
      return { url: knownDestination, via: 'direct' };
    }

    const officialSiteMatch = cleanedTarget.match(/^(.+?)\s+(?:official website|official site|company website)$/i);
    if (officialSiteMatch?.[1]) {
      const guessedWebsite = await tryCompanyWebsiteGuess(officialSiteMatch[1].trim());
      if (guessedWebsite) {
        return { url: guessedWebsite, via: 'resolved' };
      }
    }

    const candidateQueries = [
      cleanedTarget,
      `${cleanedTarget} official site`,
    ];

    for (const query of candidateQueries) {
      try {
        const resolvedUrl = await tryFeelingLucky(query);
        if (resolvedUrl) {
          return { url: resolvedUrl, via: 'resolved' };
        }
      } catch (error) {
        mainLogger.warn('[DestinationResolver] Google destination resolution failed for query:', query, error);
      }
    }

    return { url: buildGoogleSearchUrl(cleanedTarget), via: 'search' };
  }
}

export const destinationResolver = new DestinationResolverService();

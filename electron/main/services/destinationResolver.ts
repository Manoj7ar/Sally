const GOOGLE_SEARCH_BASE = 'https://www.google.com/search?hl=en&q=';
const GOOGLE_LUCKY_BASE = 'https://www.google.com/search?btnI=I&hl=en&q=';
const RESOLVE_TIMEOUT_MS = 6000;
const BROWSERLIKE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

interface ResolvedDestination {
  url: string;
  via: 'direct' | 'resolved' | 'search';
}

function buildGoogleSearchUrl(query: string): string {
  return `${GOOGLE_SEARCH_BASE}${encodeURIComponent(query.trim())}`;
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
        console.warn('[DestinationResolver] Google destination resolution failed for query:', query, error);
      }
    }

    return { url: buildGoogleSearchUrl(cleanedTarget), via: 'search' };
  }
}

export const destinationResolver = new DestinationResolverService();

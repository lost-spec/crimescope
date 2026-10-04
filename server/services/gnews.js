import { config } from '../config.js';
import { fetchJson, HttpError, clamp } from '../lib/http.js';

export const CATEGORIES = {
  violent: {
    label: 'Violent crime',
    terms: ['shooting', 'murder', 'stabbing', 'assault', 'homicide', '"armed robbery"'],
  },
  property: {
    label: 'Property crime',
    terms: ['burglary', '"car break-in"', '"package theft"', 'robbery', 'arson', 'vandalism'],
  },
  drugs: {
    label: 'Narcotics',
    terms: ['"drug arrest"', 'trafficking', 'overdose', 'fentanyl', 'meth', 'cocaine'],
  },
  juvenile: {
    label: 'Juvenile',
    terms: ['"juvenile arrest"', '"teen arrested"', '"student charged"', 'delinquency'],
  },
  court: {
    label: 'Trials & courts',
    terms: ['indictment', 'sentencing', 'conviction', 'verdict', 'plea'],
  },
  all: {
    label: 'Everything',
    terms: ['crime', 'shooting', 'murder', 'burglary', 'robbery', 'arrest', 'police', 'court'],
  },
};

const WINDOW_DAYS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, any: null };

function isoAgo(days) {
  const date = new Date(Date.now() - days * 86400_000);
  return date.toISOString().slice(0, 19) + 'Z';
}

function shortPlace(locationName) {
  return String(locationName)
    .split(',')
    .slice(0, 2)
    .join(',')
    .trim()
    .replace(/"/g, '');
}

function clean(text) {
  return String(text || '').replace(/["()]/g, '').replace(/\s+/g, ' ').trim();
}

function fitQuery(terms, place, extra, limit) {
  const quote = (list) => list.map((term) => `"${clean(term)}"`).join(' OR ');
  const safePlace = clean(place);
  const safeExtra = clean(extra);

  const parts = [quote(terms)];
  if (safePlace) parts.push(`"${safePlace}"`);
  if (safeExtra) parts.push(`"${safeExtra}"`);

  const query = parts.join(' ');
  if (query.length <= limit) return query;

  const withoutExtra = [quote(terms), safePlace && `"${safePlace}"`]
    .filter(Boolean)
    .join(' ');
  if (withoutExtra.length <= limit) return withoutExtra;

  const bare = terms.map(clean).filter((term) => term.includes(' '));
  const reduced = bare.length ? quote(bare) : quote(terms.slice(0, 3));
  const trimmed = [reduced, safePlace && `"${safePlace}"`].filter(Boolean).join(' ');
  return trimmed.length <= limit ? trimmed : reduced.slice(0, limit);
}

const HINTS = {
  400: 'GNews rejected the request. Free plans cap "max" at 10 and the query at 200 characters — lower GNEWS_MAX_RESULTS or shorten the location name.',
  401: 'GNews rejected the API key. Check GNEWS_API_KEY.',
  403: 'GNews daily quota is used up, or the free plan cannot search this date range. It resets at 00:00 UTC.',
  429: 'GNews is rate limiting you. Wait a moment and retry.',
};

function gnewsError(error) {
  const status = error?.details?.upstreamStatus;
  const hint = HINTS[status];
  if (!hint) return error;
  return new HttpError(
    status === 429 ? 429 : 502,
    `${error.message} — ${hint}`,
    error.details,
  );
}

function mapArticle(article) {
  return {
    id: Buffer.from(`${article.url || article.title}`).toString('base64url').slice(0, 22),
    title: article.title || 'Untitled report',
    description: article.description || '',
    url: article.url || '',
    image: article.image || null,
    source: article.source?.name || 'Unknown source',
    publishedAt: article.publishedAt || null,
  };
}

export async function searchCrimeNews({
  category = 'all',
  window: windowKey = '7d',
  locationName = '',
  extra = '',
  country = '',
  max,
} = {}) {
  if (!config.gnews.apiKey) {
    throw new HttpError(503, 'GNEWS_API_KEY is not configured on the server');
  }

  const pack = CATEGORIES[category] || CATEGORIES.all;
  const place = shortPlace(locationName);
  const query = fitQuery(
    pack.terms,
    place,
    extra,
    config.gnews.queryMaxChars,
  );

  const limit = clamp(max, 1, config.gnews.maxResults, config.gnews.maxResults);
  const days = WINDOW_DAYS[windowKey];

  const url = new URL(`${config.gnews.baseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('lang', config.gnews.lang);
  if (config.gnews.country || country) {
    url.searchParams.set('country', clean(country || config.gnews.country).toLowerCase());
  }
  url.searchParams.set('max', String(limit));
  url.searchParams.set('apikey', config.gnews.apiKey);
  if (days) url.searchParams.set('from', isoAgo(days));

  const body = await fetchJson(url, {
    headers: { Accept: 'application/json', 'X-Api-Key': config.gnews.apiKey },
    service: 'GNews',
  }).catch((error) => {
    throw gnewsError(error);
  });

  const articles = Array.isArray(body?.articles) ? body.articles.map(mapArticle) : [];

  return {
    query,
    window: windowKey,
    max: limit,
    total: Number(body?.totalCount) || articles.length,
    fetchedAt: new Date().toISOString(),
    articles,
  };
}
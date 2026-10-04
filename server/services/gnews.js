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

const ADMIN = /\b(county|borough|district|province|region|prefecture|parish|municipality)\b/i;
const LEADING = /^(city of|town of|state of|greater|metro|metropolitan)\s+/i;

function isoAgo(days) {
  const date = new Date(Date.now() - days * 86400_000);
  return date.toISOString().slice(0, 19) + 'Z';
}

function clean(text) {
  return String(text || '')
    .replace(/["()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeVariants(locationName) {
  const seen = new Set();
  const parts = clean(locationName)
    .split(',')
    .map(clean)
    .filter(Boolean);

  for (const part of parts.slice(0, 3)) {
    if (ADMIN.test(part)) continue;
    const stripped = part.replace(LEADING, '').replace(/\s+/g, ' ').trim();
    const candidate = stripped.length >= 3 ? stripped : part;
    if (candidate) seen.add(candidate);
  }

  return [...seen];
}

function crimeGroup(terms) {
  const bare = terms.filter((term) => !term.includes(' ')).map(clean);
  const phrases = terms.filter((term) => term.includes(' ')).map(clean);
  const all = [...phrases, ...bare].filter(Boolean);
  return `(${all.map((term) => `"${term}"`).join(' OR ')})`;
}

function placeGroup(variants, limit) {
  if (variants.length === 0) return '';
  const single = variants.slice(0, 3).map((name) => `"${name}"`).join(' OR ');
  const group = `(${single})`;
  return group.length <= limit ? group : `"${variants[0]}"`;
}

function buildQueries(terms, variants, extra, limit) {
  const crime = crimeGroup(terms);
  const place = placeGroup(variants, limit);
  const user = clean(extra) ? ` AND "${clean(extra)}"` : '';

  const ladder = [];

  if (place && user) ladder.push(`${crime} AND ${place}${user}`);
  if (place) ladder.push(`${crime} AND ${place}`);
  if (place) ladder.push(`"${variants[0]}" AND ${crime}`);
  ladder.push(crime);

  const seen = new Set();
  return ladder
    .map((query) => query.slice(0, limit))
    .filter((query) => {
      if (seen.has(query)) return false;
      seen.add(query);
      return true;
    });
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

async function runQuery(query, { limit, windowKey, country }) {
  const url = new URL(`${config.gnews.baseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('lang', config.gnews.lang);
  if (country) url.searchParams.set('country', clean(country).toLowerCase());
  url.searchParams.set('max', String(limit));
  url.searchParams.set('apikey', config.gnews.apiKey);

  const days = WINDOW_DAYS[windowKey];
  if (days) {
    const capped = Math.min(days, config.gnews.historyDays);
    url.searchParams.set('from', isoAgo(capped));
  }

  const body = await fetchJson(url, {
    headers: { Accept: 'application/json', 'X-Api-Key': config.gnews.apiKey },
    service: 'GNews',
  }).catch((error) => {
    throw gnewsError(error);
  });

  const articles = Array.isArray(body?.articles) ? body.articles.map(mapArticle) : [];
  return { articles, total: Number(body?.totalCount) || articles.length };
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
  const variants = placeVariants(locationName);
  const limit = clamp(max, 1, config.gnews.maxResults, config.gnews.maxResults);
  const wire = (country || config.gnews.country).toLowerCase();

  const ladder = buildQueries(pack.terms, variants, extra, config.gnews.queryMaxChars);

  let used = null;
  let relaxed = false;

  for (const [index, query] of ladder.entries()) {
    const result = await runQuery(query, { limit, windowKey, country: wire });
    if (result.articles.length > 0) {
      used = { query, ...result };
      relaxed = index > 0;
      break;
    }
    if (index === ladder.length - 1) used = { query, ...result };
  }

  console.log(
    `[gnews] ${used.total} hits, ${used.articles.length} returned` +
      `${relaxed ? ' (relaxed)' : ''} :: ${used.query}`,
  );

  const locationMatched = used.query.includes('"');
  const days = WINDOW_DAYS[windowKey];
  const notes = [];

  if (relaxed && !locationMatched) {
    notes.push('No location-specific reports for this filter, so these are national results.');
  }
  if (days && days > config.gnews.historyDays) {
    notes.push(
      `GNews keeps ${config.gnews.historyDays} days of history on this plan, so the ${windowKey} window was capped.`,
    );
  }

  return {
    query: used.query,
    relaxed,
    notes,
    window: windowKey,
    max: limit,
    total: used.total,
    fetchedAt: new Date().toISOString(),
    articles: used.articles,
  };
}
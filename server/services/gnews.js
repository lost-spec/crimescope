import { config } from '../config.js';
import { fetchJson, HttpError, clamp } from '../lib/http.js';

export const CATEGORIES = {
  violent: {
    label: 'Violent crime',
    terms: 'shooting OR murder OR stabbing OR assault OR homicide OR "armed robbery"',
  },
  property: {
    label: 'Property crime',
    terms: 'burglary OR "car break-in" OR "package theft" OR robbery OR arson OR vandalism',
  },
  drugs: {
    label: 'Narcotics',
    terms: '"drug arrest" OR trafficking OR overdose OR fentanyl OR meth OR cocaine',
  },
  juvenile: {
    label: 'Juvenile',
    terms: '"juvenile arrest" OR "teen arrested" OR "student charged" OR delinquency',
  },
  court: {
    label: 'Trials & courts',
    terms: 'indictment OR sentencing OR conviction OR verdict OR "trial delay" OR plea',
  },
  all: {
    label: 'Everything',
    terms: 'crime OR shooting OR murder OR burglary OR robbery OR arrest OR police OR court',
  },
};

const WINDOWS = {
  '24h': 'when:1d',
  '7d': 'when:7d',
  '30d': 'when:30d',
  '90d': 'when:90d',
  any: '',
};

function buildQuery({ category, window: windowKey, locationName, extra }) {
  const pack = CATEGORIES[category] || CATEGORIES.all;
  const parts = [`(${pack.terms})`, WINDOWS[windowKey] ?? WINDOWS['7d']].filter(Boolean);

  if (extra) parts.push(`(${extra})`);
  if (locationName) {
    const place = locationName.split(',').slice(0, 2).join(',').trim();
    parts.push(`"${place}"`);
  }
  return parts.join(' ');
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
  max = 12,
} = {}) {
  if (!config.gnews.apiKey) {
    throw new HttpError(503, 'GNEWS_API_KEY is not configured on the server');
  }

  const query = buildQuery({ category, window: windowKey, locationName, extra });
  const limit = clamp(max, 1, 25, 12);

  const url = new URL(`${config.gnews.baseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('lang', config.gnews.lang);
  if (config.gnews.country || country) {
    url.searchParams.set('country', (country || config.gnews.country).toUpperCase());
  }
  url.searchParams.set('max', String(limit));
  url.searchParams.set('apikey', config.gnews.apiKey);

  const body = await fetchJson(url, {
    headers: { Accept: 'application/json' },
  });

  const articles = Array.isArray(body?.articles) ? body.articles.map(mapArticle) : [];

  return {
    query,
    total: Number(body?.totalCount) || articles.length,
    fetchedAt: new Date().toISOString(),
    articles,
  };
}
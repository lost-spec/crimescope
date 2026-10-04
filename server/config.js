import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseEnvFile(fs.readFileSync(envPath, 'utf8'));
}

const fileEnv = loadDotEnv();

function raw(key) {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess.trim();
  const fromFile = fileEnv[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile.trim();
  return undefined;
}

const num = (key, fallback) => {
  const value = raw(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (key, fallback = '') => raw(key) ?? fallback;

const vercelHost =
  raw('VERCEL_PROJECT_PRODUCTION_URL') || raw('VERCEL_URL') || '';

const defaultSiteUrl = vercelHost
  ? `https://${vercelHost}`
  : 'http://localhost:3000';

export const config = {
  port: num('PORT', 3000),
  host: str('HOST', '127.0.0.1'),

  gnews: {
    apiKey: str('GNEWS_API_KEY'),
    baseUrl: str('GNEWS_BASE_URL', 'https://gnews.io/api/v4'),
    lang: str('GNEWS_LANG', 'en'),
    country: str('GNEWS_COUNTRY', 'US'),
    maxResults: num('GNEWS_MAX_RESULTS', 10),
    queryMaxChars: num('GNEWS_QUERY_MAX_CHARS', 200),
    historyDays: num('GNEWS_HISTORY_DAYS', 30),
  },

  openrouter: {
    apiKey: str('OPENROUTER_API_KEY'),
    baseUrl: str('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    model: str('OPENROUTER_MODEL', 'google/gemini-2.0-flash-001'),
    siteUrl: str('OPENROUTER_SITE_URL', defaultSiteUrl),
    siteName: str('OPENROUTER_SITE_NAME', 'CrimeScope'),
    temperature: num('STORY_MODEL_TEMPERATURE', 0.85),
    maxSources: num('STORY_MAX_SOURCES', 8),
  },

  geocoder: {
    url: str('GEOCODER_URL', 'https://nominatim.openstreetmap.org/search'),
    reverseUrl: str(
      'GEOCODER_REVERSE_URL',
      'https://nominatim.openstreetmap.org/reverse',
    ),
    userAgent: str(
      'GEOCODER_USER_AGENT',
      'CrimeScope/0.1 (local development project)',
    ),
  },

  dataDir: str('STORY_DATA_DIR') || path.join(ROOT_DIR, 'data', 'stories'),
};

export function missingKeys() {
  const missing = [];
  if (!config.gnews.apiKey) missing.push('GNEWS_API_KEY');
  if (!config.openrouter.apiKey) missing.push('OPENROUTER_API_KEY');
  return missing;
}
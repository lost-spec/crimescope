import { config } from '../config.js';
import { fetchJson, HttpError, clamp } from '../lib/http.js';

const cache = new Map();
const TTL_MS = 1000 * 60 * 30;

function remember(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

function shape(entry, fallbackName) {
  const address = entry.address || {};
  const parts = [
    address.neighbourhood,
    address.suburb,
    address.city_district,
    address.city || address.town || address.village || address.county,
    address.state,
    address.country,
  ].filter(Boolean);

  const unique = [...new Set(parts)];
  return {
    name: unique.slice(0, 3).join(', ') || fallbackName,
    fullName: entry.display_name || unique.join(', ') || fallbackName,
    lat: Number(entry.lat),
    lon: Number(entry.lon),
    countryCode: (address.country_code || '').toUpperCase(),
  };
}

export async function geocode(query) {
  const q = String(query || '').trim();
  if (q.length < 2) throw new HttpError(400, 'Location must be at least 2 characters');

  const cacheKey = `geo:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL(config.geocoder.url);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const rows = await fetchJson(url, {
    headers: { 'User-Agent': config.geocoder.userAgent, Accept: 'application/json' },
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HttpError(404, `Could not find a location matching "${q}"`);
  }

  return remember(cacheKey, shape(rows[0], q));
}

export async function reverseGeocode(lat, lon) {
  const latitude = clamp(lat, -90, 90, null);
  const longitude = clamp(lon, -180, 180, null);
  if (latitude === null || longitude === null) {
    throw new HttpError(400, 'lat and lon must be valid numbers');
  }

  const cacheKey = `rev:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = new URL(config.geocoder.reverseUrl);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '12');

  const entry = await fetchJson(url, {
    headers: { 'User-Agent': config.geocoder.userAgent, Accept: 'application/json' },
  });

  return remember(cacheKey, shape(entry, 'Your location'));
}

export function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
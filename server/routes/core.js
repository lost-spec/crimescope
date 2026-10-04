import { Router } from 'express';
import { config, missingKeys } from '../config.js';
import { CATEGORIES } from '../services/gnews.js';
import { COUNTRIES } from '../services/countries.js';
import { geocode, reverseGeocode, distanceKm } from '../services/geocode.js';

export const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    providers: {
      gnews: Boolean(config.gnews.apiKey),
      openrouter: Boolean(config.openrouter.apiKey),
    },
    missing: missingKeys(),
    model: config.openrouter.model,
  });
});

router.get('/categories', (_req, res) => {
  res.json({
    categories: Object.entries(CATEGORIES).map(([id, value]) => ({
      id,
      label: value.label,
    })),
    windows: ['24h', '7d', '30d', '90d', 'any'],
    countries: COUNTRIES,
    tones: [
      'noir, restrained, street-level',
      'clinical, factual, procedural',
      'literary, atmospheric, elegiac',
      'urgent, plainspoken, direct',
    ],
    lengths: ['short', 'medium', 'long'],
  });
});

router.get('/geocode', async (req, res, next) => {
  try {
    res.json(await geocode(req.query.q));
  } catch (error) {
    next(error);
  }
});

router.get('/geocode/reverse', async (req, res, next) => {
  try {
    const place = await reverseGeocode(req.query.lat, req.query.lon);
    res.json(place);
  } catch (error) {
    next(error);
  }
});

router.get('/nearby-context', async (req, res, next) => {
  try {
    const place = await geocode(req.query.q);
    const radius = Math.min(Number(req.query.radiusKm) || 25, 200);
    res.json({ ...place, radiusKm: radius, spanKm: distanceKm(place, place) });
  } catch (error) {
    next(error);
  }
});
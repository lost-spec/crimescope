import { Router } from 'express';
import { searchCrimeNews } from '../services/gnews.js';

export const router = Router();

async function run(req, res, next) {
  try {
    const source = req.method === 'POST' ? req.body || {} : req.query;
    res.json(
      await searchCrimeNews({
        category: source.category,
        window: source.window,
        locationName: source.locationName,
        extra: source.extra,
        country: source.country,
        max: source.max,
      }),
    );
  } catch (error) {
    next(error);
  }
}

router.get('/', run);
router.post('/', run);
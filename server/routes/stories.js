import { Router } from 'express';
import { generateStory } from '../services/stories.js';
import { listStories, getStory, deleteStory } from '../store/stories.js';
import { HttpError } from '../lib/http.js';

export const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    res.json({ stories: await listStories() });
  } catch (error) {
    next(error);
  }
});

router.post('/generate', async (req, res, next) => {
  try {
    const { location, category, articles, tone, length } = req.body || {};
    if (!location) throw new HttpError(400, 'A location name is required');
    res.status(201).json(
      await generateStory({ location, category, articles, tone, length }),
    );
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json(await getStory(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    res.json(await deleteStory(req.params.id));
  } catch (error) {
    next(error);
  }
});
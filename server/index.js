import path from 'node:path';
import express from 'express';
import { config, ROOT_DIR } from './config.js';
import { HttpError } from './lib/http.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { router as coreRouter } from './routes/core.js';
import { router as newsRouter } from './routes/news.js';
import { router as storiesRouter } from './routes/stories.js';

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.use(
  '/api',
  createRateLimiter({
    windowMs: 60_000,
    max: 60,
    message: 'Too many requests, slow down',
  }),
);

app.use(
  '/api/stories/generate',
  createRateLimiter({
    windowMs: 10 * 60_000,
    max: 8,
    message: 'Story generation limit reached, try again in a few minutes',
  }),
);

app.use('/api', coreRouter);
app.use('/api/news', newsRouter);
app.use('/api/stories', storiesRouter);

app.use(
  express.static(path.join(ROOT_DIR, 'public'), {
    extensions: ['html'],
    maxAge: '1h',
  }),
);

app.use('/api', (_req, _res, next) => {
  next(new HttpError(404, 'Unknown API endpoint'));
});

app.use((error, _req, res, _next) => {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: error.message || 'Internal server error',
    details: error.details || undefined,
  });
});

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  app.listen(config.port, config.host, () => {
    console.log(`\n  CRIMESCOPE  →  http://${config.host}:${config.port}`);
    if (!config.gnews.apiKey) console.log('  ! GNEWS_API_KEY missing — news search disabled');
    if (!config.openrouter.apiKey) console.log('  ! OPENROUTER_API_KEY missing — story forge disabled');
    console.log('');
  });
} else {
  console.log('  CRIMESCOPE running in serverless mode');
}

export default app;
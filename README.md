# CrimeScope

Search crime news for a neighbourhood, then have an LLM turn those reports into a
long-form crime story you can sit down and read.

- **GNews** supplies the live crime reports for the area you pick.
- **Nominatim (OpenStreetMap)** turns a typed place or browser GPS fix into real coordinates.
- **OpenRouter** writes the narrative features from the reports you tick.
- Stories are saved to disk as JSON, so the shelf survives restarts.

## Setup

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Then fill in two keys in `.env`:

| Key | Where to get it |
| --- | --- |
| `GNEWS_API_KEY` | https://gnews.io/register (free tier available) |
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |

`OPENROUTER_MODEL` defaults to `google/gemini-2.0-flash-001` — any chat model on
OpenRouter works. Point it at a cheap model to keep costs down.

Run it:

```bash
npm start        # http://127.0.0.1:3000
npm run dev      # same, with --watch
```

The header shows two status pips (`news`, `stories`). If a key is missing the pip
stays dark and the forge panel tells you exactly what to add.

## Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
vercel env add GNEWS_API_KEY production
vercel env add OPENROUTER_API_KEY production
```

Only those two keys are required. Everything else has a default:

- `OPENROUTER_SITE_URL` auto-detects from `VERCEL_PROJECT_PRODUCTION_URL` (then
  `VERCEL_URL`), so the `Referer` OpenRouter sees matches your deployed origin.
- `VERCEL=1` is injected by the platform, which is how `server/index.js` knows to
  export a handler rather than bind a port.
- `PORT` and `HOST` are ignored on Vercel — do not set them.

Optional overrides live in `.env.production.example`.

### One caveat: the story shelf

The Vercel filesystem is read-only apart from `/tmp`, so `server/store/stories.js`
probes the directory and falls back to an in-memory shelf with a warning in the
logs. Search and story generation both work, but **generated stories will not
survive a cold start or scale-out**. The story still returns to the browser and
reads fine immediately.

For a durable shelf, point `STORY_DATA_DIR` at a mounted writable path or replace
the store with a real database.

## Using it

1. Type a city, neighbourhood, postcode or address — or hit **Use my location**
   to let the browser supply a GPS fix.
2. Pick a category (violent, property, narcotics, juvenile, courts, everything),
   a time window, an optional keyword, and the country wire.
3. **Search the wire** loads matching reports.
4. Tick the reports worth using, set tone and length, then hit **Write the story**.
5. The story lands on the shelf and opens in the reader.

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | provider key status and active model |
| `GET` | `/api/categories` | categories, windows, tones, lengths |
| `GET` | `/api/geocode?q=` | place name → `{ name, lat, lon, fullName }` |
| `GET` | `/api/geocode/reverse?lat=&lon=` | coordinates → place name |
| `GET`/`POST` | `/api/news` | `{ category, window, locationName, extra, country, max }` |
| `GET` | `/api/stories` | shelf index (summaries) |
| `POST` | `/api/stories/generate` | `{ location, articles[], tone, length, category }` |
| `GET` | `/api/stories/:id` | one full story |
| `DELETE` | `/api/stories/:id` | remove a story |

## How the search query is built

GNews has no geo radius, so `server/services/gnews.js` compiles a location into its
query language instead:

```
"crime" OR "shooting" OR "murder" OR "burglary" OR "robbery" OR "arrest" "Brooklyn, Kings County"
```

The category supplies the crime terms, your keywords are added as phrases, and the
resolved place name is quoted and appended. `server/services/geocode.js` normalises the
place down to its first two comma segments so the match stays broad enough to return hits.

Three GNews limits shape this, and breaking any of them returns **HTTP 400**:

| Limit | Handling |
| --- | --- |
| `q` max 200 characters | `fitQuery` drops keywords, then multi-word terms, then hard-truncates |
| `max` capped per plan (10 Free, 25 Essential) | `GNEWS_MAX_RESULTS`, default 10 to match the Free plan |
| No `when:` operator in v4 | the time window becomes a `from` parameter in ISO format |

The country is auto-detected from the geocoded place, so a London search queries the UK
wire rather than the US one. `GNEWS_COUNTRY` is only the fallback.

## Generated stories are fiction

The system prompt in `server/services/stories.js` instructs the model to weave the real
reports into a narrative without inventing verifiable specifics, to mark gaps explicitly
("police have not said"), to keep invented names and dialogue obviously fictional, and to
close with a **What is confirmed** section listing only what the filings actually state.
Every story stores its source URLs and the reader prints them underneath.

It is still a model. Treat it as a written feature, not a police record.

## Limits

Two in-memory rate limiters guard the paid endpoints: 60 req/min across `/api`, and
8 story generations per 10 minutes. Both reset when the process restarts.

## Layout

```
server/
  index.js            express app, static hosting, error handling
  config.js           .env loading and settings
  lib/http.js         fetch + JSON helper, HttpError, clamp
  lib/rateLimit.js    per-IP fixed-window limiter
  routes/             core (health, geo, categories), news, stories
  services/           geocode.js, gnews.js, stories.js (OpenRouter)
  store/stories.js    JSON story persistence + shelf index
public/
  index.html          single page shell
  styles.css          crimson / blood theme
  app.js              state, rendering, markdown, reader
data/stories/         generated stories + index.json
```

## Notes

- Node 20+ (uses the built-in `fetch`, so there are no HTTP client dependencies).
- Stories render through a small in-house markdown subset — headings, blockquotes, lists,
  dividers, bold, italic, code. All text is HTML-escaped before formatting.
- The CSS respects `prefers-reduced-motion`.
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

`OPENROUTER_MODEL` defaults to `nvidia/nemotron-3.5-lightning:free`, which costs
nothing and has a 1M context window. Any chat model on OpenRouter works — point it at
something larger if the prose quality is not there.

## Story generation is defensive

Small models are unreliable at strict structured output, so
`server/services/stories.js` handles three failure shapes:

1. **Valid JSON** — used as-is.
2. **JSON in a markdown fence** — fences and stray prose are stripped before parsing.
3. **Prose with no JSON at all** — `salvage` keeps the markdown as the body and
   synthesises a headline from the location, rather than throwing the work away.

If the first reply is unusable it retries once at a lower temperature with an
explicit "return only JSON" instruction. If that also fails, the error names the
model so it is obvious which one to change.

This matters because the default model does not advertise `response_format` or
`structured_outputs` support, so the JSON contract has to be enforced by prompting
and cleaned up afterwards rather than by the API.

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
   a time window, an optional keyword, and a country.
3. **Search the wire** loads matching reports.
4. Tick the reports worth using, set tone and length, then hit **Write the story**.
5. The story lands on the shelf and opens in the reader.

## Countries: why there are two of them

The picker offers all **71** countries GNews indexes, but GNews splits that across
two endpoints with different country lists:

| Endpoint | Countries | Used for |
| --- | --- | --- |
| `/search` | 37 | the 37 it accepts, Pakistan included |
| `/top-headlines` | 71 | the other 34 (`ke`, `za`, `nz`, `gh`, `bw`, …) |

The "71 countries" GNews advertises is the *top-headlines* list. Passing one of the
extra 34 to `/search` gets the request rejected, so `server/services/countries.js`
holds the registry and `searchCrimeNews` routes automatically:

- **37 countries** go to `/search` as before, with `lang` pinned to `GNEWS_LANG`.
- **34 countries** (`ke`, `za`, `nz`, `gh`, `bw`, …) go to `/top-headlines`, which
  also accepts `q`, so the crime keywords still apply.
- The top-headlines route **drops the `lang` pin**. Those countries are covered
  almost entirely by local-language publishers, so forcing `en` would return
  nothing. Titles are shown in their original language either way.
- The top-headlines route gets one extra, narrower fallback query, because it
  filters a ranked headline list rather than a full-text index and long boolean
  queries come back empty more often there.

A country GNews does not index at all (Nepal, for instance) is never sent to the
wire — the filter is dropped and a note explains why, instead of returning a 400.
Auto-detect checks the same list, so a GPS fix in an uncovered country says so
rather than silently searching everywhere.

The `/api/news` response also reports `country` and which `endpoint` was used, so a
headlines-routed search is visible rather than mysterious.

## API

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | provider key status and active model |
| `GET` | `/api/categories` | categories, windows, tones, lengths, countries |
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
("crime" OR "shooting" OR "murder" OR "burglary" OR "robbery" OR "arrest" OR "police" OR "court")
  AND ("Brooklyn" OR "New York")
```

The explicit `AND` matters: `OR` binds tighter than `AND` in GNews, so without the
parentheses a location filter silently does nothing. Place variants come from splitting
the geocoded name on commas and discarding administrative segments, so
`Brooklyn, Kings County, New York` becomes `Brooklyn` and `New York`.

Three GNews limits shape this, and breaking any of them returns **HTTP 400**:

| Limit | Handling |
| --- | --- |
| `q` max 200 characters | `buildQueries` truncates |
| `max` capped per plan (10 Free, 25 Essential) | `GNEWS_MAX_RESULTS`, default 10 to match the Free plan |
| No `when:` operator in v4 | the time window becomes a `from` parameter in ISO format |

### The relaxation ladder

A place name plus a list of crime terms is a narrow intersection, and for a small
town it can legitimately match nothing. Rather than showing an empty page, the service
tries progressively looser queries and stops at the first with results:

1. crime terms `AND` place variants `AND` your keywords
2. crime terms `AND` place variants
3. `"Brooklyn" AND` crime terms
4. crime terms alone — national results, no location filter

The response carries `relaxed: true` and a `notes` array explaining what happened, and
the UI says so under the result count. The final query is logged as `[gnews] N hits`.

## Plan limits worth knowing

The Free tier is 100 requests/day, 10 articles per request, a **12-hour delay** on new
articles, and **30 days** of history. So a "last 24 hours" search on a free key only
sees 12 hours of data, and `GNEWS_HISTORY_DAYS` caps longer windows instead of letting
them return nothing. Paid plans unlock real-time data and history back to 2020.

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
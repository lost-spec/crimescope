import { config } from '../config.js';
import { fetchJson, HttpError, clamp } from '../lib/http.js';
import { saveStory } from '../store/stories.js';

const SYSTEM_PROMPT = `You are a narrative crime journalist writing for CrimeScope, a site that explains what is happening on the streets of a neighbourhood.

Rules:
- Write a fictionalised narrative feature inspired by the supplied news reports. Never present invented people, quotes, dialogue, or specific evidence as verified fact.
- Any invented character must have a plainly fictional name. Any invented quote must be paraphrased or explicitly framed as imagined.
- Do not invent specific ages, wound details, weapon calibres, conviction outcomes, or police procedures that are not in the source material. Leave gaps explicit: "police have not said", "the filing does not name".
- Never provide operational detail that would help someone commit a crime.
- End with a short, factual "What is confirmed" section listing only what the source reports actually state.
- Respect the JSON contract exactly. No markdown fences around the JSON object.`;

function buildUserPrompt({ location, category, articles, tone, length }) {
  const sources = articles.map((article, i) => {
    const date = article.publishedAt
      ? new Date(article.publishedAt).toISOString().slice(0, 10)
      : 'unknown date';
    return [
      `[${i + 1}] ${article.title}`,
      `    outlet: ${article.source} | published: ${date}`,
      `    summary: ${(article.description || 'no summary provided').slice(0, 400)}`,
      `    url: ${article.url}`,
    ].join('\n');
  });

  const lengths = {
    short: '500 to 700 words',
    medium: '900 to 1200 words',
    long: '1600 to 2000 words',
  };

  return `Write a ${lengths[length] || lengths.medium} narrative feature about crime and public safety around ${location}.

Category focus: ${category}
Tone: ${tone}

Ground the story in these ${sources.length} real news reports. Weave them into a single scene-setting narrative, clearly signalling where you are inferring beyond the reports.

REPORTS
${sources.join('\n\n')}

Return ONLY a JSON object with this exact shape:
{
  "title": "evocative headline, no clickbait, max 90 chars",
  "dek": "one or two sentence standfirst that frames the piece",
  "body_markdown": "the full narrative in markdown. Use ## for section breaks, > for short quoted framing lines, and --- as a scene divider. Include a final '## What is confirmed' section.",
  "tags": ["3", "to", "6", "single-word", "tags"]
}`;
}

function extractJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new HttpError(502, 'The model returned a story we could not parse');
      }
    }
    throw new HttpError(502, 'The model returned an empty story');
  }
}

function parseOrNull(text) {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

function salvage(raw, articles, wanted) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false };

  try {
    const parsed = extractJson(text);
    if (parsed && parsed.body_markdown) return { ok: true, value: parsed };
  } catch {
    /* not JSON, fall through to prose salvage */
  }

  const looksLikeProse = text.length > 250 && !text.startsWith('{');
  if (!looksLikeProse) return { ok: false };

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const headingIndex = lines.findIndex((line) => /^#{1,3}\s/.test(line));

  const candidate = headingIndex > 0 ? lines[headingIndex - 1] : lines[0];
  const usable = candidate && !/^#{1,3}\s/.test(candidate) && candidate.length <= 100;

  const headline = usable
    ? candidate.replace(/[.,;:]\s*$/, '')
    : `Crime on the streets of ${wanted.location}`;

  const body = headingIndex >= 0 ? lines.slice(headingIndex).join('\n\n') : text;

  return {
    ok: true,
    value: {
      title: headline.slice(0, 140),
      dek: '',
      body_markdown: body,
      tags: [wanted.location, wanted.tone.split(',')[0].trim()].filter(Boolean).slice(0, 4),
    },
  };
}

function countWords(markdown) {
  return String(markdown || '')
    .replace(/[#>*_`\-[\]()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

async function callModel(url, body) {
  return fetchJson(url, {
    method: 'POST',
    timeout: 120000,
    service: 'OpenRouter',
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.openrouter.siteUrl,
      'X-Title': config.openrouter.siteName,
    },
    body: JSON.stringify(body),
  });
}

export async function generateStory({
  location,
  category = 'all',
  articles = [],
  tone = 'noir, restrained, street-level',
  length = 'medium',
}) {
  if (!config.openrouter.apiKey) {
    throw new HttpError(503, 'OPENROUTER_API_KEY is not configured on the server');
  }
  const picked = articles.slice(0, config.openrouter.maxSources);
  if (picked.length === 0) {
    throw new HttpError(400, 'Select at least one article to build a story from');
  }

  const url = `${config.openrouter.baseUrl}/chat/completions`;
  const request = {
    model: config.openrouter.model,
    temperature: clamp(
      length === 'short' ? config.openrouter.temperature + 0.1 : config.openrouter.temperature,
      0,
      1.5,
    ),
    max_tokens: length === 'long' ? 3600 : 2200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserPrompt({
          location,
          category,
          articles: picked,
          tone,
          length,
        }),
      },
    ],
  };

  let response = await callModel(url, request);
  let raw = response?.choices?.[0]?.message?.content;

  const wanted = { length, tone, location };
  const salvaged = salvage(raw, picked, wanted);

  if (!salvaged.ok) {
    response = await callModel(url, {
      ...request,
      temperature: clamp(request.temperature - 0.3, 0, 1.5),
      messages: [
        ...request.messages,
        {
          role: 'assistant',
          content: String(raw || '').slice(0, 800),
        },
        {
          role: 'user',
          content:
            'That reply was not valid JSON. Reply with ONE JSON object and nothing else. ' +
            'No markdown fences, no commentary. Keys: title (string), dek (string), ' +
            'body_markdown (string, the full narrative in markdown), tags (array of strings).',
        },
      ],
    });
    raw = response?.choices?.[0]?.message?.content;
  }

  const parsed = salvaged.ok ? salvaged.value : parseOrNull(raw);

  if (!parsed || !parsed.title || !parsed.body_markdown) {
    throw new HttpError(
      502,
      `The model (${config.openrouter.model}) did not return a usable story. ` +
        'Try a shorter length, or set OPENROUTER_MODEL to a stronger model.',
    );
  }

  const body_markdown = String(parsed.body_markdown);
  const words = countWords(body_markdown);

  return saveStory({
    title: String(parsed.title).slice(0, 140),
    dek: String(parsed.dek || '').slice(0, 400),
    body_markdown,
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).slice(0, 32)).slice(0, 8)
      : [],
    location,
    category,
    tone,
    length,
    wordCount: words,
    readMinutes: Math.max(1, Math.round(words / 220)),
    model: response?.model || config.openrouter.model,
    sources: picked.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.source,
      publishedAt: a.publishedAt,
    })),
  });
}
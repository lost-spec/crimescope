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

/*
 * Reasoning models (Nemotron, DeepSeek, the Qwen thinking variants) leak their
 * chain of thought in two ways: as a separate `reasoning` field, and inlined in
 * `content` behind <think> tags or as a plain preamble. The inline form is the
 * dangerous one, because the thinking often contains braces and used to hijack
 * the JSON parse, and because the prose-salvage path would happily publish the
 * reasoning as the story.
 */

const REASONING_BLOCK = /<think>[\s\S]*?<\/think>/gi;
const REASONING_FENCE = /<(?:thinking|reasoning)>[\s\S]*?<\/(?:thinking|reasoning)>/gi;

function stripReasoning(text) {
  let out = String(text || '');
  out = out.replace(REASONING_BLOCK, '\n').replace(REASONING_FENCE, '\n');

  // An unterminated block means the budget ran out mid-thought; nothing after
  // the opening tag is a real answer.
  const open = out.search(/<(?:think|thinking|reasoning)>/i);
  if (open !== -1) out = out.slice(0, open);

  return out.replace(/\s{3,}/g, '\n\n').trim();
}

/**
 * Every top-level balanced `{...}` in the text, in order.
 *
 * Scanning for a balanced object rather than slicing from the first `{` to the
 * last `}` is what makes a brace-laden preamble harmless: a stray `{"title":
 * ...}` inside the thinking is simply one candidate that fails to parse, and
 * the real object later in the string still gets found.
 */
function candidateObjects(text) {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          found.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return found;
}

function unfence(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseStory(raw) {
  const text = stripReasoning(raw);
  if (!text) return null;

  const attempts = [unfence(text), ...candidateObjects(text)];
  const parsed = [];

  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      const value = JSON.parse(attempt);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed.push(value);
    } catch {
      /* try the next candidate */
    }
  }

  /*
   * A fragment such as `{"title": "x"}` inside the model's preamble parses
   * cleanly, so returning the first success would hand back a stub instead of
   * the story. Prefer a candidate that actually carries the narrative.
   */
  return parsed.find((value) => value.body_markdown) || parsed[0] || null;
}

function parseOrNull(raw) {
  return parseStory(raw);
}

/*
 * Guards the prose-salvage path. Publishing a model's internal reasoning as a
 * crime feature is worse than returning an error, so anything that reads like
 * deliberation is rejected. Two markers are required so that ordinary reported
 * prose is not caught by a single stray phrase.
 */
const REASONING_MARKERS = [
  /\blet me\b/i,
  /\bstep[- ]by[- ]step\b/i,
  /\bthe (?:user|prompt|instructions?)\b[^.\n]{0,40}\b(?:wants?|asks?|requires?|says?)\b/i,
  /^\s*(?:thinking|thoughts?|reasoning)\s*[:\-]/im,
  /\b(?:first|then|finally),?\s+i\b/i,
  /\bi\b[^.\n]{0,40}\b(?:need to|should|must)\b[^.\n]{0,30}\b(?:draft|think|consider|parse|verify|construct|write out)\b/i,
];

function looksLikeReasoning(text) {
  const sample = String(text || '').slice(0, 2000);
  if (!sample) return false;
  return REASONING_MARKERS.filter((marker) => marker.test(sample)).length >= 2;
}

function salvage(raw, articles, wanted) {
  const text = stripReasoning(raw);
  if (!text) return { ok: false, reason: 'empty' };

  const parsed = parseStory(text);
  if (parsed && parsed.body_markdown) return { ok: true, value: parsed };

  const looksLikeProse = text.length > 250 && !text.startsWith('{');
  if (!looksLikeProse) return { ok: false, reason: 'unparseable' };
  if (looksLikeReasoning(text)) return { ok: false, reason: 'reasoning' };

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

/**
 * `content` is the answer. Some reasoning models also return `reasoning` (or the
 * `reasoning_content` alias) as a sibling field, which must never be read as the
 * story. Some instead put their thinking inline in `content`, which
 * `stripReasoning` deals with downstream.
 */
function readContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Works out why a reply is unusable, so the error names the real cause instead
 * of guessing. The important case is a reasoning model that spent the whole
 * max_tokens budget thinking: visible tokens are then near zero, content is
 * empty, and finish_reason is "length".
 */
function diagnose(response, raw) {
  const choice = response?.choices?.[0] || {};
  const reasoning =
    choice.message?.reasoning || choice.message?.reasoning_content || '';
  const completion = Number(response?.usage?.completion_tokens) || 0;
  const reasoningTokens =
    Number(response?.usage?.completion_tokens_details?.reasoning_tokens) || 0;
  const visible = completion ? completion - reasoningTokens : 0;
  const truncated = choice.finish_reason === 'length';

  const detail = {
    finishReason: choice.finish_reason || null,
    completionTokens: completion || null,
    reasoningTokens: reasoningTokens || null,
    visibleTokens: completion ? visible : null,
    reasoningChars: reasoning ? String(reasoning).length : 0,
  };

  if (!raw.trim() && reasoningTokens > 0 && visible < 64) {
    return {
      note:
        `It spent ${reasoningTokens} of ${completion} tokens reasoning and left ` +
        `${visible} for the story, so it returned nothing.`,
      detail,
    };
  }
  if (!raw.trim() && reasoning) {
    return {
      note: 'It returned only internal reasoning and no story.',
      detail,
    };
  }
  if (truncated) {
    return {
      note: `It hit the ${completion || 'max_tokens'} token ceiling before finishing (finish_reason: length).`,
      detail,
    };
  }
  return { note: '', detail };
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

  /*
   * Reasoning is switched off rather than merely excluded. `exclude: true` only
   * hides the tokens, they are still billed and still count against max_tokens,
   * so a model that thinks anyway leaves no room for the story. `enabled: false`
   * is the one that actually stops it; `exclude` is belt and braces for the
   * providers that ignore the disable.
   */
  const request = {
    model: config.openrouter.model,
    temperature: clamp(
      length === 'short' ? config.openrouter.temperature + 0.1 : config.openrouter.temperature,
      0,
      1.5,
    ),
    /*
     * Reasoning tokens come out of the same budget as the answer, so this is
     * sized for the story with headroom rather than for the story alone. The old
     * 2200/3600 left a 900-1200 word feature almost no margin, and a model that
     * spent the budget thinking returned an empty content with
     * finish_reason "length".
     */
    max_tokens: { short: 3000, medium: 4500, long: 7000 }[length] || 4500,
    reasoning: { enabled: false, exclude: true },
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
  let raw = readContent(response);
  let trouble = diagnose(response, raw);

  const wanted = { length, tone, location };
  let salvaged = salvage(raw, picked, wanted);

  if (!salvaged.ok) {
    console.warn(
      `[story] first attempt unusable (${salvaged.reason || 'unknown'}${trouble.note ? `, ${trouble.note}` : ''}), retrying`,
    );
    response = await callModel(url, {
      ...request,
      temperature: clamp(request.temperature - 0.3, 0, 1.5),
      /*
       * The failed reply is echoed back as context, so it must be the real
       * answer. Echoing the model's reasoning back at it invites more of it.
       */
      messages: [
        ...request.messages,
        {
          role: 'assistant',
          content: stripReasoning(raw).slice(0, 800) || '(no usable output)',
        },
        {
          role: 'user',
          content:
            'That reply was not valid JSON. Reply with ONE JSON object and nothing else. ' +
            'No markdown fences, no commentary, no reasoning. Keys: title (string), ' +
            'dek (string), body_markdown (string, the full narrative in markdown), ' +
            'tags (array of strings).',
        },
      ],
    });
    raw = readContent(response);
    trouble = diagnose(response, raw);
    salvaged = salvage(raw, picked, wanted);
  }

  const parsed = salvaged.ok ? salvaged.value : parseOrNull(raw);

  if (!parsed || !parsed.title || !parsed.body_markdown) {
    const SALVAGE_NOTES = {
      reasoning: 'It spent the reply explaining its own reasoning instead of writing the story.',
      empty: 'It returned an empty response.',
      unparseable: 'It returned something that was neither JSON nor a narrative.',
    };
    const note = trouble.note || SALVAGE_NOTES[salvaged.reason] || '';

    throw new HttpError(
      502,
      `The model (${config.openrouter.model}) did not return a usable story. ` +
        `${note ? `${note} ` : ''}Try a shorter length, or set OPENROUTER_MODEL to a stronger model.`,
      trouble.detail,
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
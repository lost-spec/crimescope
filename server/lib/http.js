export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export async function fetchJson(
  url,
  { timeout = 15000, headers = {}, service = 'Upstream', ...init } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new HttpError(504, `${service} request timed out`);
    }
    throw new HttpError(502, `${service} request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const upstreamMessage =
      body?.errors?.[0]?.message ||
      body?.error?.message ||
      body?.message ||
      body?.raw ||
      `HTTP ${response.status}`;
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      `${service} error: ${upstreamMessage}`,
      { service, upstreamStatus: response.status, body },
    );
  }

  return body;
}

export function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
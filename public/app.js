const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  articles: [],
  picked: new Set(),
  location: '',
  category: 'all',
  window: '7d',
  country: 'US',
  shelves: [],
};

const el = {
  form: $('#searchForm'),
  location: $('#locationInput'),
  locationHint: $('#locationHint'),
  window: $('#windowSelect'),
  country: $('#countrySelect'),
  extra: $('#extraInput'),
  chips: $('#categoryChips'),
  searchBtn: $('#searchBtn'),
  locateBtn: $('#locateBtn'),
  status: $('#searchStatus'),
  reports: $('#reports'),
  grid: $('#resultGrid'),
  resultCount: $('#resultCount'),
  selectAll: $('#selectAllBtn'),
  selectedCount: $('#selectedCount'),
  tone: $('#toneSelect'),
  length: $('#lengthSelect'),
  headline: $('#headlineInput'),
  generateBtn: $('#generateBtn'),
  forgeNote: $('#forgeNote'),
  shelf: $('#shelf'),
  shelfCount: $('#shelfCount'),
  reader: $('#reader'),
  readerBody: $('#readerBody'),
  toasts: $('#toasts'),
  pips: $('#providerPips'),
};

/* ---------------- utils ---------------- */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

function busy(button, on) {
  button.classList.toggle('is-busy', on);
  button.disabled = on;
}

function toast(message, { title = 'Error', bad = true, ms = 7000 } = {}) {
  const node = document.createElement('div');
  node.className = `toast${bad ? ' bad' : ''}`;
  const strong = document.createElement('b');
  strong.textContent = title;
  node.append(strong, document.createTextNode(message));
  el.toasts.append(node);
  setTimeout(() => node.remove(), ms);
}

function setStatus(html) {
  el.status.innerHTML = html || '';
}

function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(markdown) {
  const blocks = String(markdown || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const html = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    if (/^(---|\*\*\*|___)$/.test(block)) {
      html.push('<hr />');
      continue;
    }

    const heading = block.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 5);
      html.push(`<h${level}>${escapeHtml(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (block.split('\n').every((line) => /^>\s?/.test(line.trim()))) {
      const inner = block
        .split('\n')
        .map((line) => line.trim().replace(/^>\s?/, ''))
        .join(' ');
      html.push(`<blockquote>${inline(escapeHtml(inner))}</blockquote>`);
      continue;
    }

    if (block.split('\n').every((line) => /^\s*[-*+]\s+/.test(line))) {
      const items = block
        .split('\n')
        .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
        .map((item) => `<li>${inline(escapeHtml(item))}</li>`)
        .join('');
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    if (block.split('\n').every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      const items = block
        .split('\n')
        .map((line) => line.replace(/^\s*\d+[.)]\s+/, '').trim())
        .map((item) => `<li>${inline(escapeHtml(item))}</li>`)
        .join('');
      html.push(`<ol>${items}</ol>`);
      continue;
    }

    const paragraph = block.split('\n').join(' ');
    html.push(`<p>${inline(escapeHtml(paragraph))}</p>`);
  }

  return html.join('\n');
}

/* ---------------- boot ---------------- */

async function boot() {
  try {
    const health = await api('/health');
    for (const pip of $$('.pip', el.pips)) {
      const on = health.providers?.[pip.dataset.pip];
      pip.dataset.state = on ? 'on' : 'off';
      pip.title = on
        ? 'API key configured'
        : `${pip.dataset.pip} key missing — add it to .env`;
    }
    if (health.missing?.length) {
      el.forgeNote.textContent = `Add ${health.missing.join(' and ')} to your .env file to go live. Model: ${health.model}`;
    }
  } catch {
    el.forgeNote.textContent = 'Backend unreachable.';
  }

  try {
    const meta = await api('/categories');
    state.categories = meta.categories;
    meta.categories.forEach((cat) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = cat.label;
      chip.dataset.category = cat.id;
      chip.setAttribute('aria-pressed', String(cat.id === state.category));
      chip.addEventListener('click', () => {
        state.category = cat.id;
        $$('.chip', el.chips).forEach((c) =>
          c.setAttribute('aria-pressed', String(c === chip)),
        );
      });
      el.chips.append(chip);
    });

    meta.tones.forEach((tone) => {
      const option = document.createElement('option');
      option.value = tone;
      option.textContent = tone.replace(/,.*/, (m) => m).replace(/^./, (c) => c.toUpperCase());
      el.tone.append(option);
    });
  } catch {
    /* meta is non-critical */
  }

  loadShelf();
}

/* ---------------- search ---------------- */

async function resolveLocation(raw) {
  setStatus('Resolving location…');
  const place = await api(`/geocode?q=${encodeURIComponent(raw)}`);
  el.locationHint.textContent = place.fullName;
  el.locationHint.classList.add('ok');
  return place;
}

async function runSearch() {
  const raw = el.location.value.trim();
  if (!raw) {
    toast('Tell CrimeScope where to look first.', { title: 'No location' });
    el.location.focus();
    return;
  }

  busy(el.searchBtn, true);
  try {
    const place = await resolveLocation(raw);
    state.location = place.name;
    const chosen = el.country.value;
    state.country = chosen || place.countryCode || 'US';
    if (chosen !== state.country) el.country.value = state.country;

    setStatus(`Pulling reports around <strong>${escapeHtml(place.name)}</strong>…`);
    const data = await api('/news', {
      method: 'POST',
      body: {
        category: state.category,
        window: state.window,
        locationName: place.name,
extra: el.extra.value.trim(),
        country: state.country,
      },
    });

    state.articles = data.articles;
    state.picked.clear();
    renderResults();

    if (data.articles.length === 0) {
      setStatus(
        `<span class="err">No reports matched</span> — widen the time window or clear the keywords.`,
      );
      toast('Nothing on the wire for that combination. Try a wider window.', {
        title: 'No results',
        bad: false,
      });
    } else {
      const notes = (data.notes || []).join(' ');
      setStatus(
        `<span class="ok">${data.total} report${data.total === 1 ? '' : 's'}</span> near ${escapeHtml(place.name)} · tick the ones you want in the story` +
          (notes ? `<br /><span class="hint">${escapeHtml(notes)}</span>` : ''),
      );
    }
  } catch (error) {
    setStatus(`<span class="err">${escapeHtml(error.message)}</span>`);
    toast(error.message, { title: 'Search failed' });
  } finally {
    busy(el.searchBtn, false);
  }
}

function renderResults() {
  el.reports.hidden = false;
  el.grid.innerHTML = '';
  el.resultCount.textContent = `${state.articles.length} on the wire`;

  for (const article of state.articles) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = article.id;

    const media = document.createElement('div');
    media.className = 'card-media';

    const pick = document.createElement('label');
    pick.className = 'card-pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      if (box.checked) state.picked.add(article.id);
      else state.picked.delete(article.id);
      card.classList.toggle('is-picked', box.checked);
      syncTally();
    });
    pick.append(box, document.createTextNode('use in story'));
    media.append(pick);

    if (article.image) {
      const img = document.createElement('img');
      img.src = article.image;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        img.remove();
        const fallback = document.createElement('span');
        fallback.className = 'no-image';
        fallback.textContent = 'CrimeWire';
        media.append(fallback);
      });
      media.append(img);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'no-image';
      fallback.textContent = 'CrimeWire';
      media.append(fallback);
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = article.source;
    const when = document.createElement('span');
    when.textContent = relTime(article.publishedAt);
    meta.append(src, when);

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = article.title;

    const desc = document.createElement('p');
    desc.className = 'card-desc';
    desc.textContent = article.description;

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const link = document.createElement('a');
    link.href = article.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Read at source →';
    link.addEventListener('click', (event) => event.stopPropagation());
    foot.append(link);

    body.append(meta, title);
    if (article.description) body.append(desc);
    body.append(foot);
    card.append(media, body);
    el.grid.append(card);
  }

  syncTally();
  el.reports.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncTally() {
  el.selectedCount.textContent = String(state.picked.size);
  el.generateBtn.disabled = state.picked.size === 0;
  const max = 8;
  if (state.picked.size > max) {
    el.forgeNote.textContent = `Only the first ${max} selected reports will be used for a single story.`;
  }
}

function toggleSelectAll() {
  const allPicked = state.picked.size === state.articles.length;
  state.picked.clear();
  if (!allPicked) for (const article of state.articles) state.picked.add(article.id);

  $$('.card', el.grid).forEach((card) => {
    const box = $('.card-pick input', card);
    box.checked = !allPicked;
    card.classList.toggle('is-picked', !allPicked);
  });
  el.selectAll.textContent = allPicked ? 'Select all for story' : 'Clear selection';
  syncTally();
}

/* ---------------- geolocation ---------------- */

function useMyLocation() {
  if (!navigator.geolocation) {
    toast('This browser will not share a location.', { title: 'Unsupported' });
    return;
  }

  busy(el.locateBtn, true);
  setStatus('Asking your browser for a position…');

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        setStatus('Working out where you are…');
        const place = await api(
          `/geocode/reverse?lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`,
        );
        el.location.value = place.name;
        await runSearch();
      } catch (error) {
        setStatus(`<span class="err">${escapeHtml(error.message)}</span>`);
        toast(error.message, { title: 'Location failed' });
      } finally {
        busy(el.locateBtn, false);
      }
    },
    (error) => {
      busy(el.locateBtn, false);
      const message =
        error.code === 1
          ? 'Permission denied — type your neighbourhood instead.'
          : 'Could not get a fix. Type your neighbourhood instead.';
      setStatus(`<span class="err">${escapeHtml(message)}</span>`);
      toast(message, { title: 'Location unavailable' });
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

/* ---------------- story forge ---------------- */

async function generate() {
  const chosen = state.articles.filter((article) => state.picked.has(article.id));
  if (chosen.length === 0) return;

  busy(el.generateBtn, true);
  el.forgeNote.textContent = 'The desk is writing. Long pieces take up to a minute…';

  try {
    const story = await api('/stories/generate', {
      method: 'POST',
      body: {
        location: state.location || chosen[0].source,
        category: state.category,
        articles: chosen,
        tone: el.tone.value,
        length: el.length.value,
      },
    });

    el.forgeNote.textContent = `Done — ${story.wordCount} words on "${story.title}".`;
    toast(`${story.readMinutes} min read`, { title: 'Story written', bad: false, ms: 5000 });
    await loadShelf();
    openReader(story);
    el.headline.value = '';
  } catch (error) {
    el.forgeNote.textContent = '';
    toast(error.message, { title: 'Story failed', ms: 11000 });
  } finally {
    busy(el.generateBtn, false);
  }
}

/* ---------------- shelf & reader ---------------- */

async function loadShelf() {
  try {
    const data = await api('/stories');
    state.shelves = data.stories;
  } catch {
    state.shelves = [];
  }
  renderShelf();
}

function renderShelf() {
  el.shelf.innerHTML = '';
  el.shelfCount.textContent = state.shelves.length
    ? `${state.shelves.length} stor${state.shelves.length === 1 ? 'y' : 'ies'}`
    : '';

  if (state.shelves.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML =
      '<strong>The shelf is empty</strong>Search a neighbourhood, tick a few reports, and write a story.';
    el.shelf.append(empty);
    return;
  }

  for (const item of state.shelves) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'story-card';

    const title = document.createElement('h3');
    title.textContent = item.title;

    const dek = document.createElement('p');
    dek.className = 'dek';
    dek.textContent = item.dek || `${item.sourceCount} source reports`;

    const when = document.createElement('div');
    when.className = 'when';
    const left = document.createElement('span');
    left.textContent = item.location || 'Unknown area';
    const right = document.createElement('span');
    right.textContent = `${item.readMinutes} min`;
    when.append(left, right);

    card.append(title, dek);

    if (item.tags?.length) {
      const tags = document.createElement('div');
      tags.className = 'story-tags';
      for (const tag of item.tags.slice(0, 4)) {
        const span = document.createElement('span');
        span.className = 'story-tag';
        span.textContent = tag;
        tags.append(span);
      }
      card.append(tags);
    }

    card.append(when);
    card.addEventListener('click', () => openReader(item.id));
    el.shelf.append(card);
  }
}

async function openReader(idOrStory) {
  el.reader.hidden = false;
  el.readerBody.innerHTML = '<p style="color:var(--bone-faint)">Opening…</p>';
  document.body.style.overflow = 'hidden';

  let story = idOrStory;
  if (typeof idOrStory === 'string') {
    try {
      story = await api(`/stories/${encodeURIComponent(idOrStory)}`);
    } catch (error) {
      el.readerBody.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      return;
    }
  }

  const sources = (story.sources || [])
    .map(
      (source, i) =>
        `<li>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}<br /><span class="pub">${escapeHtml(source.source)}${source.publishedAt ? ` · ${relTime(source.publishedAt)}` : ''} · ref ${i + 1}</span></li>`,
    )
    .join('');

  el.readerBody.innerHTML = `
    <p class="reader-kicker">CrimeScope original · fiction</p>
    <h1 class="reader-title" id="readerTitle">${escapeHtml(story.title)}</h1>
    ${story.dek ? `<p class="reader-dek">${escapeHtml(story.dek)}</p>` : ''}
    <div class="reader-meta">
      <span>${escapeHtml(story.location || 'Unfiled')}</span>
      <span>${story.wordCount || 0} words</span>
      <span>${story.readMinutes || 1} min read</span>
      <span>${escapeHtml(story.model || '')}</span>
      <span>${relTime(story.createdAt)}</span>
    </div>
    <div class="prose">${renderMarkdown(story.body_markdown)}</div>
    <div class="sources">
      <h4>Source reports — this story is fiction</h4>
      <ol>${sources}</ol>
    </div>
    <div class="story-actions">
      <button type="button" class="btn btn-ghost small" id="copyStoryBtn">Copy text</button>
      <button type="button" class="btn btn-ghost small" id="deleteStoryBtn">Delete</button>
    </div>
  `;

  $('#copyStoryBtn')?.addEventListener('click', async () => {
    const plain = `${story.title}\n\n${story.dek || ''}\n\n${story.body_markdown}\n\n— CrimeScope fiction, built from the reports listed above.`;
    try {
      await navigator.clipboard.writeText(plain);
      toast('Story copied to clipboard.', { title: 'Copied', bad: false, ms: 3000 });
    } catch {
      toast('Clipboard access was blocked by the browser.', { title: 'Copy failed' });
    }
  });

  $('#deleteStoryBtn')?.addEventListener('click', async () => {
    try {
      await api(`/stories/${encodeURIComponent(story.id)}`, { method: 'DELETE' });
      closeReader();
      await loadShelf();
      toast('Story removed from the shelf.', { title: 'Deleted', bad: false, ms: 3500 });
    } catch (error) {
      toast(error.message, { title: 'Delete failed' });
    }
  });

  el.readerBody.scrollTop = 0;
}

function closeReader() {
  el.reader.hidden = true;
  el.readerBody.innerHTML = '';
  document.body.style.overflow = '';
}

/* ---------------- wiring ---------------- */

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});
el.locateBtn.addEventListener('click', useMyLocation);
el.selectAll.addEventListener('click', toggleSelectAll);
el.generateBtn.addEventListener('click', generate);
el.window.addEventListener('change', () => (state.window = el.window.value));
el.country.addEventListener('change', () => (state.country = el.country.value));

$$('[data-close-reader]').forEach((node) => node.addEventListener('click', closeReader));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !el.reader.hidden) closeReader();
});

$$('[data-scroll]').forEach((node) =>
  node.addEventListener('click', () => {
    document.getElementById(node.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
  }),
);

boot();
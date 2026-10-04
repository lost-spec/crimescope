import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const INDEX_FILE = () => path.join(config.dataDir, 'index.json');
const storyFile = (id) => path.join(config.dataDir, `${path.basename(String(id))}.json`);

const memory = new Map();
let diskState = null;

async function diskAvailable() {
  if (diskState !== null) return diskState;
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(config.dataDir, '.probe'), 'ok');
    await fs.unlink(path.join(config.dataDir, '.probe'));
    diskState = true;
  } catch (error) {
    diskState = false;
    console.warn(
      `  ! Story storage is read-only at ${config.dataDir} (${error.code || error.message}).` +
        ' Falling back to in-memory: stories will not survive a cold start or scale-out.' +
        ' Set STORY_DATA_DIR to a writable mount, or add real persistence.',
    );
  }
  return diskState;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'story';
}

function summarize(story) {
  return {
    id: story.id,
    title: story.title,
    dek: story.dek,
    location: story.location,
    category: story.category,
    readMinutes: story.readMinutes,
    createdAt: story.createdAt,
    sourceCount: story.sources?.length ?? 0,
  };
}

export async function listStories() {
  if (await diskAvailable()) {
    try {
      const parsed = JSON.parse(await fs.readFile(INDEX_FILE(), 'utf8'));
      if (Array.isArray(parsed)) return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      /* fall through to memory */
    }
  }
  return [...memory.values()]
    .map(summarize)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getStory(id) {
  const safe = path.basename(String(id));
  if (memory.has(safe)) return memory.get(safe);
  try {
    return JSON.parse(await fs.readFile(storyFile(safe), 'utf8'));
  } catch {
    throw new HttpError(404, 'Story not found');
  }
}

export async function saveStory(story) {
  const id = `${Date.now().toString(36)}-${slugify(story.title)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const record = { ...story, id, createdAt: new Date().toISOString() };

  memory.set(id, record);

  if (await diskAvailable()) {
    await fs.writeFile(storyFile(id), JSON.stringify(record, null, 2), 'utf8');
    const index = [...memory.values()].map(summarize);
    await fs.writeFile(INDEX_FILE(), JSON.stringify(index, null, 2), 'utf8');
  }

  return record;
}

export async function deleteStory(id) {
  const safe = path.basename(String(id));
  const known = memory.delete(safe);
  if (await diskAvailable()) {
    try {
      await fs.unlink(storyFile(safe));
    } catch {
      if (!known) throw new HttpError(404, 'Story not found');
    }
    const index = [...memory.values()].map(summarize);
    await fs.writeFile(INDEX_FILE(), JSON.stringify(index, null, 2), 'utf8');
  } else if (!known) {
    throw new HttpError(404, 'Story not found');
  }
  return { deleted: safe };
}
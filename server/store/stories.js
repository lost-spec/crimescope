import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const INDEX_FILE = () => path.join(config.dataDir, 'index.json');

async function ensureDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

async function readIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries) {
  await ensureDir();
  await fs.writeFile(INDEX_FILE(), JSON.stringify(entries, null, 2), 'utf8');
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'story';
}

export function summarize(story) {
  return {
    id: story.id,
    title: story.title,
    dek: story.dek,
    location: story.location,
    category: story.category,
    readMinutes: story.readMinutes,
    createdAt: story.createdAt,
    sourceCount: story.sources.length,
  };
}

export async function listStories() {
  const entries = await readIndex();
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getStory(id) {
  const safe = path.basename(String(id));
  try {
    const raw = await fs.readFile(path.join(config.dataDir, `${safe}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    throw new HttpError(404, 'Story not found');
  }
}

export async function saveStory(story) {
  await ensureDir();
  const id = `${Date.now().toString(36)}-${slugify(story.title)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const record = { ...story, id, createdAt: new Date().toISOString() };

  await fs.writeFile(
    path.join(config.dataDir, `${id}.json`),
    JSON.stringify(record, null, 2),
    'utf8',
  );

  const index = await readIndex();
  index.push(summarize(record));
  await writeIndex(index);

  return record;
}

export async function deleteStory(id) {
  const safe = path.basename(String(id));
  try {
    await fs.unlink(path.join(config.dataDir, `${safe}.json`));
  } catch {
    throw new HttpError(404, 'Story not found');
  }
  await writeIndex((await readIndex()).filter((entry) => entry.id !== safe));
  return { deleted: safe };
}
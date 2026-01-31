import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { config } from './config.js';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.RD_SIMPLE_GALLERY_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'gallery.db');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');

let db = null;

export function initDb() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pictures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token TEXT PRIMARY KEY,
      current_index INTEGER NOT NULL DEFAULT 0,
      random_ids TEXT,
      random_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('max_resolution', '${config.defaultMaxResolution}');
  `);

  try {
    db.exec('ALTER TABLE pictures ADD COLUMN description TEXT');
  } catch (_) {}
  try {
    db.exec('ALTER TABLE tokens ADD COLUMN random_ids TEXT');
  } catch (_) {}
  try {
    db.exec('ALTER TABLE tokens ADD COLUMN random_index INTEGER DEFAULT 0');
  } catch (_) {}
  try {
    db.exec('ALTER TABLE pictures ADD COLUMN date TEXT');
  } catch (_) {}
  try {
    db.exec('ALTER TABLE pictures ADD COLUMN location TEXT');
  } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS picture_tags (
      picture_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (picture_id, tag_id),
      FOREIGN KEY (picture_id) REFERENCES pictures(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_picture_tags_tag ON picture_tags(tag_id);
  `);

  return db;
}

export function normalizeTag(s) {
  if (typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getDb() {
  if (!db) initDb();
  return db;
}

// Pictures
export function listPictures(tagFilter = null, limit = null, offset = 0) {
  let query = 'SELECT DISTINCT p.* FROM pictures p';
  const params = [];
  if (tagFilter) {
    query += ` INNER JOIN picture_tags pt ON pt.picture_id = p.id
               INNER JOIN tags t ON t.id = pt.tag_id AND t.name = ?`;
    params.push(tagFilter);
  }
  query += ' ORDER BY p.id';
  if (limit != null) {
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }
  const pics = getDb().prepare(query).all(...params);
  return pics.map((p) => ({ ...p, tags: getPictureTags(p.id) }));
}

export function countPictures(tagFilter = null) {
  let query = 'SELECT COUNT(DISTINCT p.id) as c FROM pictures p';
  const params = [];
  if (tagFilter) {
    query += ` INNER JOIN picture_tags pt ON pt.picture_id = p.id
               INNER JOIN tags t ON t.id = pt.tag_id AND t.name = ?`;
    params.push(tagFilter);
  }
  return getDb().prepare(query).get(...params).c;
}

export function getPictureTags(pictureId) {
  const rows = getDb().prepare(
    `SELECT t.name FROM tags t
     INNER JOIN picture_tags pt ON pt.tag_id = t.id
     WHERE pt.picture_id = ?
     ORDER BY t.name`
  ).all(pictureId);
  return rows.map((r) => r.name);
}

export function getPictureById(id) {
  return getDb().prepare('SELECT * FROM pictures WHERE id = ?').get(id);
}

export function addPicture(filename, date = null, location = null) {
  const result = getDb().prepare(
    'INSERT INTO pictures (filename, created_at, date, location) VALUES (?, ?, ?, ?)'
  ).run(filename, Date.now(), date || null, location || null);
  return result.lastInsertRowid;
}

export function deletePicture(id) {
  const pic = getPictureById(id);
  if (!pic) return false;
  getDb().prepare('DELETE FROM pictures WHERE id = ?').run(id);
  return pic;
}

export function updatePictureDescription(id, description) {
  const pic = getPictureById(id);
  if (!pic) return false;
  getDb().prepare('UPDATE pictures SET description = ? WHERE id = ?').run(description || null, id);
  return true;
}

export function updatePictureDateLocation(id, date, location) {
  const pic = getPictureById(id);
  if (!pic) return false;
  getDb().prepare('UPDATE pictures SET date = ?, location = ? WHERE id = ?').run(date || null, location || null, id);
  return true;
}

function getOrCreateTagId(name) {
  const n = normalizeTag(name);
  if (!n) return null;
  let row = getDb().prepare('SELECT id FROM tags WHERE name = ?').get(n);
  if (!row) {
    getDb().prepare('INSERT INTO tags (name) VALUES (?)').run(n);
    row = getDb().prepare('SELECT id FROM tags WHERE name = ?').get(n);
  }
  return row?.id ?? null;
}

export function setPictureTags(pictureId, tagNames) {
  const pic = getPictureById(pictureId);
  if (!pic) return false;
  getDb().prepare('DELETE FROM picture_tags WHERE picture_id = ?').run(pictureId);
  const tagIds = [...new Set(tagNames.map((n) => getOrCreateTagId(n)).filter(Boolean))];
  const stmt = getDb().prepare('INSERT INTO picture_tags (picture_id, tag_id) VALUES (?, ?)');
  for (const tagId of tagIds) {
    stmt.run(pictureId, tagId);
  }
  return true;
}

export function listTagsWithCount() {
  return getDb().prepare(
    `SELECT t.name, COUNT(pt.picture_id) as count
     FROM tags t
     LEFT JOIN picture_tags pt ON pt.tag_id = t.id
     GROUP BY t.id
     ORDER BY t.name`
  ).all();
}

export function getPictureCount() {
  return getDb().prepare('SELECT COUNT(*) as c FROM pictures').get().c;
}

export function getAllPictureIds() {
  return getDb().prepare('SELECT id FROM pictures ORDER BY id').all().map((r) => r.id);
}

export function getPictureByIndex(index) {
  return getDb().prepare(
    'SELECT * FROM pictures ORDER BY id LIMIT 1 OFFSET ?'
  ).get(index);
}

// Settings
export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  getDb().prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).run(key, String(value));
}

export function getMaxResolution() {
  const v = getSetting('max_resolution');
  return v ? parseInt(v, 10) : config.defaultMaxResolution;
}

// Tokens
export function getToken(token) {
  return getDb().prepare('SELECT * FROM tokens WHERE token = ?').get(token);
}

export function createToken() {
  const token = crypto.randomBytes(config.tokenBytes).toString('hex');
  getDb().prepare(
    'INSERT INTO tokens (token, current_index, created_at) VALUES (?, 0, ?)'
  ).run(token, Date.now());
  return token;
}

export function updateTokenIndex(token, index) {
  getDb().prepare('UPDATE tokens SET current_index = ? WHERE token = ?').run(index, token);
}

export function getTokenRandomState(token) {
  const row = getDb().prepare('SELECT random_ids, random_index FROM tokens WHERE token = ?').get(token);
  return row ? { random_ids: row.random_ids ? JSON.parse(row.random_ids) : null, random_index: row.random_index || 0 } : null;
}

export function updateTokenRandomState(token, ids, index) {
  getDb().prepare('UPDATE tokens SET random_ids = ?, random_index = ? WHERE token = ?').run(
    JSON.stringify(ids),
    index,
    token
  );
}

export function listTokens() {
  return getDb().prepare('SELECT * FROM tokens ORDER BY created_at').all();
}

export function deleteToken(token) {
  return getDb().prepare('DELETE FROM tokens WHERE token = ?').run(token);
}

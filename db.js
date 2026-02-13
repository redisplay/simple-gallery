import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { config } from './config.js';
import fs from 'fs';

export class Gallery {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.imagesDir = path.join(baseDir, 'images');
    this.dbPath = path.join(baseDir, 'gallery.db');
    this.db = null;
  }

  initDb() {
    fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
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
      this.db.exec('ALTER TABLE pictures ADD COLUMN description TEXT');
    } catch (_) {}
    try {
      this.db.exec('ALTER TABLE tokens ADD COLUMN random_ids TEXT');
    } catch (_) {}
    try {
      this.db.exec('ALTER TABLE tokens ADD COLUMN random_index INTEGER DEFAULT 0');
    } catch (_) {}
    try {
      this.db.exec('ALTER TABLE pictures ADD COLUMN date TEXT');
    } catch (_) {}
    try {
      this.db.exec('ALTER TABLE pictures ADD COLUMN location TEXT');
    } catch (_) {}

    this.db.exec(`
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

    return this.db;
  }

  normalizeTag(s) {
    if (typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  getDb() {
    if (!this.db) this.initDb();
    return this.db;
  }

  // Pictures
  listPictures(tagFilter = null, limit = null, offset = 0) {
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
    const pics = this.getDb().prepare(query).all(...params);
    return pics.map((p) => ({ ...p, tags: this.getPictureTags(p.id) }));
  }

  countPictures(tagFilter = null) {
    let query = 'SELECT COUNT(DISTINCT p.id) as c FROM pictures p';
    const params = [];
    if (tagFilter) {
      query += ` INNER JOIN picture_tags pt ON pt.picture_id = p.id
                 INNER JOIN tags t ON t.id = pt.tag_id AND t.name = ?`;
      params.push(tagFilter);
    }
    return this.getDb().prepare(query).get(...params).c;
  }

  getPictureTags(pictureId) {
    const rows = this.getDb().prepare(
      `SELECT t.name FROM tags t
       INNER JOIN picture_tags pt ON pt.tag_id = t.id
       WHERE pt.picture_id = ?
       ORDER BY t.name`
    ).all(pictureId);
    return rows.map((r) => r.name);
  }

  getPictureById(id) {
    return this.getDb().prepare('SELECT * FROM pictures WHERE id = ?').get(id);
  }

  addPicture(filename, date = null, location = null) {
    const result = this.getDb().prepare(
      'INSERT INTO pictures (filename, created_at, date, location) VALUES (?, ?, ?, ?)'
    ).run(filename, Date.now(), date || null, location || null);
    return result.lastInsertRowid;
  }

  deletePicture(id) {
    const pic = this.getPictureById(id);
    if (!pic) return false;
    this.getDb().prepare('DELETE FROM pictures WHERE id = ?').run(id);
    return pic;
  }

  updatePictureDescription(id, description) {
    const pic = this.getPictureById(id);
    if (!pic) return false;
    this.getDb().prepare('UPDATE pictures SET description = ? WHERE id = ?').run(description || null, id);
    return true;
  }

  updatePictureDateLocation(id, date, location) {
    const pic = this.getPictureById(id);
    if (!pic) return false;
    this.getDb().prepare('UPDATE pictures SET date = ?, location = ? WHERE id = ?').run(date || null, location || null, id);
    return true;
  }

  getOrCreateTagId(name) {
    const n = this.normalizeTag(name);
    if (!n) return null;
    let row = this.getDb().prepare('SELECT id FROM tags WHERE name = ?').get(n);
    if (!row) {
      this.getDb().prepare('INSERT INTO tags (name) VALUES (?)').run(n);
      row = this.getDb().prepare('SELECT id FROM tags WHERE name = ?').get(n);
    }
    return row?.id ?? null;
  }

  setPictureTags(pictureId, tagNames) {
    const pic = this.getPictureById(pictureId);
    if (!pic) return false;
    this.getDb().prepare('DELETE FROM picture_tags WHERE picture_id = ?').run(pictureId);
    const tagIds = [...new Set(tagNames.map((n) => this.getOrCreateTagId(n)).filter(Boolean))];
    const stmt = this.getDb().prepare('INSERT INTO picture_tags (picture_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) {
      stmt.run(pictureId, tagId);
    }
    return true;
  }

  listTagsWithCount() {
    return this.getDb().prepare(
      `SELECT t.name, COUNT(pt.picture_id) as count
       FROM tags t
       LEFT JOIN picture_tags pt ON pt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    ).all();
  }

  getPictureCount() {
    return this.getDb().prepare('SELECT COUNT(*) as c FROM pictures').get().c;
  }

  getAllPictureIds() {
    return this.getDb().prepare('SELECT id FROM pictures ORDER BY id').all().map((r) => r.id);
  }

  getPictureByIndex(index) {
    return this.getDb().prepare(
      'SELECT * FROM pictures ORDER BY id LIMIT 1 OFFSET ?'
    ).get(index);
  }

  // Settings
  getSetting(key) {
    const row = this.getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.getDb().prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, String(value));
  }

  getMaxResolution() {
    const v = this.getSetting('max_resolution');
    return v ? parseInt(v, 10) : config.defaultMaxResolution;
  }

  // Tokens
  getToken(token) {
    return this.getDb().prepare('SELECT * FROM tokens WHERE token = ?').get(token);
  }

  createToken() {
    const token = crypto.randomBytes(config.tokenBytes).toString('hex');
    this.getDb().prepare(
      'INSERT INTO tokens (token, current_index, created_at) VALUES (?, 0, ?)'
    ).run(token, Date.now());
    return token;
  }

  updateTokenIndex(token, index) {
    this.getDb().prepare('UPDATE tokens SET current_index = ? WHERE token = ?').run(index, token);
  }

  getTokenRandomState(token) {
    const row = this.getDb().prepare('SELECT random_ids, random_index FROM tokens WHERE token = ?').get(token);
    return row ? { random_ids: row.random_ids ? JSON.parse(row.random_ids) : null, random_index: row.random_index || 0 } : null;
  }

  updateTokenRandomState(token, ids, index) {
    this.getDb().prepare('UPDATE tokens SET random_ids = ?, random_index = ? WHERE token = ?').run(
      JSON.stringify(ids),
      index,
      token
    );
  }

  listTokens() {
    return this.getDb().prepare('SELECT * FROM tokens ORDER BY created_at').all();
  }

  deleteToken(token) {
    return this.getDb().prepare('DELETE FROM tokens WHERE token = ?').run(token);
  }
}

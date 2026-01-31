import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import {
  initDb,
  IMAGES_DIR,
  listPictures,
  countPictures,
  getPictureById,
  getPictureTags,
  addPicture,
  deletePicture,
  updatePictureDescription,
  updatePictureDateLocation,
  setPictureTags,
  listTagsWithCount,
  getPictureCount,
  getPictureByIndex,
  getAllPictureIds,
  getTokenRandomState,
  updateTokenRandomState,
  getMaxResolution,
  setSetting,
  getSetting,
  getToken,
  updateTokenIndex,
  listTokens,
  createToken,
  deleteToken,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PASSWORD = config.password;
const PORT = config.port;

initDb();

const app = express();

// Request logging (path only, no query string to avoid logging tokens)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.use(express.json());
app.use(
  session({
    secret: process.env.RD_SIMPLE_GALLERY_SESSION_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: config.sessionMaxAge },
  })
);

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// Admin: list pictures
app.get('/api/admin/pictures', requireAuth, (req, res) => {
  const tag = req.query.tag || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(config.maxPageLimit, Math.max(1, parseInt(req.query.limit, 10) || config.defaultPageLimit));
  const offset = (page - 1) * limit;
  const total = countPictures(tag);
  const pictures = listPictures(tag, limit, offset);
  res.json({
    pictures: pictures.map((p) => ({ ...p, url: `/api/admin/pictures/${p.id}/file` })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

// Admin: get single picture
app.get('/api/admin/pictures/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pic = getPictureById(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  res.json({ ...pic, tags: getPictureTags(id), url: `/api/admin/pictures/${pic.id}/file` });
});

// Admin: serve image file
app.get('/api/admin/pictures/:id/file', requireAuth, (req, res) => {
  const pic = getPictureById(parseInt(req.params.id, 10));
  if (!pic) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(IMAGES_DIR, pic.filename));
});

// Admin: update picture (description, tags, date, location)
app.patch('/api/admin/pictures/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { description, tags, date, location } = req.body;
  const pic = getPictureById(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  if (description !== undefined) updatePictureDescription(id, description);
  if (Array.isArray(tags)) setPictureTags(id, tags);
  if (date !== undefined || location !== undefined) updatePictureDateLocation(id, date, location);
  res.json({ ...getPictureById(id), tags: getPictureTags(id), url: `/api/admin/pictures/${id}/file` });
});

// Admin: delete picture
app.delete('/api/admin/pictures/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pic = deletePicture(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  const fs = await import('fs/promises');
  try {
    await fs.unlink(path.join(IMAGES_DIR, pic.filename));
  } catch (e) {
    console.warn('Could not delete file:', pic.filename);
  }
  res.json({ ok: true });
});

// Admin: list tags
app.get('/api/admin/tags', requireAuth, (req, res) => {
  res.json(listTagsWithCount());
});

// Admin: settings
app.get('/api/admin/settings', requireAuth, (req, res) => {
  res.json({ max_resolution: getMaxResolution() });
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const { max_resolution } = req.body;
  if (typeof max_resolution !== 'number' || max_resolution < config.maxResolutionMin || max_resolution > config.maxResolutionMax) {
    return res.status(400).json({ error: `max_resolution must be ${config.maxResolutionMin}-${config.maxResolutionMax}` });
  }
  setSetting('max_resolution', max_resolution);
  res.json({ max_resolution });
});

// Admin: bulk upload with resize
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (config.allowedMimeTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  },
  limits: { fileSize: config.maxFileSizeBytes },
});

async function extractExif(buffer) {
  const exifr = (await import('exifr')).default;
  const opts = { firstChunkSize: config.exifFirstChunkSize };
  let dateStr = null;
  let loc = null;
  try {
    const [gpsResult, exif] = await Promise.all([
      exifr.gps(buffer),
      exifr.parse(buffer, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'], ...opts }),
    ]);
    if (gpsResult?.latitude != null && gpsResult?.longitude != null) {
      loc = `${Number(gpsResult.latitude).toFixed(config.gpsCoordDecimals)},${Number(gpsResult.longitude).toFixed(config.gpsCoordDecimals)}`;
    }
    const date = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    if (date instanceof Date) {
      dateStr = date.toISOString().slice(0, 10);
    } else if (typeof date === 'string') {
      const m = date.match(/^(\d{4}):(\d{2}):(\d{2})/);
      if (m) dateStr = `${m[1]}-${m[2]}-${m[3]}`;
    }
  } catch (_) {}
  return { date: dateStr, location: loc };
}

app.post('/api/admin/upload', requireAuth, upload.array('images', config.maxUploadFiles), async (req, res) => {
  const maxRes = getMaxResolution();
  const fs = await import('fs/promises');
  const added = [];
  const errors = [];

  for (const file of req.files || []) {
    try {
      const ext = path.extname(file.originalname).toLowerCase() || config.defaultImageExt;
      const filename = `${crypto.randomBytes(config.filenameRandomBytes).toString('hex')}${ext}`;
      const outPath = path.join(IMAGES_DIR, filename);

      const exif = await extractExif(file.buffer);

      // failOnError: false allows some malformed JPEGs (e.g. invalid SOS) to be processed
      const inputOpts = { failOnError: false };
      // Apply EXIF orientation so metadata and output have correct dimensions/rotation
      const rotated = sharp(file.buffer, inputOpts).rotate();
      const meta = await rotated.metadata();
      const { width, height } = meta;
      if (width == null || height == null) {
        throw new Error('Could not read image dimensions');
      }
      let w = width;
      let h = height;

      if (width > maxRes || height > maxRes) {
        if (width >= height) {
          w = maxRes;
          h = Math.round((height / width) * maxRes);
        } else {
          h = maxRes;
          w = Math.round((width / height) * maxRes);
        }
      }

      let pipeline = sharp(file.buffer, inputOpts).rotate().resize(w, h, { fit: 'inside' });
      if (ext === '.png') pipeline = pipeline.png();
      else if (ext === '.webp') pipeline = pipeline.webp({ quality: config.webpQuality });
      else pipeline = pipeline.jpeg({ quality: config.jpegQuality });
      await pipeline.toFile(outPath);

      const id = addPicture(filename, exif.date, exif.location);
      if (exif.date) {
        const year = exif.date.slice(0, 4);
        if (/^\d{4}$/.test(year)) setPictureTags(id, [year]);
      }
      added.push({ id, filename });
    } catch (e) {
      errors.push({ file: file.originalname, error: e.message });
    }
  }

  res.json({ added, errors });
});

// Admin: tokens
app.get('/api/admin/tokens', requireAuth, (req, res) => {
  res.json(listTokens());
});

app.post('/api/admin/tokens', requireAuth, (req, res) => {
  const token = createToken();
  res.status(201).json({ token });
});

app.delete('/api/admin/tokens/:token', requireAuth, (req, res) => {
  const { token } = req.params;
  const result = deleteToken(token);
  if (result.changes === 0) return res.status(404).json({ error: 'Token not found' });
  res.json({ ok: true });
});

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Token-based photo API
app.get('/api/photo', (req, res) => {
  const token = req.query.token;
  const mode = req.query.mode || 'next';

  if (!token) {
    return res.status(400).json({ error: 'token required' });
  }

  const count = getPictureCount();
  if (count === 0) {
    return res.status(404).json({ error: 'No pictures in gallery' });
  }

  const tokenData = getToken(token);
  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid or revoked token' });
  }

  let pic;
  if (mode === 'random') {
    const state = getTokenRandomState(token);
    let ids = state?.random_ids;
    let idx = state?.random_index ?? 0;
    if (!ids || ids.length === 0 || idx >= ids.length) {
      ids = shuffle(getAllPictureIds());
      idx = 0;
    }
    const picId = ids[idx];
    pic = getPictureById(picId);
    idx++;
    if (idx >= ids.length) {
      ids = shuffle(getAllPictureIds());
      idx = 0;
    }
    updateTokenRandomState(token, ids, idx);
  } else {
    const index = tokenData.current_index % count;
    pic = getPictureByIndex(index);
    updateTokenIndex(token, (index + 1) % count);
  }

  if (!pic) return res.status(404).json({ error: 'Not found' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    id: pic.id,
    url: `${baseUrl}/api/photo/file/${pic.id}?token=${encodeURIComponent(token)}`,
    description: pic.description || null,
    date: pic.date || null,
    location: pic.location || null,
  });
});

app.get('/api/photo/file/:id', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!getToken(token)) return res.status(403).json({ error: 'Invalid or revoked token' });

  const pic = getPictureById(parseInt(req.params.id, 10));
  if (!pic) return res.status(404).json({ error: 'Not found' });

  res.sendFile(path.join(IMAGES_DIR, pic.filename));
});

// Static admin UI
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Simple gallery on http://localhost:${config.port}`);
});

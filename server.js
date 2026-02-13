import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { Gallery } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.RD_SIMPLE_GALLERY_DATA_DIR || process.env.DATA_DIR || path.join(__dirname, 'data');
const PASSWORD = config.password;
const PORT = config.port;

// Cache for Gallery instances
const galleries = new Map();

function getGallery(userId = null) {
  // If userId is null or 'default', use the root DATA_DIR.
  // We explicitly treat 'default' as the root to allow /default/api access if desired,
  // or just to have a canonical key.
  const key = userId || 'default';
  if (galleries.has(key)) return galleries.get(key);

  // If userId is provided, store in data/userId, otherwise data/
  const dir = userId ? path.join(DATA_DIR, userId) : DATA_DIR;
  const gallery = new Gallery(dir);
  gallery.initDb();
  galleries.set(key, gallery);
  return gallery;
}

const app = express();

// Request logging
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
  if (req.session?.authorized?.[req.galleryId]) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// --- API Router ---
const apiRouter = express.Router({ mergeParams: true });

// Middleware to attach gallery instance
apiRouter.use((req, res, next) => {
  const userId = req.params.userId;
  // Basic validation for userId to prevent directory traversal
  if (userId && !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  req.galleryId = userId || 'default';
  req.gallery = getGallery(userId);
  next();
});

function hashPassword(password, salt) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  // PBKDF2 with SHA512, 10000 iterations, 64-byte key length
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

// Login (gallery-specific password with global fallback)
apiRouter.post('/login', (req, res) => {
  const { password } = req.body;
  const galleryHash = req.gallery.getSetting('password');
  const gallerySalt = req.gallery.getSetting('password_salt');

  let authorized = false;

  if (galleryHash && gallerySalt) {
    // Check against gallery-specific hashed password
    const { hash } = hashPassword(password, gallerySalt);
    // Use timingSafeEqual to prevent timing attacks
    const bufferHash = Buffer.from(hash, 'hex');
    const bufferStored = Buffer.from(galleryHash, 'hex');
    if (bufferHash.length === bufferStored.length && crypto.timingSafeEqual(bufferHash, bufferStored)) {
      authorized = true;
    }
  } else if (password === PASSWORD) {
    // Fallback to global plaintext password (config/env)
    authorized = true;
  }

  if (authorized) {
    if (!req.session.authorized) req.session.authorized = {};
    req.session.authorized[req.galleryId] = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

apiRouter.post('/logout', (req, res) => {
  if (req.session.authorized) {
    delete req.session.authorized[req.galleryId];
  }
  res.json({ ok: true });
});

apiRouter.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authorized?.[req.galleryId] });
});

// Update password
apiRouter.put('/admin/password', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  
  const { hash, salt } = hashPassword(password);
  req.gallery.setSetting('password', hash);
  req.gallery.setSetting('password_salt', salt);
  
  res.json({ ok: true });
});

// Admin: list pictures
apiRouter.get('/admin/pictures', requireAuth, (req, res) => {
  const tag = req.query.tag || null;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(config.maxPageLimit, Math.max(1, parseInt(req.query.limit, 10) || config.defaultPageLimit));
  const offset = (page - 1) * limit;
  const total = req.gallery.countPictures(tag);
  const pictures = req.gallery.listPictures(tag, limit, offset);
  
  // URL construction needs to be relative or absolute based on mount point.
  // Since we are inside the router, we can build relative URLs or reuse req.baseUrl
  // req.baseUrl is e.g. "/api" or "/user1/api"
  
  res.json({
    pictures: pictures.map((p) => ({ ...p, url: `${req.baseUrl}/admin/pictures/${p.id}/file` })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
});

// Admin: get single picture
apiRouter.get('/admin/pictures/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pic = req.gallery.getPictureById(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  res.json({ ...pic, tags: req.gallery.getPictureTags(id), url: `${req.baseUrl}/admin/pictures/${pic.id}/file` });
});

// Admin: serve image file
apiRouter.get('/admin/pictures/:id/file', requireAuth, (req, res) => {
  const pic = req.gallery.getPictureById(parseInt(req.params.id, 10));
  if (!pic) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(req.gallery.imagesDir, pic.filename));
});

// Admin: update picture
apiRouter.patch('/admin/pictures/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { description, tags, date, location } = req.body;
  const pic = req.gallery.getPictureById(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  if (description !== undefined) req.gallery.updatePictureDescription(id, description);
  if (Array.isArray(tags)) req.gallery.setPictureTags(id, tags);
  if (date !== undefined || location !== undefined) req.gallery.updatePictureDateLocation(id, date, location);
  res.json({ ...req.gallery.getPictureById(id), tags: req.gallery.getPictureTags(id), url: `${req.baseUrl}/admin/pictures/${id}/file` });
});

// Admin: delete picture
apiRouter.delete('/admin/pictures/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pic = req.gallery.deletePicture(id);
  if (!pic) return res.status(404).json({ error: 'Not found' });
  const fs = await import('fs/promises');
  try {
    await fs.unlink(path.join(req.gallery.imagesDir, pic.filename));
  } catch (e) {
    console.warn('Could not delete file:', pic.filename);
  }
  res.json({ ok: true });
});

// Admin: list tags
apiRouter.get('/admin/tags', requireAuth, (req, res) => {
  res.json(req.gallery.listTagsWithCount());
});

// Admin: settings
apiRouter.get('/admin/settings', requireAuth, (req, res) => {
  res.json({ max_resolution: req.gallery.getMaxResolution() });
});

apiRouter.put('/admin/settings', requireAuth, (req, res) => {
  const { max_resolution } = req.body;
  if (typeof max_resolution !== 'number' || max_resolution < config.maxResolutionMin || max_resolution > config.maxResolutionMax) {
    return res.status(400).json({ error: `max_resolution must be ${config.maxResolutionMin}-${config.maxResolutionMax}` });
  }
  req.gallery.setSetting('max_resolution', max_resolution);
  res.json({ max_resolution });
});

// Admin: bulk upload
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

apiRouter.post('/admin/upload', requireAuth, upload.array('images', config.maxUploadFiles), async (req, res) => {
  const maxRes = req.gallery.getMaxResolution();
  const added = [];
  const errors = [];

  for (const file of req.files || []) {
    try {
      const ext = path.extname(file.originalname).toLowerCase() || config.defaultImageExt;
      const filename = `${crypto.randomBytes(config.filenameRandomBytes).toString('hex')}${ext}`;
      const outPath = path.join(req.gallery.imagesDir, filename);

      const exif = await extractExif(file.buffer);
      const inputOpts = { failOnError: false };
      
      const rotated = sharp(file.buffer, inputOpts).rotate();
      const meta = await rotated.metadata();
      const { width, height } = meta;
      
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

      const id = req.gallery.addPicture(filename, exif.date, exif.location);
      if (exif.date) {
        const year = exif.date.slice(0, 4);
        if (/^\d{4}$/.test(year)) req.gallery.setPictureTags(id, [year]);
      }
      added.push({ id, filename });
    } catch (e) {
      errors.push({ file: file.originalname, error: e.message });
    }
  }

  res.json({ added, errors });
});

// Admin: tokens
apiRouter.get('/admin/tokens', requireAuth, (req, res) => {
  res.json(req.gallery.listTokens());
});

apiRouter.post('/admin/tokens', requireAuth, (req, res) => {
  const token = req.gallery.createToken();
  res.status(201).json({ token });
});

apiRouter.delete('/admin/tokens/:token', requireAuth, (req, res) => {
  const { token } = req.params;
  const result = req.gallery.deleteToken(token);
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
apiRouter.get('/photo', (req, res) => {
  const token = req.query.token;
  const mode = req.query.mode || 'next';

  if (!token) {
    return res.status(400).json({ error: 'token required' });
  }

  const count = req.gallery.getPictureCount();
  if (count === 0) {
    return res.status(404).json({ error: 'No pictures in gallery' });
  }

  const tokenData = req.gallery.getToken(token);
  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid or revoked token' });
  }

  let pic;
  if (mode === 'random') {
    const state = req.gallery.getTokenRandomState(token);
    let ids = state?.random_ids;
    let idx = state?.random_index ?? 0;
    if (!ids || ids.length === 0 || idx >= ids.length) {
      ids = shuffle(req.gallery.getAllPictureIds());
      idx = 0;
    }
    const picId = ids[idx];
    pic = req.gallery.getPictureById(picId);
    idx++;
    if (idx >= ids.length) {
      ids = shuffle(req.gallery.getAllPictureIds());
      idx = 0;
    }
    req.gallery.updateTokenRandomState(token, ids, idx);
  } else {
    const index = tokenData.current_index % count;
    pic = req.gallery.getPictureByIndex(index);
    req.gallery.updateTokenIndex(token, (index + 1) % count);
  }

  if (!pic) return res.status(404).json({ error: 'Not found' });

  // Use req.baseUrl (which includes user prefix if any) for the file link
  const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}`;
  res.json({
    id: pic.id,
    url: `${baseUrl}/photo/file/${pic.id}?token=${encodeURIComponent(token)}`,
    description: pic.description || null,
    date: pic.date || null,
    location: pic.location || null,
  });
});

apiRouter.get('/photo/file/:id', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token required' });
  if (!req.gallery.getToken(token)) return res.status(403).json({ error: 'Invalid or revoked token' });

  const pic = req.gallery.getPictureById(parseInt(req.params.id, 10));
  if (!pic) return res.status(404).json({ error: 'Not found' });

  res.sendFile(path.join(req.gallery.imagesDir, pic.filename));
});

// Mount API router
app.use('/api', apiRouter);
app.use('/:userId/api', apiRouter);

// Static admin UI
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for any /:userId path (spa-like) if it matches a valid user pattern
app.get('/:userId', (req, res) => {
  const { userId } = req.params;
  if (userId && /^[a-zA-Z0-9_-]+$/.test(userId)) {
     // Ensure trailing slash for relative API calls to work
     if (!req.originalUrl.endsWith('/')) {
       return res.redirect(req.originalUrl + '/');
     }
     res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
     res.status(404).send('Not found');
  }
});

app.listen(PORT, () => {
  console.log(`Simple gallery on http://localhost:${config.port}`);
});

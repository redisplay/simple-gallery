/**
 * Configuration - each value overridable via env var (RD_SIMPLE_GALLERY_* or PORT)
 */
function envInt(key, def) {
  const v = process.env[key];
  return v != null ? parseInt(v, 10) : def;
}
function envStr(key, def) {
  const v = process.env[key];
  return v != null && v !== '' ? v : def;
}
/** Parse comma-separated list from env (e.g. "a, b, c" -> ["a","b","c"]) */
function envList(key, def) {
  const v = process.env[key];
  return v != null && v !== '' ? v.split(',').map(s => s.trim()) : def;
}

export const config = {
  // Server
  port: envInt('RD_SIMPLE_GALLERY_PORT', envInt('PORT', 3456)),
  password: envStr('RD_SIMPLE_GALLERY_PASSWORD', 'changeme'),

  // Session
  sessionMaxAge: envInt('RD_SIMPLE_GALLERY_SESSION_MAX_AGE', 24 * 60 * 60 * 1000),

  // Pagination
  defaultPageLimit: envInt('RD_SIMPLE_GALLERY_DEFAULT_PAGE_LIMIT', 24),
  maxPageLimit: envInt('RD_SIMPLE_GALLERY_MAX_PAGE_LIMIT', 100),

  // Upload
  maxUploadFiles: envInt('RD_SIMPLE_GALLERY_MAX_UPLOAD_FILES', 50),
  maxFileSizeBytes: envInt('RD_SIMPLE_GALLERY_MAX_FILE_SIZE', 50 * 1024 * 1024),
  allowedMimeTypes: envList('RD_SIMPLE_GALLERY_ALLOWED_MIME_TYPES', ['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  defaultImageExt: envStr('RD_SIMPLE_GALLERY_DEFAULT_IMAGE_EXT', '.jpg'),

  // Image processing
  defaultMaxResolution: envInt('RD_SIMPLE_GALLERY_DEFAULT_MAX_RESOLUTION', 1920),
  maxResolutionMin: envInt('RD_SIMPLE_GALLERY_MAX_RESOLUTION_MIN', 100),
  maxResolutionMax: envInt('RD_SIMPLE_GALLERY_MAX_RESOLUTION_MAX', 10000),
  jpegQuality: envInt('RD_SIMPLE_GALLERY_JPEG_QUALITY', 85),
  webpQuality: envInt('RD_SIMPLE_GALLERY_WEBP_QUALITY', 85),

  // EXIF
  exifFirstChunkSize: envInt('RD_SIMPLE_GALLERY_EXIF_FIRST_CHUNK_SIZE', 40000),
  gpsCoordDecimals: envInt('RD_SIMPLE_GALLERY_GPS_COORD_DECIMALS', 6),

  // Token
  tokenBytes: envInt('RD_SIMPLE_GALLERY_TOKEN_BYTES', 24),
  filenameRandomBytes: envInt('RD_SIMPLE_GALLERY_FILENAME_RANDOM_BYTES', 16),
};

# redisplay-simple-gallery

Photo gallery server with EXIF extraction, tags, and token-based API.

## Multi-User Support

The server supports creating unlimited separate galleries dynamically. 

- **Default Gallery:** Accessible at `http://localhost:3456/`
- **User Galleries:** Create a new gallery by visiting `http://localhost:3456/<username>/`

Each user gallery has its own:
- Database (`data/<username>/gallery.db`)
- Image storage (`data/<username>/images`)
- Settings & Tokens
- Admin Password

**Passwords:**
- Initially, all galleries use the global password defined in `RD_SIMPLE_GALLERY_PASSWORD` (default: `changeme`).
- You can set a unique, salted & hashed password for each gallery in the **Settings** tab.

## Environment variables

All configuration can be overridden via environment variables. Array values use comma-separated lists.

| Variable                                 | Default                                      | Description                        |
|------------------------------------------|----------------------------------------------|-----------------------------------|
| `RD_SIMPLE_GALLERY_PORT`                 | `3456` (or `PORT`)                           | Server port                       |
| `RD_SIMPLE_GALLERY_PASSWORD`             | `changeme`                                   | Admin login password              |
| `RD_SIMPLE_GALLERY_SESSION_MAX_AGE`      | `86400000`                                   | Session cookie max age (ms)        |
| `RD_SIMPLE_GALLERY_DEFAULT_PAGE_LIMIT`   | `24`                                         | Default pictures per page         |
| `RD_SIMPLE_GALLERY_MAX_PAGE_LIMIT`       | `100`                                        | Max pictures per page             |
| `RD_SIMPLE_GALLERY_MAX_UPLOAD_FILES`     | `50`                                         | Max files per upload              |
| `RD_SIMPLE_GALLERY_MAX_FILE_SIZE`        | `52428800`                                   | Max file size (bytes, 50MB)        |
| `RD_SIMPLE_GALLERY_ALLOWED_MIME_TYPES`   | `image/jpeg,image/png,image/webp,image/gif`  | Comma-separated allowed MIME types |
| `RD_SIMPLE_GALLERY_DEFAULT_IMAGE_EXT`    | `.jpg`                                       | Default extension when missing    |
| `RD_SIMPLE_GALLERY_DEFAULT_MAX_RESOLUTION`| `1920`                                       | Default max dimension (px)        |
| `RD_SIMPLE_GALLERY_MAX_RESOLUTION_MIN`   | `100`                                        | Min allowed max resolution        |
| `RD_SIMPLE_GALLERY_MAX_RESOLUTION_MAX`   | `10000`                                      | Max allowed max resolution         |
| `RD_SIMPLE_GALLERY_JPEG_QUALITY`         | `85`                                         | JPEG output quality               |
| `RD_SIMPLE_GALLERY_WEBP_QUALITY`         | `85`                                         | WebP output quality               |
| `RD_SIMPLE_GALLERY_EXIF_FIRST_CHUNK_SIZE`| `40000`                                      | EXIF parse first chunk size       |
| `RD_SIMPLE_GALLERY_GPS_COORD_DECIMALS`   | `6`                                          | GPS coordinate decimal places     |
| `RD_SIMPLE_GALLERY_TOKEN_BYTES`          | `24`                                         | API token random bytes            |
| `RD_SIMPLE_GALLERY_FILENAME_RANDOM_BYTES`| `16`                                         | Filename random bytes             |

### Other

| Variable                           | Default                    | Description                    |
|------------------------------------|----------------------------|-------------------------------|
| `PORT`                             | —                          | Fallback for port (e.g. PaaS) |
| `RD_SIMPLE_GALLERY_DATA_DIR`       | `./data` (or `DATA_DIR`)   | Database and images directory |
| `RD_SIMPLE_GALLERY_SESSION_SECRET` | random                     | Session signing secret        |

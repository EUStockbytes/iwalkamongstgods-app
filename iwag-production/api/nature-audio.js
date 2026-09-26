const fs = require('fs');
const path = require('path');
const { normalizeMedia, verifyPlaybackToken } = require('./_lib/nature-entitlement');

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MEDIA_FILES = Object.freeze({
  'gentle-rain/gentle-rain-01.mp3': require.resolve('../Content/nature/gentle-rain/gentle-rain-01.mp3'),
  'mountain-river/mountain-river-01.mp3': require.resolve('../Content/nature/mountain-river/mountain-river-01.mp3'),
  'forest-birds/forest-birds-01.mp3': require.resolve('../Content/nature/forest-birds/forest-birds-01.mp3'),
  'wind-through-trees/wind-through-trees-01.mp3': require.resolve('../Content/nature/wind-through-trees/wind-through-trees-01.mp3'),
  'wind-through-trees/wind-through-trees-02.mp3': require.resolve('../Content/nature/wind-through-trees/wind-through-trees-02.mp3'),
  'gentle-thunderstorm/gentle-thunderstorm-01.mp3': require.resolve('../Content/nature/gentle-thunderstorm/gentle-thunderstorm-01.mp3'),
  'fireplace-rain/fireplace-rain-01.mp3': require.resolve('../Content/nature/fireplace-rain/fireplace-rain-01.mp3'),
  'meadow-breeze/meadow-breeze-01.mp3': require.resolve('../Content/nature/meadow-breeze/meadow-breeze-01.mp3'),
  'waterfall/waterfall-01.mp3': require.resolve('../Content/nature/waterfall/waterfall-01.mp3'),
  'summer-night-forest/summer-night-forest-01.mp3': require.resolve('../Content/nature/summer-night-forest/summer-night-forest-01.mp3')
});

function protectedHeaders(res) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return { start: 0, end: Math.min(size - 1, MAX_CHUNK_BYTES - 1) };

  let start;
  let end;
  if (!match[1] && match[2]) {
    const suffixLength = Math.min(Number(match[2]), MAX_CHUNK_BYTES, size);
    start = size - suffixLength;
    end = size - 1;
  } else {
    start = Number(match[1] || 0);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    end = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1, size - 1);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end };
}

module.exports = function handler(req, res) {
  protectedHeaders(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const media = normalizeMedia(req.query.media);
  const filePath = media ? MEDIA_FILES[media] : null;
  const verified = filePath && verifyPlaybackToken({
    token: req.query.token,
    media,
    secret: process.env.STRIPE_SECRET_KEY
  });
  if (!verified) return res.status(401).end();

  const size = fs.statSync(filePath).size;
  const range = parseRange(req.headers.range, size);
  if (!range) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  const contentLength = range.end - range.start + 1;
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', contentLength);
  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(filePath, range);
  stream.on('error', error => {
    console.error('IWAG NATURE AUDIO FAILED:', path.basename(filePath), error.message);
    if (!res.headersSent) res.status(500).end();
    else res.destroy(error);
  });
  stream.pipe(res);
};

module.exports.parseRange = parseRange;

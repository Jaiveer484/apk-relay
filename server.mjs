import QRCode from 'qrcode';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const maxBytes = 100 * 1024 * 1024;
const lifetime = 30 * 60 * 1000;
const files = new Map();
const directory = await mkdtemp(join(tmpdir(), 'apk-relay-'));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
}

async function upload(req, res) {
  const name = decodeURIComponent(req.headers['x-file-name'] ?? '');
  const length = Number(req.headers['content-length']);
  if (!/^[^/\\\x00-\x1f\x7f]{1,180}\.apk$/iu.test(name)) {
    return json(res, 400, { error: 'Choose a file ending in .apk.' });
  }
  if (!Number.isSafeInteger(length) || length < 4 || length > maxBytes) {
    return json(res, 400, { error: 'Choose an APK up to 100 MB.' });
  }

  const id = randomUUID();
  const path = join(directory, id);
  let bytes = 0;
  try {
    await pipeline(req, new Transform({
      transform(chunk, encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) return done(new Error('File too large'));
        done(null, chunk);
      },
    }), createWriteStream(path, { mode: 0o600 }));
    const signature = [];
    for await (const chunk of createReadStream(path, { start: 0, end: 3 })) signature.push(chunk);
    if (Buffer.concat(signature).toString('hex') !== '504b0304') {
      await rm(path, { force: true });
      return json(res, 400, { error: 'This file does not have an APK archive header.' });
    }
    const { size } = await stat(path);
    const expiresAt = Date.now() + lifetime;
    files.set(id, { path, name, size, expiresAt });
    setTimeout(() => {
      files.delete(id);
      rm(path, { force: true }).catch(console.error);
    }, lifetime).unref();
    json(res, 201, { id, expiresAt });
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (req.method === 'POST' && pathname === '/api/uploads') return await upload(req, res);
    const route = pathname.match(/^\/(receive|api\/uploads|download|qr)\/([0-9a-f-]{36})$/);
    if (req.method !== 'GET') return json(res, 405, { error: 'Method unavailable.' });
    if (route && route[1] !== 'receive') {
      const file = files.get(route[2]);
      if (!file || file.expiresAt <= Date.now()) {
        return json(res, 404, { error: 'This transfer has expired or is unavailable.' });
      }
      const { name, size, expiresAt, path } = file;
      if (route[1] === 'qr') {
        const origin = new URL(url.searchParams.get('origin') ?? 'http://localhost');
        if (!['http:', 'https:'].includes(origin.protocol) || origin.origin.length > 255) {
          return json(res, 400, { error: 'Invalid QR origin.' });
        }
        const png = await QRCode.toBuffer(origin.origin + '/receive/' + route[2], { width: 256 });
        return res.writeHead(200, { 'Content-Type': 'image/png' }).end(png);
      }
      if (route[1] === 'api/uploads') return json(res, 200, { name, size, expiresAt });
      const encodedName = encodeURIComponent(name).replace(/['()*]/g, char =>
        '%' + char.charCodeAt(0).toString(16));
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodedName,
        'Content-Length': size,
      });
      return await pipeline(createReadStream(path), res);
    }
    const asset = staticFiles.get(route ? '/' : pathname);
    if (!asset) return json(res, 404, { error: 'Page unavailable.' });
    res.setHeader('Content-Type', asset[1] + '; charset=utf-8');
    res.end(await readFile(new URL('./public/' + asset[0], import.meta.url)));
  } catch (error) {
    if (!res.headersSent && !res.destroyed) {
      const status = error instanceof URIError ? 400 : 500;
      json(res, status, { error: status === 400 ? 'Invalid file name.' : 'The transfer could not be completed.' });
    }
  }
});

server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('APK Relay is listening on port ' + server.address().port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await rm(directory, { recursive: true, force: true });
      process.exit(0);
    });
  });
}

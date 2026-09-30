// Publish an OlympusX console update: chunk the app files, create a
// GitHub release carrying console-manifest.json + one `chunk-<sha256>`
// asset per chunk. Consoles pull only the chunks they don't have.
// Usage: node scripts/publish-update.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CHUNK_SIZE = 256 * 1024;
const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, '..', 'app');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = 'v' + version;
console.log('OlympusX console update ' + tag);

// refuse to overwrite an existing release
try {
  execFileSync('gh', ['release', 'view', tag], { stdio: 'pipe' });
  console.error('Release ' + tag + ' already exists — bump version in pc-app/package.json first.');
  process.exit(1);
} catch (e) {}

const files = walk(APP_DIR, APP_DIR).filter(f => !f.startsWith('.'));
const manifest = { version, chunk: CHUNK_SIZE, files: {} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oxx-pub-'));
const assets = [];
for (const rel of files) {
  const buf = fs.readFileSync(path.join(APP_DIR, rel));
  const hashes = [];
  for (let off = 0; off < buf.length; off += CHUNK_SIZE) {
    const c = buf.slice(off, off + CHUNK_SIZE);
    const h = sha256(c);
    hashes.push(h);
    const ap = path.join(tmp, 'chunk-' + h);
    if (!fs.existsSync(ap)) { fs.writeFileSync(ap, c); assets.push(ap); }
  }
  if (!hashes.length) { const h = sha256(Buffer.alloc(0)); hashes.push(h); }
  manifest.files[rel] = { size: buf.length, chunks: hashes };
}
const manPath = path.join(tmp, 'console-manifest.json');
fs.writeFileSync(manPath, JSON.stringify(manifest));
console.log('Files: ' + files.length + ', chunks: ' + assets.length);

execFileSync('gh', ['release', 'create', tag,
  '--title', 'OlympusX ' + tag,
  '--notes', 'Delta update: consoles download only the changed chunks.',
  manPath, ...assets], { stdio: 'inherit' });
console.log('Published ' + tag + ' — consoles will pick it up from Settings → Console.');

// OlympusX console self-updater (main process).
// Delta updates: the console's own files are content-addressed in 256KB
// chunks. A release carries console-manifest.json + one `chunk-<sha256>`
// asset per chunk. Updating downloads only chunks the console doesn't
// already have, reassembles the files, swaps them in and relaunches.
//
// Feed protocol (both modes):
//   github:<owner>/<repo>  -> GitHub releases API (production)
//   http(s)://...          -> GET {base}/latest            { version, manifestUrl }
//                            GET {manifestUrl}             manifest JSON
//                            GET {base}/chunk/<sha256>     chunk bytes
// Set OX_FEED_BASE to point at a test feed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK_SIZE = 256 * 1024;
const UA = { 'User-Agent': 'OlympusX-Updater' };

function feedBase() {
  return process.env.OX_FEED_BASE || 'github:Hoopslimbo/olympusx';
}
function appDir() {
  // Unpackaged dev layout: pc-app/../app. Packaged builds keep the same
  // relative layout via extraResources.
  return path.join(__dirname, '..', 'app');
}
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function chunkBuffer(buf) {
  const out = [];
  for (let off = 0; off < buf.length; off += CHUNK_SIZE) out.push(buf.slice(off, off + CHUNK_SIZE));
  if (!out.length) out.push(Buffer.alloc(0));
  return out;
}
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, { headers: UA }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + url)); return; }
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(url, { headers: UA }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + url)); return; }
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => resolve(Buffer.concat(parts)));
    }).on('error', reject);
  });
}

async function getLatest() {
  const fb = feedBase();
  if (fb.startsWith('github:')) {
    const m = fb.match(/^github:([^/]+)\/(.+)$/);
    if (!m) throw new Error('bad github feed: ' + fb);
    const [, owner, repo] = m;
    const rel = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    const tag = rel.tag_name;
    const asset = (rel.assets || []).find(a => a.name === 'console-manifest.json');
    if (!asset) throw new Error('release ' + tag + ' has no console-manifest.json');
    const manifest = await fetchJson(asset.browser_download_url);
    return {
      version: manifest.version, tag, manifest,
      chunkUrl: h => `https://github.com/${owner}/${repo}/releases/download/${tag}/chunk-${h}`
    };
  }
  const latest = await fetchJson(fb.replace(/\/$/, '') + '/latest');
  const manifest = await fetchJson(latest.manifestUrl);
  const base = fb.replace(/\/$/, '');
  return { version: manifest.version, tag: latest.version, manifest, chunkUrl: h => base + '/chunk/' + h };
}

// Hash every chunk of a local console file. Returns Map(hash -> Buffer).
function localChunks(rel) {
  const p = path.join(appDir(), rel);
  if (!fs.existsSync(p)) return new Map();
  const m = new Map();
  for (const c of chunkBuffer(fs.readFileSync(p))) m.set(sha256(c), c);
  return m;
}

async function checkForUpdates(localVersion) {
  const { version, manifest, chunkUrl } = await getLatest();
  if (cmpVer(version, localVersion) <= 0) return { updateAvailable: false, version: localVersion };
  const missing = [];
  const perFile = {};
  for (const rel of Object.keys(manifest.files)) {
    const meta = manifest.files[rel];
    const local = localChunks(rel);
    perFile[rel] = local;
    for (const h of meta.chunks) if (!local.has(h) && !missing.includes(h)) missing.push(h);
  }
  return { updateAvailable: true, version, manifest, chunkUrl, missing, perFile };
}

async function downloadUpdate(localVersion, onProgress) {
  const chk = await checkForUpdates(localVersion);
  if (!chk.updateAvailable) return { updateAvailable: false, version: localVersion };
  const { manifest, chunkUrl, missing, perFile } = chk;
  const have = new Map();
  let done = 0;
  for (const h of missing) {
    const buf = await fetchBuffer(chunkUrl(h));
    if (sha256(buf) !== h) throw new Error('chunk hash mismatch: ' + h.slice(0, 12));
    have.set(h, buf);
    done++;
    if (onProgress) onProgress(done / missing.length);
  }
  if (onProgress) onProgress(1);
  const os = require('os');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'olympusx-update-'));
  for (const rel of Object.keys(manifest.files)) {
    const meta = manifest.files[rel];
    const parts = meta.chunks.map(h => {
      const b = have.get(h) || (perFile[rel] || new Map()).get(h);
      if (!b) throw new Error('chunk unavailable: ' + h.slice(0, 12));
      return b;
    });
    const out = path.join(stage, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.concat(parts));
    if (fs.statSync(out).size !== meta.size) throw new Error('size mismatch: ' + rel);
  }
  fs.writeFileSync(path.join(stage, '.manifest.json'), JSON.stringify(manifest));
  return { updateAvailable: true, version: manifest.version, stage, chunkCount: missing.length };
}

function copyDir(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.manifest.json') continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); }
    else fs.copyFileSync(s, d);
  }
}

// Swap staged files into the app dir and bump the recorded version.
// Returns true when the caller should relaunch/restart the console.
function installUpdate(stage) {
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, '.manifest.json'), 'utf8'));
  copyDir(stage, appDir());
  const pkgPath = path.join(__dirname, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = manifest.version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  } catch (e) {}
  fs.rmSync(stage, { recursive: true, force: true });
  return manifest.version;
}

module.exports = { checkForUpdates, downloadUpdate, installUpdate, cmpVer, CHUNK_SIZE, appDir, feedBase };

/* ============================================================
   OlympusX chunked update engine
   Console-style updates: games are stored as content-addressed
   1MB chunks. An update downloads only the chunks that changed.
   ============================================================ */
const CHUNK_SIZE = 1024 * 1024; // 1 MB
const CHUNK_CONCURRENCY = 4;

function chunkURL(hash) { return SUPA_URL + '/storage/v1/object/public/game-files/chunks/' + hash; }
function manifestURL(g) { return SUPA_URL + '/storage/v1/object/public/game-files/games/' + g.slug + '/manifest.json'; }

async function sha256hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/* split an ArrayBuffer into 1MB pieces -> [{h, buf}] */
async function chunkBuffer(ab) {
  const out = [];
  for (let off = 0; off < ab.byteLength; off += CHUNK_SIZE) {
    const buf = ab.slice(off, off + CHUNK_SIZE);
    out.push({ h: await sha256hex(buf), buf });
  }
  return out;
}

/* which chunk hashes does the installed manifest lack? */
function diffManifest(installed, latest) {
  if (!installed) return latest.chunks.slice();
  const have = new Set(installed.chunks);
  return latest.chunks.filter(h => !have.has(h));
}

/* ---------- IndexedDB: chunk + manifest store ---------- */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const q = indexedDB.open('olympusx_files', 1);
      q.onupgradeneeded = () => {
        q.result.createObjectStore('chunks', { keyPath: 'h' });
        q.result.createObjectStore('manifests', { keyPath: 'gameId' });
      };
      q.onsuccess = () => { this.db = q.result; res(this.db); };
      q.onerror = () => rej(q.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store), q = fn(s);
      t.oncomplete = () => res(q && q.result !== undefined ? q.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  putChunk(h, buf) { return this.tx('chunks', 'readwrite', s => s.put({ h, buf })); },
  getChunk(h) { return this.tx('chunks', 'readonly', s => s.get(h)); },
  delChunks(hashes) { return this.tx('chunks', 'readwrite', s => { hashes.forEach(h => s.delete(h)); }); },
  putManifest(gameId, manifest) { return this.tx('manifests', 'readwrite', s => s.put({ gameId, manifest })); },
  getManifest(gameId) { return this.tx('manifests', 'readonly', s => s.get(gameId)).then(r => r && r.manifest); },
  delManifest(gameId) { return this.tx('manifests', 'readwrite', s => s.delete(gameId)); },
  async usageBytes() {
    const db = await this.open();
    return new Promise((res, rej) => {
      let total = 0;
      const t = db.transaction('chunks', 'readonly');
      t.objectStore('chunks').openCursor().onsuccess = e => {
        const c = e.target.result;
        if (c) { total += c.value.buf.byteLength; c.continue(); }
        else res(total);
      };
      t.onerror = () => rej(t.error);
    });
  },
};

/* ---------- manifest fetch ---------- */
async function fetchManifest(g) {
  if (!g.slug) return null;
  try {
    const r = await fetch(manifestURL(g));
    if (!r.ok) return null;
    const m = await r.json();
    return m && Array.isArray(m.chunks) ? m : null;
  } catch (e) { return null; }
}

/* download one chunk with byte progress */
async function fetchChunk(hash, onBytes, signal) {
  const r = await fetch(chunkURL(hash), { signal });
  if (!r.ok) throw new Error('chunk ' + hash.slice(0, 8) + ' -> ' + r.status);
  const buf = await r.arrayBuffer();
  onBytes(buf.byteLength);
  const h = await sha256hex(buf);
  if (h !== hash) throw new Error('chunk hash mismatch');
  return buf;
}

/* full-file fallback for games published without a manifest */
async function fetchFull(g, onBytes, signal) {
  const r = await fetch(g.fileUrl, { signal });
  if (!r.ok) throw new Error('file -> ' + r.status);
  const total = +(r.headers.get('content-length') || 0);
  const reader = r.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.byteLength; onBytes(value.byteLength);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  parts.forEach(p => { buf.set(p, off); off += p.byteLength; });
  return { buf: buf.buffer, total: total || got };
}

/* ---------- the engine ----------
   dl: { paused, cancelled, pct, totalBytes, doneBytes }
   onProg() -> re-render. Resolves { blobUrl, bytes } */
async function downloadGame(g, dl, onProg) {
  const installed = await idb.getManifest(g.id).catch(() => null);
  const latest = await fetchManifest(g);
  const ctrl = new AbortController();
  dl.cancel = () => { dl.cancelled = true; ctrl.abort(); };

  const waitUnpaused = () => new Promise(res => {
    const t = () => {
      if (dl.cancelled) return res(false);
      if (!dl.paused) return res(true);
      setTimeout(t, 150);
    }; t();
  });

  let hashes, totalBytes, assembled;
  if (latest) {
    const missing = diffManifest(installed, latest);
    hashes = latest.chunks;
    totalBytes = latest.size;
    dl.totalBytes = totalBytes;
    dl.doneBytes = totalBytes - missing.reduce((s, h, i) => s, 0); // computed below per-chunk
    // doneBytes starts at bytes already held:
    let held = 0;
    const sizeOf = i => Math.min(CHUNK_SIZE, latest.size - i * CHUNK_SIZE);
    latest.chunks.forEach((h, i) => { if (!missing.includes(h)) held += sizeOf(i); });
    dl.doneBytes = held;
    onProg();
    // fetch missing in parallel batches
    const queue = missing.slice();
    const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, queue.length) || 1 }, async () => {
      while (queue.length) {
        if (!await waitUnpaused()) throw new Error('cancelled');
        const h = queue.shift();
        const buf = await fetchChunk(h, n => { dl.doneBytes += n; onProg(); }, ctrl.signal);
        await idb.putChunk(h, buf);
      }
    });
    await Promise.all(workers);
    // assemble in order
    const parts = [];
    for (const h of latest.chunks) {
      const rec = await idb.getChunk(h);
      if (!rec) throw new Error('missing chunk after download');
      parts.push(rec.buf);
    }
    assembled = new Blob(parts, { type: 'text/html' });
    await idb.putManifest(g.id, latest);
  } else {
    // legacy: whole file
    if (!g.fileUrl) throw new Error('no file');
    const { buf, total } = await fetchFull(g, n => { dl.doneBytes += n; onProg(); }, ctrl.signal);
    totalBytes = total; dl.totalBytes = total;
    const h = 'full:' + g.id + ':' + await sha256hex(buf);
    await idb.putChunk(h, buf);
    await idb.putManifest(g.id, { v: g.latest, chunk: buf.byteLength, size: buf.byteLength, chunks: [h], full: true });
    hashes = [h];
    assembled = new Blob([buf], { type: 'text/html' });
  }
  if (dl.cancelled) throw new Error('cancelled');
  return { blobUrl: URL.createObjectURL(assembled), bytes: totalBytes, chunked: !!latest, fetched: latest ? diffManifest(installed, latest).length : 1, total: hashes.length };
}

/* build a playable URL from cached chunks (offline OK) */
async function cachedGameURL(g) {
  const m = await idb.getManifest(g.id).catch(() => null);
  if (!m || m.v !== g.version) return null;
  const parts = [];
  for (const h of m.chunks) {
    const rec = await idb.getChunk(h).catch(() => null);
    if (!rec) return null;
    parts.push(rec.buf);
  }
  return URL.createObjectURL(new Blob(parts, { type: 'text/html' }));
}

/* free a game's local data */
async function wipeGameData(g) {
  const m = await idb.getManifest(g.id).catch(() => null);
  if (m) {
    await idb.delChunks(m.chunks).catch(() => {});
    await idb.delManifest(g.id).catch(() => {});
  }
  if (g.blobUrl) { URL.revokeObjectURL(g.blobUrl); g.blobUrl = null; }
}

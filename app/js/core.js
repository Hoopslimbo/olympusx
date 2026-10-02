/* ================= OlympusX core ================= */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtSize = mb => mb == null ? '—' : mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB';
function iconHTML(g) {
  const ic = g.icon || '';
  if (/^https?:/.test(ic)) return '<img src="' + esc(ic) + '" alt="" loading="lazy">';
  return '<span>' + (ic || '🎮') + '</span>';
}

const X = {
  user: null,
  screen: 'home',
  focusEl: null,
  games: [],
  friends: [],
  downloads: {},
  currentGame: null,
  suspended: null,
  settings: Object.assign({
    accentH: 222, sounds: 'soft', stripeAlpha: 1, bandwidth: 0, // 0 = unlimited, Mbps
    autoUpdate: true, sleepDisplay: 15,
  }, JSON.parse(localStorage.getItem('olympusx_settings') || '{}')),
  bindings: Object.assign({
    confirm: 0, back: 1, options: 9,
    kConfirm: 'Enter', kBack: 'Escape', kOptions: 'm',
  }, JSON.parse(localStorage.getItem('olympusx_binds') || '{}')),
  setScreen: null, // filled below
};
let storeDetail = null, friendDetail = null; // cross-screen detail state
function saveSettings() { localStorage.setItem('olympusx_settings', JSON.stringify(X.settings)); }
function saveBinds() { localStorage.setItem('olympusx_binds', JSON.stringify(X.bindings)); }
function applyAccent() {
  document.documentElement.style.setProperty('--accent-h', X.settings.accentH);
  const l = document.getElementById('login');
  if (l) l.style.setProperty('--accent-h', X.settings.accentH);
}

/* ---------- tiny UI sounds ---------- */
let AC = null;
function blip(kind) {
  if (X.settings.sounds === 'off') return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    const base = X.settings.sounds === 'retro' ? 220 : 520;
    o.frequency.value = kind === 'back' ? base * 0.7 : kind === 'open' ? base * 1.5 : base;
    o.type = X.settings.sounds === 'retro' ? 'square' : 'sine';
    g.gain.setValueAtTime(0.06, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.09);
    o.start(); o.stop(AC.currentTime + 0.1);
  } catch (e) {}
}

/* ---------- toast + modal ---------- */
function toast(html, ms) {
  const t = document.createElement('div');
  t.className = 'toast'; t.innerHTML = html;
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms || 2600);
}
function modal(html) {
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = '<div class="modal">' + html + '</div>';
  w.addEventListener('click', e => { if (e.target === w) w.remove(); });
  $('#modalRoot').appendChild(w);
  return w;
}
function confirmDlg(title, body, okLabel, onOk) {
  const w = modal('<h3>' + esc(title) + '</h3><p>' + body + '</p><div class="mrow">' +
    '<button class="btn ghost" data-x>Cancel</button>' +
    '<button class="btn danger" data-ok>' + esc(okLabel || 'Delete') + '</button></div>');
  $('[data-x]', w).onclick = () => w.remove();
  $('[data-ok]', w).onclick = () => { w.remove(); onOk && onOk(); };
}

/* ---------- wallpaper: black + moving stripes ---------- */
(function wallpaper() {
  const cv = $('#wallpaper'), ctx = cv.getContext('2d');
  let W, H, lines = [];
  const N = 46;
  function build() {
    W = cv.width = innerWidth; H = cv.height = innerHeight; lines = [];
    const gap = W / (N - 1);
    for (let i = 0; i < N; i++) lines.push({
      x: i * gap, amp: 26 + Math.random() * 30,
      freq: 0.0016 + Math.random() * 0.0018,
      speed: 0.00035 + Math.random() * 0.0005,
      phase: Math.random() * Math.PI * 2, alpha: 0.10 + Math.random() * 0.16,
    });
  }
  function draw(t) {
    if (!document.hidden) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 2;
      const m = X.settings.stripeAlpha;
      for (const L of lines) {
        ctx.beginPath();
        for (let y = -10; y <= H + 10; y += 8) {
          const x = L.x + Math.sin(y * L.freq + t * L.speed + L.phase) * L.amp;
          y === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'hsla(' + X.settings.accentH + ',95%,52%,' + (L.alpha * m).toFixed(3) + ')';
        ctx.stroke();
      }
    }
    requestAnimationFrame(draw);
  }
  build(); addEventListener('resize', build); requestAnimationFrame(draw);
})();

/* ---------- Supabase (same backend as Olympus) ---------- */
const SUPA_URL = 'https://zzsvqnnrfngfxtucszgr.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6c3Zxbm5yZm5nZnh0dWNzemdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDAzNTksImV4cCI6MjEwNjE3NjM1OX0.R-MCzou_q_ObnwXKCQRsRYy0Bwnand-1ktiatLfQ0aU';
let supa = null;
function supaInit() {
  if (supa) return supa;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = () => { try { supa = window.supabase.createClient(SUPA_URL, SUPA_KEY); } catch (e) {} };
  document.head.appendChild(s);
  return null;
}

/* ---------- demo data (preview) ---------- */
function loadGames() {
  try { return JSON.parse(localStorage.getItem('olympusx_games') || '[]'); }
  catch (e) { return []; }
}
function saveGames() { localStorage.setItem('olympusx_games', JSON.stringify(X.games)); }

/* ---------- live catalog (Supabase) ---------- */
async function fetchCatalog() {
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/games?select=*&order=name', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}
function catalogToGame(row, keep) {
  return Object.assign({
    id: row.id, name: row.name, slug: row.slug,
    icon: row.icon_url || '🎮',
    desc: row.description || '', price: row.price || 0,
    latest: row.version || '1.0.0', version: null,
    sizeMB: null, installed: false, fav: false, lastPlayed: 0,
    hasUpdate: false, fileUrl: row.file_url || '', wallpaperUrl: row.wallpaper_url || '',
  }, keep || {});
}
function loadFriends() {
  try { return JSON.parse(localStorage.getItem('olympusx_friends') || '[]'); }
  catch (e) { return []; }
}
function saveFriends() { localStorage.setItem('olympusx_friends', JSON.stringify(X.friends)); }

/* ---------- screens / navigation ---------- */
const SCREENS = ['home', 'library', 'store', 'friends', 'settings', 'profile'];
X.setScreen = function (name) {
  if (!SCREENS.includes(name)) return;
  X.screen = name;
  $$('.rail-btn').forEach(b => b.classList.toggle('on', b.dataset.screen === name));
  SCREENS.forEach(s => { $('#screen-' + s).hidden = s !== name; });
  renderScreen(name);
  blip('move');
  const first = $('#screen-' + name + ' [data-focus]');
  if (first) setFocus(first);
};
function renderScreen(name) {
  ({ home: renderHome, library: renderLibrary, store: renderStore, friends: renderFriends, settings: renderSettings, profile: renderProfile })[name]();
}

/* directional focus (keyboard + controller) */
function focusables() {
  const root = guideOpen ? $('#guideWrap') : document;
  return $$('[data-focus]', root).filter(e => e.offsetParent !== null && !e.disabled);
}
function setFocus(el) {
  if (X.focusEl) X.focusEl.classList.remove('kb-focus');
  X.focusEl = el;
  el.classList.add('kb-focus');
  try { el.focus({ preventScroll: true }); } catch (e) {}
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function moveFocus(dir) {
  const items = focusables();
  if (!items.length) return;
  if (!X.focusEl || !document.contains(X.focusEl)) { setFocus(items[0]); return; }
  const r = X.focusEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestD = 1e12;
  for (const el of items) {
    if (el === X.focusEl) continue;
    const q = el.getBoundingClientRect();
    const ex = q.left + q.width / 2, ey = q.top + q.height / 2;
    const dx = ex - cx, dy = ey - cy;
    let ok = false, primary = 0, secondary = 0;
    if (dir === 'left' && dx < -4) { ok = true; primary = -dx; secondary = Math.abs(dy); }
    if (dir === 'right' && dx > 4) { ok = true; primary = dx; secondary = Math.abs(dy); }
    if (dir === 'up' && dy < -4) { ok = true; primary = -dy; secondary = Math.abs(dx); }
    if (dir === 'down' && dy > 4) { ok = true; primary = dy; secondary = Math.abs(dx); }
    if (!ok) continue;
    const d = primary + secondary * 2.2;
    if (d < bestD) { bestD = d; best = el; }
  }
  if (best) { setFocus(best); blip('move'); }
}
function activateFocused() {
  if (X.focusEl && document.contains(X.focusEl)) { X.focusEl.click(); blip('open'); }
}
function backAction() {
  if (!$('#optWrap').hidden) { closeOptions(); return; }
  if (guideMiniName) { closeGuideMini(); return; }
  if (guideOpen) { closeGuide(); return; }
  if (!$('#gameWrap').hidden) { closeGame(); return; }
  if (X.screen === 'profile') { X.setScreen(X.profileFrom || 'home'); return; }
  if (X.screen === 'store' && storeDetail) { storeDetail = null; renderStore(); return; }
  if (X.screen === 'friends' && friendDetail) { friendDetail = null; renderFriends(); return; }
  blip('back');
}

document.addEventListener('keydown', e => {
  if (!bootDone) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' && e.target.type !== 'range' || tag === 'textarea';
  const k = e.key;
  if (typing) { if (k === 'Escape') e.target.blur(); return; }
  const B = X.bindings;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') { moveFocus('left'); e.preventDefault(); }
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') { moveFocus('right'); e.preventDefault(); }
  else if (k === 'ArrowUp' || k === 'w' || k === 'W') { moveFocus('up'); e.preventDefault(); }
  else if (k === 'ArrowDown' || k === 's' || k === 'S') { moveFocus('down'); e.preventDefault(); }
  else if (k === B.kConfirm) { activateFocused(); e.preventDefault(); }
  else if (k === B.kBack) { backAction(); e.preventDefault(); }
  else if (k === B.kOptions) { openOptionsFor(X.focusEl && X.focusEl.dataset.game); e.preventDefault(); }
});
document.addEventListener('click', e => {
  const f = e.target.closest('[data-focus]');
  if (f) setFocus(f);
});
document.addEventListener('click', e => {
  const r = e.target.closest('.rail-btn');
  if (r && r.dataset.screen) X.setScreen(r.dataset.screen);
});
document.addEventListener('contextmenu', e => {
  const t = e.target.closest('[data-game]');
  if (t) { e.preventDefault(); openOptionsFor(t.dataset.game); }
});

/* ---------- close console (rail button + controller home button) ---------- */
function inHomeMenu() {
  return bootDone && !guideOpen && X.screen === 'home' && !$('#app').hidden &&
    $('#gameWrap').hidden && $('#optWrap').hidden && !$('#modalRoot').hasChildNodes();
}
function requestCloseConsole() {
  confirmDlg('Close OlympusX?',
    'The console will shut down. Your games, saves and profile stay in the cloud.',
    'Close console', () => {
      try {
        if (window.OlympusXPC && typeof OlympusXPC.quit === 'function') OlympusXPC.quit();
        else toast('Closing is only available in the PC app');
      } catch (e) {}
    });
}
$('#closeBtn').addEventListener('click', requestCloseConsole);

/* ---------- in-game guide (home button while playing) ---------- */
let guideOpen = false, guideMiniName = null, guideMiniSlot = null;
function openGuide() {
  if ($('#gameWrap').hidden || guideOpen) return;
  renderGuideRecent();
  $('#guideMini').hidden = true;
  $('#guideWrap').hidden = false;
  guideOpen = true;
  blip('open');
  const first = $('#guideWrap .guide-nav [data-focus]');
  if (first) setFocus(first);
}
function closeGuide() {
  if (!guideOpen) return;
  closeGuideMini(true);
  $('#guideWrap').hidden = true;
  guideOpen = false;
  blip('back');
}
function renderGuideRecent() {
  const recent = X.games.filter(g => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
  $('#guideRecentRow').innerHTML = recent.length ? recent.map(tileHTML).join('')
    : '<div class="empty-row">Nothing played yet.</div>';
}
function openGuideMini(name) {
  closeGuideMini(true);
  const node = $('#screen-' + name);
  if (!node) return;
  guideMiniSlot = document.createComment('guide-slot');
  node.replaceWith(guideMiniSlot);
  node.hidden = false;
  $('#guideMiniBody').appendChild(node);
  guideMiniName = name;
  renderScreen(name);
  $('#guideMiniTitle').textContent = name[0].toUpperCase() + name.slice(1);
  $('#guideMini').hidden = false;
  blip('open');
  const first = $('#guideMiniBody [data-focus]');
  if (first) setFocus(first);
}
function closeGuideMini(silent) {
  if (!guideMiniName) return;
  const node = $('#screen-' + guideMiniName);
  if (node && guideMiniSlot && guideMiniSlot.parentNode) guideMiniSlot.replaceWith(node);
  else if (node) $('#screens').appendChild(node);
  if (node) node.hidden = true;
  guideMiniName = null; guideMiniSlot = null;
  $('#guideMini').hidden = true;
  if (!silent) blip('back');
}
function guideHome() {
  closeGuide();
  closeGame();
  X.setScreen('home');
}
$$('#guideWrap .guide-nav [data-gscreen]').forEach(b => b.onclick = () => openGuideMini(b.dataset.gscreen));
$('#guideHomeBtn').addEventListener('click', guideHome);
$('#guideDim').addEventListener('click', closeGuide);

/* ---------- gamepad ---------- */
let padPrev = {}, padConnected = false, bootDone = false;
function rumbleConnect(gp) {
  try {
    const va = gp && gp.vibrationActuator;
    if (va && typeof va.playEffect === 'function') {
      const r = va.playEffect('dual-rumble', { duration: 450, strongMagnitude: 0.9, weakMagnitude: 0.9 });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  } catch (e) {}
}
addEventListener('gamepadconnected', e => { padConnected = true; updatePadUI(); toast('Controller connected'); rumbleConnect(e.gamepad); });
addEventListener('gamepaddisconnected', () => { padConnected = false; padPrev = {}; updatePadUI(); });
function updatePadUI() {
  const b = $('#padBatt');
  if (b) { b.textContent = padConnected ? '🎮 ●' : '🎮 --'; b.classList.toggle('low', false); }
}
function padLoop() {
  try {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const p = pads[0];
    if (p) {
      if (!padConnected) { padConnected = true; updatePadUI(); toast('Controller connected'); rumbleConnect(p); }
      const B = X.bindings;
      const press = i => p.buttons[i] && p.buttons[i].pressed;
      const edge = i => press(i) && !padPrev[i];
      const ax = p.axes, dz = v => Math.abs(v) > 0.55;
      const d = {
        left: edge(14) || (dz(ax[0]) && ax[0] < 0 && !padPrev.axL),
        right: edge(15) || (dz(ax[0]) && ax[0] > 0 && !padPrev.axR),
        up: edge(12) || (dz(ax[1]) && ax[1] < 0 && !padPrev.axU),
        down: edge(13) || (dz(ax[1]) && ax[1] > 0 && !padPrev.axD),
      };
      padPrev.axL = dz(ax[0]) && ax[0] < 0; padPrev.axR = dz(ax[0]) && ax[0] > 0;
      padPrev.axU = dz(ax[1]) && ax[1] < 0; padPrev.axD = dz(ax[1]) && ax[1] > 0;
      if (bootDone) {
        if (d.left) moveFocus('left'); if (d.right) moveFocus('right');
        if (d.up) moveFocus('up'); if (d.down) moveFocus('down');
        if (edge(B.confirm)) activateFocused();
        if (edge(B.back)) backAction();
        if (edge(B.options)) openOptionsFor(X.focusEl && X.focusEl.dataset.game);
        if (edge(16)) {
          if (!$('#gameWrap').hidden) { guideOpen ? closeGuide() : openGuide(); }
          else if (inHomeMenu()) requestCloseConsole();
        }
      }
      p.buttons.forEach((btn, i) => padPrev[i] = btn.pressed);
    }
  } catch (e) {}
  requestAnimationFrame(padLoop);
}

/* ---------- game tile ---------- */
function tileHTML(g) {
  const dl = X.downloads[g.id];
  let badges = '';
  if (g.isDemo) badges += '<span class="badge demo">DEMO</span>';
  if (g.hasUpdate && g.installed) badges += '<span class="badge update">UPDATE</span>';
  if (!g.installed && !dl) badges += '<span class="badge cloud">☁</span>';
  if (dl) badges += '<span class="badge dl">' + Math.floor(dl.pct) + '%</span>';
  const sub = g.installed
    ? ('v' + g.version + (g.lastPlayed ? ' · ' + relTime(g.lastPlayed) : ''))
    : ((g.sizeMB ? fmtSize(g.sizeMB) + ' · ' : '') + 'cloud');
  return '<button class="gtile" data-focus data-game="' + g.id + '">' +
    '<div class="art">' + iconHTML(g) + badges + (dl ? '<div class="prog"><i style="width:' + dl.pct + '%"></i></div>' : '') + '</div>' +
    '<div class="t">' + esc(g.name) + '</div><div class="s">' + esc(sub) + '</div></button>';
}
function relTime(t) {
  if (!t) return 'never';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-game]');
  if (t && !e.target.closest('#optWrap')) {
    const g = X.games.find(x => x.id === t.dataset.game);
    if (g) tileAction(g);
  }
});
function tileAction(g) {
  const dl = X.downloads[g.id];
  if (dl && !dl.done) { toast('Already downloading <b>' + esc(g.name) + '</b> — see the queue.'); return; }
  if (g.hasUpdate && g.installed) { startDownload(g, true); return; }
  if (g.installed) { launchGame(g); return; }
  startDownload(g, false);
}

/* ---------- game options mini-window (menu button on tile) ---------- */
function openOptionsFor(gameId) {
  if (!gameId) return;
  if (guideOpen) closeGuide();
  const g = X.games.find(x => x.id === gameId);
  if (!g) return;
  blip('open');
  const items = [];
  if (g.installed) items.push({ ic: '▶', label: 'Play now', fn: () => launchGame(g) });
  else items.push({ ic: '⬇', label: 'Download', tag: fmtSize(g.sizeMB), fn: () => startDownload(g, false) });
  if (g.hasUpdate && g.installed) items.push({ ic: '🔄', label: 'Update now', tag: 'v' + g.latest, fn: () => startDownload(g, true) });
  items.push({ ic: g.fav ? '★' : '☆', label: g.fav ? 'Remove from Favorites' : 'Add to Favorites', fn: () => { g.fav = !g.fav; toast(g.fav ? 'Added to <b>Favorites</b>' : 'Removed from <b>Favorites</b>'); } });
  if (g.installed) items.push({ ic: '🗑', label: 'Uninstall', tag: 'free ' + fmtSize(g.sizeMB), danger: true, fn: () => uninstallGame(g) });
  if (g.hasDemoFile && !g.demo) items.push({ ic: '🧪', label: 'Download demo', tag: 'free', fn: () => toast('Demo download queued for <b>' + esc(g.name) + '</b>') });
  items.push({ ic: '◈', label: 'View in Store', fn: () => { storeDetail = g.id; X.setScreen('store'); } });
  $('#optHead').innerHTML = '<div class="t">' + esc(g.name) + '</div><div class="s">v' + esc(g.installed ? g.version : g.latest) +
    (g.installed ? ' · installed · ' + fmtSize(g.sizeMB) : ' · cloud · ' + fmtSize(g.sizeMB)) + '</div>';
  const list = $('#optList');
  list.innerHTML = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'opt-item' + (it.danger ? ' danger' : '');
    b.setAttribute('data-focus', '');
    b.innerHTML = '<span class="ic">' + it.ic + '</span>' + esc(it.label) + (it.tag ? '<span class="tag">' + esc(it.tag) + '</span>' : '');
    b.onclick = () => { closeOptions(); it.fn(); renderScreen(X.screen); };
    list.appendChild(b);
    if (i === 0) setTimeout(() => setFocus(b), 30);
  });
  $('#optWrap').hidden = false;
}
function closeOptions() { $('#optWrap').hidden = true; blip('back'); }
$('#optWrap').addEventListener('click', e => { if (e.target.id === 'optWrap') closeOptions(); });

/* ---------- downloads ---------- */
async function startDownload(g, isUpdate) {
  const ex = X.downloads[g.id];
  if (ex && !ex.done) { toast('Already downloading <b>' + esc(g.name) + '</b> — see the queue.'); return; }
  if (X.downloads[g.id]) return;
  const dl = { id: g.id, name: g.name, pct: 0, paused: false, cancelled: false, isUpdate: !!isUpdate, done: false, doneBytes: 0, totalBytes: 1 };
  X.downloads[g.id] = dl;
  const onProg = () => {
    dl.pct = dl.totalBytes ? Math.min(100, dl.doneBytes / dl.totalBytes * 100) : 0;
    renderDlDock(); updateTileProgress(g.id, dl.pct);
  };
  renderDlDock(); renderScreen(X.screen);
  toast((isUpdate ? 'Updating <b>' : 'Downloading <b>') + esc(g.name) + '</b>…');
  try {
    const r = await downloadGame(g, dl, onProg);
    delete X.downloads[g.id];
    g.installed = true; g.version = g.latest; g.hasUpdate = false;
    g.blobUrl = r.blobUrl; g.sizeMB = Math.max(1, Math.round(r.bytes / 1048576));
    saveGames(); refreshUsage();
    renderDlDock(); renderScreen(X.screen);
    toast('<b>' + esc(g.name) + '</b> ' + (isUpdate ? 'updated' : 'downloaded') +
      (r.chunked ? ' <span class="muted">· only ' + r.fetched + ' of ' + r.total + ' chunks fetched</span>' : '') + '.');
    blip('open');
  } catch (e) {
    delete X.downloads[g.id];
    renderDlDock(); renderScreen(X.screen);
    if (!dl.cancelled) toast('Download failed: <b>' + esc(e.message) + '</b>');
  }
}
async function refreshUsage() { try { X.usedBytes = await idb.usageBytes(); } catch (e) { X.usedBytes = 0; } }
function updateTileProgress(id, pct) {
  $$('[data-game="' + id + '"] .prog i').forEach(i => i.style.width = pct + '%');
  $$('[data-game="' + id + '"] .badge.dl').forEach(b => b.textContent = Math.floor(pct) + '%');
}
function renderDlDock() {
  const dock = $('#dlDock');
  const ids = Object.keys(X.downloads);
  dock.hidden = !ids.length;
  dock.innerHTML = ids.map(id => {
    const d = X.downloads[id];
    return '<div class="dl-item"><div class="t"><span>' + esc(d.name) + (d.isUpdate ? ' (update)' : '') + '</span>' +
      '<span class="pct">' + Math.floor(d.pct) + '%</span></div>' +
      '<div class="bar"><i style="width:' + d.pct + '%"></i></div>' +
      '<div class="row"><button class="btn ghost sm" data-dlpause="' + id + '" data-focus>' + (d.paused ? 'Resume' : 'Pause') + '</button>' +
      '<button class="btn ghost sm" data-dlcancel="' + id + '" data-focus>Cancel</button></div></div>';
  }).join('');
}
document.addEventListener('click', e => {
  const p = e.target.closest('[data-dlpause]');
  const c = e.target.closest('[data-dlcancel]');
  if (p) { const d = X.downloads[p.dataset.dlpause]; if (d) { d.paused = !d.paused; renderDlDock(); } }
  if (c) {
    const id = c.dataset.dlcancel, d = X.downloads[id];
    if (d) { d.cancelled = true; if (d.cancel) d.cancel(); clearTimeout(d.timer); delete X.downloads[id]; renderDlDock(); renderScreen(X.screen); toast('Download cancelled'); }
  }
});
function uninstallGame(g) {
  confirmDlg('Uninstall ' + g.name + '?',
    'This frees <b>' + fmtSize(g.sizeMB) + '</b>. The game stays in your library as a cloud entry — redownload anytime.',
    'Uninstall', async () => {
      g.installed = false; g.lastPlayed = 0;
      try { await wipeGameData(g); } catch (e) {}
      refreshUsage(); saveGames();
      renderScreen(X.screen);
      toast('Uninstalled <b>' + esc(g.name) + '</b> — freed ' + fmtSize(g.sizeMB));
    });
}

/* ---------- launch ---------- */
function launchGame(g) {
  if (guideOpen) closeGuide();
  if (X.currentGame && X.currentGame.id !== g.id) {
    X.suspended = X.currentGame; // quick resume: suspend current
    toast('Suspended <b>' + esc(X.currentGame.name) + '</b>');
  }
  X.currentGame = g;
  g.lastPlayed = Date.now();
  const open = url => {
    $('#gameBarTitle').textContent = g.name;
    $('#gameFrame').src = url;
    $('#gameWrap').hidden = false;
  };
  (async () => {
    let url = g.blobUrl;
    if (!url && g.installed) { try { url = await cachedGameURL(g); } catch (e) {} if (url) g.blobUrl = url; }
    if (url || g.fileUrl) open(url || g.fileUrl);
    else toast('Launching <b>' + esc(g.name) + '</b>… <span class="muted">(preview stub)</span>');
  })();
  renderScreen(X.screen);
}
function closeGame() {
  $('#gameFrame').src = 'about:blank';
  $('#gameWrap').hidden = true;
  blip('back');
}
$('#gameHome').addEventListener('click', closeGame);

/* ---------- search (games / users / tabs) ---------- */
let searchTab = 'games';
$$('.stab').forEach(b => b.onclick = () => {
  $$('.stab').forEach(x => x.classList.remove('on')); b.classList.add('on');
  searchTab = b.dataset.tab; doSearch($('#search').value);
});
$('#search').addEventListener('input', e => doSearch(e.target.value));
$('#search').addEventListener('blur', () => setTimeout(() => $('#searchResults').hidden = true, 150));
$('#search').addEventListener('focus', e => doSearch(e.target.value));
function doSearch(q) {
  const box = $('#searchResults');
  q = q.trim().toLowerCase();
  if (!q) { box.hidden = true; return; }
  let items = [];
  if (searchTab === 'games') items = X.games.filter(g => g.name.toLowerCase().includes(q))
    .map(g => ({ t: g.name, s: g.installed ? 'installed · v' + g.version : 'cloud' + (g.sizeMB ? ' · ' + fmtSize(g.sizeMB) : ''), ic: iconHTML(g), fn: () => { storeDetail = g.id; X.setScreen('store'); } }));
  else items = X.friends.filter(f => f.name.toLowerCase().includes(q))
    .map(f => ({ t: f.name, s: f.status, ic: '👤', fn: () => { friendDetail = f.name; X.setScreen('friends'); } }));
  box.innerHTML = items.length
    ? items.map((it, i) => '<div class="sr-item" data-sr="' + i + '"><span>' + it.ic + '</span><span><b>' + esc(it.t) + '</b><br><span class="muted" style="font-size:11px">' + esc(it.s) + '</span></span></div>').join('')
    : '<div class="sr-item muted">No results</div>';
  box.hidden = false;
  $$('.sr-item[data-sr]', box).forEach(el => el.onclick = () => { box.hidden = true; $('#search').value = ''; items[+el.dataset.sr].fn(); });
}

/* ---------- clock ---------- */
function tickClock() {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
setInterval(tickClock, 10000); tickClock();

/* ---------- login ---------- */
function showLogin() {
  $('#login').hidden = false;
  setTimeout(() => { const e = $('#loginEmail'); if (e) setFocus(e); }, 60);
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('olympusx$' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function localAccounts() {
  try { return JSON.parse(localStorage.getItem('olympusx_accounts') || '{}'); } catch (e) { return {}; }
}
function saveLocalAccounts(a) { localStorage.setItem('olympusx_accounts', JSON.stringify(a)); }
function persistSession(user) {
  if ($('#loginStay') && !$('#loginStay').checked) { localStorage.removeItem('olympusx_session'); return; }
  localStorage.setItem('olympusx_session', JSON.stringify({ email: user.email, name: user.name }));
}
function getSession() {
  try { return JSON.parse(localStorage.getItem('olympusx_session') || 'null'); } catch (e) { return null; }
}
let loginMode = 'signin';
function setLoginMode(m) {
  loginMode = m;
  const su = m === 'signup';
  $('#loginName').hidden = !su;
  $('#loginTitle').innerHTML = su ? 'Create your <span>Olympus</span> account' : 'Welcome to <span>OlympusX</span>';
  $('#loginSub').textContent = su ? 'One account for the console, the store, and your games' : 'Sign in with your Olympus account';
  $('#loginGo').textContent = su ? 'Create account' : 'Sign in';
  $('#loginAltText').textContent = su ? 'Already have an account?' : 'New to Olympus?';
  $('#loginToggle').textContent = su ? 'Sign in' : 'Create an account';
  $('#loginErr').hidden = true;
}
async function doSignup(email, pass, name) {
  const err = $('#loginErr');
  err.hidden = true;
  if (!name) { err.textContent = 'Pick a display name.'; err.hidden = false; return; }
  if (!email || !/.+@.+\..+/.test(email)) { err.textContent = 'Enter a valid email.'; err.hidden = false; return; }
  if (!pass || pass.length < 6) { err.textContent = 'Password needs at least 6 characters.'; err.hidden = false; return; }
  if (supa) {
    try {
      const { data, error } = await supa.auth.signUp({ email, password: pass, options: { data: { name } } });
      if (error) throw error;
      const user = { email: data.user.email, name };
      persistSession(user); enterApp(user);
      return;
    } catch (e) { err.textContent = e.message || 'Sign up failed'; err.hidden = false; return; }
  }
  // offline preview: local console account
  const accs = localAccounts();
  if (accs[email.toLowerCase()]) { err.textContent = 'That email already has an account — sign in instead.'; err.hidden = false; return; }
  accs[email.toLowerCase()] = { name, hash: await sha256(pass) };
  saveLocalAccounts(accs);
  const user = { email, name };
  persistSession(user); enterApp(user);
}
async function doLogin(email, pass) {
  if (loginMode === 'signup') { doSignup(email, pass, $('#loginName').value.trim()); return; }
  const err = $('#loginErr');
  err.hidden = true;
  if (supa) {
    try {
      const { data, error } = await supa.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      const user = { email: data.user.email, name: (data.user.user_metadata && data.user.user_metadata.name) || data.user.email.split('@')[0] };
      persistSession(user); enterApp(user);
      return;
    } catch (e) { err.textContent = e.message || 'Sign in failed'; err.hidden = false; return; }
  }
  // offline preview: local console account
  const acc = localAccounts()[email.toLowerCase()];
  if (!acc) { err.textContent = 'No account for that email on this console — create one first.'; err.hidden = false; return; }
  if ((await sha256(pass)) !== acc.hash) { err.textContent = 'Wrong password.'; err.hidden = false; return; }
  const user = { email, name: acc.name };
  persistSession(user); enterApp(user);
}
async function enterApp(user) {
  X.user = user;
  $('#login').hidden = true;
  $('#app').hidden = false;
  updateAvatar(); // pic if set, else initial
  // live catalog from Supabase; fall back to the cached copy offline
  const rows = await fetchCatalog();
  const keep = {};
  loadGames().forEach(g => keep[g.id] = { installed: g.installed, version: g.version, fav: g.fav, lastPlayed: g.lastPlayed, sizeMB: g.sizeMB });
  if (rows) {
    X.games = rows.map(r => {
      const g = catalogToGame(r, keep[r.id]);
      g.hasUpdate = !!(g.installed && g.version && g.version !== g.latest);
      return g;
    });
    saveGames();
  } else {
    X.games = loadGames();
  }
  refreshUsage();
  X.games.forEach(g => { if (g.installed) cachedGameURL(g).then(u => { if (u) g.blobUrl = u; }).catch(() => {}); });
  X.friends = loadFriends();
  X.setScreen('home');
  toast('Welcome back, <b>' + esc(user.name) + '</b>');
}
$('#loginGo').addEventListener('click', () => doLogin($('#loginEmail').value.trim(), $('#loginPass').value));
$('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin($('#loginEmail').value.trim(), $('#loginPass').value); });
$('#loginName').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin($('#loginEmail').value.trim(), $('#loginPass').value); });
$('#loginToggle').addEventListener('click', () => setLoginMode(loginMode === 'signin' ? 'signup' : 'signin'));
$('#loginOffline').addEventListener('click', () => {
  const user = { email: 'preview@olympusx', name: 'Player' };
  persistSession(user); enterApp(user);
});
$('#avatarBtn').addEventListener('click', () => {
  if (X.screen !== 'profile') X.profileFrom = X.screen;
  X.setScreen('profile');
});

/* ---------- profile picture ---------- */
function getProfilePic() {
  try { return localStorage.getItem('olympusx_profile_pic') || ''; } catch (e) { return ''; }
}
function updateAvatar() {
  const b = $('#avatarBtn');
  if (!b) return;
  const pic = getProfilePic();
  if (pic) b.innerHTML = '<img src="' + pic + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block">';
  else b.textContent = ((X.user && X.user.name) || '?')[0].toUpperCase();
}
function handlePicFile(file) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) { toast('Pick an image file'); return; }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    try {
      const S = 256, cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const ctx = cv.getContext('2d');
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
      localStorage.setItem('olympusx_profile_pic', cv.toDataURL('image/jpeg', 0.85));
      updateAvatar(); renderProfile();
      toast('Profile picture updated');
    } catch (e) { toast('Couldn\'t use that image'); }
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Couldn\'t read that image'); };
  img.src = url;
}

/* ---------- boot ---------- */
function boot() {
  applyAccent();
  supaInit();
  updatePadUI();
  requestAnimationFrame(padLoop);
  const fill = $('#bootFill');
  let p = 0;
  const iv = setInterval(() => {
    p = Math.min(100, p + 8 + Math.random() * 14);
    fill.style.width = p + '%';
    if (p >= 100) {
      clearInterval(iv);
      setTimeout(() => {
        $('#boot').classList.add('done');
        bootDone = true;
        setTimeout(() => $('#boot').remove(), 700);
        const s = getSession();
        if (s && s.email) enterApp({ email: s.email, name: s.name || 'Player' });
        else showLogin();
        blip('open');
      }, 350);
    }
  }, 160);
}
document.addEventListener('DOMContentLoaded', boot);

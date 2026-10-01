/* ================= OlympusX screens ================= */
'use strict';

/* ---------- HOME ---------- */
function renderHome() {
  const el = $('#screen-home');
  const recent = X.games.filter(g => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
  const favs = X.games.filter(g => g.fav);
  let html = '';
  if (X.suspended) {
    html += '<div class="set-card" style="display:flex;align-items:center;gap:14px">' +
      '<span style="font-size:26px">⏸</span><div style="flex:1"><div class="t"><b>' + esc(X.suspended.name) + '</b> is suspended</div>' +
      '<div class="s">Jump right back in where you left off.</div></div>' +
      '<button class="btn primary sm" data-focus data-resume>Resume</button></div>';
  }
  html += '<h2 class="row-title">Recently Played <span class="count">' + recent.length + '</span></h2>';
  html += recent.length ? '<div class="grow">' + recent.map(tileHTML).join('') + '</div>'
    : '<div class="empty-row">Nothing played yet — grab a game from the Store.</div>';
  html += '<h2 class="row-title">Favorites <span class="count">' + favs.length + '</span></h2>';
  html += favs.length ? '<div class="grow">' + favs.map(tileHTML).join('') + '</div>'
    : '<div class="empty-row">Press the menu button on any game to add it to Favorites.</div>';
  el.innerHTML = html;
  const r = $('[data-resume]', el);
  if (r) r.onclick = () => { const g = X.suspended; X.suspended = null; launchGame(g); };
}

/* ---------- LIBRARY ---------- */
let libFilter = 'all';
function renderLibrary() {
  const el = $('#screen-library');
  const inst = X.games.filter(g => g.installed);
  const usedMB = Math.round((X.usedBytes || 0) / 1048576);
  const totalMB = 512 * 1024;
  const pct = Math.min(100, usedMB / totalMB * 100);
  let list = X.games.slice();
  if (libFilter === 'installed') list = list.filter(g => g.installed);
  if (libFilter === 'cloud') list = list.filter(g => !g.installed);
  if (libFilter === 'demos') list = list.filter(g => g.isDemo || g.demo);
  const chips = [['all', 'All'], ['installed', 'Installed'], ['cloud', 'Cloud'], ['demos', 'Demos']]
    .map(c => '<button class="chip' + (libFilter === c[0] ? ' on' : '') + '" data-focus data-libf="' + c[0] + '">' + c[1] + '</button>').join('');
  el.innerHTML =
    '<h2 class="row-title">Library <span class="count">' + X.games.length + ' games</span></h2>' +
    '<div class="storage-bar"><div class="lab"><span><b>' + fmtSize(usedMB) + '</b> of ' + fmtSize(totalMB) + ' used</span>' +
    '<span>' + inst.length + ' installed</span></div><div class="meter"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="lib-tools">' + chips + '</div>' +
    (list.length ? '<div class="ggrid">' + list.map(tileHTML).join('') + '</div>'
      : '<div class="empty-row">Nothing here.</div>');
  $$('[data-libf]', el).forEach(b => b.onclick = () => { libFilter = b.dataset.libf; renderLibrary(); });
}

/* ---------- STORE ---------- */
function renderStore() {
  const el = $('#screen-store');
  if (storeDetail) { renderStoreDetail(el); return; }
  if (!X.games.length) {
    el.innerHTML = '<h2 class="row-title">Store</h2><div class="empty-row">The store is empty right now — check back soon.</div>';
    return;
  }
  const featured = X.games[3] || X.games[0];
  el.innerHTML =
    '<div class="store-hero"><div class="in"><h2>Featured</h2><p>' + esc(featured.name) + ' — ' + esc(featured.desc.split('.')[0]) + '.</p>' +
    '<div style="margin-top:14px"><button class="btn primary sm" data-focus data-feat>View in Store</button></div></div></div>' +
    '<h2 class="row-title">All games <span class="count">' + X.games.length + '</span></h2>' +
    '<div class="ggrid">' + X.games.map(tileHTML).join('') + '</div>';
  $('[data-feat]', el).onclick = () => { storeDetail = featured.id; renderStore(); };
  // store tiles open the detail page instead of downloading
  $$('#screen-store [data-game]', el).forEach(t => {
    t.onclick = e => { e.stopPropagation(); storeDetail = t.dataset.game; renderStore(); };
  }, { capture: false });
}
function renderStoreDetail(el) {
  const g = X.games.find(x => x.id === storeDetail);
  if (!g) { storeDetail = null; renderStore(); return; }
  const dl = X.downloads[g.id];
  let action = '';
  if (dl) action = '<button class="btn ghost" disabled>' + Math.floor(dl.pct) + '% downloading…</button>';
  else if (g.installed && !g.hasUpdate) action = '<button class="btn primary" data-focus data-act="play">▶ Play now</button>';
  else if (g.hasUpdate) action = '<button class="btn primary" data-focus data-act="update">🔄 Update to v' + esc(g.latest) + '</button>';
  else action = '<button class="btn primary" data-focus data-act="dl">⬇ Download' + (g.price ? ' — $' + g.price : ' — Free') + '</button>';
  const demoBtn = (g.hasDemoFile && !g.demo && !g.installed)
    ? '<button class="btn ghost" data-focus data-act="demo">🧪 Download demo <span class="muted">· free</span></button>' : '';
  el.innerHTML =
    '<button class="back-link" data-focus data-back>‹ Back to Store</button>' +
    '<div id="storeDetail"><div class="det-banner">' + iconHTML(g) +
    (g.isDemo ? '<span class="badge demo">DEMO</span>' : '') + '</div>' +
    '<div class="det-body"><div class="det-main"><h2>' + esc(g.name) +
    (g.isDemo ? ' <span class="badge demo" style="position:static">DEMO</span>' : '') + '</h2>' +
    '<div class="ver">Version ' + esc(g.installed ? g.version : g.latest) + '</div>' +
    '<p class="desc">' + esc(g.desc) + '</p>' +
    (g.isDemo ? '<p class="desc muted">This demo is a smaller taste of the full game. Buying the full game replaces the demo file automatically.</p>' : '') +
    '</div><div class="det-side">' + action + demoBtn +
    '<div class="det-row"><span>Size</span><b>' + fmtSize(g.sizeMB) + '</b></div>' +
    '<div class="det-row"><span>Status</span><b>' + (g.installed ? 'Installed' : 'In the cloud') + '</b></div>' +
    '<div class="det-row"><span>Version</span><b>v' + esc(g.installed ? g.version : g.latest) + '</b></div>' +
    (g.hasUpdate ? '<div class="det-row"><span>Update</span><b style="color:var(--accent)">v' + esc(g.latest) + ' ready</b></div>' : '') +
    (g.isDemo ? '' : '<div class="det-row"><span>Demo</span><b>' + (g.hasDemoFile ? 'Available' : 'None') + '</b></div>') +
    '</div></div></div>';
  $('[data-back]', el).onclick = () => { storeDetail = null; renderStore(); };
  $$('[data-act]', el).forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'play') launchGame(g);
    else if (a === 'update') startDownload(g, true);
    else if (a === 'dl') startDownload(g, false);
    else if (a === 'demo') toast('Demo download queued for <b>' + esc(g.name) + '</b>');
    renderStore();
  });
}

/* ---------- PROFILE ---------- */
function renderProfile() {
  const el = $('#screen-profile');
  const pic = getProfilePic();
  const initial = esc(((X.user && X.user.name) || '?')[0].toUpperCase());
  el.innerHTML = '<button class="back-link" data-focus data-back>‹ Back</button>' +
    '<div class="fprof"><div class="fav" style="width:84px;height:84px;font-size:30px;overflow:hidden;padding:0">' +
    (pic ? '<img src="' + pic + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block">' : initial) + '</div>' +
    '<h2>' + esc(X.user.name) + '</h2><div class="st" style="color:var(--mut);font-size:13px">' + esc(X.user.email) + '</div>' +
    '<div class="sec"><h4>Profile picture</h4>' +
    '<label class="btn ghost sm" data-focus tabindex="0" style="cursor:pointer">Upload picture<input type="file" id="picUp" accept="image/*" hidden></label>' +
    (pic ? ' <button class="btn ghost sm" data-focus data-picrm>Remove</button>' : '') + '</div>' +
    '<div class="sec"><h4>Display name</h4>' +
    '<div style="display:flex;gap:10px"><input id="nameUp" data-focus value="' + esc(X.user.name) + '" maxlength="24" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:10px;padding:10px 14px;color:var(--txt)">' +
    '<button class="btn primary sm" data-focus data-namesave>Save</button></div></div>' +
    '<div class="sec"><h4>Session</h4><button class="btn ghost sm" data-focus data-signout>Sign out</button></div></div>';
  $('[data-back]', el).onclick = () => X.setScreen(X.profileFrom || 'home');
  $('#picUp', el).onchange = e => handlePicFile(e.target.files && e.target.files[0]);
  const rm = $('[data-picrm]', el);
  if (rm) rm.onclick = () => { try { localStorage.removeItem('olympusx_profile_pic'); } catch (e) {} updateAvatar(); renderProfile(); toast('Profile picture removed'); };
  $('[data-namesave]', el).onclick = () => {
    const nv = $('#nameUp', el).value.trim();
    if (!nv) { toast('Pick a display name'); return; }
    X.user.name = nv; persistSession(X.user); updateAvatar(); renderProfile();
    toast('Display name updated');
  };
  $('[data-signout]', el).onclick = () => confirmDlg('Sign out?',
    'You will need to sign in again next time.', 'Sign out',
    () => { localStorage.removeItem('olympusx_session'); location.reload(); });
}

/* ---------- FRIENDS ---------- */
function renderFriends() {
  const el = $('#screen-friends');
  if (friendDetail) { renderFriendDetail(el); return; }
  el.innerHTML = '<h2 class="row-title">Friends <span class="count">' + X.friends.length + '</span></h2>' +
    (X.friends.length ? X.friends.map(f =>
      '<div class="friend" data-focus data-fr="' + esc(f.name) + '" tabindex="0"><div class="fav">' + esc(f.name[0]) + '</div>' +
      '<div><div class="nm">' + esc(f.name) + '</div><div class="st">' +
      (f.online ? '<span class="on">● </span>' : '') + esc(f.status) + '</div></div></div>').join('')
      : '<div class="empty-row">No friends yet.</div>');
  $$('[data-fr]', el).forEach(d => d.onclick = () => { friendDetail = d.dataset.fr; renderFriends(); });
}
function renderFriendDetail(el) {
  const f = X.friends.find(x => x.name === friendDetail);
  if (!f) { friendDetail = null; renderFriends(); return; }
  el.innerHTML = '<button class="back-link" data-focus data-back>‹ Back to Friends</button>' +
    '<div class="fprof"><div class="fav" style="width:64px;height:64px;font-size:24px">' + esc(f.name[0]) + '</div>' +
    '<h2>' + esc(f.name) + '</h2><div class="st" style="color:var(--mut);font-size:13px">' +
    (f.online ? '<span class="on" style="color:var(--ok)">● </span>' : '') + esc(f.status) + '</div>' +
    '<div class="sec"><h4>Achievements</h4>' +
    (f.ach.length ? f.ach.map(a => '<span class="ach">' + a[0] + ' ' + esc(a[1]) + '</span>').join('') : '<span class="muted">No achievements yet</span>') + '</div>' +
    '<div class="sec"><h4>Recently played</h4>' +
    f.recent.slice(0, 10).map((r, i) => '<div class="mini-game"><span class="dot">' + (i + 1) + '</span>' + esc(r) + '</div>').join('') + '</div>' +
    '<div class="sec"><button class="btn ghost sm" data-focus data-invite>✉ Send party invite</button> ' +
    '<button class="btn ghost sm" data-focus data-unfriend style="color:#ff8ba0">Remove friend</button></div></div>';
  $('[data-back]', el).onclick = () => { friendDetail = null; renderFriends(); };
  $('[data-invite]', el).onclick = () => toast('Party invite sent to <b>' + esc(f.name) + '</b>');
  $('[data-unfriend]', el).onclick = () => confirmDlg('Remove ' + f.name + '?',
    'They will stay in your recently played, but leave your friends list.', 'Remove',
    () => {
      X.friends = X.friends.filter(x => x.name !== f.name); saveFriends();
      friendDetail = null; renderFriends();
      toast('Removed <b>' + esc(f.name) + '</b>');
    });
}

/* ---------- SETTINGS ---------- */
let setTab = 'appearance';
function renderSettings() {
  const el = $('#screen-settings');
  const tabs = [['appearance', 'Appearance'], ['controller', 'Controller'], ['downloads', 'Downloads'], ['storage', 'Storage'], ['account', 'Account'], ['console', 'Console']];
  el.innerHTML = '<h2 class="row-title">Settings</h2><div class="set-wrap"><div class="set-nav">' +
    tabs.map(t => '<button data-focus data-stab="' + t[0] + '" class="' + (setTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') +
    '</div><div class="set-body" id="setBody"></div></div>';
  $$('[data-stab]', el).forEach(b => b.onclick = () => { setTab = b.dataset.stab; renderSettings(); });
  ({ appearance: setAppearance, controller: setController, downloads: setDownloads, storage: setStorage, account: setAccount, console: setConsole })[setTab]();
}

function setAppearance() {
  const b = $('#setBody');
  const hues = [[222, 'Blue'], [187, 'Cyan'], [280, 'Violet'], [160, 'Green'], [32, 'Orange'], [0, 'Red'], [330, 'Pink']];
  b.innerHTML =
    '<div class="set-card"><h3>Theme color</h3><div class="d">Recolors buttons, glows, tiles and the background stripes across the whole console.</div>' +
    '<div class="swatches">' + hues.map(h =>
      '<div class="swatch' + (X.settings.accentH === h[0] ? ' on' : '') + '" data-focus data-hue="' + h[0] + '" title="' + h[1] + '" style="background:hsl(' + h[0] + ',95%,55%)" tabindex="0"></div>').join('') + '</div></div>' +
    '<div class="set-card"><h3>Background stripes</h3><div class="d">How visible the animated stripes are behind everything.</div>' +
    '<div class="set-row"><div><div class="t">Stripe intensity</div></div>' +
    '<input type="range" min="0" max="150" value="' + Math.round(X.settings.stripeAlpha * 100) + '" data-focus data-stripe></div></div>' +
    '<div class="set-card"><h3>UI sounds</h3><div class="d">The little dings when you move around the console.</div>' +
    '<div class="set-row"><div><div class="t">Sound pack</div></div>' +
    '<select data-focus data-sounds>' + ['off', 'soft', 'retro'].map(s =>
      '<option value="' + s + '"' + (X.settings.sounds === s ? ' selected' : '') + '>' + s[0].toUpperCase() + s.slice(1) + '</option>').join('') + '</select></div></div>';
  $$('[data-hue]', b).forEach(s => { const pick = () => { X.settings.accentH = +s.dataset.hue; saveSettings(); applyAccent(); setAppearance(); blip('open'); }; s.onclick = pick; s.onkeydown = e => { if (e.key === 'Enter') pick(); }; });
  $('[data-stripe]', b).oninput = e => { X.settings.stripeAlpha = e.target.value / 100; saveSettings(); };
  $('[data-sounds]', b).onchange = e => { X.settings.sounds = e.target.value; saveSettings(); blip('open'); };
}

/* ----- controller settings: visual rebind ----- */
const PAD_BTN_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3'];
const ACTIONS = [
  ['confirm', 'Confirm', 'Select things, launch games'],
  ['back', 'Back', 'Go back, close windows'],
  ['options', 'Game options', 'Mini-window on a focused game (like ＋ on Switch)'],
];
function setController() {
  const b = $('#setBody');
  b.innerHTML =
    '<div class="set-card"><h3>Controller</h3><div class="d">Click a binding, then press the button you want. Everything here saves automatically.</div>' +
    '<div class="pad-visual"><svg class="pad-svg" viewBox="0 0 340 220">' +
    '<rect x="20" y="30" width="300" height="160" rx="70" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.14)"/>' +
    '<rect x="60" y="14" width="46" height="20" rx="8" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.14)"/>' +
    '<rect x="234" y="14" width="46" height="20" rx="8" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.14)"/>' +
    padBtn(3, 270, 62, 'Y') + padBtn(2, 236, 96, 'X') + padBtn(1, 304, 96, 'B') + padBtn(0, 270, 130, 'A') +
    '<circle data-padbtn="10" class="pad-btn" cx="112" cy="76" r="17" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)"/>' +
    '<circle data-padbtn="11" class="pad-btn" cx="196" cy="142" r="17" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)"/>' +
    '<g data-padbtn="12up"><rect x="62" y="88" width="16" height="44" rx="5" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)"/></g>' +
    '<g data-padbtn="12lf"><rect x="48" y="102" width="44" height="16" rx="5" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)"/></g>' +
    padBtn(8, 148, 92, '–') + padBtn(9, 192, 92, '+') +
    '<text x="170" y="205" text-anchor="middle" fill="#8b98b8" font-size="11">standard layout · test below</text></svg>' +
    '<div class="bind-table">' + ACTIONS.map(a =>
      '<div class="bind-row"><div class="act">' + a[1] + '<span class="k">' + a[2] + '</span></div>' +
      '<button class="keychip" data-focus data-bind="' + a[0] + '">' + PAD_BTN_NAMES[X.bindings[a[0]]] + '</button>' +
      '<button class="keychip" data-focus data-kbind="' + a[0] + '">' + esc(keyLabel(X.bindings['k' + a[0][0].toUpperCase() + a[0].slice(1)])) + '</button></div>').join('') +
    '</div></div></div>' +
    '<div class="set-card"><h3>Test area</h3><div class="d">Press buttons on your controller — they light up here.</div>' +
    '<div id="padTest" style="font-size:13px;color:var(--mut)">Waiting for input…</div></div>' +
    '<div class="set-card"><h3>Battery</h3><div class="set-row"><div><div class="t">Controller battery</div>' +
    '<div class="s">Low-battery warnings appear as console notifications.</div></div><b id="padBatt2">—</b></div></div>';
  function padBtn(i, x, y, label) {
    return '<g class="pad-btn" data-padbtn="' + i + '"><circle cx="' + x + '" cy="' + y + '" r="17" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)"/>' +
      '<text x="' + x + '" y="' + (y + 5) + '" text-anchor="middle" fill="#c3cfe8" font-size="13" font-weight="700">' + label + '</text></g>';
  }
  // highlight currently-bound buttons
  ACTIONS.forEach(a => {
    const gEl = b.querySelector('[data-padbtn="' + X.bindings[a[0]] + '"]');
    if (gEl) { gEl.style.stroke = 'var(--accent)'; }
  });
  // rebind capture
  $$('[data-bind]', b).forEach(chip => chip.onclick = () => {
    chip.textContent = 'press…'; chip.classList.add('cap');
    const h = setInterval(() => {
      const p = (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [])[0];
      if (!p) return;
      const i = p.buttons.findIndex(x => x.pressed);
      if (i >= 0 && i <= 11) {
        X.bindings[chip.dataset.bind] = i; saveBinds();
        clearInterval(h); setController(); toast('Binding saved');
      }
    }, 60);
    setTimeout(() => { clearInterval(h); if (chip.isConnected) setController(); }, 8000);
  });
  $$('[data-kbind]', b).forEach(chip => chip.onclick = () => {
    chip.textContent = 'press…'; chip.classList.add('cap');
    const key = 'k' + chip.dataset.kbind[0].toUpperCase() + chip.dataset.kbind.slice(1);
    const h = e => {
      e.preventDefault();
      X.bindings[key] = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      saveBinds(); document.removeEventListener('keydown', h, true); setController(); toast('Binding saved');
    };
    document.addEventListener('keydown', h, true);
    setTimeout(() => document.removeEventListener('keydown', h, true), 8000);
  });
  // live test
  const test = $('#padTest', b);
  const batt = $('#padBatt2', b);
  const iv = setInterval(() => {
    if (!document.contains(b)) { clearInterval(iv); return; }
    const p = (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [])[0];
    if (!p) { test.textContent = 'No controller detected.'; batt.textContent = '—'; return; }
    const pressed = p.buttons.map((x, i) => x.pressed ? (PAD_BTN_NAMES[i] || 'btn' + i) : null).filter(Boolean);
    test.innerHTML = pressed.length ? 'Pressed: <b style="color:var(--accent)">' + pressed.join(' + ') + '</b>' : 'Waiting for input…';
    batt.textContent = 'Connected ●';
    $$('.pad-btn', b).forEach(gEl => {
      const i = +gEl.dataset.padbtn;
      gEl.classList.toggle('lit', !!(p.buttons[i] && p.buttons[i].pressed));
    });
  }, 120);
}
function keyLabel(k) {
  if (k === ' ') return 'Space';
  return k.length === 1 ? k.toUpperCase() : k;
}

function setDownloads() {
  const b = $('#setBody');
  const bw = X.settings.bandwidth;
  b.innerHTML =
    '<div class="set-card"><h3>Background downloads</h3><div class="d">Downloads keep going while you play. Cap the speed so your game never lags.</div>' +
    '<div class="set-row"><div><div class="t">Bandwidth limit</div><div class="s">Applies while a game is running. 0 = unlimited.</div></div>' +
    '<div style="display:flex;align-items:center;gap:10px"><input type="range" min="0" max="100" step="5" value="' + bw + '" data-focus data-bw><b data-bwlab style="min-width:64px;text-align:right">' + (bw ? bw + ' Mbps' : 'Unlimited') + '</b></div></div>' +
    '<div class="set-row"><div><div class="t">Overnight auto-updates</div><div class="s">Install game updates between 12:00 AM and 8:00 AM.</div></div>' +
    '<button class="toggle' + (X.settings.autoUpdate ? ' on' : '') + '" data-focus data-au aria-label="auto updates"></button></div></div>' +
    '<div class="set-card"><h3>Queue</h3><div class="d">Active and queued downloads live in the dock, bottom-right.</div>' +
    '<div class="set-row"><div><div class="t">Downloads right now</div></div><b>' + Object.keys(X.downloads).length + '</b></div></div>';
  $('[data-bw]', b).oninput = e => {
    X.settings.bandwidth = +e.target.value; saveSettings();
    $('[data-bwlab]', b).textContent = X.settings.bandwidth ? X.settings.bandwidth + ' Mbps' : 'Unlimited';
  };
  $('[data-au]', b).onclick = e => { X.settings.autoUpdate = !X.settings.autoUpdate; saveSettings(); e.target.classList.toggle('on', X.settings.autoUpdate); };
}

function setStorage() {
  const b = $('#setBody');
  const inst = X.games.filter(g => g.installed).sort((a, c) => c.sizeMB - a.sizeMB);
  const usedMB = Math.round((X.usedBytes || 0) / 1048576);
  b.innerHTML = '<div class="set-card"><h3>Storage manager</h3><div class="d"><b style="color:var(--txt)">' + fmtSize(usedMB) + '</b> used · ' +
    fmtSize(512 * 1024 - usedMB) + ' free. Uninstall anything to get space back instantly.</div>' +
    inst.map(g => '<div class="set-row"><div><div class="t"><span class="row-ic">' + iconHTML(g) + '</span>' + esc(g.name) + '</div><div class="s">v' + esc(g.version) + ' · ' + fmtSize(g.sizeMB) + '</div></div>' +
      '<button class="btn ghost sm" data-focus data-uninst="' + g.id + '">Uninstall</button></div>').join('') +
    (inst.length ? '' : '<div class="empty-row">Nothing installed — everything lives in the cloud.</div>') + '</div>';
  $$('[data-uninst]', b).forEach(x => x.onclick = () => {
    const g = X.games.find(y => y.id === x.dataset.uninst);
    uninstallGame(g); setTimeout(setStorage, 50);
  });
}

function setAccount() {
  const b = $('#setBody');
  b.innerHTML =
    '<div class="set-card"><h3>Profile</h3><div class="set-row"><div><div class="t">' + esc(X.user.name) + '</div>' +
    '<div class="s">' + esc(X.user.email) + '</div></div><button class="btn ghost sm" data-focus data-signout>Sign out</button></div></div>' +
    '<div class="set-card"><h3>Sub-accounts</h3><div class="d">Extra accounts on this console that don\'t need their own email. They share your library with family sharing.</div>' +
    '<div class="set-row"><div><div class="t">No sub-accounts yet</div></div><button class="btn ghost sm" data-focus data-sub>Create one</button></div></div>';
  $('[data-signout]', b).onclick = () => confirmDlg('Sign out?', 'Return to the login screen?', 'Sign out', () => location.reload());
  $('[data-sub]', b).onclick = () => {
    const w = modal('<h3>New sub-account</h3><p style="margin-bottom:12px">Pick a display name — no email needed.</p>' +
      '<input id="subName" placeholder="Display name" data-focus style="width:100%;background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:10px;padding:11px 14px;color:var(--txt)">' +
      '<div class="mrow"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Create</button></div>');
    $('[data-x]', w).onclick = () => w.remove();
    $('[data-ok]', w).onclick = () => { w.remove(); toast('Sub-account <b>' + esc($('#subName') ? 'created' : '') + '</b> ready'); };
  };
}

/* ----- console self-updates (PC app only) ----- */
const cuState = { version: '', status: 'idle', avail: '', progress: 0, error: '' };
function setConsole() {
  const b = $('#setBody');
  const pc = window.OlympusXPC;
  if (!pc) {
    b.innerHTML =
      '<div class="set-card"><h3>Console updates</h3><div class="d">You\'re running the web preview. Console updates arrive automatically through the OlympusX app — download it once and it keeps itself updated, only pulling the changed pieces.</div></div>';
    return;
  }
  const st = cuState;
  let body = '';
  if (st.status === 'downloading') {
    body = '<div class="d">Downloading update… ' + st.progress + '%</div>' +
      '<div class="dl-item"><div class="bar"><i style="width:' + st.progress + '%"></i></div></div>';
  } else if (st.status === 'ready') {
    body = '<div class="d">Version <b>v' + esc(st.avail) + '</b> is downloaded and ready.</div>' +
      '<button class="btn primary" data-focus data-cu-restart>Restart to install</button>';
  } else if (st.status === 'checking') {
    body = '<div class="d">Checking for updates…</div>';
  } else {
    body = (st.error ? '<div class="d" style="color:#ff8ba0">' + esc(st.error) + '</div>' : '') +
      '<button class="btn ghost sm" data-focus data-cu-check>Check for updates</button>';
  }
  b.innerHTML =
    '<div class="set-card"><h3>Console</h3>' +
    '<div class="set-row"><div><div class="t">OlympusX</div><div class="s">Version ' + esc(st.version || '…') + '</div></div></div></div>' +
    '<div class="set-card"><h3>Updates</h3><div class="d">Updates download only the changed pieces — never the whole console again.</div>' + body + '</div>';
  if (!st.version) pc.appVersion().then(v => { st.version = 'v' + v; if (setTab === 'console') setConsole(); }).catch(() => {});
  const chk = $('[data-cu-check]', b);
  if (chk) chk.onclick = async () => {
    st.status = 'checking'; st.error = ''; setConsole();
    try {
      const r = await pc.updateCheck();
      if (!r.ok) { st.status = 'idle'; st.error = r.reason || 'Check failed'; }
      else if (r.updateAvailable) { st.avail = r.version; st.error = ''; startConsoleDownload(); return; }
      else { st.status = 'idle'; st.error = ''; toast('Console is <b>up to date</b>'); }
    } catch (e) { st.status = 'idle'; st.error = 'Check failed'; }
    setConsole();
  };
  const rst = $('[data-cu-restart]', b);
  if (rst) rst.onclick = async () => {
    try {
      const r = await pc.updateInstall();
      if (!r || !r.ok) { st.error = (r && r.reason) || 'Install failed'; setConsole(); }
    } catch (e) { st.error = 'Restart failed'; setConsole(); }
  };
}
async function startConsoleDownload() {
  const pc = window.OlympusXPC;
  if (!pc) return;
  cuState.status = 'downloading'; cuState.progress = 0;
  if (setTab === 'console') setConsole();
  try {
    const r = await pc.updateDownload();
    if (!r.ok) { cuState.status = 'idle'; cuState.error = r.reason || 'Download failed'; }
    else if (r.updateAvailable) { cuState.status = 'ready'; }
    else { cuState.status = 'idle'; toast('Console is <b>up to date</b>'); }
  } catch (e) { cuState.status = 'idle'; cuState.error = 'Download failed'; }
  if (setTab === 'console') setConsole();
}
// Silent launch check: nudge the player when a console update is waiting.
if (window.OlympusXPC) {
  window.OlympusXPC.onUpdateEvent(d => {
    if (!d) return;
    if (d.type === 'download-progress' && cuState.status === 'downloading') {
      cuState.progress = d.percent;
      const bar = document.querySelector('#setBody .dl-item .bar i');
      if (bar) bar.style.width = d.percent + '%';
      const lab = document.querySelector('#setBody .set-card .d');
      if (lab && setTab === 'console') lab.textContent = 'Downloading update… ' + d.percent + '%';
    } else if (d.type === 'update-available') {
      toast('Console update <b>v' + esc(d.version) + '</b> ready — see Settings → Console');
    } else if (d.type === 'update-downloaded') {
      cuState.status = 'ready'; cuState.avail = d.version;
      if (setTab === 'console') setConsole();
      else toast('Console update <b>v' + esc(d.version) + '</b> downloaded — restart from Settings → Console');
    } else if (d.type === 'error') {
      if (cuState.status === 'downloading' || cuState.status === 'checking') { cuState.status = 'idle'; cuState.error = d.message; if (setTab === 'console') setConsole(); }
    }
  });
}

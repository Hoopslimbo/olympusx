const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const updater = require('./updater');

let mainWin = null;
let stagedUpdate = null; // { version, stage } after a successful download

function sendUpdate(data) {
  try {
    if (mainWin && !mainWin.isDestroyed() && mainWin.webContents && !mainWin.webContents.isDestroyed()) {
      mainWin.webContents.send('oxx-update', data);
    }
  } catch (e) {}
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070d',
    title: 'OlympusX',
    icon: path.join(__dirname, '..', 'assets', 'olympusx-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWin = win;
  win.on('closed', () => { if (mainWin === win) mainWin = null; });
  // Automated-test hook: only active when OX_TEST_FILE is set (never in production).
  if (process.env.OX_TEST_FILE) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 4000));
      try {
        const fn = require(process.env.OX_TEST_FILE);
        const out = await fn(win);
        console.log('OX_TEST_RESULT:' + JSON.stringify(out));
      } catch (e) { console.log('OX_TEST_RESULT:ERROR:' + String(e && e.message).slice(0, 300)); }
      app.exit(0);
    });
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'audioCapture');
  });
  createWindow();
  // Silent check on launch: the console surface tells the player if one is ready.
  setTimeout(async () => {
    try {
      const r = await updater.checkForUpdates(app.getVersion());
      if (r.updateAvailable) sendUpdate({ type: 'update-available', version: r.version });
    } catch (e) {}
  }, 8000);
});

ipcMain.on('olympusx-quit', () => app.quit());
ipcMain.on('olympusx-open-external', (e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// Console self-update IPC. Delta chunks from the update feed (GitHub
// releases in production, OX_FEED_BASE override for tests).
ipcMain.handle('oxx-app-version', () => app.getVersion());
ipcMain.handle('oxx-update-check', async () => {
  try {
    const r = await updater.checkForUpdates(app.getVersion());
    return { ok: true, updateAvailable: r.updateAvailable, version: r.version };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 200) }; }
});
ipcMain.handle('oxx-update-download', async () => {
  try {
    const r = await updater.downloadUpdate(app.getVersion(), p => {
      sendUpdate({ type: 'download-progress', percent: Math.round(p * 100) });
    });
    if (!r.updateAvailable) return { ok: true, updateAvailable: false };
    stagedUpdate = { version: r.version, stage: r.stage };
    sendUpdate({ type: 'update-downloaded', version: r.version, chunks: r.chunkCount });
    return { ok: true, updateAvailable: true, version: r.version, chunks: r.chunkCount };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 200) }; }
});
ipcMain.handle('oxx-update-install', async () => {
  try {
    if (!stagedUpdate) return { ok: false, reason: 'nothing staged' };
    const version = updater.installUpdate(stagedUpdate.stage);
    stagedUpdate = null;
    sendUpdate({ type: 'update-installed', version });
    if (app.isPackaged) {
      app.relaunch(); app.exit(0);
    } else {
      // Dev/unpackaged: files were swapped in place, just reload.
      if (mainWin && !mainWin.isDestroyed()) mainWin.reload();
    }
    return { ok: true, version };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, 200) }; }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Bridge between the OlympusX console page and the native PC shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OlympusXPC', {
  platform: process.platform,
  isPCApp: true,
  quit: () => ipcRenderer.send('olympusx-quit'),
  openExternal: (url) => ipcRenderer.send('olympusx-open-external', url),
  // Console self-updater bridge (delta chunks, no full redownloads).
  appVersion: () => ipcRenderer.invoke('oxx-app-version'),
  updateCheck: () => ipcRenderer.invoke('oxx-update-check'),
  updateDownload: () => ipcRenderer.invoke('oxx-update-download'),
  updateInstall: () => ipcRenderer.invoke('oxx-update-install'),
  onUpdateEvent: (cb) => ipcRenderer.on('oxx-update', (_e, data) => cb(data))
});

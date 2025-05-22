const { contextBridge, ipcRenderer } = require('electron');

// Expose les APIs nécessaires au renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getUserFolders: () => ipcRenderer.invoke('getUserFolders'),
  changeUserFolders: () => ipcRenderer.invoke('changeUserFolders'),
  onLog: (callback) => ipcRenderer.on('log', (_event, value) => callback(value)),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('saveConfig', config),
  
  // Pour l'UI :
  onPendingCount: (callback) => ipcRenderer.on('pending-count', (_event, count) => callback(count)),
  forceScan: () => ipcRenderer.invoke('forceScan'),
  toggleService: () => ipcRenderer.invoke('toggleService'),
  addImageToHotfolder: (filePath) => ipcRenderer.invoke('addImageToHotfolder', filePath)
});
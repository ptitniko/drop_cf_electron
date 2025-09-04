// === DEPENDANCES NUCLEAIRES ===
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs-extra");

// === MODULES DE L'APPLICATION (Refacto) ===
const settingsUtils = require('./main/settings');
const hotfolder = require('./main/hotfolder');
const server = require('./main/server');
const watcherUtils = require('./main/watcher');
const { autoUpdater } = require('electron-updater');
const { initializeManagers, timeoutManager, processingPoller } = require('./main/hotfolder');

// === CHEMIN VERS LES PARAMETRES PERSISTANTS ===
const settingsPath = path.join(app.getPath("userData"), "settings.json");

// === VARIABLES D'ETAT ===
let settings = settingsUtils.loadSettings(settingsPath);
let mainWindow = null;
let watcher = null; // Instance Chokidar active
let serviceRunning = true; // Etat du service (hotfolder actif)

// === LOGS UI (utilisé partout) ===
function sendLog(log) {
  if (mainWindow) mainWindow.webContents.send("log", log);
}

// === FONCTION POUR METTRE À JOUR LE COMPTEUR D'IMAGES EN ATTENTE ===
function updatePendingCount() {
  if (settings?.folders?.HOTFOLDER) {
    fs.readdir(settings.folders.HOTFOLDER, (err, files) => {
      if (!mainWindow) return;
      if (err) return mainWindow.webContents.send('pending-count', 0);
      const count = files.filter(f =>
        ['.jpg', '.jpeg', '.png', '.tif', '.tiff'].includes(path.extname(f).toLowerCase())
      ).length;
      mainWindow.webContents.send('pending-count', count);
    });
  }
}

// === FONCTION DE LANCEMENT/RELANCE DU WATCHER ===
function startWatcher() {
  if (watcher) watcher.close();
  const hotfolderPath = settings.folders.HOTFOLDER;
  
  // Initialiser les managers de robustesse
  initializeManagers(settings, sendLog);
  sendLog('🛡️ Managers de robustesse initialisés');
  
  watcher = watcherUtils.startWatcher(
    hotfolderPath,
    settings,
    sendLog,
    updatePendingCount,
    watcher
  );
  if (watcher && watcher.scanNow) {
    watcher.scanNow(); // 🔍 Scan immédiat au lancement
  }
}

// === INITIALISATION ELECTRON ===
app.whenReady().then(async () => {
  // --- (1) MISE À JOUR AUTO ---
  autoUpdater.on('update-available', () => {
    sendLog('🔄 Mise à jour disponible !');
  });
  autoUpdater.on('update-downloaded', () => {
    sendLog('✅ Mise à jour téléchargée. Elle sera appliquée au prochain redémarrage.');
  });
  autoUpdater.on('error', err => {
    sendLog('❌ Problème de mise à jour : ' + err);
  });
  autoUpdater.checkForUpdatesAndNotify();

  // --- (2) DOSSIERS & CONFIGURATION ---
  await settingsUtils.ensureFolders(settings, dialog, settingsPath);
  settingsUtils.ensureConfig(settings, settingsPath);

  // --- (3) CREATION FENÊTRE PRINCIPALE ---
  mainWindow = new BrowserWindow({
    width: 820,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // --- (4) LANCEMENT WATCHER + SERVEUR ---
  startWatcher();
  await server.startExpressServer(settings, sendLog, updatePendingCount);
  updatePendingCount();

  // --- (5) HANDLERS IPC POUR LE FRONTEND ---
  ipcMain.handle('getUserFolders', () => settings.folders);

  ipcMain.handle('changeUserFolders', async () => {
    const folders = await settingsUtils.promptForFolders(dialog);
    if (folders) {
      settings.folders = folders;
      settingsUtils.saveSettings(settingsPath, settings);
      Object.values(folders).filter(Boolean).forEach(p => fs.ensureDirSync(p));
      startWatcher();
      await server.startExpressServer(settings, sendLog, updatePendingCount);
      return folders;
    }
    return null;
  });

  ipcMain.handle('getConfig', () => settings.config || settingsUtils.getDefaultConfig());

  ipcMain.handle('saveConfig', async (event, config) => {
    settings.config = config;
    settingsUtils.saveSettings(settingsPath, settings);
    await server.startExpressServer(settings, sendLog, updatePendingCount);
    return config;
  });

  ipcMain.handle('forceScan', () => {
    sendLog('🔍 Scan manuel du hotfolder lancé.');
    if (watcher && watcher.scanNow) {
      watcher.scanNow();
    }
  });

  ipcMain.handle('toggleService', () => {
    serviceRunning = !serviceRunning;
    if (serviceRunning) {
      startWatcher();
      sendLog('▶️ Service démarré');
    } else {
      if (watcher) watcher.close();
      sendLog('⏸ Service arrêté');
    }
    return serviceRunning;
  });

  ipcMain.handle('addImageToHotfolder', async (_event, filePath) => {
    const dest = path.join(settings.folders.HOTFOLDER, path.basename(filePath));
    try {
      await fs.copy(filePath, dest, { overwrite: true });
      sendLog(`🖼️ Image ajoutée au hotfolder : ${dest}`);
      updatePendingCount();
      return true;
    } catch (err) {
      sendLog('❌ Erreur lors de la copie de l\'image : ' + err);
      return false;
    }
  });

  // === NOUVEAUX HANDLERS IPC POUR LE MONITORING ===
  ipcMain.handle('getHotfolderStats', () => {
    const stats = {
      watcher: watcher ? watcher.getStats() : null,
      timeout: timeoutManager ? timeoutManager.getStats() : null,
      polling: processingPoller ? processingPoller.getGlobalStats() : null
    };
    return stats;
  });

  ipcMain.handle('forceCleanup', () => {
    if (timeoutManager) {
      timeoutManager.cleanup();
      sendLog('🧹 Nettoyage forcé des timeouts effectué');
    }
    if (processingPoller) {
      processingPoller.stopAllPolling();
      sendLog('🛑 Tous les pollings arrêtés');
    }
    return true;
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

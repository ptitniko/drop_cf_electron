const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const express = require("express");
const chokidar = require("chokidar");
const axios = require("axios");
const cors = require("cors");
const { exiftool } = require("exiftool-vendored");
const { exec } = require("child_process");
const Jimp = require("jimp");
const stream = require('stream');
const { promisify } = require('util');
const finished = promisify(stream.finished);
const { autoUpdater } = require('electron-updater');

// --- CONFIGURATION --- //
const settingsPath = path.join(app.getPath("userData"), "settings.json");
let settings = {}; // { folders: {...}, config: {...} }
let mainWindow = null;

// --- GESTION DES PARAMÈTRES ET DOSSIERS --- //
function getDefaultConfig() {
  return {
    API_URL: "",
    WEBHOOK_PORT: 4000,
    LOCAL_URL: "http://localhost"
  };
}

function loadSettings() {
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } else {
    settings = {};
  }
}

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function promptForFolders() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Sélectionnez le dossier de travail principal",
    properties: ["openDirectory", "createDirectory"]
  });
  if (canceled || !filePaths[0]) return null;
  const root = filePaths[0];
  return {
    HOTFOLDER: path.join(root, "hotfolder"),
    PROCESSED: path.join(root, "processed"),
    ERROR: path.join(root, "error"),
    ORIGINALS: path.join(root, "originaux"),
    METADATA: path.join(root, "metadata"),
    ROOT: root
  };
}

async function ensureFolders() {
  if (!settings.folders) {
    settings.folders = await promptForFolders();
    if (!settings.folders) app.quit();
    saveSettings();
  }
  Object.values(settings.folders)
    .filter(Boolean)
    .forEach(p => fs.ensureDirSync(p));
}

function ensureConfig() {
  if (!settings.config) {
    settings.config = getDefaultConfig();
    saveSettings();
  }
}

// --- LOGS UI --- //
function sendLog(log) {
  if (mainWindow) mainWindow.webContents.send("log", log);
}

// --- MÉTIER : FONCTIONS DE TRAITEMENT --- //
const VALID_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];
let clientName = "Client";

async function restoreDPI(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") {
      const image = await Jimp.read(filePath);
      image._exif = image._exif || {};
      image._exif['pHYs'] = { x: 11811, y: 11811, units: 1 };
      await image.writeAsync(filePath);
      sendLog(`✅ DPI défini à 300 (pHYs) avec Jimp pour : ${filePath}`);
    } else {
      sendLog("ℹ️ Jimp ne peut pas définir le DPI sur ce format. Utilisez ExifTool si besoin.");
    }
  } catch (error) {
    sendLog("❌ Erreur lors de la mise à jour du DPI avec Jimp :" + error);
  }
}

async function extractXMP(filePath) {
  try {
    const baseName = path.parse(filePath).name;
    const metadataPath = path.join(settings.folders.METADATA, `${baseName}.json`);
    const metadata = await exiftool.read(filePath, ["-G1", "-api", "RequestAll=3"]);
    const xmpData = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => key.startsWith("XMP-ARISTID"))
    );
    clientName = xmpData["XMP-ARISTID:Xmp_ARISTIDclient"] || "Client";

    if (Object.keys(xmpData).length) {
      await fs.writeJson(metadataPath, xmpData, { spaces: 2 });
      sendLog(`✅ Métadonnées XMP sauvegardées : ${baseName}`);
    }
  } catch (error) {
    sendLog(`❌ Erreur extraction XMP : ${error}`);
  }
}

function applyXMPMetadata(filePath, metadataPath) {
  fs.readFile(metadataPath, "utf8", (err, data) => {
    if (err) {
      sendLog("❌ Erreur de lecture du fichier JSON :" + err);
      return;
    }
    let metadata;
    try {
      metadata = JSON.parse(data);
    } catch (parseError) {
      sendLog("❌ Erreur de parsing JSON :" + parseError);
      return;
    }
    const xmpArgs = Object.entries(metadata)
      .map(([key, value]) => `-"XMP-ARISTID:${key}=${value}"`)
      .join(" ");
    const exiftoolConfigPath = path.resolve(__dirname, "exiftool.cfg");
    const cmd = `exiftool -config "${exiftoolConfigPath}" -overwrite_original_in_place ${xmpArgs} "${filePath}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        sendLog("❌ Erreur lors de l'application des XMP :" + stderr);
        return;
      }
      fs.unlinkSync(metadataPath);
      sendLog("✅ Métadonnées appliquées avec succès :" + stdout);
    });
  });
}

async function processNewFile(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  if (!VALID_EXTENSIONS.includes(ext)) {
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    sendLog(`⚠️ Fichier non valide déplacé : ${fileName}`);
    return;
  }

  await extractXMP(filePath);
  const publicUrl = `${settings.config.LOCAL_URL}:${settings.config.WEBHOOK_PORT}/files/${encodeURIComponent(fileName)}`;

  const payload = {
    processings: [
      {
        client: clientName,
        customer: "Switch",
        forceGeneration: true,
        dataList: [{ context: {}, data: { fileUrl: publicUrl } }],
        actions: [{ key: "PHOTOROOM.REMOVE_BACKGROUND", settings: { format: "png" } }],
        webhook: {
          url: `${settings.config.LOCAL_URL}:${settings.config.WEBHOOK_PORT}/webhook`,
          method: "POST",
          headers: { "X-Original-Filename": encodeURIComponent(fileName) },
        },
        priority: 1,
        resultOptions: { preSignedUrls: true },
      },
    ],
  };

  try {
    await axios.post(settings.config.API_URL, payload, { headers: { "Content-Type": "application/json" } });
    sendLog(`🚀 Envoyé à l'API : ${fileName}`);
  } catch (error) {
    sendLog(`❌ Erreur API : ${error}`);
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
  }
}

// --- WATCHER HOTFOLDER & SERVEUR EXPRESS --- //
let watcher = null;
let expressApp = null;
let expressServer = null;

function startWatcher() {
  if (watcher) watcher.close();
  const hotfolderPath = settings.folders.HOTFOLDER;
  sendLog(`[Hotfolder] Surveillance du dossier : ${hotfolderPath}`);
  watcher = chokidar.watch(hotfolderPath, { persistent: true, ignoreInitial: true });
  watcher.on("add", processNewFile);
}

// Relance le serveur Express avec la nouvelle config (après changement de port ou dossier)
async function startExpressServer() {
  if (expressServer) {
    expressServer.close();
    expressServer = null;
    expressApp = null;
  }

  const HOTFOLDER = settings.folders.HOTFOLDER;
  const PROCESSED = settings.folders.PROCESSED;
  const METADATA = settings.folders.METADATA;

  const SERVER_PORT = settings.config.WEBHOOK_PORT || 4000;

  expressApp = express();
  expressApp.use(express.json({ type: ["application/json", "text/plain"] }));
  expressApp.use(cors());
  expressApp.use("/files", express.static(HOTFOLDER));

  expressApp.post('/webhook', async (req, res) => {
    const originalFileName = decodeURIComponent(req.headers['x-original-filename'] || '');
    if (!originalFileName) {
      sendLog('❌ Header X-Original-Filename manquant.');
      return res.status(400).send('Header X-Original-Filename manquant.');
    }
    const outputs = req.body.outputs;
    if (!outputs || !outputs[0] || outputs[0].status !== 'COMPLETED') {
      sendLog('❌ Traitement externe non complété ou outputs invalide.');
      return res.status(400).send('Traitement non complété ou outputs invalide.');
    }
    const processedFileUrl = outputs[0].preSignedUrls[0];
    if (!processedFileUrl) {
      sendLog('❌ preSignedUrl invalide ou manquante.');
      return res.status(400).send('preSignedUrl invalide ou manquante.');
    }
    const baseName = path.parse(originalFileName).name;
    const outputFilePath = path.join(PROCESSED, `${baseName}.png`);
    const metadataPath = path.join(METADATA, `${baseName}.json`);
    const originalFilePath = path.join(HOTFOLDER, originalFileName);

    try {
      const response = await axios.get(processedFileUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(outputFilePath);
      response.data.pipe(writer);
      await finished(writer);
      sendLog(`✅ Fichier téléchargé : ${baseName}.png`);

      if (await fs.pathExists(metadataPath)) {
        await applyXMPMetadata(outputFilePath, metadataPath);
        await restoreDPI(outputFilePath);
        sendLog(`✅ Métadonnées XMP appliquées à ${outputFilePath}`);
      } else {
        sendLog(`⚠️ Aucune métadonnée XMP trouvée pour ${baseName}`);
      }

      if (await fs.pathExists(originalFilePath)) {
        await fs.remove(originalFilePath);
        sendLog(`🗃️ Fichier original supprimé du hotfolder : ${originalFileName}`);
      } else {
        sendLog(`⚠️ Fichier original non trouvé pour suppression : ${originalFileName}`);
      }

      res.status(200).send('Webhook traité avec succès.');
    } catch (error) {
      sendLog(`❌ Erreur dans le webhook : ${error}`);
      res.status(500).send('Erreur traitement webhook.');
    }
  });

  expressServer = expressApp.listen(SERVER_PORT, () => {
    sendLog(`🚀 Serveur en écoute sur le port ${SERVER_PORT}`);
  });
}

// --- INITIALISATION ELECTRON --- //
app.whenReady().then(async () => {
  // Vérifie et lance la mise à jour (au tout début)
  autoUpdater.on('update-available', () => {
    sendLog('🔄 Mise à jour disponible !');
  });
  autoUpdater.on('update-downloaded', () => {
    sendLog('✅ Mise à jour téléchargée. Elle sera appliquée au prochain redémarrage.');
  });
  autoUpdater.on('error', err => {
    sendLog('❌ Problème de mise à jour : ' + err);
  });
  
  // Vérifie les mises à jour au lancement
  autoUpdater.checkForUpdatesAndNotify();

  // Puis toutes les 30 secondes
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 30 * 1000); 

  
  loadSettings();
  await ensureFolders();
  ensureConfig();

  // IPC pour l'UI
  ipcMain.handle('getUserFolders', () => settings.folders);
  ipcMain.handle('changeUserFolders', async () => {
    const folders = await promptForFolders();
    if (folders) {
      settings.folders = folders;
      saveSettings();
      Object.values(folders).filter(Boolean).forEach(p => fs.ensureDirSync(p));
      startWatcher();
      await startExpressServer();
      return folders;
    }
    return null;
  });
  ipcMain.handle('getConfig', () => settings.config || getDefaultConfig());
  ipcMain.handle('saveConfig', async (event, config) => {
    settings.config = config;
    saveSettings();
    await startExpressServer();
    return config;
  });

  // Création de la fenêtre principale
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

  // Lancer le watcher et le serveur
  startWatcher();
  await startExpressServer();
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
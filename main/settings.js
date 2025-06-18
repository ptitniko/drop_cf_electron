const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

/**
 * Configuration par défaut
 */
function getDefaultConfig() {
  return {
    API_URL: "",
    CLIENT: "CLIENT",
    LOCAL_URL: "CUSTOMER"
  };
}

/**
 * Charge les settings depuis un fichier
 */
function loadSettings(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }
  return {};
}

/**
 * Sauvegarde les settings dans un fichier
 */
function saveSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Prompt de sélection du dossier racine, propose Documents par défaut
 */
async function promptForFolders(dialog) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Sélectionnez le dossier de travail principal",
    defaultPath: app.getPath('documents'),
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

/**
 * Vérifie et crée les dossiers nécessaires
 */
async function ensureFolders(settings, dialog, settingsPath) {
  if (!settings.folders) {
    settings.folders = await promptForFolders(dialog);
    if (!settings.folders) process.exit(0);
    saveSettings(settingsPath, settings);
  }
  Object.values(settings.folders)
    .filter(Boolean)
    .forEach(p => fs.ensureDirSync(p));
}

/**
 * Initialise la config si absente
 */
function ensureConfig(settings, settingsPath) {
  if (!settings.config) {
    settings.config = getDefaultConfig();
    saveSettings(settingsPath, settings);
  }
}

module.exports = {
  getDefaultConfig,
  loadSettings,
  saveSettings,
  promptForFolders,
  ensureFolders,
  ensureConfig
};
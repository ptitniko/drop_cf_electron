const path = require('path');
const fs = require('fs-extra');

function getDefaultConfig() {
  return {
    API_URL: "",
    CLIENT: "CLIENT",
    LOCAL_URL: "CUSTOMER"
  };
}

function loadSettings(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }
  return {};
}

function saveSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function promptForFolders(dialog) {
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

async function ensureFolders(settings, dialog, settingsPath) {
  if (!settings.folders) {
    settings.folders = await promptForFolders(dialog);
    if (!settings.folders) process.exit(0); // app.quit() ne fonctionne pas encore ici
    saveSettings(settingsPath, settings);
  }
  Object.values(settings.folders)
    .filter(Boolean)
    .forEach(p => fs.ensureDirSync(p));
}

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
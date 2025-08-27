const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs-extra");
const { VALID_EXTENSIONS, processFileWithRetry } = require("./hotfolder");

function isValidFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

function startWatcher(folderPath, settings, sendLog, updatePendingCount, existingWatcher) {
  if (existingWatcher) existingWatcher.close();
  sendLog(`[Hotfolder] Surveillance du dossier : ${folderPath}`);
  const processingSet = new Set();
  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /[\\\/]metadata[\\\/]?/i
  });

  async function safeOnNewFile(filePath) {
    if (
      !filePath.match(/[\\\/]metadata[\\\/]?/i) &&
      isValidFile(filePath) &&
      !processingSet.has(filePath)
    ) {
      processingSet.add(filePath);
      try {
        await processFileWithRetry(filePath, settings, sendLog, updatePendingCount);
      } finally {
        processingSet.delete(filePath);
      }
    }
  }

  watcher.on("add", safeOnNewFile);

  // Fonction de scan à réutiliser
  async function scanHotfolderNow() {
    try {
      const files = await fs.readdir(folderPath);
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        if (
          file.toLowerCase() === "metadata" ||
          (await fs.stat(filePath)).isDirectory()
        ) {
          continue;
        }
        await safeOnNewFile(filePath);
      }
    } catch (e) {
      sendLog(`[Hotfolder] Erreur lors du scan périodique : ${e.message}`);
    }
  }

  // Scan périodique toutes les 30s
  const intervalId = setInterval(scanHotfolderNow, 30000);

  watcher.on("close", () => clearInterval(intervalId));

  // On expose la méthode de scan manuel
  watcher.scanNow = scanHotfolderNow;

  return watcher;
}

module.exports = {
  startWatcher
};
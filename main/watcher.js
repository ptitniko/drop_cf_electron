const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs-extra");

// Extensions valides à surveiller (adapte si besoin)
const VALID_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];

function isValidFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

/**
 * Lance ou relance le watcher sur le hotfolder.
 * Si un watcher existe déjà, il est fermé proprement.
 * Ajoute aussi un scan toutes les 30 secondes pour sécuriser.
 * @param {string} folderPath - Chemin du hotfolder à surveiller
 * @param {function} onNewFile - Callback à appeler pour chaque nouveau fichier
 * @param {function} sendLog - Pour afficher les logs
 * @param {object} [existingWatcher] - Instance Chokidar existante (optionnel)
 * @returns {object} - La nouvelle instance Chokidar
 */
function startWatcher(folderPath, onNewFile, sendLog, existingWatcher) {
  if (existingWatcher) existingWatcher.close();
  sendLog(`[Hotfolder] Surveillance du dossier : ${folderPath}`);

  // Pour éviter de traiter 2x le même fichier en simultané
  const processingSet = new Set();

  // EXCLUSION des sous-dossiers "metadata"
  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /[\\\/]metadata[\\\/]?/i // exclut le dossier metadata si présent
  });

  // Callback utilisé par watcher ET scan manuel
  async function safeOnNewFile(filePath) {
    // Exclut le dossier metadata et fichiers déjà en cours de traitement
    if (
      !filePath.match(/[\\\/]metadata[\\\/]?/i) &&
      isValidFile(filePath) &&
      !processingSet.has(filePath)
    ) {
      processingSet.add(filePath);
      try {
        await onNewFile(filePath);
      } finally {
        processingSet.delete(filePath);
      }
    }
  }

  watcher.on("add", safeOnNewFile);

  // Scan périodique toutes les 30s
  const intervalId = setInterval(async () => {
    try {
      const files = await fs.readdir(folderPath);
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        // Ignore metadata/ et dossiers
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
  }, 30000);

  // Assure un arrêt propre du scan si le watcher est fermé
  watcher.on("close", () => clearInterval(intervalId));

  return watcher;
}

module.exports = {
  startWatcher
};
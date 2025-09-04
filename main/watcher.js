const chokidar = require("chokidar");
const path = require("path");
const fs = require("fs-extra");
const { VALID_EXTENSIONS, processFileWithRetry } = require("./hotfolder");
const { FileStabilityChecker } = require("./file-stability");

function isValidFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return VALID_EXTENSIONS.includes(ext);
}

function startWatcher(folderPath, settings, sendLog, updatePendingCount, existingWatcher) {
  if (existingWatcher) existingWatcher.close();
  sendLog(`[Hotfolder] Surveillance du dossier : ${folderPath}`);
  const processingSet = new Set();
  const processingTimeouts = new Map(); // filePath -> timeout
  const stabilityChecker = new FileStabilityChecker();
  
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
      
      // Configurer un timeout de sécurité pour éviter les blocages
      const timeoutId = setTimeout(() => {
        sendLog(`⏰ Timeout de sécurité pour ${path.basename(filePath)}`);
        processingSet.delete(filePath);
        processingTimeouts.delete(filePath);
      }, parseInt(process.env.WATCHER_SAFETY_TIMEOUT) || (15 * 60 * 1000)); // 15 minutes par défaut
      
      processingTimeouts.set(filePath, timeoutId);
      
      try {
        // Vérifier la stabilité du fichier avant traitement
        const isReady = await stabilityChecker.checkFileReadiness(filePath, sendLog);
        
        if (isReady) {
          await processFileWithRetry(filePath, settings, sendLog, updatePendingCount);
        } else {
          sendLog(`⚠️ ${path.basename(filePath)} ignoré - fichier non stable`);
        }
      } catch (error) {
        sendLog(`❌ Erreur lors du traitement de ${path.basename(filePath)}: ${error.message}`);
      } finally {
        processingSet.delete(filePath);
        const timeoutId = processingTimeouts.get(filePath);
        if (timeoutId) {
          clearTimeout(timeoutId);
          processingTimeouts.delete(filePath);
        }
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

  watcher.on("close", () => {
    clearInterval(intervalId);
    // Nettoyer tous les timeouts en cours
    for (const timeoutId of processingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    processingTimeouts.clear();
  });

  // On expose la méthode de scan manuel
  watcher.scanNow = scanHotfolderNow;
  
  // Exposer les statistiques
  watcher.getStats = () => ({
    processingCount: processingSet.size,
    processingFiles: Array.from(processingSet).map(f => path.basename(f)),
    pendingTimeouts: processingTimeouts.size
  });

  return watcher;
}

module.exports = {
  startWatcher
};

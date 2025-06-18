const chokidar = require("chokidar");

/**
 * Lance ou relance le watcher sur le hotfolder.
 * Si un watcher existe déjà, il est fermé proprement.
 * @param {string} folderPath - Chemin du hotfolder à surveiller
 * @param {function} onNewFile - Callback à appeler pour chaque nouveau fichier
 * @param {function} sendLog - Pour afficher les logs
 * @param {object} [existingWatcher] - Instance Chokidar existante (optionnel)
 * @returns {object} - La nouvelle instance Chokidar
 */
function startWatcher(folderPath, onNewFile, sendLog, existingWatcher) {
  if (existingWatcher) existingWatcher.close();
  sendLog(`[Hotfolder] Surveillance du dossier : ${folderPath}`);
  // EXCLUSION des sous-dossiers "metadata" si jamais ils existaient dans le hotfolder
  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /[\\\/]metadata[\\\/]?/i // exclut le dossier metadata si présent par erreur
  });
  watcher.on("add", onNewFile);
  return watcher;
}

module.exports = {
  startWatcher
};
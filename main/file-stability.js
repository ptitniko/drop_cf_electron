const fs = require("fs-extra");
const path = require("path");

/**
 * Vérifie qu'un fichier est stable (taille constante) avant traitement
 */
class FileStabilityChecker {
  constructor(stabilityDuration = null, checkInterval = null) {
    // Utiliser les variables d'environnement si disponibles, sinon les valeurs par défaut
    this.stabilityDuration = stabilityDuration || 
      parseInt(process.env.FILE_STABILITY_DURATION) || 3000;
    this.checkInterval = checkInterval || 
      parseInt(process.env.FILE_STABILITY_CHECK_INTERVAL) || 1000;
    this.requiredStableChecks = Math.ceil(this.stabilityDuration / this.checkInterval);
  }

  /**
   * Attend que le fichier soit stable
   * @param {string} filePath - Chemin du fichier
   * @returns {Promise<boolean>} - true si stable, false si timeout/erreur
   */
  async waitForStability(filePath) {
    let lastSize = -1;
    let lastModified = 0;
    let stableCount = 0;
    const maxWaitTime = 30000; // 30 secondes max
    const startTime = Date.now();

    while (stableCount < this.requiredStableChecks) {
      try {
        // Vérifier si on a dépassé le temps max d'attente
        if (Date.now() - startTime > maxWaitTime) {
          throw new Error(`Timeout: fichier non stable après ${maxWaitTime}ms`);
        }

        const stats = await fs.stat(filePath);
        const currentSize = stats.size;
        const currentModified = stats.mtime.getTime();

        // Le fichier doit avoir une taille > 0 et être stable
        if (currentSize > 0 && 
            currentSize === lastSize && 
            currentModified === lastModified) {
          stableCount++;
        } else {
          stableCount = 0;
          lastSize = currentSize;
          lastModified = currentModified;
        }

        // Attendre avant la prochaine vérification
        await new Promise(resolve => setTimeout(resolve, this.checkInterval));

      } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`Fichier supprimé pendant la vérification: ${filePath}`);
        }
        throw new Error(`Erreur lors de la vérification de stabilité: ${error.message}`);
      }
    }

    return true;
  }

  /**
   * Vérifie si un fichier semble être en cours d'écriture
   * @param {string} filePath - Chemin du fichier
   * @returns {Promise<boolean>} - true si probablement en cours d'écriture
   */
  async isLikelyBeingWritten(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const now = Date.now();
      const fileAge = now - stats.mtime.getTime();
      
      // Si le fichier a été modifié il y a moins de 2 secondes, 
      // il est probablement encore en cours d'écriture
      return fileAge < 2000;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vérifie qu'un fichier n'est pas verrouillé par un autre processus
   * @param {string} filePath - Chemin du fichier
   * @returns {Promise<boolean>} - true si accessible
   */
  async isFileAccessible(filePath) {
    try {
      // Tenter d'ouvrir le fichier en lecture
      const fd = await fs.open(filePath, 'r');
      await fs.close(fd);
      return true;
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EACCES') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Vérification complète de la stabilité d'un fichier
   * @param {string} filePath - Chemin du fichier
   * @param {Function} sendLog - Fonction de log
   * @returns {Promise<boolean>} - true si le fichier est prêt pour traitement
   */
  async checkFileReadiness(filePath, sendLog) {
    const fileName = path.basename(filePath);
    
    try {
      sendLog(`🔍 Vérification de la stabilité de ${fileName}...`);

      // 1. Vérifier si le fichier semble être en cours d'écriture
      if (await this.isLikelyBeingWritten(filePath)) {
        sendLog(`⏳ ${fileName} semble être en cours d'écriture, attente...`);
      }

      // 2. Vérifier l'accessibilité
      if (!(await this.isFileAccessible(filePath))) {
        throw new Error(`Fichier verrouillé ou inaccessible`);
      }

      // 3. Attendre la stabilité
      await this.waitForStability(filePath);
      
      sendLog(`✅ ${fileName} est stable et prêt pour traitement`);
      return true;

    } catch (error) {
      sendLog(`❌ ${fileName} non prêt: ${error.message}`);
      return false;
    }
  }
}

module.exports = {
  FileStabilityChecker
};

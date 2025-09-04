const fs = require("fs-extra");
const path = require("path");

/**
 * Gère les timeouts globaux pour éviter les traitements infinis
 */
class ProcessingTimeoutManager {
  constructor(maxProcessingTime = null) {
    // Utiliser les variables d'environnement si disponibles, sinon la valeur par défaut
    this.maxProcessingTime = maxProcessingTime || 
      parseInt(process.env.PROCESSING_TIMEOUT) || (10 * 60 * 1000); // 10 minutes par défaut
    this.activeProcessings = new Map();
    this.settings = null;
    this.sendLog = null;
  }

  /**
   * Initialise le manager avec les settings et la fonction de log
   */
  initialize(settings, sendLog) {
    this.settings = settings;
    this.sendLog = sendLog;
  }

  /**
   * Démarre le suivi d'un traitement
   * @param {string} processingId - ID unique du traitement
   * @param {string} filePath - Chemin du fichier en cours de traitement
   * @param {string} originalFilePath - Chemin original du fichier
   */
  startTracking(processingId, filePath, originalFilePath = null) {
    const timeout = setTimeout(() => {
      this.handleTimeout(processingId, filePath, originalFilePath);
    }, this.maxProcessingTime);

    this.activeProcessings.set(processingId, {
      timeout,
      filePath,
      originalFilePath: originalFilePath || filePath,
      startTime: Date.now()
    });

    if (this.sendLog) {
      this.sendLog(`⏱️ Timeout configuré pour ${path.basename(filePath)} (${this.maxProcessingTime / 1000}s)`);
    }
  }

  /**
   * Arrête le suivi d'un traitement (succès)
   * @param {string} processingId - ID du traitement
   */
  completeTracking(processingId) {
    const processing = this.activeProcessings.get(processingId);
    if (processing) {
      clearTimeout(processing.timeout);
      this.activeProcessings.delete(processingId);
      
      const duration = Date.now() - processing.startTime;
      if (this.sendLog) {
        this.sendLog(`✅ Traitement terminé en ${Math.round(duration / 1000)}s`);
      }
    }
  }

  /**
   * Gère le timeout d'un traitement
   * @param {string} processingId - ID du traitement
   * @param {string} filePath - Chemin du fichier
   * @param {string} originalFilePath - Chemin original du fichier
   */
  async handleTimeout(processingId, filePath, originalFilePath) {
    const processing = this.activeProcessings.get(processingId);
    if (!processing) return;

    const fileName = path.basename(originalFilePath);
    const duration = Math.round((Date.now() - processing.startTime) / 1000);

    if (this.sendLog) {
      this.sendLog(`⏰ TIMEOUT: ${fileName} bloqué depuis ${duration}s (ID: ${processingId})`);
    }

    try {
      // Déplacer le fichier vers le dossier ERROR s'il existe encore
      if (this.settings && this.settings.folders && this.settings.folders.ERROR) {
        if (await fs.pathExists(originalFilePath)) {
          const errorPath = path.join(this.settings.folders.ERROR, fileName);
          await fs.move(originalFilePath, errorPath, { overwrite: true });
          
          if (this.sendLog) {
            this.sendLog(`📁 ${fileName} déplacé vers ERROR à cause du timeout`);
          }
        }
      }
    } catch (error) {
      if (this.sendLog) {
        this.sendLog(`❌ Erreur lors du déplacement après timeout: ${error.message}`);
      }
    }

    // Nettoyer le suivi
    this.activeProcessings.delete(processingId);
  }

  /**
   * Obtient les statistiques des traitements en cours
   * @returns {Object} Statistiques
   */
  getStats() {
    const now = Date.now();
    const processings = Array.from(this.activeProcessings.values());
    
    return {
      activeCount: processings.length,
      averageDuration: processings.length > 0 
        ? Math.round(processings.reduce((sum, p) => sum + (now - p.startTime), 0) / processings.length / 1000)
        : 0,
      oldestProcessing: processings.length > 0
        ? Math.round(Math.max(...processings.map(p => now - p.startTime)) / 1000)
        : 0,
      processingList: processings.map(p => ({
        filePath: path.basename(p.filePath),
        duration: Math.round((now - p.startTime) / 1000)
      }))
    };
  }

  /**
   * Force l'arrêt de tous les traitements en cours
   */
  forceStopAll() {
    const count = this.activeProcessings.size;
    
    for (const [processingId, processing] of this.activeProcessings) {
      clearTimeout(processing.timeout);
    }
    
    this.activeProcessings.clear();
    
    if (this.sendLog && count > 0) {
      this.sendLog(`🛑 ${count} traitement(s) forcé(s) à s'arrêter`);
    }
  }

  /**
   * Nettoie les traitements orphelins (sans timeout actif)
   */
  cleanup() {
    const toRemove = [];
    
    for (const [processingId, processing] of this.activeProcessings) {
      // Si le timeout n'existe plus, c'est un orphelin
      if (!processing.timeout._destroyed === false) {
        toRemove.push(processingId);
      }
    }
    
    toRemove.forEach(id => this.activeProcessings.delete(id));
    
    if (this.sendLog && toRemove.length > 0) {
      this.sendLog(`🧹 ${toRemove.length} traitement(s) orphelin(s) nettoyé(s)`);
    }
  }
}

module.exports = {
  ProcessingTimeoutManager
};

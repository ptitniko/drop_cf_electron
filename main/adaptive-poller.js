/**
 * Système de polling adaptatif avec backoff intelligent
 */
class AdaptivePoller {
  constructor(baseInterval = null, maxInterval = null, backoffMultiplier = 2) {
    // Utiliser les variables d'environnement si disponibles, sinon les valeurs par défaut
    this.baseInterval = baseInterval || 
      parseInt(process.env.POLLING_BASE_INTERVAL) || 5000;
    this.maxInterval = maxInterval || 
      parseInt(process.env.POLLING_MAX_INTERVAL) || 60000;
    this.backoffMultiplier = backoffMultiplier;
    this.currentInterval = this.baseInterval;
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses = 0;
    this.totalPolls = 0;
    this.totalErrors = 0;
    this.startTime = Date.now();
  }

  /**
   * Calcule le prochain intervalle de polling
   * @returns {number} Intervalle en millisecondes
   */
  getNextInterval() {
    if (this.consecutiveErrors > 0) {
      // Exponential backoff en cas d'erreurs consécutives
      this.currentInterval = Math.min(
        this.baseInterval * Math.pow(this.backoffMultiplier, this.consecutiveErrors),
        this.maxInterval
      );
    } else if (this.consecutiveSuccesses >= 3) {
      // Réduction progressive de l'intervalle après plusieurs succès
      this.currentInterval = Math.max(
        this.currentInterval * 0.8,
        this.baseInterval
      );
    }
    
    return this.currentInterval;
  }

  /**
   * Enregistre un succès de polling
   */
  onSuccess() {
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses++;
    this.totalPolls++;
  }

  /**
   * Enregistre une erreur de polling
   */
  onError() {
    this.consecutiveErrors++;
    this.consecutiveSuccesses = 0;
    this.totalPolls++;
    this.totalErrors++;
  }

  /**
   * Obtient les statistiques du polling
   * @returns {Object} Statistiques
   */
  getStats() {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.totalPolls > 0 ? (this.totalErrors / this.totalPolls) * 100 : 0;
    
    return {
      currentInterval: this.currentInterval,
      consecutiveErrors: this.consecutiveErrors,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalPolls: this.totalPolls,
      totalErrors: this.totalErrors,
      errorRate: Math.round(errorRate * 100) / 100,
      uptime: Math.round(uptime / 1000),
      status: this.getHealthStatus()
    };
  }

  /**
   * Détermine l'état de santé du polling
   * @returns {string} Status: HEALTHY, WARNING, CRITICAL
   */
  getHealthStatus() {
    if (this.consecutiveErrors >= 5) return 'CRITICAL';
    if (this.consecutiveErrors >= 2) return 'WARNING';
    if (this.totalPolls > 0 && (this.totalErrors / this.totalPolls) > 0.2) return 'WARNING';
    return 'HEALTHY';
  }

  /**
   * Remet à zéro les statistiques
   */
  reset() {
    this.consecutiveErrors = 0;
    this.consecutiveSuccesses = 0;
    this.totalPolls = 0;
    this.totalErrors = 0;
    this.currentInterval = this.baseInterval;
    this.startTime = Date.now();
  }

  /**
   * Détermine si le polling doit continuer basé sur les erreurs
   * @param {number} maxConsecutiveErrors - Nombre max d'erreurs consécutives
   * @returns {boolean} true si doit continuer
   */
  shouldContinue(maxConsecutiveErrors = 10) {
    return this.consecutiveErrors < maxConsecutiveErrors;
  }
}

/**
 * Gestionnaire de polling pour les traitements avec retry intelligent
 */
class ProcessingPoller {
  constructor(apiUrl, sendLog) {
    this.apiUrl = apiUrl;
    this.sendLog = sendLog;
    this.activePollers = new Map(); // processingId -> AdaptivePoller
  }

  /**
   * Démarre le polling pour un traitement
   * @param {string} processingId - ID du traitement
   * @param {Function} onComplete - Callback appelé quand terminé
   * @param {Function} onError - Callback appelé en cas d'erreur fatale
   * @returns {Promise} Promise qui se résout quand le polling est terminé
   */
  async startPolling(processingId, onComplete, onError) {
    const poller = new AdaptivePoller(5000, 60000); // 5s à 60s
    this.activePollers.set(processingId, poller);

    try {
      while (poller.shouldContinue()) {
        const interval = poller.getNextInterval();
        
        // Attendre avant le prochain poll
        await new Promise(resolve => setTimeout(resolve, interval));

        try {
          const axios = require('axios');
          const response = await axios.get(
            `${this.apiUrl.replace(/\/$/, "")}/api/processings/${processingId}/result`,
            { timeout: 30000 } // 30s timeout
          );

          poller.onSuccess();
          const data = response.data;
          
          if (this.sendLog) {
            const stats = poller.getStats();
            this.sendLog(`🔄 [Poll ${stats.totalPolls}] Status: ${JSON.stringify(data.outputs?.[0]?.status)} (interval: ${interval}ms)`);
          }

          // Vérifier si terminé
          if (data.outputs?.[0]?.status === "COMPLETED") {
            await onComplete(data);
            break;
          }

          if (data.outputs?.[0]?.status === "FAILED") {
            throw new Error("Traitement échoué côté API");
          }

        } catch (error) {
          poller.onError();
          
          if (this.sendLog) {
            const stats = poller.getStats();
            this.sendLog(`⚠️ Erreur polling [${stats.consecutiveErrors}/${stats.totalErrors}]: ${error.message}`);
          }

          // Si trop d'erreurs consécutives, abandonner
          if (!poller.shouldContinue()) {
            throw new Error(`Trop d'erreurs de polling consécutives (${poller.consecutiveErrors})`);
          }
        }
      }
    } catch (error) {
      await onError(error);
    } finally {
      this.activePollers.delete(processingId);
    }
  }

  /**
   * Arrête le polling pour un traitement spécifique
   * @param {string} processingId - ID du traitement
   */
  stopPolling(processingId) {
    this.activePollers.delete(processingId);
  }

  /**
   * Arrête tous les pollings en cours
   */
  stopAllPolling() {
    this.activePollers.clear();
    if (this.sendLog) {
      this.sendLog(`🛑 Tous les pollings arrêtés`);
    }
  }

  /**
   * Obtient les statistiques de tous les pollings actifs
   * @returns {Object} Statistiques globales
   */
  getGlobalStats() {
    const pollers = Array.from(this.activePollers.values());
    
    if (pollers.length === 0) {
      return { activePollers: 0, status: 'IDLE' };
    }

    const stats = pollers.map(p => p.getStats());
    const totalErrors = stats.reduce((sum, s) => sum + s.totalErrors, 0);
    const totalPolls = stats.reduce((sum, s) => sum + s.totalPolls, 0);
    const criticalCount = stats.filter(s => s.status === 'CRITICAL').length;
    const warningCount = stats.filter(s => s.status === 'WARNING').length;

    return {
      activePollers: pollers.length,
      totalPolls,
      totalErrors,
      globalErrorRate: totalPolls > 0 ? Math.round((totalErrors / totalPolls) * 10000) / 100 : 0,
      criticalPollers: criticalCount,
      warningPollers: warningCount,
      status: criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'HEALTHY',
      averageInterval: Math.round(stats.reduce((sum, s) => sum + s.currentInterval, 0) / stats.length)
    };
  }
}

module.exports = {
  AdaptivePoller,
  ProcessingPoller
};

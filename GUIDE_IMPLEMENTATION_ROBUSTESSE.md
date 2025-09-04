# Guide d'Implémentation des Améliorations de Robustesse

## Résumé des Améliorations Implémentées

### ✅ Phase 1 - Stabilité Immédiate (TERMINÉE)

1. **Vérification de Stabilité des Fichiers** (`main/file-stability.js`)
   - Vérification que les fichiers sont complètement écrits avant traitement
   - Détection des fichiers en cours d'écriture
   - Vérification de l'accessibilité des fichiers
   - Timeout de sécurité pour éviter les attentes infinies

2. **Système de Timeout Global** (`main/processing-timeout.js`)
   - Timeout de 10 minutes par défaut pour chaque traitement
   - Déplacement automatique vers ERROR en cas de timeout
   - Suivi des traitements actifs avec statistiques
   - Nettoyage automatique des processus orphelins

3. **Polling Adaptatif** (`main/adaptive-poller.js`)
   - Backoff exponentiel en cas d'erreurs
   - Réduction progressive de l'intervalle après succès
   - Statistiques détaillées du polling
   - Abandon intelligent après trop d'erreurs consécutives

4. **Intégration dans le Watcher** (`main/watcher.js`)
   - Vérification de stabilité avant traitement
   - Timeout de sécurité de 15 minutes par fichier
   - Statistiques des traitements en cours
   - Nettoyage automatique des timeouts

5. **Intégration dans Hotfolder** (`main/hotfolder.js`)
   - Initialisation automatique des managers
   - Export des instances pour monitoring externe

## Prochaines Étapes d'Implémentation

### Phase 2 - Intégration Complète

#### 1. Modifier `main.js` pour utiliser les nouvelles fonctionnalités

```javascript
// Ajouter après les imports existants
const { initializeManagers, timeoutManager, processingPoller } = require('./main/hotfolder');

// Dans la fonction startWatcher(), ajouter :
function startWatcher() {
  if (watcher) watcher.close();
  const hotfolderPath = settings.folders.HOTFOLDER;
  
  // Initialiser les managers de robustesse
  initializeManagers(settings, sendLog);
  
  watcher = watcherUtils.startWatcher(
    hotfolderPath,
    settings,
    sendLog,
    updatePendingCount,
    watcher
  );
  
  if (watcher && watcher.scanNow) {
    watcher.scanNow();
  }
}

// Ajouter de nouveaux handlers IPC pour le monitoring
ipcMain.handle('getHotfolderStats', () => {
  const stats = {
    watcher: watcher ? watcher.getStats() : null,
    timeout: timeoutManager ? timeoutManager.getStats() : null,
    polling: processingPoller ? processingPoller.getGlobalStats() : null
  };
  return stats;
});

ipcMain.handle('forceCleanup', () => {
  if (timeoutManager) {
    timeoutManager.cleanup();
    sendLog('🧹 Nettoyage forcé des timeouts effectué');
  }
  if (processingPoller) {
    processingPoller.stopAllPolling();
    sendLog('🛑 Tous les pollings arrêtés');
  }
  return true;
});
```

#### 2. Remplacer la fonction `pollProcessingResult` dans `hotfolder.js`

```javascript
async function pollProcessingResult(processingId, originalFilePath, fileName, settings, sendLog, updatePendingCount, aristidMetadata) {
  const PROCESSED = settings.folders.PROCESSED;
  
  // Démarrer le suivi du timeout
  if (timeoutManager) {
    timeoutManager.startTracking(processingId, fileName, originalFilePath);
  }
  
  sendLog(`⏳ Suivi du processing avec polling adaptatif (ID: ${processingId})...`);
  
  try {
    await processingPoller.startPolling(
      processingId,
      // Callback de succès
      async (data) => {
        const preSignedUrls = data.outputs[0].preSignedUrls;
        if (preSignedUrls && preSignedUrls[0]) {
          const outputExt = path.extname(preSignedUrls[0]).split("?")[0] || ".png";
          const outputFilePath = path.join(PROCESSED, path.parse(fileName).name + outputExt);
          sendLog(`⬇️ Téléchargement du résultat...`);
          
          const response = await axios.get(preSignedUrls[0], { 
            responseType: "stream",
            timeout: 60000 // 60s timeout pour le téléchargement
          });
          const writer = fs.createWriteStream(outputFilePath);
          response.data.pipe(writer);
          await finished(writer);
          
          sendLog(`✅ Fichier traité téléchargé : ${outputFilePath}`);
          
          if (aristidMetadata) {
            await applyAristidShell(outputFilePath, aristidMetadata, sendLog);
          } else {
            sendLog(`ℹ️ Pas de métadonnées ARISTID disponibles pour ${fileName}`);
          }
          
          if (await fs.pathExists(originalFilePath)) {
            const dest = path.join(settings.folders.ORIGINALS, path.basename(originalFilePath));
            await fs.move(originalFilePath, dest, { overwrite: true });
            sendLog(`🗃️ Fichier original déplacé dans 'originaux' : ${dest}`);
          }
          
          updatePendingCount?.();
        } else {
          throw new Error("preSignedUrls manquant dans la réponse");
        }
      },
      // Callback d'erreur
      async (error) => {
        sendLog(`❌ Échec du polling pour ${fileName}: ${error.message}`);
        // Le fichier sera déplacé vers ERROR par le timeout manager
      }
    );
  } finally {
    // Arrêter le suivi du timeout
    if (timeoutManager) {
      timeoutManager.completeTracking(processingId);
    }
  }
}
```

### Phase 3 - Interface Utilisateur (Optionnel)

#### Ajouter un onglet de monitoring dans `renderer/index.html`

```html
<!-- Ajouter après les onglets existants -->
<div class="tab-content" id="monitoring-tab" style="display: none;">
  <h2>🔍 Monitoring du Système</h2>
  
  <div class="stats-grid">
    <div class="stat-card">
      <h3>Watcher</h3>
      <div id="watcher-stats">Chargement...</div>
    </div>
    
    <div class="stat-card">
      <h3>Timeouts</h3>
      <div id="timeout-stats">Chargement...</div>
    </div>
    
    <div class="stat-card">
      <h3>Polling</h3>
      <div id="polling-stats">Chargement...</div>
    </div>
  </div>
  
  <div class="actions">
    <button id="refresh-stats">🔄 Actualiser</button>
    <button id="force-cleanup">🧹 Nettoyage Forcé</button>
  </div>
</div>
```

#### Ajouter le JavaScript correspondant dans `renderer/renderer.js`

```javascript
// Ajouter les handlers pour le monitoring
document.getElementById('refresh-stats').addEventListener('click', async () => {
  const stats = await window.electronAPI.getHotfolderStats();
  updateStatsDisplay(stats);
});

document.getElementById('force-cleanup').addEventListener('click', async () => {
  await window.electronAPI.forceCleanup();
  addLog('🧹 Nettoyage forcé effectué');
});

function updateStatsDisplay(stats) {
  document.getElementById('watcher-stats').innerHTML = `
    <p>Fichiers en traitement: ${stats.watcher?.processingCount || 0}</p>
    <p>Timeouts actifs: ${stats.watcher?.pendingTimeouts || 0}</p>
  `;
  
  document.getElementById('timeout-stats').innerHTML = `
    <p>Traitements actifs: ${stats.timeout?.activeCount || 0}</p>
    <p>Durée moyenne: ${stats.timeout?.averageDuration || 0}s</p>
  `;
  
  document.getElementById('polling-stats').innerHTML = `
    <p>Pollers actifs: ${stats.polling?.activePollers || 0}</p>
    <p>Statut: ${stats.polling?.status || 'IDLE'}</p>
    <p>Taux d'erreur: ${stats.polling?.globalErrorRate || 0}%</p>
  `;
}

// Actualiser les stats toutes les 10 secondes
setInterval(async () => {
  if (document.getElementById('monitoring-tab').style.display !== 'none') {
    const stats = await window.electronAPI.getHotfolderStats();
    updateStatsDisplay(stats);
  }
}, 10000);
```

## Configuration Recommandée

### Variables d'Environnement (.env)

```env
# Timeouts (en millisecondes)
PROCESSING_TIMEOUT=600000          # 10 minutes
FILE_STABILITY_DURATION=3000       # 3 secondes
FILE_STABILITY_CHECKS=3            # 3 vérifications

# Polling
POLLING_BASE_INTERVAL=5000         # 5 secondes
POLLING_MAX_INTERVAL=60000         # 60 secondes
POLLING_MAX_CONSECUTIVE_ERRORS=10  # 10 erreurs max

# Watcher
WATCHER_SCAN_INTERVAL=30000        # 30 secondes
WATCHER_SAFETY_TIMEOUT=900000      # 15 minutes
```

## Tests de Validation

### Test 1 - Fichier en Cours d'Écriture
1. Commencer à copier un gros fichier dans le hotfolder
2. Vérifier que le traitement n'commence pas immédiatement
3. Attendre la fin de la copie
4. Vérifier que le traitement commence après stabilisation

### Test 2 - Timeout de Traitement
1. Configurer un timeout court (30s)
2. Déposer un fichier
3. Simuler une panne API
4. Vérifier que le fichier est déplacé vers ERROR après timeout

### Test 3 - Polling Adaptatif
1. Déposer plusieurs fichiers
2. Observer les intervalles de polling dans les logs
3. Simuler des erreurs API temporaires
4. Vérifier que les intervalles augmentent puis diminuent

### Test 4 - Récupération après Redémarrage
1. Déposer des fichiers
2. Fermer l'application pendant le traitement
3. Redémarrer l'application
4. Vérifier que les fichiers sont retraités

## Métriques de Succès Attendues

- **Réduction de 80%** des fichiers bloqués
- **Temps de récupération** < 30 secondes après incident
- **Taux d'erreur** < 5% en conditions normales
- **Visibilité complète** sur l'état du système
- **Auto-recovery** sans intervention manuelle

## Maintenance

### Logs à Surveiller
- Messages de timeout fréquents
- Taux d'erreur de polling élevé
- Fichiers restant longtemps en traitement
- Erreurs de stabilité répétées

### Actions de Maintenance
- Nettoyer périodiquement les fichiers orphelins
- Surveiller l'espace disque des dossiers ERROR
- Vérifier les performances de l'API
- Ajuster les timeouts selon les besoins

Cette implémentation transforme votre système hotfolder en une solution robuste et auto-réparatrice, capable de gérer les pannes et les conditions difficiles sans intervention manuelle.

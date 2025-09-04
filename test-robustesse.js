/**
 * Script de test pour valider les améliorations de robustesse du hotfolder
 * Usage: node test-robustesse.js
 */

const fs = require('fs-extra');
const path = require('path');

// Configuration de test
const TEST_CONFIG = {
  hotfolderPath: './hotfolder',
  testImagePath: './test-image.jpg',
  testLargeImagePath: './test-large-image.jpg'
};

console.log('🧪 Tests de Robustesse du Hotfolder');
console.log('=====================================\n');

/**
 * Test 1: Vérification de la stabilité des fichiers
 */
async function testFileStability() {
  console.log('📋 Test 1: Stabilité des fichiers');
  
  try {
    const { FileStabilityChecker } = require('./main/file-stability');
    const checker = new FileStabilityChecker(2000, 500); // 2s avec vérifications toutes les 500ms
    
    // Créer un fichier de test
    const testFile = path.join(TEST_CONFIG.hotfolderPath, 'test-stability.jpg');
    await fs.ensureDir(TEST_CONFIG.hotfolderPath);
    
    // Simuler un fichier en cours d'écriture
    console.log('  ⏳ Simulation d\'un fichier en cours d\'écriture...');
    const writer = fs.createWriteStream(testFile);
    
    // Écrire progressivement
    setTimeout(() => writer.write('data1'), 100);
    setTimeout(() => writer.write('data2'), 600);
    setTimeout(() => writer.write('data3'), 1100);
    setTimeout(() => writer.end(), 1600);
    
    // Tester la stabilité
    const startTime = Date.now();
    const isReady = await checker.checkFileReadiness(testFile, (msg) => console.log(`    ${msg}`));
    const duration = Date.now() - startTime;
    
    console.log(`  ✅ Fichier ${isReady ? 'stable' : 'non stable'} après ${duration}ms`);
    
    // Nettoyer
    await fs.remove(testFile);
    
  } catch (error) {
    console.log(`  ❌ Erreur: ${error.message}`);
  }
  
  console.log('');
}

/**
 * Test 2: Système de timeout
 */
async function testTimeoutManager() {
  console.log('📋 Test 2: Système de timeout');
  
  try {
    const { ProcessingTimeoutManager } = require('./main/processing-timeout');
    const manager = new ProcessingTimeoutManager(3000); // 3 secondes pour le test
    
    manager.initialize({ folders: { ERROR: './error' } }, (msg) => console.log(`    ${msg}`));
    
    // Créer un fichier de test
    const testFile = path.join('./error', 'test-timeout.jpg');
    await fs.ensureDir('./error');
    await fs.writeFile(testFile.replace('./error', './'), 'test data');
    
    console.log('  ⏳ Démarrage du suivi avec timeout de 3s...');
    manager.startTracking('test-processing-123', 'test-timeout.jpg', testFile.replace('./error', './'));
    
    // Attendre le timeout
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    // Vérifier les stats
    const stats = manager.getStats();
    console.log(`  📊 Statistiques: ${stats.activeCount} actifs`);
    
    // Nettoyer
    manager.forceStopAll();
    await fs.remove('./error').catch(() => {});
    
    console.log('  ✅ Test de timeout terminé');
    
  } catch (error) {
    console.log(`  ❌ Erreur: ${error.message}`);
  }
  
  console.log('');
}

/**
 * Test 3: Polling adaptatif
 */
async function testAdaptivePoller() {
  console.log('📋 Test 3: Polling adaptatif');
  
  try {
    const { AdaptivePoller } = require('./main/adaptive-poller');
    const poller = new AdaptivePoller(1000, 5000); // 1s à 5s
    
    console.log('  ⏳ Test des intervalles adaptatifs...');
    
    // Simuler des succès
    for (let i = 0; i < 3; i++) {
      poller.onSuccess();
      const interval = poller.getNextInterval();
      console.log(`    Succès ${i + 1}: intervalle = ${interval}ms`);
    }
    
    // Simuler des erreurs
    for (let i = 0; i < 3; i++) {
      poller.onError();
      const interval = poller.getNextInterval();
      console.log(`    Erreur ${i + 1}: intervalle = ${interval}ms`);
    }
    
    // Afficher les stats
    const stats = poller.getStats();
    console.log(`  📊 Stats: ${stats.totalPolls} polls, ${stats.errorRate}% erreurs, statut: ${stats.status}`);
    
    console.log('  ✅ Test de polling adaptatif terminé');
    
  } catch (error) {
    console.log(`  ❌ Erreur: ${error.message}`);
  }
  
  console.log('');
}

/**
 * Test 4: Intégration complète
 */
async function testIntegration() {
  console.log('📋 Test 4: Intégration complète');
  
  try {
    // Vérifier que tous les modules sont bien exportés
    const hotfolder = require('./main/hotfolder');
    const watcher = require('./main/watcher');
    
    console.log('  ✅ Module hotfolder chargé');
    console.log('  ✅ Module watcher chargé');
    
    // Vérifier les exports
    if (typeof hotfolder.initializeManagers === 'function') {
      console.log('  ✅ initializeManagers disponible');
    } else {
      console.log('  ❌ initializeManagers manquant');
    }
    
    if (typeof watcher.startWatcher === 'function') {
      console.log('  ✅ startWatcher disponible');
    } else {
      console.log('  ❌ startWatcher manquant');
    }
    
    console.log('  ✅ Test d\'intégration terminé');
    
  } catch (error) {
    console.log(`  ❌ Erreur: ${error.message}`);
  }
  
  console.log('');
}

/**
 * Exécution des tests
 */
async function runTests() {
  console.log('🚀 Démarrage des tests...\n');
  
  await testFileStability();
  await testTimeoutManager();
  await testAdaptivePoller();
  await testIntegration();
  
  console.log('✅ Tous les tests terminés !');
  console.log('\n📝 Pour tester en conditions réelles :');
  console.log('   1. Démarrez l\'application: npm start');
  console.log('   2. Copiez un gros fichier dans le hotfolder pendant qu\'il se copie');
  console.log('   3. Observez les logs pour voir la vérification de stabilité');
  console.log('   4. Testez avec des pannes réseau simulées');
}

// Exécuter les tests si le script est appelé directement
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  testFileStability,
  testTimeoutManager,
  testAdaptivePoller,
  testIntegration,
  runTests
};

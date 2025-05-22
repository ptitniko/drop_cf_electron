// /main/server.js

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const stream = require('stream');
const { promisify } = require('util');
const finished = promisify(stream.finished);

function createServer(settings, sendLog, updatePendingCount) {
  const HOTFOLDER = settings.folders.HOTFOLDER;
  const PROCESSED = settings.folders.PROCESSED;

  const app = express();
  app.use(express.json({ type: ["application/json", "text/plain"] }));
  app.use(cors());
  app.use("/files", express.static(HOTFOLDER));

  app.post('/webhook', async (req, res) => {
    const originalFileName = decodeURIComponent(req.headers['x-original-filename'] || '');
    if (!originalFileName) {
      sendLog('❌ Header X-Original-Filename manquant.');
      return res.status(400).send('Header X-Original-Filename manquant.');
    }
    const outputs = req.body.outputs;
    if (!outputs || !outputs[0] || outputs[0].status !== 'COMPLETED') {
      sendLog('❌ Traitement externe non complété ou outputs invalide.');
      return res.status(400).send('Traitement non complété ou outputs invalide.');
    }
    const processedFileUrl = outputs[0].preSignedUrls[0];
    if (!processedFileUrl) {
      sendLog('❌ preSignedUrl invalide ou manquante.');
      return res.status(400).send('preSignedUrl invalide ou manquante.');
    }
    const baseName = path.parse(originalFileName).name;
    const outputFilePath = path.join(PROCESSED, `${baseName}.png`);
    const originalFilePath = path.join(HOTFOLDER, originalFileName);

    try {
      const response = await axios.get(processedFileUrl, { responseType: 'stream' });
      const writer = fs.createWriteStream(outputFilePath);
      response.data.pipe(writer);
      await finished(writer);
      sendLog(`✅ Fichier téléchargé : ${baseName}.png`);

      if (await fs.pathExists(originalFilePath)) {
        await fs.remove(originalFilePath);
        sendLog(`🗃️ Fichier original supprimé du hotfolder : ${originalFileName}`);
        if (typeof updatePendingCount === 'function') updatePendingCount();
      } else {
        sendLog(`⚠️ Fichier original non trouvé pour suppression : ${originalFileName}`);
      }

      res.status(200).send('Webhook traité avec succès.');
    } catch (error) {
      sendLog(`❌ Erreur dans le webhook : ${error}`);
      res.status(500).send('Erreur traitement webhook.');
    }
  });

  return app;
}

let expressServer = null;

/**
 * Lance ou relance le serveur Express sur le port spécifié dans settings.
 * Si un serveur existe déjà, il est fermé proprement.
 * @param {object} settings 
 * @param {function} sendLog 
 * @returns {Promise} 
 */
async function startExpressServer(settings, sendLog, updatePendingCount) {
  const SERVER_PORT = settings.config.WEBHOOK_PORT || 4000;

  if (expressServer) {
    await new Promise(res => expressServer.close(res));
    expressServer = null;
  }

  const app = createServer(settings, sendLog, updatePendingCount);

  return new Promise((resolve, reject) => {
    expressServer = app.listen(SERVER_PORT, () => {
      sendLog(`🚀 Serveur en écoute sur le port ${SERVER_PORT}`);
      resolve(expressServer);
    });
    expressServer.on('error', err => {
      sendLog(`❌ Erreur serveur Express : ${err.message}`);
      reject(err);
    });
  });
}

module.exports = {
  startExpressServer
};
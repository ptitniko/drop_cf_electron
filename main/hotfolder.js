const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const FormData = require("form-data");
const stream = require('stream');
const { promisify } = require('util');
const finished = promisify(stream.finished);

const VALID_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];

async function processNewFile(filePath, settings, sendLog, updatePendingCount) {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();

  if (!VALID_EXTENSIONS.includes(ext)) {
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    sendLog(`⚠️ Fichier non valide déplacé : ${fileName}`);
    if (typeof updatePendingCount === 'function') updatePendingCount();
    return;
  }

  try {
    // 1. Upload image
    sendLog(`⬆️ Upload de ${fileName} sur l'API...`);
    updatePendingCount()
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), fileName);

    const uploadResponse = await axios.post(
      `${settings.config.API_URL.replace(/\/$/, "")}/api/assets`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const s3Key = uploadResponse.data && (uploadResponse.data.key || uploadResponse.data.s3Key);
    if (!s3Key) {
      sendLog(`❌ Erreur : la clé S3 n'a pas été reçue. Réponse: ${JSON.stringify(uploadResponse.data)}`);
      await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
      if (typeof updatePendingCount === 'function') updatePendingCount();
      return;
    }
    sendLog(`✅ Image uploadée. Clé S3 : ${s3Key}`);

    // 2. Création du processing
    const payload = {
      processings: [
        {
          client: settings.config.CLIENT,
          customer: settings.config.CUSTOMER,
          forceGeneration: true,
          dataList: [
            {
              context: {},
              data: {
                imageUrl: s3Key
              }
            }
          ],
          actions: [
            {
              key: "PHOTOROOM.EDIT",
              settings: {
                "export.format": "png",
                "removeBackground": true,
                "background.color": "transparent",
                "background.scaling": "fill",
                "padding": "20px",
                "outputSize": "croppedSubject"
              }
            }
          ],
          webhook: {
            url: "https://webhook.site/376e97af-4879-49a7-b159-2e66b74571bd",
            method: "POST",
            headers: {}
          },
          priority: 1,
          resultOptions:{
            preSignedUrls:true
          }
        }
      ]
    };

    const processResponse = await axios.post(
      `${settings.config.API_URL.replace(/\/$/, "")}/api/processings`,
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    // Récupère l'ID du processing
    const processingIds = processResponse.data;
    if (!processingIds || !Array.isArray(processingIds) || !processingIds[0]) {
      sendLog(`❌ Impossible de récupérer l'ID du processing. Réponse: ${JSON.stringify(processResponse.data)}`);
      await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
      if (typeof updatePendingCount === 'function') updatePendingCount();
      return;
    }
    const processingId = processingIds[0];
    sendLog(`🆔 Processing lancé (ID: ${processingId})`);

    // 3. Polling toutes les 2s sur l'avancement du traitement
    await pollProcessingResult(processingId, filePath, fileName, settings, sendLog, updatePendingCount);

  } catch (error) {
    sendLog(`❌ Erreur lors du traitement de ${fileName} : ${error.message} | ${error.response ? JSON.stringify(error.response.data) : ''}`);
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    if (typeof updatePendingCount === 'function') updatePendingCount();
  }
  if (typeof updatePendingCount === 'function') updatePendingCount();
}

async function pollProcessingResult(processingId, originalFilePath, fileName, settings, sendLog, updatePendingCount) {
  const PROCESSED = settings.folders.PROCESSED;
  const HOTFOLDER = settings.folders.HOTFOLDER;
  const pollingInterval = 10000; // 2 secondes

  let attempts = 0;
  let isCompleted = false;
  let errorCount = 0;
  const maxErrors = 100;

  sendLog(`⏳ Suivi du processing (ID: ${processingId})...`);

  while (!isCompleted && errorCount < maxErrors) {
    attempts++;
    try {
      await new Promise(res => setTimeout(res, pollingInterval));

      const resultResp = await axios.get(
        `${settings.config.API_URL.replace(/\/$/, "")}/api/processings/${processingId}/result`
      );
      const data = resultResp.data;
      sendLog(`🔄 [Tentative ${attempts}] Statut: ${JSON.stringify(data.outputs && data.outputs[0] && data.outputs[0].status)}`);

      // Vérifie le statut
      if (data.outputs && data.outputs[0] && data.outputs[0].status === "COMPLETED") {
        const preSignedUrls = data.outputs[0].preSignedUrls;
        if (preSignedUrls && preSignedUrls[0]) {
          // Télécharge le fichier
          const outputExt = path.extname(preSignedUrls[0]).split('?')[0] || ".png";
          const outputFilePath = path.join(PROCESSED, path.parse(fileName).name + outputExt);

          sendLog(`⬇️ Téléchargement du résultat...`);
          const response = await axios.get(preSignedUrls[0], { responseType: 'stream' });
          const writer = fs.createWriteStream(outputFilePath);
          response.data.pipe(writer);
          await finished(writer);

          sendLog(`✅ Fichier traité téléchargé : ${outputFilePath}`);

          // Supprime l'original du hotfolder
          if (await fs.pathExists(originalFilePath)) {
            await fs.remove(originalFilePath);
            sendLog(`🗃️ Fichier original supprimé du hotfolder : ${fileName}`);
          }

          if (typeof updatePendingCount === 'function') updatePendingCount();
        } else {
          sendLog(`❌ Résultat: preSignedUrls manquant`);
        }
        isCompleted = true;
        break;
      }

      // Si le statut est FAILED, on arrête aussi
      if (data.outputs && data.outputs[0] && data.outputs[0].status === "FAILED") {
        sendLog(`❌ Le traitement a échoué pour ${fileName}`);
        isCompleted = true;
        break;
      }
    } catch (err) {
      errorCount++;
      sendLog(`⚠️ Erreur lors du polling (tentative ${attempts}) : ${err.message}`);
      if (errorCount >= maxErrors) {
        sendLog(`❌ Trop d'erreurs lors du polling, abandon (ID: ${processingId})`);
      }
    }
  }
}

module.exports = {
  processNewFile,
  VALID_EXTENSIONS
};
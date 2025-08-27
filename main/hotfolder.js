// hotfolder.js
const path = require("path");
const fs = require("fs-extra");
const axios = require("axios");
const FormData = require("form-data");
const stream = require("stream");
const { promisify } = require("util");
const finished = promisify(stream.finished);
const { exiftool } = require("exiftool-vendored");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);

const VALID_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tif", ".tiff"];

async function withRetry(fn, maxRetries = 3, delayMs = 2000, onError = () => {}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      onError(error, attempt);
      if (attempt < maxRetries) {
        await new Promise(res => setTimeout(res, delayMs * attempt));
      } else {
        throw error;
      }
    }
  }
}

async function extractAristidMetadata(filePath, sendLog) {
  sendLog(`🔍 Extraction des métadonnées ARISTID de ${filePath}`);
  try {
    const tags = await exiftool.read(filePath);
    const aristidTags = Object.entries(tags).filter(
      ([key]) => key.toLowerCase().includes("aristid")
    );
    if (aristidTags.length > 0) {
      const aristidMetadata = Object.fromEntries(aristidTags);
      const metadataDir = path.resolve(__dirname, "../metadata");
      const metadataPath = path.join(
        metadataDir,
        `${path.parse(filePath).name}_aristid.json`
      );
      await fs.ensureDir(metadataDir);
      await fs.writeJson(metadataPath, aristidMetadata, { spaces: 2 });
      sendLog(
        `✅ ${aristidTags.length} métadonnée(s) ARISTID sauvegardée(s) dans ${metadataPath}`
      );
      return aristidMetadata;
    } else {
      sendLog("⚠️ Aucun nœud ARISTID trouvé");
      return null;
    }
  } catch (err) {
    sendLog(`❌ Erreur exiftool : ${err.message}`);
    return null;
  }
}

async function applyAristidShell(processedFilePath, aristidMetadata, sendLog) {
  if (!aristidMetadata || Object.keys(aristidMetadata).length === 0) {
    sendLog("ℹ️ Pas de données ARISTID à ré-appliquer");
    return;
  }
  const args = [
    '-config', 'aristid.config',
    ...Object.entries(aristidMetadata).map(
      ([key, value]) => `-XMP-ARISTID:${key}=${value}`
    ),
    '-overwrite_original',
    processedFilePath
  ];
  sendLog(`🛠️ Injection ARISTID avec exiftool shell : exiftool ${args.join(' ')}`);
  try {
    const { stdout, stderr } = await execFileAsync('exiftool', args);
    if (stderr && stderr.trim()) {
      sendLog(`⚠️ exiftool stderr: ${stderr}`);
    } else {
      sendLog(`✅ Métadonnées ARISTID injectées avec succès via exiftool`);
    }
  } catch (err) {
    sendLog(`❌ Erreur exiftool shell : ${err.message}`);
  }
}

async function processNewFile(filePath, settings, sendLog, updatePendingCount) {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  if (!VALID_EXTENSIONS.includes(ext)) {
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    sendLog(`⚠️ Fichier non valide déplacé : ${fileName}`);
    updatePendingCount?.();
    return;
  }
  let aristidMetadata = null;
  try {
    aristidMetadata = await extractAristidMetadata(filePath, sendLog);
    sendLog(`⬆️ Upload de ${fileName} sur l'API...`);
    updatePendingCount?.();
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), fileName);
    const uploadResponse = await axios.post(
      `${settings.config.API_URL.replace(/\/$/, "")}/api/assets`,
      form,
      {
        headers: { ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    const s3Key = uploadResponse.data && (uploadResponse.data.key || uploadResponse.data.s3Key);
    if (!s3Key) {
      sendLog(`❌ Erreur : la clé S3 n'a pas été reçue. Réponse: ${JSON.stringify(uploadResponse.data)}`);
      await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
      updatePendingCount?.();
      return;
    }
    sendLog(`✅ Image uploadée. Clé S3 : ${s3Key}`);
    const payload = {
      processings: [
        {
          client: settings.config.CLIENT,
          customer: settings.config.CUSTOMER,
          forceGeneration: true,
          dataList: [
            {
              context: {},
              data: { imageUrl: s3Key }
            }
          ],
          actions: [
            {
              key: "PHOTOROOM.EDIT",
              settings: {
                "export.format": "png",
                "removeBackground": true,
                "export.dpi": "300",
                "background.color": "transparent",
                "background.scaling": "fill",
                "padding": settings.config.PADDING,
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
          resultOptions: { preSignedUrls: true }
        }
      ]
    };
    const processResponse = await axios.post(
      `${settings.config.API_URL.replace(/\/$/, "")}/api/processings`,
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    const processingIds = processResponse.data;
    if (!processingIds || !Array.isArray(processingIds) || !processingIds[0]) {
      sendLog(`❌ Impossible de récupérer l'ID du processing. Réponse: ${JSON.stringify(processResponse.data)}`);
      await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
      updatePendingCount?.();
      return;
    }
    const processingId = processingIds[0];
    sendLog(`🆔 Processing lancé (ID: ${processingId})`);
    await pollProcessingResult(processingId, filePath, fileName, settings, sendLog, updatePendingCount, aristidMetadata);
  } catch (error) {
    sendLog(`❌ Erreur lors du traitement de ${fileName} : ${error.message} | ${error.response ? JSON.stringify(error.response.data) : ''}`);
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    updatePendingCount?.();
  }
  updatePendingCount?.();
}

async function pollProcessingResult(processingId, originalFilePath, fileName, settings, sendLog, updatePendingCount, aristidMetadata) {
  const PROCESSED = settings.folders.PROCESSED;
  const pollingInterval = 10000;
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
      sendLog(`🔄 [Tentative ${attempts}] Statut: ${JSON.stringify(data.outputs?.[0]?.status)}`);
      if (data.outputs?.[0]?.status === "COMPLETED") {
        const preSignedUrls = data.outputs[0].preSignedUrls;
        if (preSignedUrls && preSignedUrls[0]) {
          const outputExt = path.extname(preSignedUrls[0]).split("?")[0] || ".png";
          const outputFilePath = path.join(PROCESSED, path.parse(fileName).name + outputExt);
          sendLog(`⬇️ Téléchargement du résultat...`);
          const response = await axios.get(preSignedUrls[0], { responseType: "stream" });
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
          sendLog(`❌ Résultat: preSignedUrls manquant`);
        }
        isCompleted = true;
        break;
      }
      if (data.outputs?.[0]?.status === "FAILED") {
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

async function processFileWithRetry(filePath, settings, sendLog, updatePendingCount) {
  const fileName = path.basename(filePath);
  try {
    await withRetry(
      () => processNewFile(filePath, settings, sendLog, updatePendingCount),
      3,
      2000,
      (err, attempt) => sendLog(`⚠️ Tentative ${attempt} pour ${fileName} a échoué : ${err.message}`)
    );
  } catch (err) {
    await fs.move(filePath, path.join(settings.folders.ERROR, fileName), { overwrite: true });
    sendLog(`❌ Après 3 essais, ${fileName} déplacé dans le dossier ERROR`);
    updatePendingCount?.();
  }
}

module.exports = {
  processFileWithRetry,
  VALID_EXTENSIONS
};
// === Sélection des éléments de l'interface ===
const rootPathDiv = document.getElementById('rootPath');
const foldersList = document.getElementById('foldersList');
const logsDiv = document.getElementById('logs');
const changeFolderBtn = document.getElementById('changeFolderBtn');
const showSettingsBtn = document.getElementById('showSettingsBtn');

// Paramètres (modale)
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const apiUrlInput = document.getElementById('apiUrlInput');
const portInput = document.getElementById('portInput');
const localUrlInput = document.getElementById('localUrlInput');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');

// === Affichage dynamique des dossiers ===
async function updateFoldersDisplay() {
  const folders = await window.electronAPI.getUserFolders();
  if (!folders) return;

  rootPathDiv.textContent = "Emplacement principal : " + (folders.ROOT || "Non défini");

  // Remplir la liste des sous-dossiers
  const mapping = {
    HOTFOLDER: "Hotfolder",
    PROCESSED: "Processed",
    METADATA: "Metadata",
    ERROR: "Error",
    ORIGINALS: "Originaux"
  };
  foldersList.innerHTML = '';
  Object.entries(mapping).forEach(([key, label]) => {
    if (folders[key]) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${label}</b> : <code>${folders[key]}</code>`;
      foldersList.appendChild(li);
    }
  });
}

// === Changer de dossier de travail ===
changeFolderBtn.addEventListener('click', async () => {
  const folders = await window.electronAPI.changeUserFolders();
  if (folders && folders.ROOT) {
    await updateFoldersDisplay();
    window.location.reload(); // Optionnel : relancer watchers/serveur
  }
});

// === Affichage dynamique des logs ===
window.electronAPI.onLog((log) => {
  logsDiv.textContent += log + "\n";
  logsDiv.scrollTop = logsDiv.scrollHeight;
});

// === Gestion modale paramètres ===
showSettingsBtn.addEventListener('click', async () => {
  const config = await window.electronAPI.getConfig?.();
  apiUrlInput.value = config?.API_URL || '';
  portInput.value = config?.WEBHOOK_PORT || 4000;
  localUrlInput.value = config?.LOCAL_URL || 'http://localhost';
  settingsModal.classList.add('active');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.remove('active');
});

// Validation du formulaire de paramètres
settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await window.electronAPI.saveConfig?.({
    API_URL: apiUrlInput.value,
    WEBHOOK_PORT: Number(portInput.value),
    LOCAL_URL: localUrlInput.value
  });
  settingsModal.classList.remove('active');
  window.location.reload(); // Pour prendre en compte les nouveaux paramètres
});

// === Initialisation au chargement ===
updateFoldersDisplay();
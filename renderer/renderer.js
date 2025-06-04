// --- DOM ----
const showSettingsBtn = document.getElementById('showSettingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsForm = document.getElementById('settingsForm');
const apiInput = document.getElementById('param-api');
const clientInput = document.getElementById('param-client');
const customerInput = document.getElementById('param-customer');
const folderInput = document.getElementById('param-folder');
const browseFolderBtn = document.getElementById('browseFolderBtn');
const forceScanBtn = document.getElementById('forceScanBtn');
const serviceBtn = document.getElementById('serviceBtn');
const serviceBtnLabel = document.getElementById('serviceBtnLabel');
const serviceBtnIcon = document.getElementById('serviceBtnIcon');
const imageCount = document.getElementById('imageCount');
const logsArea = document.getElementById('logsArea');
const copyLogsBtn = document.getElementById('copyLogsBtn');
const dndOverlay = document.getElementById('dndOverlay');
const mainContainer = document.getElementById('mainContainer');
const ctx = document.getElementById('pendingChart').getContext('2d');


// --- PARAMÈTRES & FOLDERS ---
async function loadConfigAndFolders() {
  const config = await window.electronAPI.getConfig();
  const folders = await window.electronAPI.getUserFolders();
  apiInput.value = config?.API_URL || '';
  clientInput.value = config?.CLIENT || 'CLIENT';
  customerInput.value = config?.CUSTOMER || 'CUSTOMER';
  folderInput.value = folders?.ROOT || '';
}
loadConfigAndFolders();

// --- MODALE PARAMÈTRES ---
showSettingsBtn.addEventListener('click', () => {
  loadConfigAndFolders();
  settingsModal.classList.add('open');
  setTimeout(() => settingsModal.focus(), 150);
});
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('open'));
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) settingsModal.classList.remove('open');
});
settingsForm.addEventListener('submit', async e => {
  e.preventDefault();
  await window.electronAPI.saveConfig({
    API_URL: apiInput.value,
    CLIENT: clientInput.value,
    CUSTOMER: customerInput.value
  });
  settingsModal.classList.remove('open');
});
browseFolderBtn.addEventListener('click', async () => {
  const folders = await window.electronAPI.changeUserFolders();
  if (folders && folders.ROOT) folderInput.value = folders.ROOT;
});

// --- LOGS ---
window.electronAPI.onLog((log) => {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = log;
  logsArea.appendChild(entry);
  logsArea.scrollTop = logsArea.scrollHeight;
});
copyLogsBtn.addEventListener('click', () => {
  const text = Array.from(logsArea.children).map(e => e.textContent).join('\n');
  navigator.clipboard?.writeText(text);
});

// --- COMPTEUR HOTFOLDER ---
window.electronAPI.onPendingCount(count => {
  imageCount.textContent = count;
});

// --- GRAPH ---
// Historique des valeurs
let labels = [];
let data = [];

// Chart.js instance
const pendingChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: labels,
    datasets: [{
      label: 'Fichiers en attente',
      data: data,
      borderColor: '#36a2eb',
      backgroundColor: 'rgba(54,162,235,0.1)',
      fill: true,
      tension: 0.2,
      pointRadius: 3
    }]
  },
  options: {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Files Pending Over Time' }
    },
    scales: {
      x: {
        title: { display: true, text: 'Heure' }
      },
      y: {
        title: { display: true, text: 'En attente' },
        beginAtZero: true,
        precision: 0
      }
    }
  }
});

// Met à jour le graphique à chaque message IPC
window.electronAPI.onPendingCount((count) => {
  const now = new Date();
  const time = now.toLocaleTimeString();
  labels.push(time);
  data.push(count);

  // Garde seulement les 20 derniers points
  if (labels.length > 20) {
    labels.shift();
    data.shift();
  }

  pendingChart.update();
});


// --- FORCE SCAN ---
forceScanBtn.addEventListener('click', () => window.electronAPI.forceScan());

// --- SERVICE START/STOP ---
let serviceRunning = true;
serviceBtn.addEventListener('click', async () => {
  serviceRunning = !serviceRunning;
  const running = await window.electronAPI.toggleService();
  updateServiceBtn(running);
});
function updateServiceBtn(running) {
  serviceBtn.classList.toggle('running', running);
  serviceBtn.classList.toggle('stopped', !running);
  serviceBtnLabel.textContent = running ? "Arrêter le service" : "Démarrer le service";
  // Change icon
  serviceBtnIcon.innerHTML = running
    ? '<rect x="6" y="5" width="3" height="10" rx="1"/><rect x="11" y="5" width="3" height="10" rx="1"/>'
    : '<polygon points="6.5,5.5 6.5,14.5 14.5,10" />';
}
// Initialise
updateServiceBtn(serviceRunning);

// --- DRAG & DROP IMAGE ---
mainContainer.addEventListener('dragover', e => {
  e.preventDefault();
  dndOverlay.classList.add('active');
});
mainContainer.addEventListener('dragleave', e => {
  if (e.target === mainContainer) dndOverlay.classList.remove('active');
});
mainContainer.addEventListener('drop', async e => {
  e.preventDefault();
  dndOverlay.classList.remove('active');
  const files = Array.from(e.dataTransfer.files);
  const image = files.find(f => f.type.startsWith('image/'));
  if (image) {
    await window.electronAPI.addImageToHotfolder(image.path);
  }
});

// --- ESC pour fermer la modale ---
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') settingsModal.classList.remove('open');
});
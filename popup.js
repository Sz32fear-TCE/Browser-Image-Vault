const DB_NAME = 'ImageVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

let db;
let cachedImages = [];

const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onupgradeneeded = (event) => {
  db = event.target.result;
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
  }
};

request.onsuccess = (event) => {
  db = event.target.result;
  loadImages();
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "refreshGallery") loadImages();
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const nameInput = document.getElementById('imageName');
  const fileInput = document.getElementById('imageFile');
  const name = nameInput.value.trim();
  const files = fileInput.files;

  if (!name || files.length === 0) {
    alert('Please provide both a name and an image file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    saveImageToDB(name, e.target.result);
  };
  reader.readAsDataURL(files[0]);
});

document.getElementById('searchBar').addEventListener('input', (e) => {
  renderGallery(e.target.value.toLowerCase());
});

document.getElementById('exportBtn').addEventListener('click', exportBackup);

function saveImageToDB(name, dataUrl) {
  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.add({ name: name, dataUrl: dataUrl, timestamp: Date.now() });

  transaction.oncomplete = () => {
    document.getElementById('imageName').value = '';
    document.getElementById('imageFile').value = '';
    loadImages();
  };
}

function loadImages() {
  if (!db) return;
  const transaction = db.transaction([STORE_NAME], 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();

  request.onsuccess = () => {
    cachedImages = request.result;
    renderGallery(document.getElementById('searchBar').value.toLowerCase());
  };
}

function renderGallery(filterText = '') {
  const gallery = document.getElementById('imageGallery');
  gallery.innerHTML = '';

  const filteredItems = cachedImages.filter(item => 
    item.name.toLowerCase().includes(filterText)
  );

  if (filteredItems.length === 0) {
    gallery.innerHTML = '<div style="text-align:center; color:#777; font-size:13px; padding-top:10px;">No images found</div>';
    return;
  }

  filteredItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${escapeHtml(item.name)}</span>
        <button class="delete-btn" data-id="${item.id}">Delete</button>
      </div>
      <img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" draggable="true" class="vault-img">
      <div class="card-actions">
        <button class="copy-btn action-btn">📋 Copy</button>
        <button class="download-btn action-btn">💾 Download</button>
      </div>
    `;

    const imgElement = card.querySelector('.vault-img');
    
    // Process image into a safe binary block BEFORE sending to the tab frame
    imgElement.addEventListener('dragstart', async () => {
      imgElement.classList.add('dragging');
      
      try {
        const response = await fetch(item.dataUrl);
        const blob = await response.blob();
        
        // Read file contents as a cross-site friendly ArrayBuffer
        const bufferReader = new FileReader();
        bufferReader.onloadend = async () => {
          const arrayBuffer = bufferReader.result;
          const binaryArray = Array.from(new Uint8Array(arrayBuffer)); // Convert to simple standard array numbers

          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            chrome.tabs.sendMessage(activeTab.id, { 
              action: "setActiveDrag", 
              data: { 
                name: item.name, 
                binaryArray: binaryArray,
                mimeType: blob.type
              } 
            }).catch(() => {});
          }
        };
        bufferReader.readAsArrayBuffer(blob);
      } catch (err) {
        console.error("Failed to prepare file data wrapper in panel:", err);
      }
    });

    imgElement.addEventListener('dragend', async () => {
      imgElement.classList.remove('dragging');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, { action: "clearActiveDrag" }).catch(() => {});
      }
    });

    card.querySelector('.copy-btn').addEventListener('click', async () => {
      try {
        const response = await fetch(item.dataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        alert('Image copied to clipboard!');
      } catch (err) {
        alert('Clipboard write blocked.');
      }
    });

    card.querySelector('.download-btn').addEventListener('click', () => {
      const dlAnchor = document.createElement('a');
      dlAnchor.href = item.dataUrl;
      dlAnchor.download = `${item.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
      document.body.appendChild(dlAnchor);
      dlAnchor.click();
      dlAnchor.remove();
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      if (confirm('Are you sure you want to delete this image?')) {
        const idToDelete = parseInt(e.target.getAttribute('data-id'));
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        transaction.objectStore(STORE_NAME).delete(idToDelete);
        transaction.oncomplete = () => loadImages();
      }
    });

    gallery.appendChild(card);
  });
}

function exportBackup() {
  if (cachedImages.length === 0) return alert('No data to export.');
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cachedImages));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "image_vault_backup.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

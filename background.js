const DB_NAME = 'ImageVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'images';

// Configure extension icon to trigger the Side Panel layout wrapper
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToVault",
    title: "Save image to Image Vault",
    contexts: ["image"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveToVault" && info.srcUrl) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (imageUrl, pageTitle) => {
        let name = prompt("Enter a name for this image (leave blank for auto-name):");
        if (name === null) return null; 
        
        name = name.trim();
        if (!name) {
          try {
            const urlPath = new URL(imageUrl).pathname;
            const filename = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            name = filename ? decodeURIComponent(filename).split('?')[0] : pageTitle;
          } catch (e) {
            name = pageTitle || "Saved Image";
          }
        }
        return { name: name, imageUrl: imageUrl };
      },
      args: [info.srcUrl, tab.title]
    }, async (injectionResults) => {
      if (!injectionResults || !injectionResults[0] || !injectionResults[0].result) return;
      
      const { name, imageUrl } = injectionResults[0].result;
      
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        
        const reader = new FileReader();
        reader.onloadend = function() {
          saveToIndexedDB(name, reader.result);
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error("Failed to fetch image data:", err);
      }
    });
  }
});

function saveToIndexedDB(name, dataUrl) {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  
  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    }
  };

  request.onsuccess = (event) => {
    const db = event.target.result;
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.add({ name: name, dataUrl: dataUrl, timestamp: Date.now() });
    
    // Send a message to update the open side panel gallery layout dynamically
    chrome.runtime.sendMessage({ action: "refreshGallery" }).catch(() => {});
  };
}

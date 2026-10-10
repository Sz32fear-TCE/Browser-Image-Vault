let activeDraggedImage = null;

// Listen for messages from the sidebar panel
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "setActiveDrag") {
    activeDraggedImage = message.data;
  } else if (message.action === "clearActiveDrag") {
    activeDraggedImage = null;
  }
});

// Intercept dragover so Scratch recognizes an active file payload is arriving
window.addEventListener("dragover", (e) => {
  // If this is an event we generated ourselves, do not touch it
  if (e.isCustomVaultEvent) return;

  if (activeDraggedImage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
}, true);

window.addEventListener("drop", (e) => {
  // CRITICAL FIX: If this is our own simulated event, ignore it 
  // and let it pass through directly to Scratch/TurboWarp
  if (e.isCustomVaultEvent || e.target.isCustomVaultEvent) return;
  if (!activeDraggedImage) return;

  // Stop Scratch from parsing the original empty drop event stream
  e.preventDefault();
  e.stopPropagation();

  try {
    // Convert the sent array numbers back into raw binary bytes
    const byteArray = new Uint8Array(activeDraggedImage.binaryArray);
    const blob = new Blob([byteArray], { type: activeDraggedImage.mimeType });
    
    const cleanName = `${activeDraggedImage.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
    const virtualFile = new File([blob], cleanName, { type: activeDraggedImage.mimeType });

    // Build a true DataTransfer object mapping system file data arrays
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(virtualFile);

    // Override read-only types property so Scratch recognizes it as a real OS file
    Object.defineProperty(dataTransfer, 'types', {
      get: () => ['Files']
    });

    const commonEventConfig = {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dataTransfer,
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY
    };

    // Sequential Triggering to match what the Scratch-GUI React app listens for
    const dragEnterEvent = new DragEvent("dragenter", commonEventConfig);
    dragEnterEvent.isCustomVaultEvent = true; // Mark it safe
    e.target.dispatchEvent(dragEnterEvent);

    const dragOverEvent = new DragEvent("dragover", commonEventConfig);
    dragOverEvent.isCustomVaultEvent = true; // Mark it safe
    e.target.dispatchEvent(dragOverEvent);

    const nativeDropEvent = new DragEvent("drop", commonEventConfig);
    nativeDropEvent.isCustomVaultEvent = true; // Mark it safe
    e.target.dispatchEvent(nativeDropEvent);

  } catch (err) {
    console.error("Scratch/TurboWarp cross-site drop injection failed:", err);
  }

  // Clear tracking variable for next drag cycles
  activeDraggedImage = null;
}, true);

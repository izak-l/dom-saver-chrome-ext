// background.js
// This script runs in the background and handles the core logic.

// Listen for messages from other parts of the extension (e.g., popup.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.action, request);
  
  // Helper function to safely send a response
  const safeResponse = (response) => {
    try {
      console.log("Attempting to send response:", response);
      // Check if we can still send a response
      if (chrome.runtime.lastError) {
        console.warn("Cannot send response:", chrome.runtime.lastError);
        return;
      }
      sendResponse(response);
      console.log("Response sent successfully");
    } catch (err) {
      console.warn("Error sending response:", err);
    }
  };

  // Handle saving the DOM content
  if (request.action === "saveDOM") {
    console.log("Processing saveDOM action");
    // Query for the currently active tab in the current window
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log("Got active tabs:", tabs);
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        console.error("Error querying tabs:", chrome.runtime.lastError?.message);
        safeResponse({ status: "error", message: "Could not get active tab." });
        return;
      }

      const activeTab = tabs[0];
      console.log("Active tab:", activeTab.url);

      // Inject a script into the active tab to get its DOM content
      console.log("Executing script in tab...");
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        function: getPageDOM // The function to execute in the tab's context
      }, (injectionResults) => {
        console.log("Script execution complete, results:", injectionResults ? "received" : "none");
        
        if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
          console.error("Error injecting script:", chrome.runtime.lastError?.message);
          safeResponse({ status: "error", message: "Failed to get DOM content. " + (chrome.runtime.lastError?.message || "") });
          return;
        }

        // The result from the injected script is an array, we take the first element's result
        const domContent = injectionResults[0].result;
        console.log("DOM content received, length:", domContent ? domContent.length : 0);

        if (domContent) {
          // Generate filename (e.g., domain-timestamp.html)
          let filename = "page_dom.html";
          try {
            const tabUrl = new URL(activeTab.url);
            const hostname = tabUrl.hostname.replace(/^www\./, ''); // Remove www.
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            filename = `${hostname}_${timestamp}.html`;
            console.log("Generated filename:", filename);
          } catch (e) {
            // If URL parsing fails, use a generic name
            console.warn("Could not parse URL for filename:", activeTab.url, e);
          }

          if (request.saveMode === "batch") {
            console.log("Batch save mode, storing to local storage");
            // Save to chrome.storage.local
            storeDOMCapture(filename, domContent, activeTab.url, activeTab.title)
              .then(() => {
                console.log("DOM capture stored successfully");
                safeResponse({ status: "success", message: "Capture saved to batch" });
              })
              .catch(error => {
                console.error("Error storing DOM capture:", error);
                safeResponse({ status: "error", message: "Failed to save capture: " + error.message });
              });
          } else {
            console.log("Direct save mode, initiating download");
            // Direct download mode (original behavior)
            // Create a Blob with the DOM content
            const blob = new Blob([domContent], { type: 'text/html' });
            // Create a URL for the Blob
            const url = URL.createObjectURL(blob);
            console.log("Blob URL created");

            // Use the chrome.downloads API to trigger a download
            console.log("Initiating download...");
            chrome.downloads.download({
              url: url,
              filename: filename,
              saveAs: true // Prompts the user to choose the save location
            }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError.message);
                safeResponse({ status: "error", message: "Download failed: " + chrome.runtime.lastError.message });
              } else if (downloadId) {
                console.log("Download initiated with ID:", downloadId);
                // Immediate response to help ensure popup gets it
                safeResponse({ status: "success" });
              } else {
                console.error("Download did not start, no ID received.");
                safeResponse({ status: "error", message: "Download did not start." });
              }
              // Revoke the blob URL after some time to free up resources
              setTimeout(() => {
                console.log("Revoking blob URL");
                URL.revokeObjectURL(url);
              }, 10000);
            });
          }
        } else {
          console.error("No DOM content received from page");
          safeResponse({ status: "error", message: "No DOM content received." });
        }
      });
    });
    console.log("Returning true to keep message channel open");
    return true; // Indicates that sendResponse will be called asynchronously
  }
  
  // Handle exporting all saved captures as a ZIP
  else if (request.action === "exportZIP") {
    console.log("Processing exportZIP action");
    exportCapturesAsZIP()
      .then((downloadId) => {
        console.log("ZIP export complete, download ID:", downloadId);
        safeResponse({ status: "success", message: "Captures exported as ZIP" });
      })
      .catch(error => {
        console.error("Error exporting ZIP:", error);
        safeResponse({ status: "error", message: "Failed to export captures: " + error.message });
      });
    return true; // Indicates that sendResponse will be called asynchronously
  }
  
  // Handle getting the count of saved captures
  else if (request.action === "getCaptures") {
    console.log("Processing getCaptures action");
    getSavedCaptures()
      .then(captures => {
        console.log("Retrieved captures, count:", captures.length);
        safeResponse({ 
          status: "success", 
          captures: captures,
          count: captures.length
        });
      })
      .catch(error => {
        console.error("Error getting captures:", error);
        safeResponse({ status: "error", message: "Failed to get captures: " + error.message });
      });
    return true; // Indicates that sendResponse will be called asynchronously
  }
  
  // Handle clearing all saved captures
  else if (request.action === "clearCaptures") {
    console.log("Processing clearCaptures action");
    chrome.storage.local.set({ domCaptures: [] }, () => {
      if (chrome.runtime.lastError) {
        console.error("Error clearing captures:", chrome.runtime.lastError);
        safeResponse({ status: "error", message: "Failed to clear captures: " + chrome.runtime.lastError.message });
      } else {
        console.log("Captures cleared successfully");
        safeResponse({ status: "success", message: "All captures cleared" });
      }
    });
    return true; // Indicates that sendResponse will be called asynchronously
  }
});

// Store a DOM capture in chrome.storage.local
async function storeDOMCapture(filename, content, url, title) {
  console.log("Storing DOM capture:", filename);
  // Get existing captures
  const data = await chrome.storage.local.get('domCaptures');
  const captures = data.domCaptures || [];
  console.log("Current capture count:", captures.length);
  
  // Add new capture
  captures.push({
    filename,
    content,
    url,
    title,
    timestamp: new Date().toISOString()
  });
  
  // Save back to storage
  console.log("Saving updated captures, new count:", captures.length);
  await chrome.storage.local.set({ domCaptures: captures });
  console.log("Capture saved successfully");
  
  return true;
}

// Get all saved captures
async function getSavedCaptures() {
  console.log("Getting saved captures");
  const data = await chrome.storage.local.get('domCaptures');
  console.log("Retrieved captures from storage:", data.domCaptures ? data.domCaptures.length : 0);
  return data.domCaptures || [];
}

// Export all saved captures as a ZIP file
async function exportCapturesAsZIP() {
  console.log("Starting ZIP export");
  // Get all saved captures
  const captures = await getSavedCaptures();
  console.log("Retrieved", captures.length, "captures for ZIP export");
  
  if (captures.length === 0) {
    console.error("No captures available to export");
    throw new Error("No captures available to export");
  }
  
  // Create a new JSZip instance
  console.log("Creating new JSZip instance");
  const zip = new JSZip();
  
  // Add each capture to the ZIP
  console.log("Adding files to ZIP");
  captures.forEach(capture => {
    console.log("Adding file to ZIP:", capture.filename);
    zip.file(capture.filename, capture.content);
  });
  
  // Generate the ZIP file
  console.log("Generating ZIP blob");
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  console.log("ZIP blob generated, size:", zipBlob.size);
  
  // Create a timestamp for the ZIP filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipFilename = `dom_captures_${timestamp}.zip`;
  console.log("ZIP filename:", zipFilename);
  
  // Download the ZIP file
  const url = URL.createObjectURL(zipBlob);
  console.log("Created blob URL for ZIP");
  console.log("Initiating ZIP download");
  const downloadId = await chrome.downloads.download({
    url: url,
    filename: zipFilename,
    saveAs: true
  });
  console.log("ZIP download initiated, ID:", downloadId);
  
  // Revoke the URL after a delay
  setTimeout(() => {
    console.log("Revoking ZIP blob URL");
    URL.revokeObjectURL(url);
  }, 10000);
  
  return downloadId;
}

// This function will be injected into the web page to retrieve its full HTML (DOM)
function getPageDOM() {
  console.log("getPageDOM function executing in page context");
  // Check if it's an XML document (e.g. RSS feed)
  if (document.contentType === 'text/xml' || document.contentType === 'application/xml' || document.documentElement.tagName === 'rss' || document.documentElement.tagName === 'feed') {
    console.log("XML document detected, using XMLSerializer");
    const serializer = new XMLSerializer();
    return serializer.serializeToString(document);
  }
  // For HTML documents
  console.log("HTML document detected, using outerHTML");
  return document.documentElement.outerHTML;
}
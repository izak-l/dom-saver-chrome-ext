// popup.js
// This script handles the logic for popup.html.

// Get DOM elements
const saveDOMButton = document.getElementById('saveDOMButton');
const saveToStorageButton = document.getElementById('saveToStorageButton');
const exportZIPButton = document.getElementById('exportZIPButton');
const clearCapturesButton = document.getElementById('clearCapturesButton');
const statusP = document.getElementById('status');
const captureCountP = document.getElementById('captureCount');

// Initialize the UI
document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup initialized");
  updateCaptureCount();
});

// Save DOM as immediate download
saveDOMButton.addEventListener('click', () => {
  console.log("Save DOM button clicked");
  saveDOMHandler('direct');
});

// Save DOM to storage for batch export
saveToStorageButton.addEventListener('click', () => {
  console.log("Save to storage button clicked");
  saveDOMHandler('batch');
});

// Export all saved DOMs as a ZIP file
exportZIPButton.addEventListener('click', () => {
  console.log("Export ZIP button clicked");
  // Disable buttons during export
  setButtonsEnabled(false);
  statusP.textContent = 'Creating ZIP file...';

  console.log("Sending exportZIP message to background");
  chrome.runtime.sendMessage({ action: "exportZIP" }, (response) => {
    console.log("Received exportZIP response:", response);
    // Check if the message port is still open
    if (chrome.runtime.lastError) {
      console.error("Error exporting ZIP:", chrome.runtime.lastError.message);
      statusP.textContent = 'Error: ' + chrome.runtime.lastError.message;
      setButtonsEnabled(true);
      return;
    }

    if (response && response.status === "success") {
      console.log("ZIP export successful");
      statusP.textContent = 'ZIP download initiated!';
      setButtonsEnabled(true); // Re-enable buttons before closing
      
      // Wait a bit longer to make sure download starts first
      console.log("Will close popup in 3 seconds");
      setTimeout(() => {
        console.log("Closing popup");
        window.close();
      }, 3000);
    } else if (response && response.status === "error") {
      console.error("ZIP export error:", response.message);
      statusP.textContent = 'Error: ' + (response.message || 'Unknown error');
      setButtonsEnabled(true);
    } else {
      console.error("No response or unknown error for ZIP export");
      statusP.textContent = 'No response or unknown error.';
      setButtonsEnabled(true);
    }
  });
});

// Clear all saved DOM captures
clearCapturesButton.addEventListener('click', () => {
  console.log("Clear captures button clicked");
  if (confirm('Are you sure you want to clear all saved captures?')) {
    console.log("Confirmed clear, sending clearCaptures message");
    chrome.runtime.sendMessage({ action: "clearCaptures" }, (response) => {
      console.log("Received clearCaptures response:", response);
      if (chrome.runtime.lastError) {
        console.error("Error clearing captures:", chrome.runtime.lastError.message);
        statusP.textContent = 'Error: ' + chrome.runtime.lastError.message;
        return;
      }

      if (response && response.status === "success") {
        console.log("Captures cleared successfully");
        statusP.textContent = 'All captures cleared!';
        updateCaptureCount();
      } else if (response && response.status === "error") {
        console.error("Clear captures error:", response.message);
        statusP.textContent = 'Error: ' + (response.message || 'Unknown error');
      } else {
        console.error("No response or unknown error for clear captures");
        statusP.textContent = 'No response or unknown error.';
      }
    });
  } else {
    console.log("Clear operation cancelled by user");
  }
});

// Common function to handle DOM saving (direct download or batch mode)
function saveDOMHandler(saveMode) {
  console.log(`SaveDOM handler called with mode: ${saveMode}`);
  
  // Disable all buttons to prevent multiple clicks
  setButtonsEnabled(false);
  statusP.textContent = 'Processing...';

  // Set a timeout to re-enable buttons if no response is received
  console.log("Setting response timeout");
  const timeoutId = setTimeout(() => {
    console.warn("Response timeout - re-enabling buttons");
    statusP.textContent = 'No response received. Please try again.';
    setButtonsEnabled(true);
  }, 10000); // 10 second timeout

  // Try more direct approach for direct save
  if (saveMode === 'direct') {
    console.log("Using direct approach for saveDOM");
    // Send a message to the background script to save the DOM
    console.log("Sending saveDOM message to background");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log("Got active tabs:", tabs);
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        console.error("Error querying tabs:", chrome.runtime.lastError?.message);
        clearTimeout(timeoutId);
        statusP.textContent = 'Error: Could not get active tab.';
        setButtonsEnabled(true);
        return;
      }

      const activeTab = tabs[0];
      console.log("Active tab:", activeTab.url);

      console.log("Injecting script to get DOM");
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        function: function() {
          // Simplified version just for direct save
          if (document.contentType === 'text/xml' || document.contentType === 'application/xml') {
            const serializer = new XMLSerializer();
            return serializer.serializeToString(document);
          }
          return document.documentElement.outerHTML;
        }
      }, (injectionResults) => {
        console.log("Script execution complete");
        
        if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
          console.error("Error injecting script:", chrome.runtime.lastError?.message);
          clearTimeout(timeoutId);
          statusP.textContent = 'Error: Failed to get DOM content.';
          setButtonsEnabled(true);
          return;
        }

        const domContent = injectionResults[0].result;
        console.log("DOM content received, length:", domContent ? domContent.length : 0);

        if (!domContent) {
          console.error("No DOM content received");
          clearTimeout(timeoutId);
          statusP.textContent = 'Error: No DOM content received.';
          setButtonsEnabled(true);
          return;
        }

        // Generate filename
        let filename = "page_dom.html";
        try {
          const tabUrl = new URL(activeTab.url);
          const hostname = tabUrl.hostname.replace(/^www\./, '');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          filename = `${hostname}_${timestamp}.html`;
          console.log("Generated filename:", filename);
        } catch (e) {
          console.warn("Could not parse URL for filename:", activeTab.url, e);
        }

        // Create and download blob
        console.log("Creating blob for download");
        const blob = new Blob([domContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);

        console.log("Initiating download");
        chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: true
        }, (downloadId) => {
          clearTimeout(timeoutId);
          
          if (chrome.runtime.lastError) {
            console.error("Download failed:", chrome.runtime.lastError.message);
            statusP.textContent = 'Error: Download failed.';
            setButtonsEnabled(true);
          } else if (downloadId) {
            console.log("Download initiated with ID:", downloadId);
            statusP.textContent = 'DOM download initiated!';
            setButtonsEnabled(true);
            
            console.log("Will close popup in 3 seconds");
            setTimeout(() => {
              console.log("Closing popup");
              window.close();
            }, 3000);
          } else {
            console.error("Download did not start, no ID received");
            statusP.textContent = 'Error: Download did not start.';
            setButtonsEnabled(true);
          }
          
          // Clean up the blob URL
          setTimeout(() => {
            console.log("Revoking blob URL");
            URL.revokeObjectURL(url);
          }, 10000);
        });
      });
    });
    
    return; // Skip the message-based approach for direct save
  }
  
  // Standard approach for batch save
  console.log("Sending saveDOM message to background");
  chrome.runtime.sendMessage({ action: "saveDOM", saveMode }, (response) => {
    console.log("Received saveDOM response:", response);
    // Clear the timeout since we got a response
    clearTimeout(timeoutId);
    
    if (chrome.runtime.lastError) {
      console.error("Error sending message:", chrome.runtime.lastError.message);
      statusP.textContent = 'Error: ' + chrome.runtime.lastError.message;
      setButtonsEnabled(true); // Re-enable the buttons
      return;
    }

    if (response && response.status === "success") {
      console.log("saveDOM successful with mode:", saveMode);
      if (saveMode === 'batch') {
        statusP.textContent = 'DOM saved to batch!';
        updateCaptureCount();
        setButtonsEnabled(true); // Re-enable the buttons
      } else {
        statusP.textContent = 'DOM download initiated!';
        setButtonsEnabled(true); // Re-enable buttons before closing
        
        // Wait a bit longer to make sure download starts first
        console.log("Will close popup in 3 seconds");
        setTimeout(() => {
          console.log("Closing popup");
          window.close();
        }, 3000);
      }
    } else if (response && response.status === "error") {
      console.error("saveDOM error:", response.message);
      statusP.textContent = 'Error: ' + (response.message || 'Unknown error');
      setButtonsEnabled(true); // Re-enable the buttons
    } else {
      console.error("No response or unknown error for saveDOM");
      statusP.textContent = 'No response or unknown error.';
      setButtonsEnabled(true); // Re-enable the buttons
    }
  });
}

// Enable or disable all buttons
function setButtonsEnabled(enabled) {
  console.log("Setting buttons enabled:", enabled);
  saveDOMButton.disabled = !enabled;
  saveToStorageButton.disabled = !enabled;
  exportZIPButton.disabled = !enabled;
  clearCapturesButton.disabled = !enabled;
}

// Update the capture count in the UI
function updateCaptureCount() {
  console.log("Updating capture count");
  chrome.runtime.sendMessage({ action: "getCaptures" }, (response) => {
    console.log("Received getCaptures response:", response);
    if (chrome.runtime.lastError) {
      console.error("Error getting captures count:", chrome.runtime.lastError.message);
      captureCountP.textContent = 'Error getting count';
      return;
    }

    if (response && response.status === "success") {
      const count = response.count || 0;
      console.log("Updated capture count:", count);
      captureCountP.textContent = `Saved captures: ${count}`;
      
      // Disable export and clear buttons if there are no captures
      exportZIPButton.disabled = count === 0;
      clearCapturesButton.disabled = count === 0;
    } else {
      console.error("Error or no response for getCaptures");
      captureCountP.textContent = 'Error getting count';
    }
  });
}
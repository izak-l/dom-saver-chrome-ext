// background.js
// This script runs in the background and handles the core logic.

// Import JSZip library
try {
  self.importScripts('jszip.js');
  console.log("JSZip loaded successfully in background");
} catch (error) {
  console.error("Failed to load JSZip:", error);
}

// Import scrapers registry
try {
  self.importScripts('scrapers.js');
  console.log("Scrapers loaded successfully in background");
} catch (error) {
  console.error("Failed to load scrapers:", error);
}

// Clean up any temporary storage on startup
chrome.runtime.onStartup.addListener(() => {
  cleanupTemporaryStorage();
});

chrome.runtime.onInstalled.addListener(() => {
  cleanupTemporaryStorage();
});

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
            console.log("Blob created for HTML content");

            // Convert Blob to data URI with FileReader
            console.log("Converting blob to data URI");
            const reader = new FileReader();
            reader.onload = function() {
              const dataUrl = reader.result;
              console.log("Data URI created, initiating download");
              
              // Use the chrome.downloads API to trigger a download
              chrome.downloads.download({
                url: dataUrl,
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
              });
            };
            
            reader.onerror = function() {
              console.error("FileReader error:", reader.error);
              safeResponse({ status: "error", message: "Failed to read HTML content: " + reader.error });
            };
            
            reader.readAsDataURL(blob);
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
    getSavedCaptures()
      .then(captures => {
        if (captures.length === 0) {
          safeResponse({ 
            status: "error", 
            message: "No captures available to export" 
          });
          return;
        }
        
        console.log(`Sending ${captures.length} captures back to popup for ZIP creation`);
        // Just send the captures data back to the popup where JSZip is loaded in browser context
        safeResponse({ 
          status: "success", 
          captures: captures
        });
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
  
  // Handle getting available scrapers for current page
  else if (request.action === "getAvailableScrapers") {
    console.log("Processing getAvailableScrapers action");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        console.error("Error querying tabs:", chrome.runtime.lastError?.message);
        safeResponse({ status: "error", message: "Could not get active tab." });
        return;
      }

      const activeTab = tabs[0];
      const availableScrapers = scraperRegistry.findMatchingScrapers(activeTab.url);
      
      console.log(`Found ${availableScrapers.length} available scrapers for ${activeTab.url}`);
      safeResponse({ 
        status: "success", 
        scrapers: availableScrapers.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description
        }))
      });
    });
    return true;
  }
  
  // Handle executing a specific scraper
  else if (request.action === "executeScraper") {
    console.log("Processing executeScraper action:", request.scraperId);
    const scraper = scraperRegistry.getScraper(request.scraperId);
    
    if (!scraper) {
      safeResponse({ status: "error", message: "Scraper not found" });
      return;
    }
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        console.error("Error querying tabs:", chrome.runtime.lastError?.message);
        safeResponse({ status: "error", message: "Could not get active tab." });
        return;
      }

      const activeTab = tabs[0];
      console.log("Capturing DOM for scraper execution:", activeTab.url);
      
      // Step 1: Capture DOM and run scraper in content script context
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        function: function(scraperId, pageUrl, pageTitle) {
          // This runs in the page context where DOM is available
          try {
            // Create a minimal scraper registry in page context
            const linkedinCompanyScraper = {
              id: 'linkedin-company-people',
              extract: function(doc, pageUrl, pageTitle) {
                console.log('LinkedIn Company People scraper executing...');
                
                // Find all anchor tags with aria-label containing "View" and "profile"
                const profileData = [];
                const anchors = doc.querySelectorAll('a[aria-label*="View"][aria-label*="profile"]');
                
                anchors.forEach(anchor => {
                  if (anchor.href) {
                    // Truncate URL to remove query parameters
                    const baseUrl = anchor.href.split('?')[0];
                    if (baseUrl.includes('linkedin.com/in/')) {
                      // Find the blurb text - it's in a sibling container
                      let blurb = "";
                      
                      // The blurb is in the artdeco-entity-lockup__subtitle which is a sibling of the title containing the anchor
                      const lockupContent = anchor.closest('.artdeco-entity-lockup__content');
                      if (lockupContent) {
                        const blurbElement = lockupContent.querySelector('.artdeco-entity-lockup__subtitle div.ember-view.lt-line-clamp.lt-line-clamp--multi-line[style="-webkit-line-clamp: 2"]');
                        if (blurbElement) {
                          blurb = blurbElement.textContent.trim();
                        }
                      }
                      
                      profileData.push({
                        url: baseUrl,
                        blurb: blurb || ""
                      });
                    }
                  }
                });

                // Also look for profile links in different structures
                const profileAnchors = doc.querySelectorAll('a[href*="/in/"]');
                profileAnchors.forEach(anchor => {
                  if (anchor.href && anchor.href.includes('linkedin.com/in/')) {
                    const baseUrl = anchor.href.split('?')[0];
                    
                    // Check if we already have this profile
                    const existingProfile = profileData.find(p => p.url === baseUrl);
                    if (!existingProfile) {
                      // Find blurb for this profile link too
                      let blurb = "";
                      
                      const lockupContent = anchor.closest('.artdeco-entity-lockup__content');
                      if (lockupContent) {
                        const blurbElement = lockupContent.querySelector('.artdeco-entity-lockup__subtitle div.ember-view.lt-line-clamp.lt-line-clamp--multi-line[style="-webkit-line-clamp: 2"]');
                        if (blurbElement) {
                          blurb = blurbElement.textContent.trim();
                        }
                      }
                      
                      profileData.push({
                        url: baseUrl,
                        blurb: blurb || ""
                      });
                    }
                  }
                });

                // Remove duplicates based on URL and sort
                const uniqueProfiles = profileData.filter((profile, index, self) => 
                  index === self.findIndex(p => p.url === profile.url)
                ).sort((a, b) => a.url.localeCompare(b.url));
                
                console.log(`Found ${uniqueProfiles.length} LinkedIn profiles with blurbs`);
                
                return {
                  type: 'linkedin-profiles',
                  data: uniqueProfiles,
                  count: uniqueProfiles.length,
                  extractedAt: new Date().toISOString(),
                  pageUrl: pageUrl,
                  pageTitle: pageTitle
                };
              }
            };
            
            // Execute scraper on live document
            if (scraperId === 'linkedin-company-people') {
              const result = linkedinCompanyScraper.extract(document, pageUrl, pageTitle);
              return { success: true, result: result };
            } else {
              return { error: 'Unknown scraper: ' + scraperId };
            }
            
          } catch (error) {
            console.error('Scraper execution error:', error);
            return { error: error.message };
          }
        },
        args: [request.scraperId, activeTab.url, activeTab.title]
      }, (injectionResults) => {
        if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
          console.error("Error executing scraper:", chrome.runtime.lastError?.message);
          safeResponse({ status: "error", message: "Failed to execute scraper." });
          return;
        }

        const scriptResult = injectionResults[0].result;
        if (!scriptResult) {
          safeResponse({ status: "error", message: "No result from scraper execution." });
          return;
        }

        if (scriptResult.error) {
          safeResponse({ status: "error", message: scriptResult.error });
          return;
        }

        if (scriptResult.success) {
          const result = scriptResult.result;
          console.log("Scraper execution result:", result);
          
          // Handle results
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `${scraper.id}_${timestamp}.json`;
          const content = JSON.stringify(result, null, 2);
          
          if (request.saveMode === "batch") {
            storeDOMCapture(filename, content, activeTab.url, activeTab.title)
              .then(() => {
                safeResponse({ 
                  status: "success", 
                  message: "Scraper results saved to batch",
                  result: result
                });
              })
              .catch(error => {
                safeResponse({ status: "error", message: "Failed to save results: " + error.message });
              });
          } else {
            // Direct download
            const blob = new Blob([content], { type: 'application/json' });
            const reader = new FileReader();
            reader.onload = function() {
              const dataUrl = reader.result;
              chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                saveAs: true
              }, (downloadId) => {
                if (chrome.runtime.lastError) {
                  safeResponse({ status: "error", message: "Download failed: " + chrome.runtime.lastError.message });
                } else {
                  safeResponse({ 
                    status: "success", 
                    message: "Scraper results downloaded",
                    result: result
                  });
                }
              });
            };
            reader.readAsDataURL(blob);
          }
        }
      });
    });
    return true;
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
  
  // Convert Blob to base64 data URI
  return new Promise((resolve, reject) => {
    console.log("Converting blob to data URI");
    const reader = new FileReader();
    reader.onload = function() {
      const dataUrl = reader.result;
      console.log("Data URI created, length:", dataUrl.length);
      
      console.log("Initiating ZIP download with data URI");
      chrome.downloads.download({
        url: dataUrl,
        filename: zipFilename,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error("Download failed:", chrome.runtime.lastError);
          reject(new Error("Download failed: " + chrome.runtime.lastError.message));
        } else {
          console.log("ZIP download initiated, ID:", downloadId);
          resolve(downloadId);
        }
      });
    };
    
    reader.onerror = function() {
      console.error("FileReader error:", reader.error);
      reject(new Error("Failed to read ZIP blob: " + reader.error));
    };
    
    reader.readAsDataURL(zipBlob);
  });
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

// Clean up temporary DOM storage
async function cleanupTemporaryStorage() {
  console.log("Cleaning up temporary storage");
  try {
    const data = await chrome.storage.local.get();
    const keysToRemove = [];
    const cutoffTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago
    
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('temp_dom_')) {
        // Remove if older than 5 minutes or malformed
        if (!value.timestamp || value.timestamp < cutoffTime) {
          keysToRemove.push(key);
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      console.log(`Removing ${keysToRemove.length} temporary DOM entries`);
      await chrome.storage.local.remove(keysToRemove);
    }
  } catch (error) {
    console.error("Error cleaning up temporary storage:", error);
  }
}
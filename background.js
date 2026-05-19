const DEFAULT_REPO = "sagive/stepflow";
const DEFAULT_BRANCH = "main";
const DEFAULT_INTERVAL = 60; // minutes

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("StepFlow Extension Installed!");
  
  // Set default settings if they do not exist
  const settings = await chrome.storage.local.get(["githubRepo", "githubBranch", "syncInterval"]);
  const newSettings = {};
  if (!settings.githubRepo) newSettings.githubRepo = DEFAULT_REPO;
  if (!settings.githubBranch) newSettings.githubBranch = DEFAULT_BRANCH;
  if (!settings.syncInterval) newSettings.syncInterval = DEFAULT_INTERVAL;
  
  if (Object.keys(newSettings).length > 0) {
    await chrome.storage.local.set(newSettings);
  }

  // Load local fallback scenarios first so it works out of the box
  await loadLocalFallbackScenarios();

  // Set up periodic sync alarm
  setupSyncAlarm(newSettings.syncInterval || settings.syncInterval);
});

// Setup alarm for periodic sync
function setupSyncAlarm(intervalMinutes) {
  chrome.alarms.clear("sync-scenarios", () => {
    chrome.alarms.create("sync-scenarios", {
      periodInMinutes: parseInt(intervalMinutes) || DEFAULT_INTERVAL
    });
    console.log(`Periodic sync scheduled every ${intervalMinutes} minutes.`);
  });
}

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync-scenarios") {
    console.log("Triggering periodic scenario sync...");
    syncScenarios();
  }
});

// Listen for message requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "sync_now") {
    syncScenarios().then((result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  }
  if (message.action === "update_alarm") {
    setupSyncAlarm(message.interval);
    sendResponse({ success: true });
  }
});

// Load local bundled scenarios as initial/fallback state
async function loadLocalFallbackScenarios() {
  try {
    const manifestUrl = chrome.runtime.getURL("tutorials/index.json");
    const res = await fetch(manifestUrl);
    const manifest = await res.json();
    
    const scenarios = [];
    for (const item of manifest.tutorials) {
      try {
        const scenarioRes = await fetch(chrome.runtime.getURL(item.file));
        const scenarioData = await scenarioRes.json();
        scenarios.push({
          id: item.id,
          name: item.name,
          urlPattern: item.urlPattern,
          steps: scenarioData.steps
        });
      } catch (err) {
        console.error(`Failed to load local scenario file: ${item.file}`, err);
      }
    }
    
    if (scenarios.length > 0) {
      await chrome.storage.local.set({ scenarios });
      console.log("Successfully loaded local fallback scenarios:", scenarios);
    }
  } catch (err) {
    console.error("Failed to load local fallback scenarios manifest:", err);
  }
}

// Main sync logic
async function syncScenarios() {
  await chrome.storage.local.set({ syncStatus: "syncing", syncError: null });
  console.log("Starting sync with GitHub...");

  try {
    const data = await chrome.storage.local.get(["githubRepo", "githubBranch"]);
    const repo = data.githubRepo || DEFAULT_REPO;
    const branch = data.githubBranch || DEFAULT_BRANCH;

    const indexUrl = `https://raw.githubusercontent.com/${repo}/${branch}/tutorials/index.json`;
    console.log(`Fetching index from: ${indexUrl}`);
    
    const res = await fetch(indexUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest index.json from Git (Status: ${res.status}). Ensure repository is public and branches/paths are correct.`);
    }
    
    const manifest = await res.json();
    if (!manifest.tutorials || !Array.isArray(manifest.tutorials)) {
      throw new Error("Invalid manifest format. 'tutorials' array is missing.");
    }

    const scenarios = [];
    for (const item of manifest.tutorials) {
      if (!item.file || !item.urlPattern) continue;
      
      const fileUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${item.file}`;
      console.log(`Fetching scenario file from: ${fileUrl}`);
      
      const scenarioRes = await fetch(fileUrl);
      if (!scenarioRes.ok) {
        throw new Error(`Failed to fetch scenario file ${item.file} (Status: ${scenarioRes.status})`);
      }
      
      const scenarioData = await scenarioRes.json();
      scenarios.push({
        id: item.id || Math.random().toString(36).substr(2, 9),
        name: item.name || "Unnamed Walkthrough",
        urlPattern: item.urlPattern,
        steps: scenarioData.steps || []
      });
    }

    await chrome.storage.local.set({
      scenarios,
      syncStatus: "success",
      lastSynced: Date.now(),
      syncError: null
    });
    console.log("Sync complete! Saved scenarios:", scenarios);
    return { success: true, count: scenarios.length };
  } catch (error) {
    console.error("Sync failed:", error);
    await chrome.storage.local.set({
      syncStatus: "error",
      syncError: error.message
    });
    return { success: false, error: error.message };
  }
}

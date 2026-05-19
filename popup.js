// StepFlow Popup JS

document.addEventListener("DOMContentLoaded", async () => {
  const btnSettings = document.getElementById("btn-settings");
  const btnLaunch = document.getElementById("btn-launch-tutorial");
  const btnSync = document.getElementById("btn-sync");
  const syncIcon = document.getElementById("sync-icon");
  const syncLabel = document.getElementById("sync-label");
  const statusDot = document.getElementById("status-dot");
  
  let currentTab = null;
  let matchingScenario = null;

  // Open settings page
  btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Query active tab URL
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs && tabs[0]) {
      currentTab = tabs[0];
      await updatePopupUI();
    }
  });

  // Launch tutorial on click
  btnLaunch.addEventListener("click", () => {
    if (matchingScenario && currentTab) {
      chrome.tabs.sendMessage(currentTab.id, {
        action: "start_tutorial",
        scenarioId: matchingScenario.id
      }, (response) => {
        // Close popup
        window.close();
      });
    }
  });

  // Footer manual sync
  btnSync.addEventListener("click", () => {
    btnSync.disabled = true;
    syncIcon.style.display = "inline-block";
    syncIcon.style.animation = "spin 1s linear infinite";
    statusDot.className = "status-dot syncing";
    syncLabel.textContent = "Syncing...";

    chrome.runtime.sendMessage({ action: "sync_now" }, async (response) => {
      btnSync.disabled = false;
      syncIcon.style.animation = "none";
      await updatePopupUI();
    });
  });
});

// Update the entire popup UI based on current tab and cache
async function updatePopupUI() {
  const btnLaunch = document.getElementById("btn-launch-tutorial");
  const matchTitle = document.getElementById("match-title");
  const matchDesc = document.getElementById("match-desc");
  const listContainer = document.getElementById("tutorial-list");
  const statusDot = document.getElementById("status-dot");
  const syncLabel = document.getElementById("sync-label");

  // Load scenarios from storage
  const data = await chrome.storage.local.get([
    "scenarios",
    "syncStatus",
    "lastSynced",
    "syncError"
  ]);

  const scenarios = data.scenarios || [];
  const currentTab = await getActiveTab();
  
  let matchingScenario = null;

  if (currentTab && currentTab.url) {
    const currentUrl = currentTab.url;
    matchingScenario = scenarios.find(scenario => isUrlMatch(currentUrl, scenario.urlPattern));
  }

  // 1. Update Match Card
  if (matchingScenario) {
    matchTitle.textContent = matchingScenario.name;
    const stepsCount = matchingScenario.steps ? matchingScenario.steps.length : 0;
    matchDesc.textContent = `A walkthrough tutorial is available for this website. Features ${stepsCount} interactive highlight steps.`;
    
    // Enable launch button
    btnLaunch.disabled = false;
    btnLaunch.textContent = "✨ Launch Walkthrough";
    btnLaunch.className = "btn-action btn-primary";
    
    // Bind current matching scenario to a global variable
    window.matchingScenario = matchingScenario;
  } else {
    matchTitle.textContent = "No Tutorial Here";
    matchDesc.textContent = "There is no walkthrough matched to this page URL. You can check out the testing sandbox dashboard instead.";
    
    // Modify button to open sandbox page
    btnLaunch.disabled = false;
    btnLaunch.textContent = "🚀 Open Test Sandbox";
    btnLaunch.className = "btn-action btn-secondary";
    
    // Clean global matching variable
    window.matchingScenario = null;
    
    // Remove existing event listeners and bind sandbox opener
    const newBtnLaunch = btnLaunch.cloneNode(true);
    btnLaunch.parentNode.replaceChild(newBtnLaunch, btnLaunch);
    newBtnLaunch.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("sandbox.html") });
    });
  }

  // 2. Render all scenarios list
  listContainer.innerHTML = "";
  if (scenarios.length === 0) {
    listContainer.innerHTML = `
      <p style="color: var(--text-muted); font-size: 11px; font-style: italic; text-align: center; padding: 10px 0;">
        No tutorials loaded. Click Sync in the footer.
      </p>
    `;
  } else {
    scenarios.forEach(scenario => {
      const item = document.createElement("div");
      item.className = "tutorial-item";
      
      const stepsCount = scenario.steps ? scenario.steps.length : 0;
      
      item.innerHTML = `
        <div class="tutorial-item-info">
          <div class="tutorial-item-name">${escapeHtml(scenario.name)}</div>
          <span class="tutorial-item-pattern">${escapeHtml(scenario.urlPattern)}</span>
        </div>
        <button class="btn-play-small" data-id="${scenario.id}">
          Launch (${stepsCount})
        </button>
      `;
      
      listContainer.appendChild(item);
    });

    // Add click listeners to list item buttons
    listContainer.querySelectorAll(".btn-play-small").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const scenarioId = e.target.dataset.id;
        const scenario = scenarios.find(s => s.id === scenarioId);
        if (scenario) {
          triggerScenarioLaunch(scenario);
        }
      });
    });
  }

  // 3. Update Sync Status in footer
  const status = data.syncStatus || "idle";
  statusDot.className = "status-dot";
  if (status === "success") statusDot.classList.add("success");
  else if (status === "error") statusDot.classList.add("error");
  else if (status === "syncing") statusDot.classList.add("syncing");
  else statusDot.classList.add("success");

  if (data.lastSynced) {
    const timeStr = new Date(data.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    syncLabel.textContent = `Synced: ${timeStr}`;
  } else {
    syncLabel.textContent = "Not Synced";
  }
}

// Open / Launch tutorial from list item click
async function triggerScenarioLaunch(scenario) {
  const currentTab = await getActiveTab();
  if (!currentTab) return;

  if (isUrlMatch(currentTab.url, scenario.urlPattern)) {
    // Current tab matches, trigger walkthrough in content script
    chrome.tabs.sendMessage(currentTab.id, {
      action: "start_tutorial",
      scenarioId: scenario.id
    }, () => {
      window.close();
    });
  } else {
    // Current tab does not match
    if (scenario.urlPattern.includes("sandbox.html")) {
      // It's the sandbox, open sandbox
      chrome.tabs.create({ url: chrome.runtime.getURL("sandbox.html") });
      window.close();
    } else {
      alert(`To run this walkthrough, please navigate to the matching page: ${scenario.urlPattern}`);
    }
  }
}

// Get active browser tab helper
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs ? tabs[0] : null);
    });
  });
}

// Check if URL matches a pattern
function isUrlMatch(currentUrl, pattern) {
  try {
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const lastSlashIdx = pattern.lastIndexOf("/");
      const regexStr = pattern.substring(1, lastSlashIdx);
      const flags = pattern.substring(lastSlashIdx + 1);
      return new RegExp(regexStr, flags).test(currentUrl);
    }
    return currentUrl.toLowerCase().includes(pattern.toLowerCase());
  } catch (err) {
    return currentUrl.toLowerCase().includes(pattern.toLowerCase());
  }
}

// HTML escaping helper
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Spin style injection
const spinStyle = document.createElement("style");
spinStyle.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(spinStyle);

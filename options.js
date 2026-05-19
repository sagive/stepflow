// StepFlow Options JS

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("settings-form");
  const repoInput = document.getElementById("github-repo");
  const branchInput = document.getElementById("github-branch");
  const intervalSelect = document.getElementById("sync-interval");
  const btnSyncNow = document.getElementById("btn-sync-now");
  const syncIcon = document.getElementById("sync-icon");
  
  // Load settings and update UI
  loadSettings();
  
  // Form submission to save settings
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const settings = {
      githubRepo: repoInput.value.trim(),
      githubBranch: branchInput.value.trim(),
      syncInterval: parseInt(intervalSelect.value)
    };
    
    await chrome.storage.local.set(settings);
    
    // Notify background worker to reschedule sync alarms
    chrome.runtime.sendMessage({ 
      action: "update_alarm", 
      interval: settings.syncInterval 
    }, () => {
      showToast("Settings saved successfully!");
      loadSettings();
    });
  });

  // Manual Sync trigger
  btnSyncNow.addEventListener("click", () => {
    // Put button and monitor into syncing state
    btnSyncNow.disabled = true;
    syncIcon.style.display = "inline-block";
    syncIcon.style.animation = "spin 1s linear infinite";
    
    updateStatusUI("syncing", null, null);
    
    chrome.runtime.sendMessage({ action: "sync_now" }, (response) => {
      btnSyncNow.disabled = false;
      syncIcon.style.animation = "none";
      
      if (response && response.success) {
        showToast(`Sync complete! Loaded ${response.count} scenarios.`);
      } else {
        const errMsg = response ? response.error : "Unknown sync error";
        showToast(`Sync failed: ${errMsg}`, true);
      }
      
      // Reload UI to show new states
      loadSettings();
    });
  });

  // Listen for changes in storage (e.g. sync finishing in the background)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      loadSettings();
    }
  });
});

// Load options and statuses from storage
async function loadSettings() {
  const data = await chrome.storage.local.get([
    "githubRepo",
    "githubBranch",
    "syncInterval",
    "syncStatus",
    "lastSynced",
    "syncError",
    "scenarios"
  ]);

  // Update inputs
  document.getElementById("github-repo").value = data.githubRepo || "sagive/stepflow";
  document.getElementById("github-branch").value = data.githubBranch || "main";
  document.getElementById("sync-interval").value = data.syncInterval || "60";

  // Update monitor UI
  const status = data.syncStatus || "idle";
  const error = data.syncError || null;
  const lastSync = data.lastSynced || null;
  const scenarios = data.scenarios || [];

  updateStatusUI(status, error, lastSync);
  
  // Update scenarios list
  document.getElementById("cached-scenarios-count").textContent = scenarios.length;
  document.getElementById("source-badge").textContent = `${data.githubRepo || "sagive/stepflow"} [${data.githubBranch || "main"}]`;
  
  renderScenariosList(scenarios);
}

// Update the Status Monitor indicators
function updateStatusUI(status, error, timestamp) {
  const badge = document.getElementById("status-badge");
  const timeLabel = document.getElementById("last-sync-time");
  const errorContainer = document.getElementById("error-container");
  const errorText = document.getElementById("error-text");

  // Reset classes
  badge.className = "status-badge";
  
  if (status === "syncing") {
    badge.textContent = "Syncing...";
    badge.classList.add("status-syncing");
  } else if (status === "success") {
    badge.textContent = "Success";
    badge.classList.add("status-success");
  } else if (status === "error") {
    badge.textContent = "Failed";
    badge.classList.add("status-error");
  } else {
    badge.textContent = "Idle";
    badge.classList.add("status-success");
  }

  // Format date
  if (timestamp) {
    const date = new Date(timestamp);
    timeLabel.textContent = date.toLocaleTimeString() + " " + date.toLocaleDateString();
  } else {
    timeLabel.textContent = "Never";
  }

  // Display error container if needed
  if (status === "error" && error) {
    errorContainer.style.display = "block";
    errorText.textContent = error;
  } else {
    errorContainer.style.display = "none";
  }
}

// Render scenarios listed in storage
function renderScenariosList(scenarios) {
  const container = document.getElementById("scenarios-list");
  container.innerHTML = "";

  if (scenarios.length === 0) {
    container.innerHTML = `
      <p style="color: var(--text-muted); font-size: 14px; font-style: italic;">
        No scenarios cached. Check settings and press "Sync Scenarios" above.
      </p>
    `;
    return;
  }

  scenarios.forEach(scenario => {
    const item = document.createElement("div");
    item.className = "tutorial-item";
    
    const stepsCount = scenario.steps ? scenario.steps.length : 0;
    
    item.innerHTML = `
      <div>
        <div class="tutorial-name">${escapeHtml(scenario.name)}</div>
        <span class="tutorial-pattern">${escapeHtml(scenario.urlPattern)}</span>
      </div>
      <div class="tutorial-steps-count">${stepsCount} steps</div>
    `;
    
    container.appendChild(item);
  });
}

// Simple HTML escaping helper
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Show a message toast
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  
  if (isError) {
    toast.style.borderColor = "rgba(239, 68, 68, 0.4)";
    toast.style.background = "rgba(45, 15, 20, 0.95)";
  } else {
    toast.style.borderColor = "rgba(138, 35, 135, 0.4)";
    toast.style.background = "rgba(30, 24, 48, 0.95)";
  }
  
  toast.classList.add("show");
  
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}

// Inject CSS style for spinning sync icon
const spinStyle = document.createElement("style");
spinStyle.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(spinStyle);

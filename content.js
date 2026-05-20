// StepFlow Content Script
let driverInstance = null;

// Initialize when page loads
init();

async function init() {
  console.log("StepFlow content script loaded.");
  
  // Retrieve scenarios from extension storage
  const data = await chrome.storage.local.get(["scenarios", "autoStartEnabled"]);
  const scenarios = data.scenarios || [];
  
  // Find a matching scenario for the current URL
  const currentUrl = window.location.href;
  const matchingScenario = scenarios.find(scenario => {
    return isUrlMatch(currentUrl, scenario.urlPattern);
  });
  
  if (matchingScenario && matchingScenario.steps && matchingScenario.steps.length > 0) {
    console.log(`StepFlow: Found matching scenario "${matchingScenario.name}"`);
    
    // Inject floating launcher button
    createFloatingLauncher(matchingScenario);
    
    // Listen for messages from popup to trigger tutorial manually
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "start_tutorial" && message.scenarioId === matchingScenario.id) {
        startWalkthrough(matchingScenario);
        sendResponse({ success: true });
      }
    });
  }
}

// Check if current URL matches a pattern (Regex or Substring)
function isUrlMatch(currentUrl, pattern) {
  try {
    // If the pattern starts and ends with "/", parse as regex
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const lastSlashIdx = pattern.lastIndexOf("/");
      const regexStr = pattern.substring(1, lastSlashIdx);
      const flags = pattern.substring(lastSlashIdx + 1);
      return new RegExp(regexStr, flags).test(currentUrl);
    }
    
    // Simple substring match (case insensitive) fallback
    return currentUrl.toLowerCase().includes(pattern.toLowerCase());
  } catch (err) {
    console.warn("Invalid matching pattern, falling back to simple substring match:", pattern, err);
    return currentUrl.toLowerCase().includes(pattern.toLowerCase());
  }
}

// Inject a beautiful floating launcher button into the target page
function createFloatingLauncher(scenario) {
  // Check if launcher already exists
  if (document.getElementById("stepflow-launcher")) return;

  // Check session storage to see if the user dismissed it for this session
  if (sessionStorage.getItem(`stepflow-dismissed-${scenario.id}`) === "true") return;

  // Create launcher element
  const launcher = document.createElement("div");
  launcher.id = "stepflow-launcher";
  
  // Set styles via JS to isolate from page stylesheet modifications
  Object.assign(launcher.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "999999",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 16px",
    background: "rgba(25, 20, 45, 0.85)",
    backdropFilter: "blur(12px)",
    webkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "30px",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
    color: "#ffffff",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
    userSelect: "none"
  });

  // Create tutorial trigger text and icon
  const content = document.createElement("div");
  content.innerHTML = `<span style="margin-right: 6px;">✨</span> Start ${scenario.name}`;
  Object.assign(content.style, {
    display: "flex",
    alignItems: "center"
  });
  launcher.appendChild(content);

  // Close/Dismiss button
  const closeBtn = document.createElement("span");
  closeBtn.innerHTML = "×";
  Object.assign(closeBtn.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.1)",
    fontSize: "14px",
    lineHeight: "1",
    color: "rgba(255, 255, 255, 0.7)",
    transition: "background 0.2s"
  });
  
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.background = "rgba(255, 0, 0, 0.3)";
    closeBtn.style.color = "#ffffff";
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
    closeBtn.style.color = "rgba(255, 255, 255, 0.7)";
  });
  
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Avoid triggering tutorial
    launcher.style.transform = "translateY(100px) scale(0.8)";
    launcher.style.opacity = "0";
    setTimeout(() => launcher.remove(), 300);
    sessionStorage.setItem(`stepflow-dismissed-${scenario.id}`, "true");
  });
  launcher.appendChild(closeBtn);

  // Hover effects
  launcher.addEventListener("mouseenter", () => {
    launcher.style.transform = "translateY(-4px)";
    launcher.style.boxShadow = "0 15px 35px rgba(120, 80, 220, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)";
    launcher.style.borderColor = "rgba(120, 80, 220, 0.5)";
  });
  launcher.addEventListener("mouseleave", () => {
    launcher.style.transform = "none";
    launcher.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)";
    launcher.style.borderColor = "rgba(255, 255, 255, 0.15)";
  });

  // Launch tutorial on click
  launcher.addEventListener("click", () => {
    launcher.style.transform = "scale(0.95)";
    setTimeout(() => {
      launcher.style.transform = "none";
      startWalkthrough(scenario);
    }, 100);
  });

  document.body.appendChild(launcher);
}

// Helper to evaluate and convert XPath selectors to CSS selectors by injecting temp attributes
function resolveSelector(selector, index) {
  if (typeof selector !== "string") return selector;

  // Check if it's a stringified function
  const trimmed = selector.trim();
  if (trimmed.startsWith("() =>") || trimmed.startsWith("function")) {
    // 1. Try safe extraction of XPath if it is just a wrapped document.evaluate
    const xpathMatch = trimmed.match(/document\.evaluate\(\s*['"`]([^'"`]+)['"`]/);
    if (xpathMatch && xpathMatch[1]) {
      const xpathQuery = xpathMatch[1];
      try {
        const result = document.evaluate(
          xpathQuery,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        const element = result.singleNodeValue;
        if (element) {
          const attrValue = `xpath-step-${index}`;
          element.setAttribute("data-stepflow-target", attrValue);
          return `[data-stepflow-target="${attrValue}"]`;
        } else {
          console.warn(`StepFlow: XPath element not found in DOM via function extraction: ${xpathQuery}`);
        }
      } catch (err) {
        console.error(`StepFlow: Error evaluating extracted XPath: ${xpathQuery}`, err);
      }
    }

    // 2. Otherwise, fall back to eval if possible
    try {
      const fn = (0, eval)(selector);
      if (typeof fn === "function") {
        return fn;
      }
    } catch (err) {
      console.warn(`StepFlow: CSP or error blocked direct eval of function selector: ${selector}`, err);
    }

    // Return a dummy CSS selector instead of letting the raw function string leak
    return `#stepflow-non-existent-function-${index}`;
  }

  // Heuristic to detect XPath (starts with / or //) while avoiding regex patterns
  const isXPath = selector.startsWith("/") || selector.startsWith("//") || selector.startsWith("(/");
  const isRegex = selector.startsWith("/") && selector.lastIndexOf("/") > 0 && /^[gimsuy]*$/.test(selector.substring(selector.lastIndexOf("/") + 1));

  if (isXPath && !isRegex) {
    try {
      const result = document.evaluate(
        selector,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const element = result.singleNodeValue;
      if (element) {
        const attrValue = `xpath-step-${index}`;
        element.setAttribute("data-stepflow-target", attrValue);
        return `[data-stepflow-target="${attrValue}"]`;
      } else {
        console.warn(`StepFlow: XPath element not found in DOM: ${selector}`);
        return `#stepflow-non-existent-xpath-${index}`; // Prevent SyntaxError in Driver.js
      }
    } catch (err) {
      console.error(`StepFlow: Error evaluating XPath: ${selector}`, err);
      return `#stepflow-invalid-xpath-${index}`; // Prevent SyntaxError in Driver.js
    }
  }

  return selector; // Default to CSS selector
}

// Start the walkthrough using bundled Driver.js
function startWalkthrough(scenario) {
  if (typeof window.driver === "undefined" || typeof window.driver.js === "undefined") {
    console.error("StepFlow error: Driver.js library is not loaded on this page.");
    alert("StepFlow Error: Tutorial library failed to load.");
    return;
  }

  // Hide launcher during the walkthrough to prevent overlap
  const launcher = document.getElementById("stepflow-launcher");
  if (launcher) launcher.style.display = "none";

  console.log(`Initializing walkthrough "${scenario.name}" with ${scenario.steps.length} steps...`);

  // Construct steps, mapping selectors and custom content
  const steps = scenario.steps.map((step, index) => {
    return {
      element: resolveSelector(step.element, index),
      popover: {
        title: step.popover.title || "Step",
        description: step.popover.description || "",
        side: step.popover.side || "bottom",
        align: step.popover.align || "start",
        // styling class for popover custom customization
        popoverClass: "stepflow-custom-popover"
      }
    };
  });

  // Initialize Driver.js
  driverInstance = window.driver.js.driver({
    showProgress: true,
    animate: true,
    overlayColor: "rgba(12, 10, 22, 0.75)",
    stagePadding: 8,
    stageRadius: 6,
    steps: steps,
    onDestroyStarted: () => {
      console.log("Walkthrough dismissed or finished.");
      // Restore launcher
      if (launcher) launcher.style.display = "flex";
      driverInstance.destroy();
    }
  });

  // Start drive
  driverInstance.drive();

  // Inject popover custom styles to make popovers look modern and premium
  injectPopoverStyles();
}

// Style injection to override basic Driver.js popovers with high-end styles
function injectPopoverStyles() {
  if (document.getElementById("stepflow-popover-styles")) return;

  const style = document.createElement("style");
  style.id = "stepflow-popover-styles";
  style.textContent = `
    .driver-popover.stepflow-custom-popover {
      background: rgba(30, 25, 50, 0.95) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 12px !important;
      padding: 20px !important;
      color: #ffffff !important;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
      font-family: system-ui, -apple-system, sans-serif !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-title {
      color: #ffffff !important;
      font-size: 16px !important;
      font-weight: 700 !important;
      margin-bottom: 8px !important;
      font-family: system-ui, -apple-system, sans-serif !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-description {
      color: rgba(255, 255, 255, 0.8) !important;
      font-size: 13.5px !important;
      line-height: 1.5 !important;
      font-family: system-ui, -apple-system, sans-serif !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-footer {
      margin-top: 16px !important;
      display: flex !important;
      gap: 8px !important;
      justify-content: flex-end !important;
    }
    .driver-popover.stepflow-custom-popover button {
      background: rgba(255, 255, 255, 0.08) !important;
      color: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      border-radius: 6px !important;
      padding: 6px 12px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      text-shadow: none !important;
      transition: all 0.2s !important;
      cursor: pointer !important;
    }
    .driver-popover.stepflow-custom-popover button:hover {
      background: rgba(255, 255, 255, 0.2) !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-next-btn {
      background: linear-gradient(135deg, #8A2387, #E94057) !important;
      border: none !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-next-btn:hover {
      opacity: 0.9 !important;
      transform: translateY(-1px) !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-close-btn {
      color: rgba(255, 255, 255, 0.5) !important;
      top: 12px !important;
      right: 12px !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-close-btn:hover {
      color: #ffffff !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-progress-text {
      color: rgba(255, 255, 255, 0.5) !important;
      font-size: 11px !important;
    }
    .driver-popover.stepflow-custom-popover .driver-popover-arrow {
      border-color: rgba(30, 25, 50, 0.95) !important;
    }
  `;
  document.head.appendChild(style);
}

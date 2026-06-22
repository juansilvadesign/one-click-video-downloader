const elements = {
  count: document.querySelector("#detected-count"),
  dot: document.querySelector("#status-dot"),
  planLabel: document.querySelector("#plan-label"),
  planDetail: document.querySelector("#plan-detail"),
  download: document.querySelector("#download"),
  clear: document.querySelector("#clear"),
  host: document.querySelector("#host-status"),
  progressCard: document.querySelector("#progress-card"),
  progressLabel: document.querySelector("#progress-label"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  jobMessage: document.querySelector("#job-message"),
  controlJob: document.querySelector("#control-job"),
  cookieOption: document.querySelector("#cookie-option"),
  useCookies: document.querySelector("#use-cookies"),
  enableDeep: document.querySelector("#enable-deep"),
  error: document.querySelector("#error")
};

let tabId;
let currentState;

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId === undefined) {
    showError("No active browser tab was found.");
    return;
  }
  await refresh();
}

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "getState", tabId });
    if (state?.error) throw new Error(state.error);
    render(state);
  } catch (error) {
    showError(error.message);
  }
}

function render(state) {
  const { candidateCount = 0, plan, host, job } = state;
  currentState = state;
  const active = ["running", "recording", "retrying", "stopping"].includes(job?.status);
  elements.count.textContent = String(candidateCount);
  elements.dot.classList.toggle("ready", Boolean(plan));
  elements.download.disabled = !plan || active;
  elements.cookieOption.classList.toggle("hidden", plan?.mode !== "page");
  elements.enableDeep.classList.toggle(
    "hidden",
    candidateCount > 0 || currentState.deepDetectionEnabled || active
  );

  if (plan) {
    elements.planLabel.textContent = plan.label;
    elements.planDetail.textContent = plan.mode === "direct"
      ? "A finished media file can download immediately."
      : plan.mode === "page"
        ? "No media URL was visible. The optional local extractor can inspect this page."
        : "Audio and video will be processed by local FFmpeg.";
  } else if (currentState.deepDetectionEnabled) {
    elements.planLabel.textContent = "Deep detection is active";
    elements.planDetail.textContent = "Reload the page, play the video, then open this popup again.";
  } else {
    elements.planLabel.textContent = "Play a video on this page";
    elements.planDetail.textContent = "Detection happens automatically.";
  }

  elements.host.textContent = plan?.mode === "direct"
    ? "FFmpeg available as fallback"
    : host?.message || "Checking local FFmpeg…";

  renderJob(job || { status: "idle" });
}

function renderJob(job) {
  const visible = ["running", "recording", "retrying", "stopping", "canceled", "complete", "error"]
    .includes(job.status);
  elements.progressCard.classList.toggle("hidden", !visible);
  elements.error.classList.add("hidden");
  if (!visible) return;

  const progress = Number.isFinite(job.progress) ? Math.round(job.progress) : null;
  elements.progressValue.textContent = progress === null ? "" : `${progress}%`;
  elements.progressBar.classList.toggle("indeterminate", progress === null && ["running", "recording", "retrying"].includes(job.status));
  elements.progressBar.style.width = progress === null ? "18%" : `${Math.max(2, progress)}%`;
  const labels = {
    complete: job.stopped ? "Recording saved" : "Saved locally",
    error: "Download failed",
    canceled: "Download canceled",
    recording: "Recording live",
    retrying: "Retrying download",
    stopping: "Stopping and finalizing",
    running: "Processing locally"
  };
  elements.progressLabel.textContent = labels[job.status] || "Processing locally";
  elements.jobMessage.textContent = job.output || job.error || job.detail || "";
  const controllable = ["running", "recording", "retrying"].includes(job.status);
  elements.controlJob.classList.toggle("hidden", !controllable);
  elements.controlJob.disabled = job.status === "stopping";
  elements.controlJob.textContent = job.live ? "Stop and save" : "Cancel download";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

elements.download.addEventListener("click", async () => {
  elements.download.disabled = true;
  elements.error.classList.add("hidden");
  try {
    const permissions = [];
    if (currentState?.plan?.mode !== "direct") permissions.push("power");
    if (currentState?.plan?.mode === "page" && elements.useCookies.checked) permissions.push("cookies");
    let granted = true;
    if (permissions.length) granted = await chrome.permissions.request({ permissions });
    if (!granted && permissions.includes("cookies")) throw new Error("Cookie access was not granted");
    const response = await chrome.runtime.sendMessage({
      type: "downloadBest",
      tabId,
      useCookies: granted && permissions.includes("cookies")
    });
    if (response?.error) throw new Error(response.error);
    await refresh();
  } catch (error) {
    showError(error.message);
    elements.download.disabled = false;
  }
});

elements.controlJob.addEventListener("click", async () => {
  elements.controlJob.disabled = true;
  elements.error.classList.add("hidden");
  try {
    const response = await chrome.runtime.sendMessage({ type: "cancelJob" });
    if (response?.error) throw new Error(response.error);
    await refresh();
  } catch (error) {
    showError(error.message);
    elements.controlJob.disabled = false;
  }
});

elements.enableDeep.addEventListener("click", async () => {
  elements.enableDeep.disabled = true;
  elements.error.classList.add("hidden");
  try {
    const granted = await chrome.permissions.request({ permissions: ["scripting"] });
    if (!granted) throw new Error("Deep-detection permission was not granted");
    const response = await chrome.runtime.sendMessage({ type: "enableDeepDetection", tabId });
    if (response?.error) throw new Error(response.error);
    window.close();
  } catch (error) {
    showError(error.message);
    elements.enableDeep.disabled = false;
  }
});

elements.clear.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearTab", tabId });
  await refresh();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "mediaUpdated" && message.tabId !== tabId) return;
  if (["mediaUpdated", "stateUpdated"].includes(message.type)) void refresh();
});

void initialize();

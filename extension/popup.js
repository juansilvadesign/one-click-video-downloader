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
  error: document.querySelector("#error")
};

let tabId;

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

function render({ candidateCount = 0, plan, host, job }) {
  elements.count.textContent = String(candidateCount);
  elements.dot.classList.toggle("ready", Boolean(plan));
  elements.download.disabled = !plan || job?.status === "running";

  if (plan) {
    elements.planLabel.textContent = plan.label;
    elements.planDetail.textContent = plan.mode === "direct"
      ? "A finished media file can download immediately."
      : "Audio and video will be processed by local FFmpeg.";
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
  const visible = ["running", "complete", "error"].includes(job.status);
  elements.progressCard.classList.toggle("hidden", !visible);
  elements.error.classList.add("hidden");
  if (!visible) return;

  const progress = Number.isFinite(job.progress) ? Math.round(job.progress) : null;
  elements.progressValue.textContent = progress === null ? "" : `${progress}%`;
  elements.progressBar.style.width = progress === null ? "18%" : `${Math.max(2, progress)}%`;
  elements.progressLabel.textContent = job.status === "complete"
    ? "Saved locally"
    : job.status === "error"
      ? "Download failed"
      : "Processing locally";
  elements.jobMessage.textContent = job.output || job.error || job.detail || "";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

elements.download.addEventListener("click", async () => {
  elements.download.disabled = true;
  elements.error.classList.add("hidden");
  try {
    const response = await chrome.runtime.sendMessage({ type: "downloadBest", tabId });
    if (response?.error) throw new Error(response.error);
    await refresh();
  } catch (error) {
    showError(error.message);
    elements.download.disabled = false;
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

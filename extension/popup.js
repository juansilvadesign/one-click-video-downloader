const elements = {
  count: document.querySelector("#detected-count"),
  dot: document.querySelector("#status-dot"),
  planLabel: document.querySelector("#plan-label"),
  planDetail: document.querySelector("#plan-detail"),
  download: document.querySelector("#download"),
  downloadText: document.querySelector("#download span"),
  clear: document.querySelector("#clear"),
  host: document.querySelector("#host-status"),
  jobs: document.querySelector("#jobs"),
  cookieOption: document.querySelector("#cookie-option"),
  useCookies: document.querySelector("#use-cookies"),
  headingOption: document.querySelector("#heading-option"),
  useHeading: document.querySelector("#use-heading"),
  enableDeep: document.querySelector("#enable-deep"),
  error: document.querySelector("#error")
};

const ACTIVE_STATES = ["running", "recording", "retrying", "stopping"];
const CONTROLLABLE_STATES = ["running", "recording", "retrying"];
const VISIBLE_STATES = [...ACTIVE_STATES, "canceled", "complete", "error"];
const STATUS_LABELS = {
  complete: "Saved locally",
  error: "Download failed",
  canceled: "Download canceled",
  recording: "Recording live",
  retrying: "Retrying download",
  stopping: "Stopping and finalizing",
  running: "Processing locally"
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
  const { candidateCount = 0, plan, host } = state;
  currentState = state;
  const atCap = state.activeCount >= state.maxConcurrent;

  elements.count.textContent = String(candidateCount);
  elements.dot.classList.toggle("ready", Boolean(plan));
  elements.download.disabled = !plan || state.tabDownloading || atCap;
  elements.downloadText.textContent = !plan
    ? "Download best quality"
    : state.tabDownloading
      ? "Already downloading"
      : atCap
        ? "Max downloads running"
        : "Download best quality";
  elements.cookieOption.classList.toggle("hidden", plan?.mode !== "page");
  elements.useHeading.checked = Boolean(state.useHeadingForName);
  elements.enableDeep.classList.toggle(
    "hidden",
    candidateCount > 0 || state.deepDetectionEnabled
  );

  if (plan) {
    elements.planLabel.textContent = plan.label;
    elements.planDetail.textContent = plan.mode === "direct"
      ? "A finished media file can download immediately."
      : plan.mode === "page"
        ? "No media URL was visible. The optional local extractor can inspect this page."
        : "Audio and video will be processed by local FFmpeg.";
  } else if (state.deepDetectionEnabled) {
    elements.planLabel.textContent = "Deep detection is active";
    elements.planDetail.textContent = "Reload the page, play the video, then open this popup again.";
  } else {
    elements.planLabel.textContent = "Play a video on this page";
    elements.planDetail.textContent = "Detection happens automatically.";
  }

  elements.host.textContent = plan?.mode === "direct"
    ? "FFmpeg available as fallback"
    : host?.message || "Checking local FFmpeg…";

  renderJobs(state.jobs || []);
}

function statusLabel(job) {
  if (job.status === "complete" && job.stopped) return "Recording saved";
  return STATUS_LABELS[job.status] || "Processing locally";
}

function jobName(job) {
  return job.title ? `${job.title}.mp4` : job.label || "Download";
}

function renderJobs(jobList) {
  const visible = jobList.filter((job) => VISIBLE_STATES.includes(job.status));
  elements.jobs.classList.toggle("hidden", visible.length === 0);
  elements.jobs.replaceChildren(...visible.map(buildJobCard));
}

function buildJobCard(job) {
  const card = document.createElement("section");
  card.className = "card job";

  const copy = document.createElement("div");
  copy.className = "progress-copy";
  const label = document.createElement("span");
  label.textContent = statusLabel(job);
  const value = document.createElement("span");
  const progress = Number.isFinite(job.progress) ? Math.round(job.progress) : null;
  value.textContent = progress === null ? "" : `${progress}%`;
  copy.append(label, value);

  const track = document.createElement("div");
  track.className = "progress-track";
  const bar = document.createElement("div");
  bar.className = "job-bar";
  bar.classList.toggle(
    "indeterminate",
    progress === null && ["running", "recording", "retrying"].includes(job.status)
  );
  if (["error", "canceled"].includes(job.status)) bar.classList.add("stopped");
  bar.style.width = progress === null ? "18%" : `${Math.max(2, progress)}%`;
  track.appendChild(bar);

  const message = document.createElement("p");
  message.className = "secondary";
  message.textContent = job.status === "error" ? (job.error || "Download failed") : jobName(job);

  card.append(copy, track, message);

  if (CONTROLLABLE_STATES.includes(job.status)) {
    const control = document.createElement("button");
    control.className = "control-button";
    control.textContent = job.live ? "Stop and save" : "Cancel download";
    control.addEventListener("click", () => controlJob(control, job.id));
    card.appendChild(control);
  }
  return card;
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

async function controlJob(button, jobId) {
  button.disabled = true;
  elements.error.classList.add("hidden");
  try {
    const response = await chrome.runtime.sendMessage({ type: "cancelJob", jobId });
    if (response?.error) throw new Error(response.error);
    await refresh();
  } catch (error) {
    showError(error.message);
    button.disabled = false;
  }
}

elements.useHeading.addEventListener("change", async () => {
  const enabled = elements.useHeading.checked;
  elements.error.classList.add("hidden");
  try {
    if (enabled) {
      const granted = (await chrome.permissions.contains({ permissions: ["scripting"] }))
        || (await chrome.permissions.request({ permissions: ["scripting"] }));
      if (!granted) throw new Error("Permission to read page headings was not granted");
    }
    const response = await chrome.runtime.sendMessage({ type: "setHeadingPreference", enabled });
    if (response?.error) throw new Error(response.error);
  } catch (error) {
    elements.useHeading.checked = !enabled;
    showError(error.message);
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

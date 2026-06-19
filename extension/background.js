import {
  chooseDownloadPlan,
  classifyMedia,
  normalizeContentType,
  qualityHint,
  sanitizeFilename
} from "./media.js";

const HOST_NAME = "io.local.one_click_video_downloader";
const STORAGE_KEY = "mediaByTab";
const MAX_CANDIDATES_PER_TAB = 100;
const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "origin",
  "referer",
  "user-agent"
]);

const mediaByTab = new Map();
const requestHeaders = new Map();
const storageArea = chrome.storage.session || chrome.storage.local;
let nativePort = null;
let hostState = { status: "unknown", message: "Native host not checked" };
let jobState = { status: "idle" };

const ready = restoreMedia();

async function restoreMedia() {
  const stored = await storageArea.get(STORAGE_KEY);
  for (const [tabId, candidates] of Object.entries(stored[STORAGE_KEY] || {})) {
    mediaByTab.set(Number(tabId), candidates);
    await updateBadge(Number(tabId));
  }
}

async function persistMedia() {
  const serializable = Object.fromEntries(mediaByTab);
  await storageArea.set({ [STORAGE_KEY]: serializable });
}

function headerValue(headers = [], name) {
  const match = headers.find((header) => header.name.toLowerCase() === name);
  return match?.value || "";
}

function responseMetadata(details) {
  const contentType = normalizeContentType(headerValue(details.responseHeaders, "content-type"));
  const contentRange = headerValue(details.responseHeaders, "content-range");
  const contentLength = Number(headerValue(details.responseHeaders, "content-length")) ||
    Number(contentRange.split("/").pop()) || 0;
  return { contentType, contentLength };
}

function selectedRequestHeaders(headers = []) {
  return Object.fromEntries(
    headers
      .map(({ name, value }) => [name.toLowerCase(), value])
      .filter(([name, value]) => ALLOWED_REQUEST_HEADERS.has(name) && value)
  );
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    requestHeaders.set(details.requestId, selectedRequestHeaders(details.requestHeaders));
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => void captureCandidate(details),
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  ({ requestId }) => requestHeaders.delete(requestId),
  { urls: ["http://*/*", "https://*/*"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  ({ requestId }) => requestHeaders.delete(requestId),
  { urls: ["http://*/*", "https://*/*"] }
);

async function captureCandidate(details) {
  await ready;
  if (details.tabId < 0 || details.statusCode >= 400) return;

  const metadata = responseMetadata(details);
  const classification = classifyMedia({
    url: details.url,
    contentType: metadata.contentType,
    requestType: details.type
  });
  if (!classification) return;

  let tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch {
    return;
  }

  const candidates = mediaByTab.get(details.tabId) || [];
  const existingIndex = candidates.findIndex((candidate) => candidate.url === details.url);
  const candidate = {
    id: `${details.requestId}:${Date.now()}`,
    url: details.url,
    ...classification,
    contentType: metadata.contentType,
    contentLength: metadata.contentLength,
    quality: qualityHint(details.url),
    requestType: details.type,
    headers: requestHeaders.get(details.requestId) || {},
    detectedAt: Date.now(),
    pageTitle: tab.title || "video",
    pageUrl: tab.url || details.initiator || ""
  };

  if (existingIndex >= 0) candidates.splice(existingIndex, 1);
  candidates.push(candidate);
  mediaByTab.set(details.tabId, candidates.slice(-MAX_CANDIDATES_PER_TAB));
  await Promise.all([persistMedia(), updateBadge(details.tabId)]);
  broadcast({ type: "mediaUpdated", tabId: details.tabId });
}

async function updateBadge(tabId) {
  const count = mediaByTab.get(tabId)?.length || 0;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#166534" });
  await chrome.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 99)) : "" });
}

chrome.tabs.onRemoved.addListener((tabId) => void clearTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) void clearTab(tabId);
});

async function clearTab(tabId) {
  mediaByTab.delete(tabId);
  await Promise.all([persistMedia(), updateBadge(tabId).catch(() => undefined)]);
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  hostState = { status: "connecting", message: "Connecting to local FFmpeg host" };
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message || "Native host disconnected";
      nativePort = null;
      hostState = { status: "unavailable", message };
      if (jobState.status === "running") {
        jobState = { ...jobState, status: "error", error: message };
      }
      broadcast({ type: "stateUpdated" });
    });
    nativePort.postMessage({ action: "ping", id: crypto.randomUUID() });
  } catch (error) {
    nativePort = null;
    hostState = { status: "unavailable", message: error.message };
  }
  return nativePort;
}

function handleNativeMessage(message) {
  if (message.event === "ready") {
    hostState = {
      status: "ready",
      message: message.ffmpeg ? `FFmpeg ${message.ffmpeg}` : "Local FFmpeg ready"
    };
  } else if (message.event === "started" || message.event === "progress") {
    jobState = {
      ...jobState,
      status: "running",
      progress: message.progress ?? jobState.progress ?? null,
      detail: message.detail || "Processing locally"
    };
  } else if (message.event === "complete") {
    jobState = { status: "complete", output: message.output, progress: 100 };
  } else if (message.event === "error") {
    jobState = { status: "error", error: message.error || "FFmpeg failed" };
  }
  broadcast({ type: "stateUpdated" });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function startDownload(tabId) {
  await ready;
  const candidates = mediaByTab.get(tabId) || [];
  const plan = chooseDownloadPlan(candidates);
  if (!plan) throw new Error("No downloadable video detected yet");

  const title = sanitizeFilename(plan.inputs[0]?.pageTitle, "video");
  if (plan.mode === "direct") {
    try {
      const downloadId = await chrome.downloads.download({
        url: plan.inputs[0].url,
        filename: `${title}.mp4`,
        saveAs: false,
        conflictAction: "uniquify"
      });
      jobState = {
        status: "running",
        mode: "browser",
        downloadId,
        detail: "Downloading MP4",
        fallbackPlan: plan,
        fallbackTitle: title
      };
      broadcast({ type: "stateUpdated" });
      return jobState;
    } catch {
      return startNativeJob({ ...plan, mode: "direct" }, title);
    }
  }
  return startNativeJob(plan, title);
}

function startNativeJob(plan, title) {
  const port = connectNativeHost();
  if (!port) throw new Error(hostState.message);
  const id = crypto.randomUUID();
  jobState = { status: "running", mode: "native", id, progress: null, detail: "Starting FFmpeg" };
  port.postMessage({
    action: "download",
    id,
    job: {
      kind: plan.mode === "remux" ? "direct" : plan.mode,
      title,
      inputs: plan.inputs.map(({ url, headers, kind, format }) => ({ url, headers, kind, format }))
    }
  });
  return jobState;
}

chrome.downloads.onChanged.addListener((delta) => {
  if (jobState.mode !== "browser" || delta.id !== jobState.downloadId) return;
  if (delta.state?.current === "complete") {
    jobState = { ...jobState, status: "complete", progress: 100 };
  } else if (delta.error?.current) {
    const { fallbackPlan, fallbackTitle } = jobState;
    if (delta.error.current !== "USER_CANCELED" && fallbackPlan && fallbackTitle) {
      try {
        startNativeJob(fallbackPlan, fallbackTitle);
        return;
      } catch (error) {
        jobState = { status: "error", error: error.message };
      }
    } else {
      jobState = { ...jobState, status: "error", error: delta.error.current };
    }
  }
  broadcast({ type: "stateUpdated" });
});

async function stateFor(tabId) {
  await ready;
  connectNativeHost();
  const candidates = mediaByTab.get(tabId) || [];
  const plan = chooseDownloadPlan(candidates);
  const { fallbackPlan: _fallbackPlan, fallbackTitle: _fallbackTitle, ...publicJob } = jobState;
  return {
    candidateCount: candidates.length,
    plan: plan ? { mode: plan.mode, label: plan.label } : null,
    host: hostState,
    job: publicJob
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const operation = message?.type === "getState"
    ? stateFor(message.tabId)
    : message?.type === "downloadBest"
      ? startDownload(message.tabId)
      : message?.type === "clearTab"
        ? clearTab(message.tabId).then(() => ({ ok: true }))
        : Promise.reject(new Error("Unknown extension message"));

  operation.then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

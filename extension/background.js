import {
  chooseDownloadPlan,
  classifyMedia,
  normalizeContentType,
  qualityHint,
  sanitizeFilename
} from "./media.js";
import { PowerLeaseManager } from "./power.js";

const HOST_NAME = "io.local.one_click_video_downloader";
const MEDIA_STORAGE_KEY = "mediaByTab";
const JOB_STORAGE_KEY = "jobState";
const MAX_CANDIDATES_PER_TAB = 100;
const MAX_INLINE_MANIFEST_BYTES = 2 * 1024 * 1024;
const ACTIVE_JOB_STATES = new Set(["running", "recording", "retrying", "stopping"]);
const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "origin",
  "referer",
  "user-agent"
]);

const mediaByTab = new Map();
const requestHeaders = new Map();
const lastHeadersByTab = new Map();
const storageArea = chrome.storage.session || chrome.storage.local;
let nativePort = null;
let hostPingId = null;
let hostState = { status: "unknown", message: "Native host not checked", capabilities: null };
let jobState = { status: "idle" };
let browserFallback = null;

const wakeLocks = new PowerLeaseManager({
  hasPermission: () => chrome.permissions.contains({ permissions: ["power"] }),
  requestKeepAwake: (level) => chrome.power.requestKeepAwake(level),
  releaseKeepAwake: () => chrome.power.releaseKeepAwake()
});

const ready = restoreState();

async function restoreState() {
  const stored = await storageArea.get([MEDIA_STORAGE_KEY, JOB_STORAGE_KEY]);
  for (const [tabId, candidates] of Object.entries(stored[MEDIA_STORAGE_KEY] || {})) {
    mediaByTab.set(Number(tabId), candidates);
    await updateBadge(Number(tabId));
  }
  const restoredJob = stored[JOB_STORAGE_KEY];
  if (restoredJob && ACTIVE_JOB_STATES.has(restoredJob.status)) {
    jobState = {
      status: "error",
      error: "The previous local job disconnected when the extension worker restarted."
    };
    await persistJob();
  } else if (restoredJob) {
    jobState = restoredJob;
  }
  const hasPower = await chrome.permissions.contains({ permissions: ["power"] });
  if (hasPower) chrome.power.releaseKeepAwake();
}

async function persistMedia() {
  await storageArea.set({ [MEDIA_STORAGE_KEY]: Object.fromEntries(mediaByTab) });
}

async function persistJob() {
  await storageArea.set({ [JOB_STORAGE_KEY]: jobState });
}

function setJobState(next) {
  jobState = next;
  void persistJob();
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
    const selected = selectedRequestHeaders(details.requestHeaders);
    requestHeaders.set(details.requestId, selected);
    if (details.tabId >= 0 && Object.keys(selected).length) lastHeadersByTab.set(details.tabId, selected);
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

async function captureInlineManifest(message, sender) {
  await ready;
  const tabId = sender.tab?.id;
  const manifestText = message.manifestText;
  if (tabId === undefined || typeof manifestText !== "string") return { ok: false };
  const byteLength = new TextEncoder().encode(manifestText).byteLength;
  if (byteLength > MAX_INLINE_MANIFEST_BYTES || !manifestText.trimStart().startsWith("#EXTM3U")) {
    throw new Error("The in-memory HLS manifest is malformed or exceeds 2 MiB");
  }
  const base = new URL(message.baseUrl || sender.tab.url);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("HLS base URL must use HTTP(S)");
  base.hash = "";
  const candidates = mediaByTab.get(tabId) || [];
  const inlineUrl = `${base.href}#ocvd-inline-hls`;
  const inlineHeaders = Object.fromEntries(
    Object.entries(lastHeadersByTab.get(tabId) || {})
      .filter(([name]) => ["origin", "referer", "user-agent"].includes(name))
  );
  const candidate = {
    id: `inline:${Date.now()}`,
    url: inlineUrl,
    kind: "manifest",
    format: "hls",
    inline: true,
    manifestText,
    baseUrl: base.href,
    contentType: "application/vnd.apple.mpegurl",
    contentLength: byteLength,
    quality: 0,
    headers: inlineHeaders,
    detectedAt: Date.now(),
    pageTitle: sender.tab.title || "video",
    pageUrl: sender.tab.url || base.href
  };
  const existingIndex = candidates.findIndex((item) => item.inline && item.baseUrl === base.href);
  if (existingIndex >= 0) candidates.splice(existingIndex, 1);
  candidates.push(candidate);
  mediaByTab.set(tabId, candidates.slice(-MAX_CANDIDATES_PER_TAB));
  await Promise.all([persistMedia(), updateBadge(tabId)]);
  broadcast({ type: "mediaUpdated", tabId });
  return { ok: true };
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
  lastHeadersByTab.delete(tabId);
  await Promise.all([persistMedia(), updateBadge(tabId).catch(() => undefined)]);
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  hostState = { status: "connecting", message: "Connecting to local media host", capabilities: null };
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message || "Native host disconnected";
      nativePort = null;
      hostState = { status: "unavailable", message, capabilities: null };
      if (jobState.mode === "native" && ACTIVE_JOB_STATES.has(jobState.status)) {
        void wakeLocks.release(jobState.id);
        setJobState({ ...jobState, status: "error", error: message });
      }
      broadcast({ type: "stateUpdated" });
    });
    hostPingId = crypto.randomUUID();
    nativePort.postMessage({ action: "ping", id: hostPingId });
  } catch (error) {
    nativePort = null;
    hostState = { status: "unavailable", message: error.message, capabilities: null };
  }
  return nativePort;
}

function handleNativeMessage(message) {
  if (message.event === "ready") {
    hostState = {
      status: "ready",
      message: `FFmpeg ${message.ffmpeg} · ffprobe ${message.ffprobe}`,
      capabilities: message.capabilities || null
    };
    broadcast({ type: "stateUpdated" });
    return;
  }
  if (message.id === hostPingId && message.event === "error") {
    hostState = { status: "unavailable", message: message.error, capabilities: null };
    broadcast({ type: "stateUpdated" });
    return;
  }
  if (jobState.id && message.id !== jobState.id) return;

  if (message.event === "started") {
    setJobState({
      ...jobState,
      status: message.live ? "recording" : "running",
      live: Boolean(message.live),
      detail: message.detail || "Processing locally"
    });
  } else if (message.event === "progress") {
    const status = jobState.status === "stopping"
      ? "stopping"
      : jobState.live ? "recording" : "running";
    setJobState({
      ...jobState,
      status,
      progress: message.progress ?? jobState.progress ?? null,
      detail: message.detail || "Processing locally"
    });
  } else if (message.event === "retrying") {
    setJobState({
      ...jobState,
      status: "retrying",
      retryAttempt: message.attempt,
      detail: message.detail || "Retrying a temporary failure"
    });
  } else if (message.event === "stopping") {
    setJobState({ ...jobState, status: "stopping", detail: message.detail || "Stopping" });
  } else if (message.event === "canceled") {
    void wakeLocks.release(message.id);
    setJobState({ status: "canceled", mode: "native", detail: "Download canceled" });
  } else if (message.event === "complete") {
    void wakeLocks.release(message.id);
    setJobState({
      status: "complete",
      output: message.output,
      progress: 100,
      stopped: Boolean(message.stopped)
    });
  } else if (message.event === "error") {
    void wakeLocks.release(message.id);
    setJobState({ status: "error", error: message.error || "Local processing failed" });
  }
  broadcast({ type: "stateUpdated" });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function canUsePageFallback(tab) {
  return Boolean(
    hostState.capabilities?.ytDlp?.available &&
    tab?.url &&
    /^https?:\/\//i.test(tab.url)
  );
}

async function startDownload(tabId, { useCookies = false } = {}) {
  await ready;
  if (ACTIVE_JOB_STATES.has(jobState.status)) throw new Error("Another download is already active");
  const candidates = mediaByTab.get(tabId) || [];
  const plan = chooseDownloadPlan(candidates);
  const tab = await chrome.tabs.get(tabId);

  if (!plan) {
    if (!canUsePageFallback(tab)) {
      throw new Error(hostState.capabilities?.ytDlp?.available
        ? "This page cannot be passed to the local extractor"
        : "No video was detected. Play it first, enable deep detection, or install yt-dlp fallback.");
    }
    let cookies = [];
    if (useCookies) {
      const allowed = await chrome.permissions.contains({ permissions: ["cookies"] });
      if (!allowed) throw new Error("Cookie access was not granted");
      cookies = await chrome.cookies.getAll({ url: tab.url });
    }
    return startNativeJob({
      mode: "page",
      pageUrl: tab.url,
      cookies,
      userAgent: navigator.userAgent
    }, sanitizeFilename(tab.title, "video"));
  }

  const title = sanitizeFilename(plan.inputs[0]?.pageTitle || tab.title, "video");
  if (plan.mode === "direct") {
    try {
      const downloadId = await chrome.downloads.download({
        url: plan.inputs[0].url,
        filename: `${title}.mp4`,
        saveAs: false,
        conflictAction: "uniquify"
      });
      browserFallback = { plan, title };
      setJobState({
        status: "running",
        mode: "browser",
        downloadId,
        detail: "Downloading MP4"
      });
      broadcast({ type: "stateUpdated" });
      return jobState;
    } catch {
      return startNativeJob({ ...plan, mode: "direct" }, title);
    }
  }
  return startNativeJob(plan, title);
}

async function startNativeJob(plan, title) {
  const port = connectNativeHost();
  if (!port) throw new Error(hostState.message);
  const id = crypto.randomUUID();
  setJobState({ status: "running", mode: "native", id, progress: null, detail: "Starting local job" });
  const job = plan.mode === "page"
    ? {
        kind: "page",
        title,
        pageUrl: plan.pageUrl,
        cookies: plan.cookies,
        userAgent: plan.userAgent
      }
    : {
        kind: plan.mode === "remux" ? "direct" : plan.mode,
        title,
        inputs: plan.inputs.map(({ url, headers, kind, format, inline, manifestText, baseUrl }) => ({
          ...(inline ? { manifestText, baseUrl } : { url }),
          headers,
          kind,
          format
        }))
      };
  try {
    port.postMessage({ action: "download", id, job });
    await wakeLocks.acquire(id);
  } catch (error) {
    await wakeLocks.release(id);
    setJobState({ status: "error", error: error.message });
    throw error;
  }
  broadcast({ type: "stateUpdated" });
  return jobState;
}

chrome.downloads.onChanged.addListener((delta) => {
  if (jobState.mode !== "browser" || delta.id !== jobState.downloadId || jobState.status === "canceled") return;
  if (delta.state?.current === "complete") {
    browserFallback = null;
    setJobState({ ...jobState, status: "complete", progress: 100 });
  } else if (delta.error?.current) {
    const fallback = browserFallback;
    browserFallback = null;
    if (delta.error.current !== "USER_CANCELED" && fallback) {
      void startNativeJob(fallback.plan, fallback.title).catch((error) => {
        setJobState({ status: "error", error: error.message });
        broadcast({ type: "stateUpdated" });
      });
      return;
    }
    setJobState(delta.error.current === "USER_CANCELED"
      ? { status: "canceled", detail: "Download canceled" }
      : { status: "error", error: delta.error.current });
  }
  broadcast({ type: "stateUpdated" });
});

async function cancelCurrentJob() {
  await ready;
  if (!ACTIVE_JOB_STATES.has(jobState.status)) throw new Error("No active download to stop");
  if (jobState.mode === "browser") {
    await chrome.downloads.cancel(jobState.downloadId);
    browserFallback = null;
    setJobState({ status: "canceled", detail: "Download canceled" });
  } else if (jobState.mode === "native" && nativePort) {
    nativePort.postMessage({ action: jobState.live ? "stop" : "cancel", id: jobState.id });
    setJobState({ ...jobState, status: "stopping", detail: jobState.live ? "Stopping and finalizing" : "Canceling" });
  } else {
    throw new Error("The native job is no longer connected");
  }
  broadcast({ type: "stateUpdated" });
  return jobState;
}

function scriptHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepScriptDetails(rawUrl) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Deep detection requires an HTTP(S) page");
  const key = scriptHash(`${url.protocol}//${url.hostname}`);
  return {
    ids: [`ocvd-deep-isolated-${key}`, `ocvd-deep-main-${key}`],
    match: `${url.protocol}//${url.hostname}/*`
  };
}

async function enableDeepDetection(tabId) {
  await ready;
  if (chooseDownloadPlan(mediaByTab.get(tabId) || [])) {
    throw new Error("Normal detection already found a downloadable video");
  }
  const allowed = await chrome.permissions.contains({ permissions: ["scripting"] });
  if (!allowed) throw new Error("Scripting permission was not granted");
  const tab = await chrome.tabs.get(tabId);
  const { ids, match } = deepScriptDetails(tab.url);
  await chrome.scripting.unregisterContentScripts({ ids }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([
    {
      id: ids[0],
      matches: [match],
      js: ["deep-isolated.js"],
      runAt: "document_start",
      world: "ISOLATED",
      persistAcrossSessions: true
    },
    {
      id: ids[1],
      matches: [match],
      js: ["deep-main.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true
    }
  ]);
  await clearTab(tabId);
  await chrome.tabs.reload(tabId);
  return { ok: true };
}

async function deepDetectionEnabled(tab) {
  if (!tab?.url || !(await chrome.permissions.contains({ permissions: ["scripting"] }))) return false;
  try {
    const { ids } = deepScriptDetails(tab.url);
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids });
    return scripts.length === ids.length;
  } catch {
    return false;
  }
}

async function stateFor(tabId) {
  await ready;
  connectNativeHost();
  const candidates = mediaByTab.get(tabId) || [];
  const detectedPlan = chooseDownloadPlan(candidates);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const pageFallback = !detectedPlan && canUsePageFallback(tab);
  return {
    candidateCount: candidates.length,
    plan: detectedPlan
      ? { mode: detectedPlan.mode, label: detectedPlan.label }
      : pageFallback ? { mode: "page", label: "Page extractor fallback" } : null,
    host: hostState,
    job: jobState,
    pageFallback,
    deepDetectionEnabled: await deepDetectionEnabled(tab)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === "getState") {
    operation = stateFor(message.tabId);
  } else if (message?.type === "downloadBest") {
    operation = startDownload(message.tabId, { useCookies: Boolean(message.useCookies) });
  } else if (message?.type === "cancelJob") {
    operation = cancelCurrentJob();
  } else if (message?.type === "clearTab") {
    operation = clearTab(message.tabId).then(() => ({ ok: true }));
  } else if (message?.type === "enableDeepDetection") {
    operation = enableDeepDetection(message.tabId);
  } else if (message?.type === "inlineManifestDetected") {
    operation = captureInlineManifest(message, sender);
  } else {
    operation = Promise.reject(new Error("Unknown extension message"));
  }

  operation.then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

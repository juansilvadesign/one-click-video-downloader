import {
  chooseDownloadPlan,
  classifyMedia,
  normalizeContentType,
  qualityHint,
  slugify
} from "./media.js";
import { PowerLeaseManager } from "./power.js";

const HOST_NAME = "io.local.one_click_video_downloader";
const MEDIA_STORAGE_KEY = "mediaByTab";
const JOB_STORAGE_KEY = "jobs";
const HEADING_PREF_KEY = "useHeadingForName";
const MAX_CANDIDATES_PER_TAB = 100;
const MAX_INLINE_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 3;
const MAX_FINISHED_JOBS = 6;
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
// One entry per download, keyed by job id, so several can run at once.
const jobs = new Map();
// Browser-download fallback plans carry media URLs + headers, so they stay in
// memory only and are never persisted — preserving the original redaction posture.
const browserFallbacks = new Map();
let useHeadingForName = false;

const wakeLocks = new PowerLeaseManager({
  hasPermission: () => chrome.permissions.contains({ permissions: ["power"] }),
  requestKeepAwake: (level) => chrome.power.requestKeepAwake(level),
  releaseKeepAwake: () => chrome.power.releaseKeepAwake()
});

const ready = restoreState();

async function restoreState() {
  const stored = await storageArea.get([MEDIA_STORAGE_KEY, JOB_STORAGE_KEY, HEADING_PREF_KEY]);
  for (const [tabId, candidates] of Object.entries(stored[MEDIA_STORAGE_KEY] || {})) {
    mediaByTab.set(Number(tabId), candidates);
    await updateBadge(Number(tabId));
  }
  for (const job of stored[JOB_STORAGE_KEY] || []) {
    if (!job?.id) continue;
    jobs.set(job.id, ACTIVE_JOB_STATES.has(job.status)
      ? {
          ...job,
          status: "error",
          error: "The previous local job disconnected when the extension worker restarted.",
          finishedAt: Date.now()
        }
      : job);
  }
  useHeadingForName = Boolean(stored[HEADING_PREF_KEY]);
  await persistJobs();
  const hasPower = await chrome.permissions.contains({ permissions: ["power"] });
  if (hasPower) chrome.power.releaseKeepAwake();
}

async function persistMedia() {
  await storageArea.set({ [MEDIA_STORAGE_KEY]: Object.fromEntries(mediaByTab) });
}

async function persistJobs() {
  await storageArea.set({ [JOB_STORAGE_KEY]: [...jobs.values()] });
}

function setJob(id, entry) {
  jobs.set(id, entry);
  void persistJobs();
}

function patchJob(id, patch) {
  const current = jobs.get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  jobs.set(id, next);
  void persistJobs();
  return next;
}

function activeJobs() {
  return [...jobs.values()].filter((job) => ACTIVE_JOB_STATES.has(job.status));
}

function hasActiveDuplicate(dedupeKey) {
  return [...jobs.values()].some(
    (job) => job.dedupeKey === dedupeKey && ACTIVE_JOB_STATES.has(job.status)
  );
}

// Project a job to a popup-safe view: no media URLs, headers, cookies, or fallback plan.
function jobView(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    tabId: job.tabId,
    title: job.title,
    label: job.label,
    progress: Number.isFinite(job.progress) ? job.progress : null,
    detail: job.detail || "",
    live: Boolean(job.live),
    stopped: Boolean(job.stopped),
    output: job.output || "",
    error: job.error || ""
  };
}

// Keep all active jobs plus the most recent finished ones so the list stays bounded.
function pruneJobs() {
  const finished = [...jobs.values()].filter((job) => !ACTIVE_JOB_STATES.has(job.status));
  if (finished.length <= MAX_FINISHED_JOBS) return;
  finished
    .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))
    .slice(0, finished.length - MAX_FINISHED_JOBS)
    .forEach((job) => jobs.delete(job.id));
  void persistJobs();
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
      for (const job of jobs.values()) {
        if (job.mode === "native" && ACTIVE_JOB_STATES.has(job.status)) {
          void wakeLocks.release(job.id);
          patchJob(job.id, { status: "error", error: message, finishedAt: Date.now() });
        }
      }
      pruneJobs();
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
  const job = jobs.get(message.id);
  if (!job) return;

  if (message.event === "started") {
    patchJob(message.id, {
      status: message.live ? "recording" : "running",
      live: Boolean(message.live),
      detail: message.detail || "Processing locally"
    });
  } else if (message.event === "progress") {
    const status = job.status === "stopping"
      ? "stopping"
      : job.live ? "recording" : "running";
    patchJob(message.id, {
      status,
      progress: message.progress ?? job.progress ?? null,
      detail: message.detail || "Processing locally"
    });
  } else if (message.event === "retrying") {
    patchJob(message.id, {
      status: "retrying",
      retryAttempt: message.attempt,
      detail: message.detail || "Retrying a temporary failure"
    });
  } else if (message.event === "stopping") {
    patchJob(message.id, { status: "stopping", detail: message.detail || "Stopping" });
  } else if (message.event === "canceled") {
    void wakeLocks.release(message.id);
    patchJob(message.id, { status: "canceled", detail: "Download canceled", finishedAt: Date.now() });
    pruneJobs();
  } else if (message.event === "complete") {
    void wakeLocks.release(message.id);
    patchJob(message.id, {
      status: "complete",
      output: message.output,
      progress: 100,
      stopped: Boolean(message.stopped),
      finishedAt: Date.now()
    });
    pruneJobs();
  } else if (message.event === "error") {
    void wakeLocks.release(message.id);
    patchJob(message.id, {
      status: "error",
      error: message.error || "Local processing failed",
      finishedAt: Date.now()
    });
    pruneJobs();
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

async function headingNamingEnabled() {
  if (!useHeadingForName) return false;
  return chrome.permissions.contains({ permissions: ["scripting"] });
}

// One-shot read of the page <h1> on the active download gesture. Only runs when the
// user opted in and granted scripting; any blocked page (chrome://, PDF, restricted)
// returns "" so the caller falls back to the tab title.
async function readPageHeading(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const heading = document.querySelector("h1")?.innerText?.trim();
        return heading || document.title || "";
      }
    });
    return String(injection?.result || "").slice(0, 300);
  } catch {
    return "";
  }
}

async function resolveTitle(tabId, tab, plan) {
  const base = plan?.inputs?.[0]?.pageTitle || tab?.title || "video";
  const heading = (await headingNamingEnabled()) ? await readPageHeading(tabId) : "";
  return slugify(heading || base, "video");
}

async function setHeadingPreference(enabled) {
  if (enabled) {
    const granted = await chrome.permissions.contains({ permissions: ["scripting"] });
    if (!granted) throw new Error("Scripting permission is required to read page headings");
  }
  useHeadingForName = enabled;
  await storageArea.set({ [HEADING_PREF_KEY]: enabled });
  broadcast({ type: "stateUpdated" });
  return { ok: true, useHeadingForName };
}

async function startDownload(tabId, { useCookies = false } = {}) {
  await ready;
  if (activeJobs().length >= MAX_CONCURRENT_JOBS) {
    throw new Error(`Too many downloads are active (max ${MAX_CONCURRENT_JOBS}). Wait for one to finish.`);
  }
  const candidates = mediaByTab.get(tabId) || [];
  const plan = chooseDownloadPlan(candidates);
  const tab = await chrome.tabs.get(tabId);

  if (!plan) {
    if (!canUsePageFallback(tab)) {
      throw new Error(hostState.capabilities?.ytDlp?.available
        ? "This page cannot be passed to the local extractor"
        : "No video was detected. Play it first, enable deep detection, or install yt-dlp fallback.");
    }
    const dedupeKey = `${tabId}:page:${scriptHash(tab.url)}`;
    if (hasActiveDuplicate(dedupeKey)) throw new Error("This page is already downloading");
    let cookies = [];
    if (useCookies) {
      const allowed = await chrome.permissions.contains({ permissions: ["cookies"] });
      if (!allowed) throw new Error("Cookie access was not granted");
      cookies = await chrome.cookies.getAll({ url: tab.url });
    }
    const title = await resolveTitle(tabId, tab, null);
    return startNativeJob(
      { mode: "page", pageUrl: tab.url, cookies, userAgent: navigator.userAgent },
      title,
      { tabId, dedupeKey, label: "Page extractor" }
    );
  }

  const dedupeKey = `${tabId}:${scriptHash(plan.inputs[0]?.url || "")}`;
  if (hasActiveDuplicate(dedupeKey)) throw new Error("This video is already downloading");
  const title = await resolveTitle(tabId, tab, plan);

  if (plan.mode === "direct") {
    try {
      const downloadId = await chrome.downloads.download({
        url: plan.inputs[0].url,
        filename: `${title}.mp4`,
        saveAs: false,
        conflictAction: "uniquify"
      });
      const id = crypto.randomUUID();
      browserFallbacks.set(id, { plan, title });
      setJob(id, {
        id,
        status: "running",
        mode: "browser",
        tabId,
        title,
        label: plan.label,
        dedupeKey,
        downloadId,
        progress: null,
        detail: "Downloading MP4",
        createdAt: Date.now()
      });
      broadcast({ type: "stateUpdated" });
      return jobView(jobs.get(id));
    } catch {
      return startNativeJob({ ...plan, mode: "direct" }, title, { tabId, dedupeKey, label: plan.label });
    }
  }
  return startNativeJob(plan, title, { tabId, dedupeKey, label: plan.label });
}

async function startNativeJob(plan, title, { tabId, dedupeKey, label }) {
  const port = connectNativeHost();
  if (!port) throw new Error(hostState.message);
  const id = crypto.randomUUID();
  setJob(id, {
    id,
    status: "running",
    mode: "native",
    tabId,
    title,
    label: label || "Local job",
    dedupeKey,
    progress: null,
    detail: "Starting local job",
    createdAt: Date.now()
  });
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
    patchJob(id, { status: "error", error: error.message, finishedAt: Date.now() });
    throw error;
  }
  broadcast({ type: "stateUpdated" });
  return jobView(jobs.get(id));
}

chrome.downloads.onChanged.addListener((delta) => {
  const job = [...jobs.values()].find((entry) => entry.mode === "browser" && entry.downloadId === delta.id);
  if (!job || job.status === "canceled") return;
  if (delta.state?.current === "complete") {
    browserFallbacks.delete(job.id);
    patchJob(job.id, { status: "complete", progress: 100, finishedAt: Date.now() });
    pruneJobs();
  } else if (delta.error?.current) {
    const fallback = browserFallbacks.get(job.id);
    browserFallbacks.delete(job.id);
    if (delta.error.current !== "USER_CANCELED" && fallback) {
      jobs.delete(job.id);
      void persistJobs();
      void startNativeJob(fallback.plan, fallback.title, {
        tabId: job.tabId,
        dedupeKey: job.dedupeKey,
        label: job.label
      }).catch((error) => {
        setJob(job.id, { ...job, status: "error", error: error.message, finishedAt: Date.now() });
        broadcast({ type: "stateUpdated" });
      });
      return;
    }
    patchJob(job.id, delta.error.current === "USER_CANCELED"
      ? { status: "canceled", detail: "Download canceled", finishedAt: Date.now() }
      : { status: "error", error: delta.error.current, finishedAt: Date.now() });
    pruneJobs();
  }
  broadcast({ type: "stateUpdated" });
});

async function cancelJob(jobId) {
  await ready;
  const job = jobs.get(jobId);
  if (!job || !ACTIVE_JOB_STATES.has(job.status)) throw new Error("No active download to stop");
  if (job.mode === "browser") {
    browserFallbacks.delete(jobId);
    await chrome.downloads.cancel(job.downloadId);
    patchJob(jobId, { status: "canceled", detail: "Download canceled", finishedAt: Date.now() });
    pruneJobs();
  } else if (job.mode === "native" && nativePort) {
    nativePort.postMessage({ action: job.live ? "stop" : "cancel", id: jobId });
    patchJob(jobId, { status: "stopping", detail: job.live ? "Stopping and finalizing" : "Canceling" });
  } else {
    throw new Error("The native job is no longer connected");
  }
  broadcast({ type: "stateUpdated" });
  return jobView(jobs.get(jobId));
}

// Remove a finished job's card from the popup. This only forgets the local job
// record; it never touches the saved file. Active jobs must be canceled first.
async function dismissJob(jobId) {
  await ready;
  const job = jobs.get(jobId);
  if (!job) return { ok: true };
  if (ACTIVE_JOB_STATES.has(job.status)) {
    throw new Error("This download is still active. Cancel it first.");
  }
  jobs.delete(jobId);
  browserFallbacks.delete(jobId);
  await persistJobs();
  broadcast({ type: "stateUpdated" });
  return { ok: true };
}

// Remove every finished (non-active) job card at once. Saved files are untouched.
async function clearFinishedJobs() {
  await ready;
  let changed = false;
  for (const [id, job] of jobs) {
    if (ACTIVE_JOB_STATES.has(job.status)) continue;
    jobs.delete(id);
    browserFallbacks.delete(id);
    changed = true;
  }
  if (changed) await persistJobs();
  broadcast({ type: "stateUpdated" });
  return { ok: true };
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
  const dedupeKey = detectedPlan
    ? `${tabId}:${scriptHash(detectedPlan.inputs[0]?.url || "")}`
    : pageFallback ? `${tabId}:page:${scriptHash(tab?.url || "")}` : "";
  return {
    candidateCount: candidates.length,
    plan: detectedPlan
      ? { mode: detectedPlan.mode, label: detectedPlan.label }
      : pageFallback ? { mode: "page", label: "Page extractor fallback" } : null,
    host: hostState,
    jobs: [...jobs.values()].map(jobView),
    activeCount: activeJobs().length,
    maxConcurrent: MAX_CONCURRENT_JOBS,
    tabDownloading: dedupeKey ? hasActiveDuplicate(dedupeKey) : false,
    pageFallback,
    deepDetectionEnabled: await deepDetectionEnabled(tab),
    useHeadingForName,
    headingPermission: await chrome.permissions.contains({ permissions: ["scripting"] })
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === "getState") {
    operation = stateFor(message.tabId);
  } else if (message?.type === "downloadBest") {
    operation = startDownload(message.tabId, { useCookies: Boolean(message.useCookies) });
  } else if (message?.type === "cancelJob") {
    operation = cancelJob(message.jobId);
  } else if (message?.type === "dismissJob") {
    operation = dismissJob(message.jobId);
  } else if (message?.type === "clearFinishedJobs") {
    operation = clearFinishedJobs();
  } else if (message?.type === "clearTab") {
    operation = clearTab(message.tabId).then(() => ({ ok: true }));
  } else if (message?.type === "enableDeepDetection") {
    operation = enableDeepDetection(message.tabId);
  } else if (message?.type === "inlineManifestDetected") {
    operation = captureInlineManifest(message, sender);
  } else if (message?.type === "setHeadingPreference") {
    operation = setHeadingPreference(Boolean(message.enabled));
  } else {
    operation = Promise.reject(new Error("Unknown extension message"));
  }

  operation.then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

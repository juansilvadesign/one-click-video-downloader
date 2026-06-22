(() => {
  const MAX_BYTES = 2 * 1024 * 1024;
  const encoder = new TextEncoder();
  document.addEventListener("ocvd:inline-hls", (event) => {
    const manifestText = event.detail?.manifestText;
    const baseUrl = event.detail?.baseUrl;
    if (typeof manifestText !== "string" || typeof baseUrl !== "string") return;
    if (!manifestText.trimStart().startsWith("#EXTM3U")) return;
    if (encoder.encode(manifestText).byteLength > MAX_BYTES) return;
    chrome.runtime.sendMessage({ type: "inlineManifestDetected", manifestText, baseUrl }).catch(() => undefined);
  });
})();

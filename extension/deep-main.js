(() => {
  const INSTALLED = Symbol.for("ocvd.deepBlobDetector");
  const HLS_TYPES = new Set([
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ]);
  const MAX_BYTES = 2 * 1024 * 1024;
  if (window[INSTALLED]) return;
  window[INSTALLED] = true;

  const NativeBlob = window.Blob;
  class ObservedBlob extends NativeBlob {
    constructor(parts, options = {}) {
      super(parts, options);
      const type = String(options.type || this.type || "").split(";", 1)[0].trim().toLowerCase();
      if (!HLS_TYPES.has(type) || this.size > MAX_BYTES) return;
      this.text().then((manifestText) => {
        if (!manifestText.trimStart().startsWith("#EXTM3U")) return;
        document.dispatchEvent(new CustomEvent("ocvd:inline-hls", {
          detail: { manifestText, baseUrl: document.baseURI }
        }));
      }).catch(() => undefined);
    }
  }
  window.Blob = ObservedBlob;
})();

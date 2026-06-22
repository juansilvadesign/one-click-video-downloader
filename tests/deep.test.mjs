import test from "node:test";
import assert from "node:assert/strict";

test("deep detector emits only bounded HLS-typed Blob manifests", async () => {
  const events = [];
  const nativeBlob = globalThis.Blob;
  globalThis.window = { Blob: nativeBlob };
  globalThis.document = {
    baseURI: "https://media.example/watch/1",
    dispatchEvent: (event) => events.push(event)
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  };

  try {
    await import(`../extension/deep-main.js?test=${Date.now()}`);
    new window.Blob(["#EXTM3U\nsegment.ts\n"], { type: "application/vnd.apple.mpegurl" });
    new window.Blob(["#EXTM3U\nignored.ts\n"], { type: "text/plain" });
    new window.Blob([`#EXTM3U\n${"x".repeat(2 * 1024 * 1024)}`], {
      type: "application/vnd.apple.mpegurl"
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "ocvd:inline-hls");
    assert.equal(events[0].detail.baseUrl, document.baseURI);
    assert.match(events[0].detail.manifestText, /^#EXTM3U/);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.CustomEvent;
  }
});

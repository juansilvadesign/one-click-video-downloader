const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm"];

let recorder = null;
let chunks = [];
let audioContext = null;

function supportedMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startCapture(streamId) {
  if (recorder) throw new Error("A tab recording is already running");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    }
  });

  audioContext = new AudioContext();
  audioContext.createMediaStreamSource(stream).connect(audioContext.destination);

  chunks = [];
  const mimeType = supportedMimeType();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  recorder.start(1000);

  return { ok: true };
}

async function stopCapture() {
  if (!recorder) throw new Error("No tab recording is running");

  const active = recorder;
  const stopped = new Promise((resolve) => {
    active.addEventListener("stop", resolve, { once: true });
  });
  active.stop();
  await stopped;

  active.stream.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close().catch(() => undefined);

  const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" });
  recorder = null;
  chunks = [];
  audioContext = null;

  if (!blob.size) throw new Error("The recording produced no audio");
  return { ok: true, url: URL.createObjectURL(blob), bytes: blob.size };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return undefined;

  let operation;
  if (message.type === "offscreenStartCapture") {
    operation = startCapture(message.streamId);
  } else if (message.type === "offscreenStopCapture") {
    operation = stopCapture();
  } else {
    operation = Promise.reject(new Error("Unknown offscreen message"));
  }

  operation.then(sendResponse, (error) => sendResponse({ error: error.message }));
  return true;
});

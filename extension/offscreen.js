// PodPilot offscreen audio player.
// Receives PLAY_UPLOAD_SOUND from the background service worker and
// plays assets/cha-ching.mp3 once. Browsers may still block playback
// if the user has never interacted with the extension origin; we log
// and fail silently in that case.

var DEBUG = false;
var debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

const SOUND_URL = chrome.runtime.getURL("assets/cha-ching.mp3");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== "offscreen") return undefined;

  if (message.type === "PLAY_UPLOAD_SOUND") {
    playChaChing()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true; // keep the message channel open for the async response
  }

  return undefined;
});

async function playChaChing() {
  try {
    const audio = new Audio(SOUND_URL);
    audio.volume = 0.7;
    await audio.play();
    debugLog("[PodPilot] cha-ching sound played");
  } catch (error) {
    console.warn("[PodPilot] cha-ching playback failed (offscreen):", error?.message || error);
    throw error;
  }
}

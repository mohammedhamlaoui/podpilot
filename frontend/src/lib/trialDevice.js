const DEVICE_ID_KEY = "podpilot_trial_device_id";
const LEGACY_DEVICE_ID_KEY = "podpilot_device_id";

function makeRandomId() {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getTrialDeviceId() {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY)
      || window.localStorage.getItem(LEGACY_DEVICE_ID_KEY);
    if (existing && existing.trim()) {
      const normalized = existing.trim();
      window.localStorage.setItem(DEVICE_ID_KEY, normalized);
      return normalized;
    }
    const next = makeRandomId();
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return makeRandomId();
  }
}

export function trialDeviceHeaders() {
  const deviceId = getTrialDeviceId();
  return deviceId ? { "X-PodPilot-Device-Id": deviceId } : {};
}

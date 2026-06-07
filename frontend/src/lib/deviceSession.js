const DEVICE_ID_STORAGE_KEY = "podpilot_device_id";
const DEVICE_LABEL = "PodPilot web dashboard";
export const DEVICE_ALREADY_ACTIVE_CODE = "device_already_active";
export const DEVICE_SESSION_REVOKED_CODE = "device_session_revoked";
export const DEVICE_ALREADY_ACTIVE_MESSAGE = "Your PodPilot account is already active on another device.";
export const DEVICE_SWITCH_MESSAGE = "Your PodPilot account is already active on another device. Switch to this device to continue. The other device will be disconnected.";
export const DEVICE_SESSION_REVOKED_MESSAGE = "This device was disconnected because your account was opened on another device.";

function fallbackUuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getDeviceId() {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing && existing.trim()) return existing.trim();
  const next = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : fallbackUuid();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

export function devicePayload() {
  return {
    device_id: getDeviceId(),
    device_label: DEVICE_LABEL,
  };
}

export function getDeviceHeaders() {
  const deviceId = getDeviceId();
  return deviceId ? { "X-PodPilot-Device-Id": deviceId } : {};
}

export function parseDeviceError(error) {
  const detail = error?.response?.data?.detail || error?.detail || null;
  const code = detail?.code || error?.code || "";
  const message = detail?.message || error?.message || "";
  return { code, message };
}

export function isDeviceAlreadyActiveError(error) {
  return parseDeviceError(error).code === DEVICE_ALREADY_ACTIVE_CODE;
}

export function isDeviceSessionRevokedError(error) {
  return parseDeviceError(error).code === DEVICE_SESSION_REVOKED_CODE;
}

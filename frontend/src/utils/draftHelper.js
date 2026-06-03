/**
 * Utility to identify local in-memory draft designs that haven't been persisted to the backend yet.
 */
export function isLocalId(id) {
  return typeof id === "string" && (id.startsWith("local_") || id.startsWith("temp_"));
}

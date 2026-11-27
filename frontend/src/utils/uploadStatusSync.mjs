// Merge delivery state only; preserve local editor fields, rows, and ordering.
export function mergeUploadStatuses(current, incoming) {
  const byId = new Map(incoming.map(row => [String(row.id || row.design_id), row]));
  let changed = false;
  const next = current.map(row => {
    const fresh = byId.get(String(row.id || row.design_id));
    if (!fresh || !fresh.status) return row;
    const patch = {};
    for (const key of ["status", "uploaded_at", "error_message"]) {
      if (Object.prototype.hasOwnProperty.call(fresh, key) && row[key] !== fresh[key]) patch[key] = fresh[key];
    }
    if (!Object.keys(patch).length) return row;
    changed = true;
    return { ...row, ...patch };
  });
  return changed ? next : current;
}

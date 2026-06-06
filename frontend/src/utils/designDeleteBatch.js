import { clearCachedDesignImages } from "./imageCache";
import { isLocalId } from "./draftHelper";

function devDeleteLog(message, data) {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[Delete] ${message}`, data || "");
}

export async function deleteDesignBatch({
  ids,
  designs,
  userId,
  deleteBackendDesigns,
  onDesignsChange,
  setSelectedIds,
  updateProgress,
  isCancelled,
  revokeLocalDraftPreview,
}) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  const total = uniqueIds.length;
  const byId = new Map((designs || []).map((design) => [design.id, design]));
  const localIds = uniqueIds.filter((id) => isLocalId(id));
  const backendIds = uniqueIds.filter((id) => !isLocalId(id));
  const deletedIds = [];
  const failedIds = [];
  const results = [];
  let completed = 0;

  for (const id of localIds) {
    if (isCancelled?.()) {
      return { deletedIds, failedIds, results, cancelled: true, completed, total };
    }
    updateProgress?.(completed, total, deletedIds.length, failedIds.length, { currentId: id });
    revokeLocalDraftPreview?.(byId.get(id));
    deletedIds.push(id);
    results.push({ design_id: id, success: true, local: true });
    completed += 1;
    onDesignsChange((currentDesigns) => currentDesigns.filter((design) => design.id !== id));
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
    updateProgress?.(completed, total, deletedIds.length, failedIds.length, { currentId: id });
  }

  for (const id of backendIds) {
    if (isCancelled?.()) {
      return { deletedIds, failedIds, results, cancelled: true, completed, total };
    }
    updateProgress?.(completed, total, deletedIds.length, failedIds.length, { currentId: id });

    try {
      const payload = await deleteBackendDesigns([id]);
      const result = Array.isArray(payload?.results) ? payload.results[0] : null;
      results.push(result || { design_id: id, success: false, reason: "No delete result returned." });
      if (!result?.success) {
        failedIds.push(id);
        devDeleteLog("failed design kept visible", {
          design_id: id,
          reason: result?.reason || "No delete result returned.",
        });
      } else {
        deletedIds.push(id);
        await clearCachedDesignImages(byId.get(id), userId);
        onDesignsChange((currentDesigns) => currentDesigns.filter((design) => design.id !== id));
        setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      }
    } catch (error) {
      failedIds.push(id);
      results.push({ design_id: id, success: false, reason: error?.message || "Delete request failed." });
      devDeleteLog("delete request failed", {
        design_id: id,
        reason: error?.message || error,
      });
    }

    completed += 1;
    updateProgress?.(completed, total, deletedIds.length, failedIds.length, { currentId: id });
  }

  setSelectedIds((current) => current.filter((id) => failedIds.includes(id)));
  return { deletedIds, failedIds, results, cancelled: false, completed, total };
}

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
  revokeLocalDraftPreview,
}) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  const total = uniqueIds.length;
  const byId = new Map((designs || []).map((design) => [design.id, design]));
  const localIds = uniqueIds.filter((id) => isLocalId(id));
  const backendIds = uniqueIds.filter((id) => !isLocalId(id));
  const deletedIds = [];
  const failedIds = [];
  let completed = 0;

  if (localIds.length > 0) {
    localIds.forEach((id) => {
      revokeLocalDraftPreview?.(byId.get(id));
      deletedIds.push(id);
    });
    completed += localIds.length;
    updateProgress?.(completed, total, deletedIds.length, failedIds.length);
    onDesignsChange((currentDesigns) => currentDesigns.filter((design) => !localIds.includes(design.id)));
    setSelectedIds((current) => current.filter((id) => !localIds.includes(id)));
  }

  if (backendIds.length > 0) {
    let payload;
    try {
      payload = await deleteBackendDesigns(backendIds);
    } catch (error) {
      backendIds.forEach((id) => failedIds.push(id));
      completed += backendIds.length;
      updateProgress?.(completed, total, deletedIds.length, failedIds.length);
      devDeleteLog("batch request failed", error?.message || error);
      return { deletedIds, failedIds, results: [] };
    }

    const results = Array.isArray(payload?.results) ? payload.results : [];
    const resultById = new Map(results.map((result) => [String(result.design_id || result.deleted_design_id || ""), result]));

    backendIds.forEach((id) => {
      const result = resultById.get(String(id));
      if (result?.success) {
        deletedIds.push(id);
      } else {
        failedIds.push(id);
        devDeleteLog("failed design kept visible", {
          design_id: id,
          reason: result?.reason || "No delete result returned.",
        });
      }
      completed += 1;
      updateProgress?.(completed, total, deletedIds.length, failedIds.length);
    });

    const backendDeletedIds = backendIds.filter((id) => deletedIds.includes(id));
    if (backendDeletedIds.length > 0) {
      await Promise.all(
        backendDeletedIds.map((id) => clearCachedDesignImages(byId.get(id), userId)),
      );
      onDesignsChange((currentDesigns) => currentDesigns.filter((design) => !backendDeletedIds.includes(design.id)));
      setSelectedIds((current) => current.filter((id) => !backendDeletedIds.includes(id)));
    }
  }

  setSelectedIds((current) => current.filter((id) => failedIds.includes(id)));
  return { deletedIds, failedIds };
}

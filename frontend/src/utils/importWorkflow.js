export const IMPORT_CONCURRENCY = 3;

export function createImportProgress(message = "Preparing import") {
  return {
    open: true,
    step: "preparing",
    message,
    uploadDone: 0,
    uploadTotal: 0,
    createDone: 0,
    createTotal: 0,
    createdCount: 0,
    failures: [],
    done: false,
  };
}

export function getErrorMessage(error, fallback = "Import failed.") {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" ? detail : error?.message || fallback;
}

export function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function runLimitedConcurrency(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

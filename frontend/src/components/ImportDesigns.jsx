import { useEffect, useMemo, useState, useRef } from "react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import { createDesign, uploadStandaloneImages } from "../api/client";
import Icon from "./Icon";
import { LoadingButton } from "./LoadingComponents";
import ImportProgressModal from "./ImportProgressModal";
import { createImagePreviewDataUrl } from "../utils/imagePreview";
import { IMPORT_CONCURRENCY, createImportProgress, getErrorMessage, runLimitedConcurrency, withTimeout } from "../utils/importWorkflow";
import { PREMIUM_LOCK_MESSAGE } from "../lib/subscriptionAccess";

const REQUIRED_COLUMNS = [
  "filename",
  "title",
  "description",
  "main_tag",
  "supporting_tags",
  "copy_link"
];

function stripExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^/.]+$/, "");
}

function normalizeName(fileName) {
  return stripExtension(fileName).trim().toLowerCase();
}

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return "0 MB";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function buildDesign(row, index) {
  const filename = normalizeCell(row.filename);

  return {
    id: `${filename || "design"}-${index + 2}`,
    filename,
    title: normalizeCell(row.title),
    description: normalizeCell(row.description),
    main_tag: normalizeCell(row.main_tag),
    supporting_tags: normalizeCell(row.supporting_tags),
    copy_link: normalizeCell(row.copy_link),
    sticker_color: "",
    stickers_color_enabled: "Off",
    source_row: index + 2
  };
}

function parseWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          reject(new Error("The workbook does not contain any sheets."));
          return;
        }

        const sheet = workbook.Sheets[firstSheetName];
        const headerRows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          blankrows: false,
          defval: ""
        });
        const headers = (headerRows[0] || []).map((header) => normalizeCell(header)).filter(Boolean);
        const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));

        if (missingColumns.length > 0) {
          reject(new Error(`Missing columns: ${missingColumns.join(", ")}.`));
          return;
        }

        const rows = XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          raw: false
        });
        const designs = rows
          .map(buildDesign)
          .filter((design) => REQUIRED_COLUMNS.some((column) => design[column]));

        if (designs.length === 0) {
          reject(new Error("The Excel file has headers but no design rows."));
          return;
        }

        resolve(designs);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Could not read the Excel file."));
    reader.readAsArrayBuffer(file);
  });
}

function findImageForDesign(design, files) {
  const designFull = String(design?.filename ?? "").trim().toLowerCase();
  const designBase = normalizeName(design?.filename);
  return files.find((file) => {
    const imageFull = String(file.name ?? "").trim().toLowerCase();
    const imageBase = normalizeName(file.name);
    return imageFull === designFull || imageBase === designBase;
  }) || null;
}

function findSavedFile(file, savedFiles) {
  return savedFiles.find((saved) => saved.original_name === file.name) ||
    savedFiles.find((saved) => saved.filename === file.name) ||
    {};
}

export default function ImportDesigns({ onImportComplete, onBackToDesigns, existingDesigns = [], isWorkspaceLocked = false, onLockedAction }) {
  const stopImportRef = useRef(false);
  const [excelFile, setExcelFile] = useState(null);
  const [designs, setDesigns] = useState([]);
  const [imageFiles, setImageFiles] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [unmatchedNames, setUnmatchedNames] = useState([]);
  const [allowPartialImport, setAllowPartialImport] = useState(false);
  const [importProgress, setImportProgress] = useState(null);

  function requireUnlocked() {
    if (!isWorkspaceLocked) return true;
    setError(PREMIUM_LOCK_MESSAGE);
    if (typeof onLockedAction === "function") onLockedAction();
    return false;
  }

  // Map filename → existing design for metadata reuse on image-only imports.
  const existingByFilename = useMemo(() => {
    const m = new Map();
    for (const d of existingDesigns || []) {
      if (!d.filename) continue;
      m.set(String(d.filename).trim().toLowerCase(), d);
      m.set(normalizeName(d.filename), d);
    }
    return m;
  }, [existingDesigns]);

  function lookupExistingMetadata(fileName) {
    const fn = String(fileName || "").trim().toLowerCase();
    return existingByFilename.get(fn) || existingByFilename.get(normalizeName(fileName)) || null;
  }

  const previewRows = useMemo(() => designs.slice(0, 8), [designs]);
  const imagePreviewUrls = useMemo(
    () => new Map(imageFiles.map((file) => [file.name, URL.createObjectURL(file)])),
    [imageFiles]
  );
  const matchSummary = useMemo(() => {
    const missing = designs
      .filter((design) => !findImageForDesign(design, imageFiles))
      .map((design) => design.filename)
      .filter(Boolean);
    const matchedDesigns = designs.length - missing.length;
    const matchedEntries = designs
      .map((design) => ({ design, file: findImageForDesign(design, imageFiles) }))
      .filter((entry) => entry.file);
    return { missing, matchedDesigns, matchedEntries };
  }, [designs, imageFiles]);
  const hasExcelMissingImages = designs.length > 0 && imageFiles.length > 0 && matchSummary.missing.length > 0;
  const hasPartialExcelMatch = hasExcelMissingImages && matchSummary.matchedDesigns > 0;
  const hasNoExcelImageMatches = hasExcelMissingImages && matchSummary.matchedDesigns === 0;
  const imageOnlySummary = useMemo(() => {
    const matched = [];
    const missing = [];
    if (designs.length > 0 || imageFiles.length === 0 || existingByFilename.size === 0) {
      return { matched, missing };
    }
    imageFiles.forEach((file) => {
      if (lookupExistingMetadata(file.name)) matched.push(file.name);
      else missing.push(file.name);
    });
    return { matched, missing };
  }, [designs.length, existingByFilename, imageFiles]);
  const hasPartialImageOnlyMatch = !excelFile &&
    designs.length === 0 &&
    imageOnlySummary.matched.length > 0 &&
    imageOnlySummary.missing.length > 0;
  const hasNoImageOnlyMatches = !excelFile &&
    designs.length === 0 &&
    imageFiles.length > 0 &&
    existingByFilename.size > 0 &&
    imageOnlySummary.matched.length === 0;

  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imagePreviewUrls]);

  const onExcelDrop = async (acceptedFiles) => {
    if (!requireUnlocked()) return;
    const file = acceptedFiles[0];
    setError("");
    setSuccess("");
    setAllowPartialImport(false);
    setExcelFile(null);
    setDesigns([]);

    if (!file) {
      setError("Drop one .xlsx file.");
      return;
    }

    try {
      const parsedDesigns = await parseWorkbook(file);
      setExcelFile(file);
      setDesigns(parsedDesigns);
    } catch (parseError) {
      setError(parseError.message || "Could not parse this Excel file.");
    }
  };

  const onImageDrop = (acceptedFiles, fileRejections) => {
    if (!requireUnlocked()) return;
    setError("");
    setSuccess("");
    setAllowPartialImport(false);

    const skippedCount = fileRejections?.length || 0;
    if (skippedCount > 0) {
      if (acceptedFiles.length === 0) {
        setError("Unsupported file type. Please upload PNG or JPEG designs only.");
        setImageFiles([]);
        return;
      } else {
        setError(`${skippedCount} file${skippedCount === 1 ? ' was' : 's were'} skipped because only PNG and JPEG designs are supported.`);
      }
    }
    setImageFiles(acceptedFiles);
  };

  const excelDropzone = useDropzone({
    onDrop: onExcelDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
    },
    maxFiles: 1,
    multiple: false,
    noClick: false,
    noKeyboard: false
  });

  const imagesDropzone = useDropzone({
    onDrop: onImageDrop,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"]
    },
    multiple: true,
    noClick: false,
    noKeyboard: false
  });

  function downloadTemplate() {
    const worksheet = XLSX.utils.json_to_sheet([
      {
        filename: "example.png",
        title: "Example Redbubble title",
        description: "SEO description with at least 75 characters.",
        main_tag: "example",
        supporting_tags: "funny, art, sticker",
        copy_link: "https://www.redbubble.com/portfolio/images/123/duplicate"
      }
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Redbubble Upload");
    XLSX.writeFile(workbook, "redbubble_upload_template.xlsx");
  }

  async function handleImport() {
    if (!requireUnlocked()) return;
    stopImportRef.current = false;
    setError("");
    setSuccess("");
    setUnmatchedNames([]);
    setImportProgress(null);
    const importFailures = [];

    function pushFailure(filename, reason) {
      importFailures.push({ filename, reason });
      setImportProgress((current) => current ? {
        ...current,
        failures: [...current.failures, { filename, reason }]
      } : current);
    }

    // Determine all matched files to upload
    let rowsToCreate = [];
    if (excelFile && designs.length > 0) {
      rowsToCreate = imageFiles.length > 0 && hasPartialExcelMatch
        ? matchSummary.matchedEntries.map((entry) => entry.design)
        : designs;
    } else if (!excelFile && imageFiles.length > 0) {
      const matchedFiles = [];
      for (const file of imageFiles) {
        const meta = lookupExistingMetadata(file.name);
        if (meta) matchedFiles.push({ file, meta });
      }
      rowsToCreate = matchedFiles;
    }

    const uploadEntries = (excelFile && designs.length > 0)
      ? rowsToCreate.map((design) => ({ design, file: findImageForDesign(design, imageFiles) })).filter((entry) => entry.file)
      : rowsToCreate; // For path 2, rowsToCreate is already matchedFiles list which has { file, meta }

    const totalBytes = uploadEntries.reduce((acc, entry) => acc + (entry.file?.size || 0), 0);
    const uploadedBytesMap = {};

    function updateOverallUploadProgress(fileName, loaded) {
      uploadedBytesMap[fileName] = loaded;
      const totalLoaded = Object.values(uploadedBytesMap).reduce((sum, val) => sum + val, 0);
      const uploadPercent = totalBytes > 0 ? (totalLoaded / totalBytes) : 0;
      const currentPercent = Math.min(Math.round(uploadPercent * 70), 70);

      setImportProgress((current) => {
        if (!current) return current;
        return {
          ...current,
          loadedBytes: totalLoaded,
          totalBytes,
          currentFileName: fileName,
          percent: currentPercent,
          message: `Uploading: ${fileName}`,
        };
      });
    }

    async function uploadMatchedEntries(entries) {
      const savedByFile = new Map();
      if (entries.length === 0) return savedByFile;

      setImportProgress((current) => ({
        ...current,
        step: "uploading",
        message: `Uploading images 0/${entries.length}`,
        uploadDone: 0,
        uploadTotal: entries.length,
        loadedBytes: 0,
        totalBytes,
        percent: 0,
        status: "Uploading",
      }));

      await runLimitedConcurrency(entries, IMPORT_CONCURRENCY, async (entry) => {
        if (stopImportRef.current) return;
        try {
          const uploadResp = await withTimeout(
            uploadStandaloneImages([entry.file], "redbubble", (progressEvent) => {
              updateOverallUploadProgress(entry.file.name, progressEvent.loaded);
            }),
            120000,
            `${entry.file.name} upload timed out.`
          );
          updateOverallUploadProgress(entry.file.name, entry.file.size);
          const saved = findSavedFile(entry.file, Array.isArray(uploadResp?.files) ? uploadResp.files : []);
          if (!saved.image_r2_key) throw new Error("Image upload did not return an R2 key.");
          savedByFile.set(entry.file.name, saved);
        } catch (uploadError) {
          pushFailure(entry.file.name, getErrorMessage(uploadError, "Image upload failed."));
        } finally {
          setImportProgress((current) => {
            const done = Math.min((current?.uploadDone || 0) + 1, entries.length);
            return current ? {
              ...current,
              uploadDone: done,
              message: `Uploading images ${done}/${entries.length}`,
            } : current;
          });
        }
      });

      return savedByFile;
    }

    async function buildUploadedImages(entries, savedByFile) {
      return Promise.all(entries.map(async ({ file }) => {
        const saved = savedByFile.get(file.name) || {};
        const previewDataUrl = await createImagePreviewDataUrl(file);
        return {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: file.size,
          previewUrl: URL.createObjectURL(file),
          previewDataUrl,
          matched: Boolean(saved.image_r2_key),
          storedName: saved.stored_name || "",
          imagePath: saved.image_r2_key || "",
          imageUrl: "",
          thumbnailUrl: "",
        };
      }));
    }

    // Path 1: Excel + optional images, driven from the frontend for progress.
    if (excelFile && designs.length > 0) {
      if (hasNoExcelImageMatches) {
        setError("No Excel rows have matching images yet. Add matching image files before importing.");
        setUnmatchedNames(matchSummary.missing);
        return;
      }
      if (hasPartialExcelMatch && !allowPartialImport) {
        setError("Some Excel rows are missing matching images. Confirm Import only matched designs to continue.");
        setUnmatchedNames(matchSummary.missing);
        return;
      }

      setIsImporting(true);
      setImportProgress({
        open: true,
        step: "preparing",
        message: "Preparing import",
        percent: 0,
        uploadedBytes: 0,
        totalBytes: 0,
        currentFileName: "",
        uploadDone: 0,
        uploadTotal: 0,
        createDone: 0,
        createTotal: 0,
        createdCount: 0,
        failures: [],
        done: false,
        status: "Uploading"
      });

      try {
        const savedByFile = await uploadMatchedEntries(uploadEntries);
        if (stopImportRef.current) {
          const uploadedImages = await buildUploadedImages(uploadEntries, savedByFile);
          const result = { count: created.length, marketplace: "redbubble", designs: created };
          onImportComplete(created, uploadedImages, result, { files: Array.from(savedByFile.values()) });
          setIsImporting(false);
          return;
        }
        const created = [];

        setImportProgress((current) => ({
          ...current,
          step: "creating",
          message: `Creating designs 0/${rowsToCreate.length}`,
          createDone: 0,
          createTotal: rowsToCreate.length,
          status: "Processing",
          percent: 70
        }));

        for (const design of rowsToCreate) {
          if (stopImportRef.current) {
            break;
          }
          const file = findImageForDesign(design, imageFiles);
          const saved = file ? savedByFile.get(file.name) : null;
          if (file && !saved?.image_r2_key) {
            setImportProgress((current) => {
              const done = Math.min((current?.createDone || 0) + 1, rowsToCreate.length);
              const createPercent = rowsToCreate.length > 0 ? (done / rowsToCreate.length) : 0;
              const currentPercent = 70 + Math.round(createPercent * 20);
              return current ? { 
                ...current, 
                createDone: done, 
                percent: currentPercent,
                message: `Creating designs ${done}/${rowsToCreate.length}` 
              } : current;
            });
            continue;
          }

          try {
            const row = await withTimeout(createDesign({
              filename: design.filename,
              marketplace: "redbubble",
              title: design.title || "",
              description: design.description || "",
              primary_tag: design.main_tag || "",
              main_tag: design.main_tag || "",
              supporting_tags: design.supporting_tags || "",
              copy_link: design.copy_link || "",
              image_r2_key: saved?.image_r2_key || undefined,
            }), 60000, `${design.filename} row creation timed out.`);
            created.push(row);
          } catch (createError) {
            pushFailure(design.filename || "Excel row", getErrorMessage(createError, "Could not create design."));
          } finally {
            setImportProgress((current) => {
              const done = Math.min((current?.createDone || 0) + 1, rowsToCreate.length);
              const createPercent = rowsToCreate.length > 0 ? (done / rowsToCreate.length) : 0;
              const currentPercent = 70 + Math.round(createPercent * 20);
              return current ? {
                ...current,
                createDone: done,
                createdCount: created.length,
                percent: currentPercent,
                message: `Creating designs ${done}/${rowsToCreate.length}`,
              } : current;
            });
          }
        }

        if (stopImportRef.current) {
          const uploadedImages = await buildUploadedImages(uploadEntries, savedByFile);
          const result = { count: created.length, marketplace: "redbubble", designs: created };
          onImportComplete(created, uploadedImages, result, { files: Array.from(savedByFile.values()) });
          setIsImporting(false);
          return;
        }

        setImportProgress((current) => ({ 
          ...current, 
          step: "finalizing", 
          message: "Finalizing import",
          percent: 95,
          status: "Processing"
        }));
        const uploadedImages = await buildUploadedImages(uploadEntries, savedByFile);
        const result = { count: created.length, marketplace: "redbubble", designs: created };
        setSuccess(`${created.length} design${created.length === 1 ? "" : "s"} imported${importFailures.length ? " with some skipped files." : " successfully."}`);
        setImportProgress((current) => ({
          ...current,
          step: "done",
          message: `${created.length} design${created.length === 1 ? "" : "s"} imported.`,
          createdCount: created.length,
          done: true,
          percent: 100,
          status: "Completed"
        }));
        onImportComplete(created, uploadedImages, result, { files: Array.from(savedByFile.values()) });
      } catch (importError) {
        setError(getErrorMessage(importError, "Import failed."));
        setImportProgress((current) => current ? {
          ...current,
          step: "done",
          message: getErrorMessage(importError, "Import failed."),
          done: true,
          percent: 100,
          status: "Failed"
        } : current);
      } finally {
        setIsImporting(false);
      }
      return;
    }

    // ── Path 2: Images only — reuse existing metadata by filename ──────
    if (!excelFile && imageFiles.length > 0) {
      const matchedFiles = [];
      const unmatched = [];
      for (const file of imageFiles) {
        const meta = lookupExistingMetadata(file.name);
        if (meta) matchedFiles.push({ file, meta });
        else unmatched.push(file.name);
      }

      if (matchedFiles.length === 0) {
        setError(
          "No previous metadata found for these filenames. Upload an Excel file or use Add New to enter metadata manually."
        );
        setUnmatchedNames(unmatched);
        return;
      }
      if (unmatched.length > 0 && !allowPartialImport) {
        setError("Some images do not match existing metadata. Confirm Import only matched designs to continue.");
        setUnmatchedNames(unmatched);
        return;
      }

      setIsImporting(true);
      setImportProgress({
        open: true,
        step: "preparing",
        message: "Preparing import",
        percent: 0,
        uploadedBytes: 0,
        totalBytes: 0,
        currentFileName: "",
        uploadDone: 0,
        uploadTotal: 0,
        createDone: 0,
        createTotal: 0,
        createdCount: 0,
        failures: [],
        done: false,
        status: "Uploading"
      });

      try {
        const uploadEntriesForPath2 = matchedFiles.map(({ file, meta }) => ({ file, meta }));
        const savedByFile = await uploadMatchedEntries(uploadEntriesForPath2);
        if (stopImportRef.current) {
          const uploadedImages = await buildUploadedImages(uploadEntriesForPath2, savedByFile);
          onImportComplete(created, uploadedImages, null, { files: Array.from(savedByFile.values()) });
          setIsImporting(false);
          return;
        }

        const created = [];
        setImportProgress((current) => ({
          ...current,
          step: "creating",
          message: `Creating designs 0/${matchedFiles.length}`,
          createDone: 0,
          createTotal: matchedFiles.length,
          status: "Processing",
          percent: 70
        }));

        for (const { file, meta } of matchedFiles) {
          if (stopImportRef.current) {
            break;
          }
          const saved = savedByFile.get(file.name) || {};
          if (!saved.image_r2_key) {
            setImportProgress((current) => {
              const done = Math.min((current?.createDone || 0) + 1, matchedFiles.length);
              const createPercent = matchedFiles.length > 0 ? (done / matchedFiles.length) : 0;
              const currentPercent = 70 + Math.round(createPercent * 20);
              return current ? { 
                ...current, 
                createDone: done, 
                percent: currentPercent,
                message: `Creating designs ${done}/${matchedFiles.length}` 
              } : current;
            });
            continue;
          }
          const supportingTags =
            typeof meta.supporting_tags === "string"
              ? meta.supporting_tags
              : (meta.supporting_tags || []).join(", ");
          try {
            const row = await withTimeout(createDesign({
              filename: file.name,
              marketplace: "redbubble",
              title: meta.title || "",
              description: meta.description || "",
              primary_tag: meta.primary_tag || meta.main_tag || "",
              main_tag: meta.primary_tag || meta.main_tag || "",
              supporting_tags: supportingTags,
              copy_link: meta.copy_link || "",
              adult_content: Boolean(meta.adult_content),
              image_r2_key: saved.image_r2_key || undefined,
            }), 60000, `${file.name} row creation timed out.`);
            created.push(row);
          } catch (createError) {
            pushFailure(file.name, getErrorMessage(createError, "Could not create design."));
          } finally {
            setImportProgress((current) => {
              const done = Math.min((current?.createDone || 0) + 1, matchedFiles.length);
              const createPercent = matchedFiles.length > 0 ? (done / matchedFiles.length) : 0;
              const currentPercent = 70 + Math.round(createPercent * 20);
              return current ? {
                ...current,
                createDone: done,
                createdCount: created.length,
                percent: currentPercent,
                message: `Creating designs ${done}/${matchedFiles.length}`,
              } : current;
            });
          }
        }

        if (stopImportRef.current) {
          const uploadedImages = await buildUploadedImages(uploadEntriesForPath2, savedByFile);
          onImportComplete(created, uploadedImages, null, { files: Array.from(savedByFile.values()) });
          setIsImporting(false);
          return;
        }

        setImportProgress((current) => ({ 
          ...current, 
          step: "finalizing", 
          message: "Finalizing import",
          percent: 95,
          status: "Processing"
        }));
        const uploadedImages = await buildUploadedImages(uploadEntriesForPath2, savedByFile);

        const messageParts = [`${created.length} design${created.length === 1 ? "" : "s"} imported using existing metadata.`];
        if (unmatched.length > 0) {
          messageParts.push(`Skipped (no metadata): ${unmatched.join(", ")}.`);
          setUnmatchedNames(unmatched);
        }
        setSuccess(messageParts.join(" "));
        setImportProgress((current) => ({
          ...current,
          step: "done",
          message: `${created.length} design${created.length === 1 ? "" : "s"} imported.`,
          createdCount: created.length,
          done: true,
          percent: 100,
          status: "Completed"
        }));
        onImportComplete(created, uploadedImages, null, { files: Array.from(savedByFile.values()) });
      } catch (importError) {
        setError(getErrorMessage(importError, "Import failed."));
        setImportProgress((current) => current ? {
          ...current,
          step: "done",
          message: getErrorMessage(importError, "Import failed."),
          done: true,
          percent: 100,
          status: "Failed"
        } : current);
      } finally {
        setIsImporting(false);
      }
      return;
    }

    setError("Drop an Excel file and/or design images to import.");
  }

  return (
    <section className="import-page marketplace-import redbubble-import">
      <div className="import-title-row">
        <div>
          <span className="marketplace-kicker">Redbubble automation</span>
          <h2>Import Redbubble Designs</h2>
          <p>Upload spreadsheet metadata and matching design images for the Redbubble queue.</p>
        </div>
        <div className="import-title-actions">
          <button type="button" className="secondary-button" onClick={onBackToDesigns}>
            <Icon name="arrowLeft" />
            <span>Back to Designs</span>
          </button>
          <button type="button" className="secondary-button">
            <Icon name="book" />
            <span>View Guide</span>
          </button>
          <button type="button" className="secondary-button" onClick={downloadTemplate}>
            <Icon name="download" />
            <span>Download Template</span>
          </button>
        </div>
      </div>

      <div className="import-card import-flow-card">
        <div className="import-drop-grid">
          <section className="import-step-card">
            <div className="import-section-head">
              <span className="import-step-badge">1</span>
              <h3 className="import-section-title import-section-title-excel">
                <Icon name="file" />
                Redbubble Excel File
              </h3>
            </div>
            <p className="import-section-copy">Start with the metadata sheet for filenames, titles, descriptions, and tags.</p>
            <div
              {...excelDropzone.getRootProps({
                className: `import-dropzone ${excelDropzone.isDragActive ? "import-dropzone-active" : ""}`
              })}
            >
              <input {...excelDropzone.getInputProps()} />
              <div className="upload-symbol">
                <Icon name="upload" />
              </div>
              <strong>Drag 'n' drop files here, or click to select files</strong>
              <span>You can upload a file with 10 MB</span>
            </div>
            {excelFile && (
              <div className="selected-file-card">
                <div className="file-icon-box">
                  <Icon name="file" />
                </div>
                <div>
                  <strong>{excelFile.name}</strong>
                  <span>{formatFileSize(excelFile.size)}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => {
                  setExcelFile(null);
                  setDesigns([]);
                  setAllowPartialImport(false);
                }} aria-label="Remove Excel file">
                  <Icon name="x" />
                </button>
              </div>
            )}
          </section>

          <section className="import-step-card">
            <div className="import-section-head">
              <span className="import-step-badge">2</span>
              <h3 className="import-section-title import-section-title-images">
                <Icon name="images" />
                Design Images
              </h3>
            </div>
            <p className="import-section-copy">Drop the matching artwork files so PodPilot can pair images with each row.</p>
            <div
              {...imagesDropzone.getRootProps({
                className: `import-dropzone ${imagesDropzone.isDragActive ? "import-dropzone-active" : ""}`
              })}
            >
              <input {...imagesDropzone.getInputProps()} />
              <div className="upload-symbol">
                <Icon name="upload" />
              </div>
              <strong>Drag 'n' drop files here, or click to select files</strong>
              <span>You can upload 50 files (up to 35 MB each)</span>
            </div>
            {imageFiles.length > 0 && (
              <div className="selected-image-list">
                {imageFiles.map((file) => (
                  <div className="selected-image-row" key={`${file.name}-${file.size}`}>
                    <div className="selected-image-row-img-wrap">
                      <img src={imagePreviewUrls.get(file.name)} alt={file.name} />
                    </div>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                    <button type="button" className="icon-button" onClick={() => {
                      setImageFiles((current) => current.filter((item) => item !== file));
                      setAllowPartialImport(false);
                    }} aria-label={`Remove ${file.name}`}>
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}
        {designs.length > 0 && (
          <div className={`import-match-panel ${hasExcelMissingImages ? "import-match-panel-warning" : ""}`}>
            <strong>{matchSummary.matchedDesigns}/{designs.length} images matched</strong>
            {imageFiles.length === 0 ? (
              <span>No images selected. Import will create metadata rows only.</span>
            ) : hasNoExcelImageMatches ? (
              <span>Missing images: {matchSummary.missing.slice(0, 8).join(", ")}{matchSummary.missing.length > 8 ? "..." : ""}</span>
            ) : hasPartialExcelMatch ? (
              <>
                <span>Missing images: {matchSummary.missing.slice(0, 8).join(", ")}{matchSummary.missing.length > 8 ? "..." : ""}</span>
                <label className="import-partial-confirm">
                  <input
                    type="checkbox"
                    checked={allowPartialImport}
                    onChange={(event) => setAllowPartialImport(event.target.checked)}
                  />
                  <span>Import only matched designs?</span>
                </label>
              </>
            ) : (
              <span>All Excel rows have matching artwork.</span>
            )}
          </div>
        )}
        {!excelFile && designs.length === 0 && imageFiles.length > 0 && existingByFilename.size > 0 && (
          <div className={`import-match-panel ${hasPartialImageOnlyMatch || hasNoImageOnlyMatches ? "import-match-panel-warning" : ""}`}>
            <strong>{imageOnlySummary.matched.length}/{imageFiles.length} images matched</strong>
            {hasPartialImageOnlyMatch ? (
              <>
                <span>Missing metadata: {imageOnlySummary.missing.slice(0, 8).join(", ")}{imageOnlySummary.missing.length > 8 ? "..." : ""}</span>
                <label className="import-partial-confirm">
                  <input
                    type="checkbox"
                    checked={allowPartialImport}
                    onChange={(event) => setAllowPartialImport(event.target.checked)}
                  />
                  <span>Import only matched designs?</span>
                </label>
              </>
            ) : imageOnlySummary.matched.length === imageFiles.length ? (
              <span>All selected images match existing metadata.</span>
            ) : (
              <span>Missing metadata: {imageOnlySummary.missing.slice(0, 8).join(", ")}{imageOnlySummary.missing.length > 8 ? "..." : ""}</span>
            )}
          </div>
        )}
      </div>

      {designs.length > 0 && (
        <section className="preview-card">
          <div className="preview-heading">
            <h3>Review imported rows</h3>
            <span>{designs.length} designs loaded</span>
          </div>
          <div className="table-wrap">
            <table className="import-preview-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Filename</th>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Main Tag</th>
                  <th>Supporting Tags</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((design) => {
                  const imageFile = imageFiles.find((file) => {
                    const imageFull = String(file.name || "").trim().toLowerCase();
                    const imageBase = normalizeName(file.name);
                    const designFull = String(design.filename || "").trim().toLowerCase();
                    const designBase = normalizeName(design.filename);
                    return imageFull === designFull || imageBase === designBase;
                  });

                  return (
                    <tr key={design.id}>
                      <td>
                        {imageFile ? (
                          <div className="table-thumb-wrap">
                            <img className="table-thumb" src={imagePreviewUrls.get(imageFile.name)} alt={design.filename} />
                          </div>
                        ) : (
                          <div className="table-thumb table-thumb-empty">{design.filename?.slice(0, 2) || "?"}</div>
                        )}
                      </td>
                      <td>{design.filename}</td>
                      <td>{design.title}</td>
                      <td>
                        <span className="clamp-text">{design.description}</span>
                      </td>
                      <td>
                        {design.main_tag}
                      </td>
                      <td>
                        <span className="clamp-text">
                          {design.supporting_tags}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="import-status-row">
        <div>
          {designs.length > 0 ? (
            <>
              <strong>{designs.length} designs ready to import</strong>
              <span>Review the preview above, then click Import Designs</span>
            </>
          ) : imageFiles.length > 0 && existingByFilename.size > 0 ? (
            <>
              <strong>{imageFiles.length} image{imageFiles.length === 1 ? "" : "s"} ready</strong>
              <span>Excel file optional — existing metadata will be reused for matching filenames.</span>
            </>
          ) : imageFiles.length > 0 ? (
            <>
              <strong>{imageFiles.length} image{imageFiles.length === 1 ? "" : "s"} selected</strong>
              <span>No previous metadata available — drop an Excel file too.</span>
            </>
          ) : (
            <>
              <strong>No designs loaded yet</strong>
              <span>Upload an Excel file, or drop images that match previously imported metadata.</span>
            </>
          )}
        </div>
        {designs.length > 0 && <span className="import-match-badge">{matchSummary.matchedDesigns}/{designs.length} images matched</span>}
        <LoadingButton
          type="button"
          className="primary-button"
          onClick={handleImport}
          disabled={
            isImporting ||
            hasNoExcelImageMatches ||
            hasNoImageOnlyMatches ||
            (hasPartialExcelMatch && !allowPartialImport) ||
            (hasPartialImageOnlyMatch && !allowPartialImport) ||
            (designs.length === 0 && imageFiles.length === 0)
          }
          loading={isImporting}
          loadingText="Starting..."
        >
          Import Designs
        </LoadingButton>
      </div>

      {unmatchedNames.length > 0 && (
        <div className="alert alert-error import-unmatched-alert">
          {designs.length > 0 || excelFile ? (
            <>
              <strong>Missing matching images for:</strong> {unmatchedNames.join(", ")}.
              <br />Add matching image files or confirm importing only matched designs.
            </>
          ) : (
            <>
              <strong>No metadata found for:</strong> {unmatchedNames.join(", ")}.
              <br />Upload an Excel file or use Add New to enter metadata manually.
            </>
          )}
        </div>
      )}
      <ImportProgressModal
        progress={importProgress}
        onClose={() => setImportProgress(null)}
        onCancel={() => {
          stopImportRef.current = true;
          setImportProgress((current) => {
            if (!current) return current;
            return {
              ...current,
              step: "done",
              message: `Import stopped by user. ${current.createdCount || 0} designs imported.`,
              done: true,
              percent: 100,
              status: "Failed"
            };
          });
        }}
      />
    </section>
  );
}

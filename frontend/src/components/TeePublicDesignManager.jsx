import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDropzone } from "react-dropzone";
import { batchDeleteDesigns, checkCopyrightRisk, checkTrademarkForDesign, copyDesignsToMarketplace, createDesign, generateDraftListingContent, updateDesign, uploadStandaloneImages, logFailingRequest } from "../api/client";
import { createImagePreviewDataUrl } from "../utils/imagePreview";
import { deleteDesignBatch } from "../utils/designDeleteBatch";
import { validateAiListingQuality } from "../utils/aiListingQuality";
import { PREMIUM_LOCK_MESSAGE } from "../lib/subscriptionAccess";
import CachedThumbnail from "./CachedThumbnail";
import DeleteProgressModal from "./DeleteProgressModal";

const ACCEPTED_REPLACEMENT_TYPES = new Set(["image/png", "image/jpeg"]);
const ACCEPTED_REPLACEMENT_EXTENSIONS = /\.(png|jpe?g)$/i;
const MAX_CREATE_DESIGNS = 50;
const MAX_CREATE_DESIGNS_MESSAGE = "Maximum 50 designs per session.";

function isAcceptedReplacementImage(file) {
  return Boolean(file && (ACCEPTED_REPLACEMENT_TYPES.has(file.type) || ACCEPTED_REPLACEMENT_EXTENSIONS.test(file.name || "")));
}
function makeTempDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `temp_${crypto.randomUUID()}`;
  }
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
import Icon from "./Icon";
import ColorDropdown from "./ColorDropdown";
import CopyrightRiskModal from "./CopyrightRiskModal";
import { LoadingButton, ProgressLoader, SavingOverlay, TableSkeleton } from "./LoadingComponents";
import TrademarkModal from "./TrademarkModal";
import { isLocalId } from "../utils/draftHelper";
import { IconShieldSearch } from "@tabler/icons-react";
import { BotMessageSquare, Info } from "lucide-react";
import {
  TEEPUBLIC_ALL_PRODUCT_KEYS,
  TEEPUBLIC_COLOR_PRODUCTS,
  TEEPUBLIC_COLORS,
  TEEPUBLIC_DEFAULT_COLORS,
  TEEPUBLIC_PRODUCTS,
  canonicalizeSettings,
  getDefaultColorSettings,
  getDefaultProductSettings,
} from "../config/teepublicOptions";
import { getColorCategory, getColorHex } from "../config/teepublicColorHex";
import {
  applyClipboardToDesign,
  copyAdultContentOnly,
  copyAllConfig,
  copyColorsOnly,
  copyProductsOnly,
  getClipboard,
  getClipboardLabel,
  hasClipboard,
} from "../utils/teepublicClipboard";

const EMPTY_FORM = {
  filename: "",
  title: "",
  description: "",
  primary_tag: "",
  supporting_tags: "",
  adult_content: "No",
  color_preference: "Dark Colors",
  colors: {},
  products: {},
};

const TP_PRODUCTS = [
  "T-Shirt", "Hoodie", "Tank", "Crewneck", "Long Sleeve", "Baseball Tee",
  "Kids", "Kids Hoodie", "Kids Long Sleeve T-Shirt", "Hats", "Shorts",
  "Bags", "Stickers", "Cases", "Mugs", "Wall Art", "Pillows", "Totes",
  "Tapestries", "Pins", "Magnets"
];

const TP_COLOR_OPTIONS = [
  "Asphalt", "Black", "Navy", "Charcoal Heather", "White/Navy",
  "Deep Royal", "White", "Red", "Green", "Blue", "Purple", "Vintage Heather"
];

function stripExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^/.]+$/, "");
}

function normalizeName(fileName) {
  return stripExtension(fileName).trim().toLowerCase();
}

function makeDesignId(filename) {
  return `${filename || "manual-design"}-${Date.now()}`;
}

function findImageForDesign(design, uploadedImages) {
  const targetFull = String(design.filename ?? "").trim().toLowerCase();
  const targetBase = normalizeName(design.filename);

  return uploadedImages.find((image) => {
    const imageFull = String(image.name ?? "").trim().toLowerCase();
    const imageBase = normalizeName(image.name);
    return imageFull === targetFull || imageBase === targetBase;
  });
}

function tagList(design) {
  return [design.primary_tag, ...String(design.supporting_tags || "").split(",")]
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function splitTagDraft(value) {
  const raw = String(value || "");
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) {
    return { main: raw.trim(), supporting: "" };
  }
  return {
    main: raw.slice(0, commaIndex).trim(),
    supporting: raw.slice(commaIndex + 1).replace(/^\s+/, ""),
  };
}

function joinTagDraft(mainTag, supportingTags) {
  const main = String(mainTag || "").trim();
  const supporting = String(supportingTags || "");
  if (!main) return supporting;
  if (!supporting) return main;
  return `${main}, ${supporting}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date());
}

function cleanWords(fileName) {
  const baseName = stripExtension(fileName || "");
  const words = baseName
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(" ")
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);

  if (words.length === 0) {
    return ["design"];
  }

  return words;
}

function titleFromWords(words) {
  return words
    .map((word) => (word.length <= 2 ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

function makeCreateDraft(image) {
  return {
    title: "",
    tags: "",
    description: "",
    adult_content: "No",
  };
}

// Match the editor's Light/Dark/All filter so the Create page surfaces
// the same color choices users will see when they later edit a design.
function filterColorsForProduct(productKey, preferenceLabel) {
  const all = TEEPUBLIC_COLORS[productKey] || [];
  const pref = String(preferenceLabel || "Dark Colors").toLowerCase();
  if (pref.startsWith("all")) return all;
  return all.filter((c) => {
    const cat = getColorCategory(c);
    if (pref.startsWith("light")) return cat === "light" || cat === "medium";
    if (pref.startsWith("dark")) return cat === "dark" || cat === "medium";
    return true;
  });
}

function validHexColor(value, fallback = "#000000") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function normalizeHexTyping(value) {
  const raw = String(value || "").trim().replace(/[^0-9a-fA-F#]/g, "");
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  return withHash.slice(0, 7).toUpperCase();
}

function findSavedFile(file, response) {
  const files = Array.isArray(response?.files) ? response.files : [];
  return files.find((savedFile) => savedFile.original_name === file.name) || {};
}

export default function DesignManager({
  designs,
  uploadedImages,
  onDesignsChange,
  onImportClick,
  onUploadImagesClick,
  onImagesUploaded,
  onRefreshFromBackend,
  onDesignsCopied,
  onEditDesign,
  editorMode = false,
  editorKind = "",
  onEditorOpen,
  onBackToDesigns,
  onUnsavedChangesChange,
  unsavedResetToken = 0,
  designsLoaded = false,
  autoOpenCreate = false,
  createSignal = 0,
  userId = "",
  isLoading = false,
  isWorkspaceLocked = false,
  onLockedAction
}) {
  const [query, setQuery] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [createImageIds, setCreateImageIds] = useState([]);
  const [sessionImages, setSessionImages] = useState([]); // images uploaded in this Add New session
  const [activeCreateIndex, setActiveCreateIndex] = useState(0);
  const [createDrafts, setCreateDrafts] = useState({});
  const [createError, setCreateError] = useState("");
  const [createUploadError, setCreateUploadError] = useState("");
  const [isCreateUploading, setIsCreateUploading] = useState(false);
  const [isSavingCreated, setIsSavingCreated] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [openActionId, setOpenActionId] = useState(null);
  const [openCreateMenu, setOpenCreateMenu] = useState(null);
  const [copiedStickerConfig, setCopiedStickerConfig] = useState(null);
  const [activeTab, setActiveTab] = useState("Info");
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: 'one' | 'many', id?, count? }
  const [confirmCopy, setConfirmCopy] = useState(null); // { count }
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopyingSelected, setIsCopyingSelected] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const deleteCancelRequestedRef = useRef(false);
  const deleteAutoCloseTimerRef = useRef(null);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [trademarkModalOpen, setTrademarkModalOpen] = useState(false);
  const [trademarkLoading, setTrademarkLoading] = useState(false);
  const [trademarkError, setTrademarkError] = useState("");
  const [trademarkResults, setTrademarkResults] = useState([]);
  const [trademarkPhrase, setTrademarkPhrase] = useState("");
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [riskResult, setRiskResult] = useState(null);

  function handleLockedAction() {
    setCreateError(PREMIUM_LOCK_MESSAGE);
    setAiError(PREMIUM_LOCK_MESSAGE);
    setRiskError(PREMIUM_LOCK_MESSAGE);
    setTrademarkError(PREMIUM_LOCK_MESSAGE);
    if (typeof onLockedAction === "function") onLockedAction();
  }

  function requireUnlocked() {
    if (!isWorkspaceLocked) return true;
    handleLockedAction();
    return false;
  }

  useEffect(() => {
    return () => {
      if (deleteAutoCloseTimerRef.current) clearTimeout(deleteAutoCloseTimerRef.current);
    };
  }, []);

  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingAllIndex, setGeneratingAllIndex] = useState(0);
  const [generatingAllTotal, setGeneratingAllTotal] = useState(0);
  const [generatingAllError, setGeneratingAllError] = useState("");
  const stopGeneratingAllRef = useRef(false);
  const activeCreateAiDesignIdRef = useRef("");
  const [showBatchProgressModal, setShowBatchProgressModal] = useState(false);
  const [batchItems, setBatchItems] = useState([]);

  // Custom toast notification state
  const [toast, setToast] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  function markDirty() {
    setHasUnsavedChanges(true);
    onUnsavedChangesChange?.(true);
  }

  function markClean() {
    setHasUnsavedChanges(false);
    onUnsavedChangesChange?.(false);
  }

  useEffect(() => {
    onUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChangesChange]);

  useEffect(() => {
    markClean();
  }, [unsavedResetToken]);
  
  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }

  const [createImageReplacements, setCreateImageReplacements] = useState({});
  const [clearedCreateImageIds, setClearedCreateImageIds] = useState(new Set());
  const createReplacementInputRef = useRef(null);

  useEffect(() => () => {
    Object.values(createImageReplacements).forEach((rep) => {
      if (rep.previewUrl) URL.revokeObjectURL(rep.previewUrl);
    });
  }, []);

  function clearCreatePreview(imageId) {
    if (!requireUnlocked()) return;
    markDirty();
    setClearedCreateImageIds((current) => {
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
    setCreateImageReplacements((current) => {
      const next = { ...current };
      if (next[imageId]) {
        if (next[imageId].previewUrl) {
          URL.revokeObjectURL(next[imageId].previewUrl);
        }
        delete next[imageId];
      }
      return next;
    });
  }

  function handleCreateReplacementFileChange(event) {
    if (!requireUnlocked()) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    markDirty();
    if (!isAcceptedReplacementImage(file)) {
      setCreateError("Unsupported file type. Please upload PNG or JPEG designs only.");
      return;
    }
    if (!activeCreateImage) return;
    const imageId = activeCreateImage.id;
    const previewUrl = URL.createObjectURL(file);
    setCreateImageReplacements((current) => {
      const next = { ...current };
      if (next[imageId] && next[imageId].previewUrl) {
        URL.revokeObjectURL(next[imageId].previewUrl);
      }
      next[imageId] = { file, previewUrl };
      return next;
    });
    setClearedCreateImageIds((current) => {
      const next = new Set(current);
      next.delete(imageId);
      return next;
    });
    setCreateError("");
  }

  const filteredDesigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return designs;

    return designs.filter((design) =>
      [design.filename, design.title, design.description, design.primary_tag, design.supporting_tags]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [designs, query]);

  const totalPages = Math.max(1, Math.ceil(filteredDesigns.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleDesigns = filteredDesigns.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  const allVisibleSelected =
    visibleDesigns.length > 0 && visibleDesigns.every((design) => selectedIds.includes(design.id));

  function updateForm(field, value) {
    markDirty();
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startAdd() {
    if (!requireUnlocked()) return;
    setOpenActionId(null);
    setEditingId("new");
    markClean();
    setForm(EMPTY_FORM);
    setCreateError("");
    setCreateUploadError("");
    setSessionImages([]);
    setCreateImageIds([]);
    setActiveCreateIndex(0);
    setCreateDrafts({});
    setActiveTab("Info");
    setAiResult(null);
    setAiError("");
    onEditorOpen?.("create");
    console.log("[PodPilot] Add New opened for marketplace teepublic");
  }

  function handleAddLocalDesignDraft() {
    if (createImageIds.length >= MAX_CREATE_DESIGNS) {
      setCreateError(`${MAX_CREATE_DESIGNS_MESSAGE} Remove a design before adding more.`);
      return;
    }

    setCreateError("");
    markDirty();
    const newId = makeTempDraftId();
    const newImage = {
      id: newId,
      name: "design.png",
      size: 0,
      file: null,
      previewUrl: "",
      previewDataUrl: "",
      matched: false,
      storedName: "",
      imagePath: "",
      imageUrl: "",
    };

    setSessionImages((current) => [...current, newImage]);
    setCreateImageIds((current) => {
      const nextIds = [...current, newId];
      setActiveCreateIndex(nextIds.length - 1);
      return nextIds;
    });
    setCreateDrafts((currentDrafts) => ({
      ...currentDrafts,
      [newId]: makeCreateDraft(newImage)
    }));
  }

  function isEmptyLocalCreateDesign(imageId) {
    const image = getCreateImageById(imageId);
    const draft = createDrafts[imageId] || {};
    const hasImage = Boolean(
      image?.file ||
      image?.previewUrl ||
      image?.imagePath ||
      image?.imageUrl ||
      image?.image_r2_key ||
      createImageReplacements[imageId]?.file
    ) && !clearedCreateImageIds.has(imageId);
    const hasText = ["title", "description", "tags", "primary_tag", "supporting_tags", "adult_content"].some((field) =>
      String(draft[field] || "").trim().length > 0
    );
    return !hasImage && !hasText;
  }

  function confirmLocalRemove({ empty = false, online = false } = {}) {
    if (online) {
      return window.confirm("This design already exists online. This local remove will only hide it from this local editing session.");
    }
    if (empty) {
      return window.confirm("Remove this empty design?");
    }
    return window.confirm("Remove this design from this local editing session?");
  }

  function removeCreateDesignLocally(imageId) {
    if (!imageId) return;
    const image = getCreateImageById(imageId);
    const online = Boolean(image?.image_r2_key || image?.imagePath || image?.imageUrl);
    const empty = isEmptyLocalCreateDesign(imageId);
    if (!confirmLocalRemove({ empty, online })) return;

    setCreateImageReplacements((current) => {
      const next = { ...current };
      if (next[imageId]?.previewUrl) URL.revokeObjectURL(next[imageId].previewUrl);
      delete next[imageId];
      return next;
    });
    setClearedCreateImageIds((current) => {
      const next = new Set(current);
      next.delete(imageId);
      return next;
    });
    setCreateDrafts((current) => {
      const next = { ...current };
      delete next[imageId];
      return next;
    });
    setSessionImages((current) => current.filter((item) => item.id !== imageId));
    setCreateImageIds((current) => {
      const next = current.filter((id) => id !== imageId);
      setActiveCreateIndex((index) => Math.max(0, Math.min(index, next.length - 1)));
      return next;
    });
    showToast("Design removed from this local editing session.", "success");
  }

  async function uploadCreateImages(acceptedFiles, fileRejections) {
    if (!requireUnlocked()) return;
    setCreateUploadError("");

    const skippedCount = fileRejections?.length || 0;
    if (skippedCount > 0) {
      if (acceptedFiles.length === 0) {
        setCreateUploadError("Unsupported file type. Please upload PNG or JPEG designs only.");
        return;
      } else {
        setCreateUploadError(`${skippedCount} file${skippedCount === 1 ? ' was' : 's were'} skipped because only PNG and JPEG designs are supported.`);
      }
    }

    if (acceptedFiles.length === 0) {
      return;
    }

    const remainingSlots = Math.max(MAX_CREATE_DESIGNS - createImageIds.length, 0);
    if (remainingSlots <= 0) {
      setCreateUploadError(`${MAX_CREATE_DESIGNS_MESSAGE} Remove a design before adding more.`);
      return;
    }

    const acceptedImageFiles = acceptedFiles.slice(0, remainingSlots);
    const slotsSkippedCount = acceptedFiles.length - acceptedImageFiles.length;
    if (slotsSkippedCount > 0) {
      setCreateUploadError((prev) => {
        const slotsMsg = `${MAX_CREATE_DESIGNS_MESSAGE} ${slotsSkippedCount} image${slotsSkippedCount === 1 ? "" : "s"} not added.`;
        return prev ? `${prev} ${slotsMsg}` : slotsMsg;
      });
    }

    setIsCreateUploading(true);

    try {
      // Only create local previews — do NOT upload to R2 yet.
      // R2 upload + design creation happens in saveCreatedDesigns.
      const nextImages = await Promise.all(acceptedImageFiles.map(async (file) => {
        const previewDataUrl = await createImagePreviewDataUrl(file);
        return {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: file.size,
          file, // keep raw File for later upload
          previewUrl: URL.createObjectURL(file),
          previewDataUrl,
          matched: false,
          storedName: "",
          imagePath: "",
          imageUrl: "",
        };
      }));

      setSessionImages((current) => [...current, ...nextImages]);
      setCreateImageIds((current) => [...current, ...nextImages.map((image) => image.id)]);
      markDirty();
      console.log("[PodPilot] selected files (draft only, not uploaded yet)", nextImages.map((i) => i.name));
      setActiveCreateIndex(createImageIds.length);
      setCreateDrafts((currentDrafts) => {
        const nextDrafts = { ...currentDrafts };
        nextImages.forEach((image) => {
          nextDrafts[image.id] = nextDrafts[image.id] || makeCreateDraft(image);
        });
        return nextDrafts;
      });
    } catch (error) {
      setCreateUploadError(error.message || "Could not process images.");
    } finally {
      setIsCreateUploading(false);
    }
  }

  const createDropzone = useDropzone({
    onDrop: uploadCreateImages,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"]
    },
    multiple: true,
    noClick: true,
    noKeyboard: true
  });

  useEffect(() => {
    if (autoOpenCreate) {
      startAdd();
    }
  }, [autoOpenCreate, createSignal]);

  useEffect(() => {
    if (!editorMode || editingId || isLoading || !designsLoaded) return;
    if (editorKind === "create") {
      startAdd();
    }
  }, [designsLoaded, editingId, editorKind, editorMode, isLoading]);

  // ── Close 3-dot menu on outside click / scroll / Escape ─────────────────
  useEffect(() => {
    if (!openActionId) return undefined;

    function onDocClick(e) {
      // If the click is inside an action-menu or its trigger, ignore.
      const t = e.target.closest && e.target.closest(".action-menu, .action-menu-trigger");
      if (t) return;
      setOpenActionId(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpenActionId(null);
    }
    function onScroll() { setOpenActionId(null); }

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [openActionId]);

  function startEdit(design) {
    setOpenActionId(null);
    setEditingId(design.id);
    setForm({
      filename: design.filename || "",
      title: design.title || "",
      description: design.description || "",
      primary_tag: design.primary_tag || "",
      supporting_tags: design.supporting_tags || "",
      adult_content: design.adult_content || "",
      sticker_color: design.sticker_color || "",
      stickers_color_enabled: design.stickers_color_enabled || "Off"
    });
    markClean();
  }

  function cancelEdit(silent = false, navigateBack = true) {
    if (!silent) {
      if (navigateBack) onBackToDesigns?.();
      return;
    }

    setEditingId(null);
    setForm(EMPTY_FORM);
    setCreateError("");
    setAiResult(null);
    setAiError("");
    setCreateImageReplacements({});
    setClearedCreateImageIds(new Set());
    markClean();
    if (navigateBack) onBackToDesigns?.();
  }

  async function saveDesign(event) {
    event.preventDefault();
    if (!requireUnlocked()) return;
    const currentDesign = designs.find((design) => design.id === editingId);
    const filename = editingId === "new" ? form.filename.trim() : currentDesign?.filename || form.filename.trim();

    try {
      if (editingId === "new") {
        const created = await createDesign({
          filename,
          marketplace: "teepublic",
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.primary_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          adult_content: String(form.adult_content || "").trim().toLowerCase() === "yes",
        });
        onDesignsChange((current) => [created, ...current.filter((design) => design.id !== created.id)]);
      } else {
        const updated = await updateDesign(editingId, {
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.primary_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          adult_content: String(form.adult_content || "").trim().toLowerCase() === "yes",
        });
        onDesignsChange((current) => current.map((design) => (design.id === editingId ? { ...design, ...updated } : design)));
      }
      cancelEdit(true);
    } catch (saveError) {
      logFailingRequest(saveError);
      const detail = saveError.response?.data?.detail;
      const status = saveError.response?.status;
      let finalMessage = typeof detail === "string" ? detail : saveError.message || "Could not save design.";
      if (finalMessage.includes("Authentication service is temporarily unavailable") && status !== 503) {
        finalMessage = saveError.message || "Could not save design.";
      }
      setCreateError(finalMessage);
    }
  }

  function getCreateImageById(imageId) {
    // Look first in this session's just-uploaded images, then fall back to
    // the parent's uploadedImages list. This way the Create flow works even
    // if the parent doesn't track session uploads.
    return sessionImages.find((image) => image.id === imageId)
        || uploadedImages.find((image) => image.id === imageId);
  }

  function updateCreateDraft(field, value) {
    const imageId = createImageIds[activeCreateIndex];
    if (!imageId) return;
    markDirty();

    const image = getCreateImageById(imageId);
    setCreateDrafts((currentDrafts) => ({
      ...currentDrafts,
      [imageId]: {
        ...(currentDrafts[imageId] || makeCreateDraft(image)),
        [field]: value
      }
    }));
  }

  function toggleCreateImage(image) {
    setCreateError("");
    markDirty();
    setCreateImageIds((currentIds) => {
      if (currentIds.includes(image.id)) {
        const nextIds = currentIds.filter((id) => id !== image.id);
        setActiveCreateIndex((currentIndex) => Math.min(currentIndex, Math.max(0, nextIds.length - 1)));
        return nextIds;
      }

      setCreateDrafts((currentDrafts) => ({
        ...currentDrafts,
        [image.id]: currentDrafts[image.id] || makeCreateDraft(image)
      }));
      return [...currentIds, image.id];
    });
  }

  function moveCreateIndex(direction) {
    setActiveCreateIndex((currentIndex) => {
      if (createImageIds.length === 0) return 0;
      return (currentIndex + direction + createImageIds.length) % createImageIds.length;
    });
  }

  async function saveCreatedDesigns(event) {
    event.preventDefault();
    if (!requireUnlocked()) return;
    if (isSavingCreated) return;

    if (createImageIds.length === 0) {
      setCreateError("Choose at least one image.");
      return;
    }
    if (createImageIds.length > MAX_CREATE_DESIGNS) {
      setCreateError(`${MAX_CREATE_DESIGNS_MESSAGE} Remove extra designs before saving.`);
      return;
    }

    setCreateError("");
    setIsSavingCreated(true);
    setSaveProgress(null);
    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });

    try {
      // 1. Collect raw File/image info that needs uploading to R2.
      const filesToUpload = [];
      for (const imageId of createImageIds) {
        const image = getCreateImageById(imageId);
        const replacement = createImageReplacements[imageId];
        const isCleared = clearedCreateImageIds.has(imageId);
        const activeFile = replacement ? replacement.file : (isCleared ? null : image?.file);

        if (activeFile) {
          filesToUpload.push({
            id: imageId,
            name: activeFile.name,
            file: activeFile
          });
        }
      }

      const totalBytes = filesToUpload.reduce((acc, f) => acc + f.file.size, 0);

      // 2. Upload images to R2 in one batch (only now, not on drop).
      let savedFiles = [];
      if (filesToUpload.length > 0) {
        setSaveProgress({
          percent: 0,
          loadedBytes: 0,
          totalBytes,
          currentFileName: filesToUpload.length === 1 ? filesToUpload[0].name : "Uploading batch...",
          status: "Uploading"
        });
        const uploadResp = await uploadStandaloneImages(
          filesToUpload.map((img) => img.file),
          "teepublic",
          (progressEvent) => {
            const percent = totalBytes > 0 ? Math.min(Math.round((progressEvent.loaded / totalBytes) * 70), 70) : 0;
            setSaveProgress({
              percent,
              loadedBytes: progressEvent.loaded,
              totalBytes,
              currentFileName: filesToUpload.length === 1 ? filesToUpload[0].name : "Uploading batch...",
              status: "Uploading"
            });
          }
        );
        savedFiles = Array.isArray(uploadResp?.files) ? uploadResp.files : [];
        setSaveProgress(current => current ? { ...current, percent: 70, status: "Processing" } : null);
      }

      // 3. Create design rows in backend.
      const created = [];
      const totalToCreate = createImageIds.length;
      let createdDone = 0;
      for (const imageId of createImageIds) {
        const image = getCreateImageById(imageId);
        if (!image) continue;
        const draft = createDrafts[imageId] || makeCreateDraft(image);
        const tags = parseTags(draft.tags);

        const replacement = createImageReplacements[imageId];
        const isCleared = clearedCreateImageIds.has(imageId);
        const activeFile = replacement ? replacement.file : (isCleared ? null : image?.file);
        const filename = activeFile ? activeFile.name : (image?.name || "design.png");

        const title = (draft.title || "").trim();
        const description = (draft.description || "").trim();
        const safeTags = tags;

        // Find the R2 key from the upload response.
        const saved =
          savedFiles.find((s) => s.original_name === filename) ||
          savedFiles.find((s) => s.filename === filename) ||
          {};

        // Normalize Colors and Products tabs into the same canonical-key
        // shape the editor and extension expect, so the new design opens
        // cleanly when the user later clicks Edit.
        const draftColors = draft.colors || {};
        const colorSettings = {};
        TEEPUBLIC_COLOR_PRODUCTS.forEach((key) => {
          const chosen = draftColors[key] || TEEPUBLIC_DEFAULT_COLORS[key];
          if (chosen) colorSettings[key] = chosen;
        });

        const draftProducts = draft.products || {};
        const productSettings = {};
        TEEPUBLIC_ALL_PRODUCT_KEYS.forEach((key) => {
          // Default to enabled (true) when the user hasn't touched the toggle.
          productSettings[key] = draftProducts[key] !== false;
        });

        const row = await createDesign({
          filename: filename,
          marketplace: "teepublic",
          title,
          description,
          primary_tag: safeTags[0] || "",
          supporting_tags: safeTags.slice(1).join(", "),
          adult_content: String(draft.adult_content || "no").trim().toLowerCase() === "yes",
          image_r2_key: saved.image_r2_key || image.imagePath || undefined,
          color_settings: colorSettings,
          product_settings: productSettings,
        });
        created.push(row);
        createdDone++;
        const createPercent = totalToCreate > 0 ? (createdDone / totalToCreate) : 0;
        const currentPercent = 70 + Math.round(createPercent * 20); // 70% to 90%
        setSaveProgress(current => current ? {
          ...current,
          percent: currentPercent,
          currentFileName: filename,
          status: "Processing"
        } : null);
      }
      setSaveProgress(current => current ? { ...current, percent: 95, status: "Processing" } : null);
      console.log("[PodPilot] create designs response", { count: created.length });
      const createdIds = new Set(created.map((design) => design.id).filter(Boolean));
      onDesignsChange((current) => [...created, ...current.filter((design) => !createdIds.has(design.id))]);
      setSessionImages([]);
      cancelEdit(true); // silent=true: skip leave-warning, this is a successful save
      setSaveProgress(current => current ? { ...current, percent: 100, status: "Completed" } : null);
      if (created.length > 0 || filesToUpload.length > 0) onImagesUploaded?.();
    } catch (saveError) {
      logFailingRequest(saveError);
      console.error("[PodPilot] create designs error", saveError);
      const detail = saveError.response?.data?.detail;
      const status = saveError.response?.status;
      let finalMessage = typeof detail === "string" ? detail : saveError.message || "Could not save designs.";
      if (finalMessage.includes("Authentication service is temporarily unavailable") && status !== 503) {
        finalMessage = saveError.message || "Could not save designs.";
      }
      setCreateError(finalMessage);
    } finally {
      setIsSavingCreated(false);
      setSaveProgress(null);
    }
  }

  async function deleteDesign(id) {
    if (!requireUnlocked()) return;
    setOpenActionId(null);
    if (isLocalId(id)) {
      onDesignsChange((current) => current.filter((design) => design.id !== id));
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      return { deletedIds: [id], failedIds: [] };
    }
    try {
      const response = await batchDeleteDesigns([id]);
      const result = Array.isArray(response?.results) ? response.results[0] : null;
      if (!result?.success) {
        throw new Error(result?.reason || "Design delete failed.");
      }
      onDesignsChange((current) => current.filter((design) => design.id !== id));
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      return { deletedIds: [id], failedIds: [] };
    } catch (error) {
      console.warn("[PodPilot] delete design failed:", error?.message || error);
      return { deletedIds: [], failedIds: [id], error };
    }
  }

  function startDeleteProgress(total) {
    if (deleteAutoCloseTimerRef.current) clearTimeout(deleteAutoCloseTimerRef.current);
    deleteCancelRequestedRef.current = false;
    setDeleteProgress({
      status: "running",
      total,
      completed: 0,
      percent: 0,
      deletedCount: 0,
      failedCount: 0,
      current: total > 0 ? 1 : 0,
      canCancel: total > 1,
      cancelRequested: false,
      stage: "Removing designs and related files from your workspace.",
    });
  }

  function updateDeleteProgress(completed, total, deletedCount, failedCount = 0, meta = {}) {
    const nextCurrent = completed >= total ? total : completed + 1;
    setDeleteProgress({
      status: "running",
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 100,
      deletedCount,
      failedCount,
      current: nextCurrent,
      currentId: meta.currentId || "",
      canCancel: total > 1 && !deleteCancelRequestedRef.current && completed < total,
      cancelRequested: deleteCancelRequestedRef.current,
      stage: deleteCancelRequestedRef.current
        ? "Finishing the current deletion, then PodPilot will stop."
        : "Removing designs and related files from your workspace.",
    });
  }

  function finishDeleteProgress(total, deletedCount, failedCount = 0, { cancelled = false, completed = total } = {}) {
    const status = cancelled ? "cancelled" : failedCount > 0 ? "error" : "success";
    setDeleteProgress({
      status,
      total,
      completed,
      percent: status === "success" ? 100 : Math.round((completed / Math.max(total, 1)) * 100),
      deletedCount,
      failedCount,
      current: Math.min(total, Math.max(1, completed)),
      canCancel: false,
      cancelRequested: false,
      stage: cancelled
        ? "Deletion stopped. Remaining designs were left untouched."
        : failedCount > 0
          ? `${failedCount} design${failedCount === 1 ? "" : "s"} could not be deleted. Please try again.`
          : `Deleted ${deletedCount} design${deletedCount === 1 ? "" : "s"}.`,
    });
    if (!cancelled && failedCount === 0) {
      deleteAutoCloseTimerRef.current = setTimeout(() => {
        setIsDeleting(false);
        setDeleteProgress(null);
        setConfirmDelete(null);
      }, 700);
    }
  }

  function requestDeleteCancel() {
    deleteCancelRequestedRef.current = true;
    setDeleteProgress((current) => current ? {
      ...current,
      canCancel: false,
      cancelRequested: true,
      stage: "Finishing the current deletion, then PodPilot will stop.",
    } : current);
  }

  async function deleteSelected() {
    if (!requireUnlocked()) return;
    if (selectedIds.length === 0) return;
    const ids = [...selectedIds];
    startDeleteProgress(ids.length);

    const result = await deleteDesignBatch({
      ids,
      designs,
      userId,
      deleteBackendDesigns: batchDeleteDesigns,
      onDesignsChange,
      setSelectedIds,
      updateProgress: updateDeleteProgress,
      isCancelled: () => deleteCancelRequestedRef.current,
    });
    finishDeleteProgress(ids.length, result.deletedIds.length, result.failedIds.length, {
      cancelled: result.cancelled,
      completed: result.completed ?? ids.length,
    });
  }

  async function copySelectedToRedbubble() {
    if (!requireUnlocked()) return;
    if (selectedIds.length === 0 || isCopyingSelected) return;
    const ids = [...selectedIds];
    setIsCopyingSelected(true);
    try {
      const response = await copyDesignsToMarketplace(ids, "redbubble");
      const copied = Number(response?.copied || 0);
      const failed = Number(response?.failed || 0);
      const firstReason = String(response?.first_failure_reason || response?.results?.find?.((result) => !result?.success)?.reason || "").trim();
      if (failed > 0) {
        showToast(`Copied ${copied} designs. ${failed} failed${firstReason ? `: ${firstReason}` : "."}`, copied > 0 ? "warning" : "error");
      } else {
        showToast(`Copied ${copied} designs to Redbubble`);
      }
      setSelectedIds([]);
      setConfirmCopy(null);
      if (typeof onDesignsCopied === "function") {
        onDesignsCopied("redbubble", Array.isArray(response?.designs) ? response.designs : []);
      } else if (typeof onRefreshFromBackend === "function") {
        onRefreshFromBackend();
      }
    } catch (error) {
      const detail = error.response?.data?.detail;
      showToast(typeof detail === "string" ? detail : error.message || "Could not copy selected designs.", "error");
    } finally {
      setIsCopyingSelected(false);
    }
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      setSelectedIds((current) =>
        current.filter((id) => !visibleDesigns.some((design) => design.id === id))
      );
      return;
    }

    setSelectedIds((current) => Array.from(new Set([...current, ...visibleDesigns.map((design) => design.id)])));
  }

  function toggleSelection(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]
    );
  }

  const editingDesign = editingId && editingId !== "new"
    ? designs.find((design) => design.id === editingId)
    : null;
  const editingImage = editingDesign ? findImageForDesign(editingDesign, uploadedImages) : null;
  const formStickerEnabled = form.stickers_color_enabled === "On";
  const formStickerColor = validHexColor(form.sticker_color);
  const selectedCreateImages = createImageIds.map((imageId) => getCreateImageById(imageId)).filter(Boolean);
  const activeCreateImage = selectedCreateImages[activeCreateIndex] || selectedCreateImages[0] || null;
  const activeCreateImagePreview = useMemo(() => {
    if (!activeCreateImage) return null;
    if (createImageReplacements[activeCreateImage.id]) {
      return createImageReplacements[activeCreateImage.id].previewUrl;
    }
    if (clearedCreateImageIds.has(activeCreateImage.id)) {
      return null;
    }
    return activeCreateImage.previewUrl;
  }, [activeCreateImage, createImageReplacements, clearedCreateImageIds]);

  const activeCreateDraft = activeCreateImage
    ? createDrafts[activeCreateImage.id] || makeCreateDraft(activeCreateImage)
    : makeCreateDraft(null);
  const activeCreateTshirtColor =
    (activeCreateDraft.colors || {}).tshirt ||
    TEEPUBLIC_DEFAULT_COLORS.tshirt;
  const activeCreateTshirtPreviewBackground = getColorHex(activeCreateTshirtColor);
  useEffect(() => {
    activeCreateAiDesignIdRef.current = activeCreateImage?.id || "";
  }, [activeCreateImage?.id]);
  const activeStickerEnabled = activeCreateDraft.stickers_color_enabled === "On";
  const activeStickerColor = validHexColor(activeCreateDraft.sticker_color);
  const completedCreateCount = selectedCreateImages.filter((image) => {
    return Boolean(image);
  }).length;

  async function handleCreateAiGenerate() {
    if (!requireUnlocked()) return;
    if (!activeCreateImage || isAiGenerating) return;
    setOpenCreateMenu(null);
    setAiError("");
    setAiResult(null);
    setIsAiGenerating(true);

    const requestDesignId = activeCreateImage.id;
    const replacement = createImageReplacements[requestDesignId];
    const requestFile = replacement?.file || activeCreateImage.file || null;
    logAiListingRequest({
      designIndex: activeCreateIndex,
      designId: requestDesignId,
      filename: requestFile?.name || activeCreateImage.name || "",
      hasLocalFile: Boolean(requestFile),
      imageSource: requestFile ? "local-file" : (activeCreateImage.previewDataUrl ? "local-preview" : "none"),
    });

    try {
      const tags = parseTags(activeCreateDraft.tags);
      const result = await generateDraftListingContent("teepublic", {
        filename: requestFile?.name || activeCreateImage.name || "",
        title: activeCreateDraft.title,
        description: activeCreateDraft.description,
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
      }, requestFile);
      if (activeCreateAiDesignIdRef.current !== requestDesignId) {
        showToast("AI result ignored because the selected design changed.", "warning");
        return;
      }
      applyCreateAiListingResult(result);
      setAiError("");
    } catch (error) {
      const detail = error.response?.data?.detail;
      const finalMsg = typeof detail === "string" ? detail : error.message || "AI generation failed.";
      showToast(finalMsg, "error");
      setAiError("");
    } finally {
      setIsAiGenerating(false);
    }
  }

  function applyCreateAiListingResult(result) {
    if (!result || !activeCreateImage) return;
    validateAiListingQuality(result, activeCreateDraft);
    updateCreateDraft("title", result.title || activeCreateDraft.title);
    updateCreateDraft("description", result.description || activeCreateDraft.description);
    updateCreateDraft("tags", [result.main_tag, result.supporting_tags].filter(Boolean).join(", "));
    setAiResult(null);
    setAiError("");
    setActiveTab("Info");
    showToast("AI listing applied.", "success");
  }

  function logAiListingRequest({ designIndex, designId, filename, hasLocalFile, imageSource }) {
    console.info(
      `[PodPilot][AI Listing] request designIndex=${designIndex} designId=${designId || ""} filename=${filename || ""} hasLocalFile=${Boolean(hasLocalFile)} imageSource=${imageSource || "none"}`
    );
  }

  async function handleRetryDesignCreate(item) {
    if (!requireUnlocked()) return;
    
    setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'generating', error: '' } : x));
    
    const image = item.image;
    const draft = createDrafts[image.id] || makeCreateDraft(image);
    const tags = parseTags(draft.tags);
    
    try {
      const replacement = createImageReplacements[image.id];
      const requestFile = replacement?.file || image.file || null;
      logAiListingRequest({
        designIndex: createImageIds.indexOf(image.id),
        designId: image.id,
        filename: requestFile?.name || image.name || "",
        hasLocalFile: Boolean(requestFile),
        imageSource: requestFile ? "local-file" : (image.previewDataUrl ? "local-preview" : "none"),
      });
      const result = await generateDraftListingContent("teepublic", {
        filename: requestFile?.name || image.name || "",
        title: draft.title,
        description: draft.description,
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
      }, requestFile);
      
      validateAiListingQuality(result, draft);
      setCreateDrafts((currentDrafts) => ({
        ...currentDrafts,
        [image.id]: {
          ...draft,
          title: result.title || draft.title,
          description: result.description || draft.description,
          tags: [result.main_tag, result.supporting_tags].filter(Boolean).join(", "),
        }
      }));
      
      setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'success' } : x));
    } catch (error) {
      const detail = error.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : error.message || "AI generation failed.";
      setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'failed', error: msg } : x));
    }
  }

  async function handleGenerateForAllCreate() {
    if (!requireUnlocked()) return;
    const batch = selectedCreateImages;
    if (batch.length < 2 || isGeneratingAll) return;
    const total = batch.length;

    setOpenCreateMenu(null);
    setAiError("");
    setAiResult(null);
    setIsGeneratingAll(true);
    setShowBatchProgressModal(true);
    setGeneratingAllIndex(0);
    setGeneratingAllTotal(total);
    setGeneratingAllError("");
    stopGeneratingAllRef.current = false;

    // Initialize batchItems
    const initialItems = batch.map(image => ({
      id: image.id,
      name: image.name || "Unnamed Design",
      status: 'pending',
      error: '',
      image: image
    }));
    setBatchItems(initialItems);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < total; i++) {
      if (stopGeneratingAllRef.current) {
        setBatchItems(current => current.map(item => item.status === 'pending' ? { ...item, status: 'failed', error: 'Canceled by user.' } : item));
        break;
      }

      const image = batch[i];
      setGeneratingAllIndex(i + 1);
      setBatchItems(current => current.map(item => item.id === image.id ? { ...item, status: 'generating' } : item));

      const draft = createDrafts[image.id] || makeCreateDraft(image);
      const tags = parseTags(draft.tags);

      try {
        const replacement = createImageReplacements[image.id];
        const requestFile = replacement?.file || image.file || null;
        logAiListingRequest({
          designIndex: i,
          designId: image.id,
          filename: requestFile?.name || image.name || "",
          hasLocalFile: Boolean(requestFile),
          imageSource: requestFile ? "local-file" : (image.previewDataUrl ? "local-preview" : "none"),
        });
        const result = await generateDraftListingContent("teepublic", {
          filename: requestFile?.name || image.name || "",
          title: draft.title,
          description: draft.description,
          primary_tag: tags[0] || "",
          supporting_tags: tags.slice(1).join(", "),
        }, requestFile);

        if (stopGeneratingAllRef.current) {
          break;
        }

        validateAiListingQuality(result, draft);
        setCreateDrafts((currentDrafts) => ({
          ...currentDrafts,
          [image.id]: {
            ...draft,
            title: result.title || draft.title,
            description: result.description || draft.description,
            tags: [result.main_tag, result.supporting_tags].filter(Boolean).join(", "),
          }
        }));
        setBatchItems(current => current.map(item => item.id === image.id ? { ...item, status: 'success' } : item));
        successCount++;
      } catch (error) {
        if (stopGeneratingAllRef.current) {
          break;
        }
        failedCount++;
        const detail = error.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : error.message || "AI generation failed.";
        setBatchItems(current => current.map(item => item.id === image.id ? { ...item, status: 'failed', error: msg } : item));
      }
    }

    setIsGeneratingAll(false);
    if (stopGeneratingAllRef.current) {
      setGeneratingAllError("Generation stopped by user.");
    } else if (failedCount === 0) {
      setShowBatchProgressModal(false);
      showToast(`Generated ${successCount} of ${total} listings successfully.`);
    } else {
      setGeneratingAllError(`Generated ${successCount} of ${total} listings successfully. ${failedCount} failed.`);
    }
  }

  function titleForTrademarkModal(results) {
    const termsWithMatches = (results || [])
      .flatMap((result) => result.matches || [])
      .map((match) => match.term || match.matched_term)
      .filter(Boolean);
    if (termsWithMatches.length > 0) return termsWithMatches[0];
    return (results || []).flatMap((result) => result.checked_terms || []).filter(Boolean)[0] || "";
  }

  function detectedTrademarkTerms() {
    return Array.from(new Set(
      (trademarkResults || [])
        .flatMap((result) => result.matches || [])
        .flatMap((match) => [match.term, match.matched_term])
        .filter(Boolean)
        .map((term) => String(term).toLowerCase())
    ));
  }

  function closeRiskModal() {
    if (riskLoading) return;
    setRiskModalOpen(false);
  }

  async function handleCreateRiskCheck() {
    if (!requireUnlocked()) return;
    if (!activeCreateImage || riskLoading) return;
    const tags = parseTags(activeCreateDraft.tags);
    const replacement = createImageReplacements[activeCreateImage.id];
    const imageBase64 = replacement?.file
      ? await fileToDataUrl(replacement.file)
      : activeCreateImage.previewDataUrl || (activeCreateImage.file ? await fileToDataUrl(activeCreateImage.file) : "");

    setOpenCreateMenu(null);
    setRiskError("");
    setRiskResult(null);
    setRiskLoading(true);

    try {
      const result = await checkCopyrightRisk({
        platform: "teepublic",
        title: activeCreateDraft.title || "",
        description: activeCreateDraft.description || "",
        main_tag: tags[0] || "",
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1),
        detected_trademark_terms: detectedTrademarkTerms(),
        image_base64: imageBase64,
      });
      setRiskResult(result);
      setRiskModalOpen(true);
    } catch (error) {
      const detail = error.response?.data?.detail;
      const finalMsg = typeof detail === "string" ? detail : error.message || "AI risk check failed.";
      setRiskError(finalMsg);
      showToast(finalMsg, "error");
    } finally {
      setRiskLoading(false);
    }
  }

  async function handleCreateTrademarkCurrent() {
    if (!requireUnlocked()) return;
    if (!activeCreateImage || trademarkLoading) return;
    const tags = parseTags(activeCreateDraft.tags);
    setOpenCreateMenu(null);
    setTrademarkError("");
    setTrademarkResults([]);
    setTrademarkPhrase("");
    setTrademarkLoading(true);

    try {
      const data = await checkTrademarkForDesign({
        title: activeCreateDraft.title || "",
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
        description: activeCreateDraft.description || "",
      });
      const result = { ...data, designLabel: activeCreateDraft.title || activeCreateImage.name || "Current design" };
      setTrademarkResults([result]);
      setTrademarkPhrase(titleForTrademarkModal([result]));
      setTrademarkModalOpen(true);
    } catch (error) {
      const detail = error.response?.data?.detail;
      const finalMsg = typeof detail === "string" ? detail : error.message || "Trademark check failed.";
      setTrademarkError(finalMsg);
      showToast(finalMsg, "error");
    } finally {
      setTrademarkLoading(false);
    }
  }

  async function handleCreateTrademarkAll() {
    if (!requireUnlocked()) return;
    const batch = selectedCreateImages;
    if (batch.length === 0 || trademarkLoading) return;
    setOpenCreateMenu(null);
    setTrademarkError("");
    setTrademarkResults([]);
    setTrademarkPhrase("");
    setTrademarkLoading(true);

    try {
      const settled = await Promise.allSettled(
        batch.map(async (img) => {
          const draft = createDrafts[img.id] || makeCreateDraft(img);
          const tags = parseTags(draft.tags);
          const data = await checkTrademarkForDesign({
            title: draft.title || "",
            primary_tag: tags[0] || "",
            supporting_tags: tags.slice(1).join(", "),
            description: draft.description || "",
          });
          return {
            ...data,
            designLabel: draft.title || img.name || "Design",
          };
        })
      );
      const nextResults = settled.map((entry, index) => {
        const img = batch[index];
        const draft = createDrafts[img.id] || makeCreateDraft(img);
        const label = draft.title || img.name || "Design";
        if (entry.status === "fulfilled") return entry.value;
        const detail = entry.reason?.response?.data?.detail;
        return {
          designLabel: label,
          matches: [],
          checked_terms: [],
          failed_terms: [{
            term: label,
            error: typeof detail === "string" ? detail : entry.reason?.message || "Trademark check failed.",
          }],
          errors: [],
        };
      });
      setTrademarkResults(nextResults);
      setTrademarkPhrase(titleForTrademarkModal(nextResults));
      setTrademarkModalOpen(true);
    } catch (error) {
      console.error("[PodPilot] check trademark all error:", error);
      const detail = error.response?.data?.detail;
      const finalMsg = typeof detail === "string" ? detail : error.message || "Trademark check failed.";
      setTrademarkError(finalMsg);
      showToast(finalMsg, "error");
    } finally {
      setTrademarkLoading(false);
    }
  }

  function getStickerConfig(draft) {
    return {
      sticker_color: validHexColor(draft.sticker_color),
      stickers_color_enabled: draft.stickers_color_enabled === "On" ? "On" : "Off"
    };
  }

  // Copy / Paste menus on the Create page mirror the editor: support all four
  // copy variants and persist via the shared teepublicClipboard util so config
  // round-trips between Create and Edit.
  function buildCreateDesignSnapshot(draft) {
    if (!draft) return null;
    const colorSettings = {};
    TEEPUBLIC_COLOR_PRODUCTS.forEach((key) => {
      const chosen = (draft.colors || {})[key] || TEEPUBLIC_DEFAULT_COLORS[key];
      if (chosen) colorSettings[key] = chosen;
    });
    const productSettings = {};
    TEEPUBLIC_ALL_PRODUCT_KEYS.forEach((key) => {
      productSettings[key] = (draft.products || {})[key] !== false;
    });
    return {
      color_settings: colorSettings,
      product_settings: productSettings,
      adult_content: String(draft.adult_content || "").trim().toLowerCase() === "yes",
    };
  }

  function applyClipboardToDraft(draft, clip) {
    if (!clip || clip.marketplace !== "teepublic") return draft;
    const next = { ...draft };
    const data = clip.data || {};
    if (data.color_settings !== undefined) {
      const canonical = canonicalizeSettings(data.color_settings);
      next.colors = { ...(draft.colors || {}), ...canonical };
    }
    if (data.product_settings !== undefined) {
      const canonical = canonicalizeSettings(data.product_settings);
      next.products = { ...(draft.products || {}), ...canonical };
    }
    if (data.adult_content !== undefined) {
      next.adult_content = data.adult_content ? "Yes" : "No";
    }
    return next;
  }

  function handleCreateCopy(type) {
    setOpenCreateMenu(null);
    if (!activeCreateDraft || !activeCreateImage) return;
    const snapshot = buildCreateDesignSnapshot(activeCreateDraft);
    if (!snapshot) return;
    if (type === "all") copyAllConfig(snapshot);
    else if (type === "colors") copyColorsOnly(snapshot);
    else if (type === "products") copyProductsOnly(snapshot);
    else if (type === "adult_content") copyAdultContentOnly(snapshot);
    setCreateError("");
  }

  function handleCreatePaste(target) {
    if (!requireUnlocked()) return;
    setOpenCreateMenu(null);
    const clip = getClipboard();
    if (!clip) {
      setCreateError("Nothing copied yet.");
      return;
    }
    if (clip.marketplace !== "teepublic") {
      setCreateError("Clipboard is not TeePublic config.");
      return;
    }
    setCreateError("");

    if (target === "current") {
      const imageId = createImageIds[activeCreateIndex];
      if (!imageId) return;
      setCreateDrafts((currentDrafts) => {
        const image = getCreateImageById(imageId);
        const base = currentDrafts[imageId] || makeCreateDraft(image);
        return { ...currentDrafts, [imageId]: applyClipboardToDraft(base, clip) };
      });
    } else if (target === "all") {
      setCreateDrafts((currentDrafts) => {
        const next = { ...currentDrafts };
        createImageIds.forEach((imageId) => {
          const image = getCreateImageById(imageId);
          const base = next[imageId] || makeCreateDraft(image);
          next[imageId] = applyClipboardToDraft(base, clip);
        });
        return next;
      });
    }
  }

  function copyStickerConfig() {
    setCopiedStickerConfig(getStickerConfig(activeCreateDraft));
    setOpenCreateMenu(null);
  }

  function pasteStickerConfigToCurrent() {
    if (!requireUnlocked()) return;
    if (!copiedStickerConfig || !activeCreateImage) return;
    updateCreateDraft("sticker_color", copiedStickerConfig.sticker_color);
    updateCreateDraft("stickers_color_enabled", copiedStickerConfig.stickers_color_enabled);
    setOpenCreateMenu(null);
  }

  function pasteStickerConfigToAll() {
    if (!requireUnlocked()) return;
    if (!copiedStickerConfig) return;
    setCreateDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      selectedCreateImages.forEach((image) => {
        nextDrafts[image.id] = {
          ...(nextDrafts[image.id] || makeCreateDraft(image)),
          ...copiedStickerConfig
        };
      });
      return nextDrafts;
    });
    setOpenCreateMenu(null);
  }

  function handleStickerColorToggle(checked) {
    updateCreateDraft("stickers_color_enabled", checked ? "On" : "Off");
    if (checked && !activeCreateDraft.sticker_color) {
      updateCreateDraft("sticker_color", "#000000");
    }
  }

  if (editorMode && editingId === "new") {
    return (
      <section className="workflow-panel manager-panel create-page">
        <div className="create-page-header">
          <div>
            <h2>Create TeePublic Design</h2>
            <button type="button" className="secondary-button" onClick={onBackToDesigns}>
              <Icon name="chevronLeft" />
              <span>Back to Designs</span>
            </button>
          </div>
          {selectedCreateImages.length > 0 && (
            <div className="create-page-status">
              <span>Design {activeCreateIndex + 1} of {selectedCreateImages.length}</span>
              <strong>{selectedCreateImages.length - completedCreateCount} Unsaved</strong>
            </div>
          )}
        </div>

        <TrademarkModal
          open={trademarkModalOpen}
          loading={trademarkLoading}
          error={trademarkError}
          results={trademarkResults}
          phrase={trademarkPhrase}
          onClose={() => setTrademarkModalOpen(false)}
        />
        <CopyrightRiskModal
          open={riskModalOpen}
          loading={riskLoading}
          error={riskError}
          result={riskResult}
          onClose={closeRiskModal}
        />

        {showBatchProgressModal && createPortal(
          <div className="pp-loading-card-overlay">
            <div className="pp-loading-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
              {isGeneratingAll ? (
                <>
                  <div className="pp-loading-card-spinner" />
                  <h3 className="pp-loading-card-title">
                    Generating listing {generatingAllIndex} of {generatingAllTotal}
                  </h3>
                  <p className="pp-loading-card-subtitle">
                    Please wait while PodPilot prepares your designs.
                  </p>
                  <button
                    type="button"
                    className="pp-loading-card-btn secondary"
                    onClick={() => {
                      stopGeneratingAllRef.current = true;
                      setIsGeneratingAll(false);
                      setBatchItems(current => current.map(item => item.status === 'pending' || item.status === 'generating' ? { ...item, status: 'failed', error: 'Canceled by user.' } : item));
                      setGeneratingAllError("Generation stopped by user.");
                    }}
                  >
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <h3 className="pp-loading-card-title">Batch Generation Completed</h3>
                  {generatingAllError && (
                    <p className="pp-loading-card-subtitle" style={{ color: "var(--danger-color, #ef4444)" }}>
                      {generatingAllError}
                    </p>
                  )}
                  {batchItems.some(item => item.status === 'failed') && (
                    <div className="pp-loading-card-failures">
                      {batchItems.filter(item => item.status === 'failed').map((item) => (
                        <div key={item.id} className="pp-loading-card-failure-row">
                          <span className="pp-loading-card-failure-name">{item.name}</span>
                          <span className="pp-loading-card-failure-reason">{item.error || 'Failed'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="pp-loading-card-btn"
                    onClick={() => { setShowBatchProgressModal(false); setGeneratingAllError(""); setBatchItems([]); }}
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

        {toast && createPortal(
          <div className={`tp-toast tp-toast-${toast.type}`}>{toast.msg}</div>,
          document.body
        )}

        {createImageIds.length === 0 ? (
          <div className="create-upload-card">
            <div
              {...createDropzone.getRootProps({
                className: createDropzone.isDragActive ? "create-upload-drop create-upload-drop-active" : "create-upload-drop",
                onClick: isCreateUploading ? undefined : createDropzone.open
              })}
            >
              <input {...createDropzone.getInputProps()} />
              <div className="create-upload-icon">
                <Icon name="upload" />
              </div>
              <strong>Drag & Drop Your Design Images Here</strong>
              <span>Select multiple images to create designs in bulk</span>
              <small>Maximum 50 designs per session</small>
              <button
                type="button"
                className="secondary-button"
                disabled={isCreateUploading}
              >
                <Icon name="images" />
                {isCreateUploading ? "Uploading..." : "Or Click to Browse Files"}
              </button>
            </div>
            {createUploadError && <div className="alert alert-error">{createUploadError}</div>}
          </div>
        ) : (
          <form className="create-config-form" onSubmit={saveCreatedDesigns}>
            <div className="create-command-bar">
              <div className="create-nav-buttons">
                <button type="button" className="secondary-button icon-only-button" onClick={() => moveCreateIndex(-1)} aria-label="Previous design">
                  <Icon name="chevronLeft" />
                </button>
                <button type="button" className="secondary-button icon-only-button" onClick={() => moveCreateIndex(1)} aria-label="Next design">
                  <Icon name="chevronRight" />
                </button>
                <button type="button" className="secondary-button icon-only-button" onClick={handleAddLocalDesignDraft} aria-label="Add design" title="Add design">
                  <Icon name="upload" />
                </button>
              </div>
              {selectedCreateImages.length > 1 ? (
                <div className="toolbar-menu-wrap tp-ai-generate-menu">
                  <button
                    type="button"
                    className="secondary-button ai-generate-button"
                    onClick={() => { setOpenCreateMenu((current) => (current === "ai" ? null : "ai")); }}
                    disabled={isAiGenerating || isGeneratingAll}
                    aria-haspopup="menu"
                    aria-expanded={openCreateMenu === "ai"}
                  >
                    {isAiGenerating || isGeneratingAll ? (
                      <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                    ) : (
                      <Icon name="sparkles" />
                    )}
                    <span>{isAiGenerating || isGeneratingAll ? "Generating..." : "AI Listing"}</span>
                    <Icon name="chevronDown" />
                  </button>
                  {openCreateMenu === "ai" && (
                    <div className="toolbar-dropdown tp-ai-generate-dropdown" role="menu" style={{ minWidth: "220px" }}>
                      <button type="button" onClick={() => { setOpenCreateMenu(null); handleCreateAiGenerate(); }} role="menuitem">
                        <Icon name="sparkles" />
                        <span>Generate current design</span>
                      </button>
                      <button type="button" onClick={() => { setOpenCreateMenu(null); handleGenerateForAllCreate(); }} role="menuitem">
                        <Icon name="sparkles" />
                        <span>Generate for all designs</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary-button ai-generate-button"
                  onClick={handleCreateAiGenerate}
                  disabled={isAiGenerating || isGeneratingAll || !activeCreateImage}
                >
                  {isAiGenerating ? (
                    <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                  ) : (
                    <Icon name="sparkles" />
                  )}
                  <span>{isAiGenerating ? "Generating..." : "AI Listing"}</span>
                </button>
              )}
              <button
                type="button"
                className="secondary-button ai-generate-button"
                onClick={handleCreateRiskCheck}
                disabled={riskLoading || !activeCreateImage}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                {riskLoading ? (
                  <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                ) : (
                  <BotMessageSquare size={20} />
                )}
                <span>{riskLoading ? "Checking..." : "AI Check"}</span>
              </button>
              <div className="toolbar-menu-wrap">
                <button
                  type="button"
                  className={`secondary-button${trademarkResults.some((r) => (r.matches || []).length > 0) ? " tp-toolbar-btn-danger" : ""}`}
                  onClick={() => setOpenCreateMenu((current) => (current === "trademark" ? null : "trademark"))}
                  disabled={trademarkLoading || !activeCreateImage}
                  aria-haspopup="menu"
                  aria-expanded={openCreateMenu === "trademark"}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  {trademarkLoading ? (
                    <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                  ) : (
                    <IconShieldSearch size={20} stroke={2} />
                  )}
                  <span>{trademarkLoading ? "Checking..." : "Check Trademark"}</span>
                  <Icon name="chevronDown" />
                </button>
                {openCreateMenu === "trademark" && (
                  <div className="toolbar-dropdown" role="menu" style={{ minWidth: "220px" }}>
                    <button type="button" onClick={handleCreateTrademarkCurrent} role="menuitem">
                      <span>Check this design (TM)</span>
                    </button>
                    <button type="button" onClick={handleCreateTrademarkAll} role="menuitem" disabled={selectedCreateImages.length === 0}>
                      <span>Check all designs (TM)</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="toolbar-menu-wrap">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setOpenCreateMenu((current) => (current === "copy" ? null : "copy"))}
                >
                  <Icon name="copy" />
                  <span>Copy</span>
                  <Icon name="chevronDown" />
                </button>
                {openCreateMenu === "copy" && (
                  <div className="toolbar-dropdown" role="menu">
                    <button type="button" onClick={() => handleCreateCopy("all")} role="menuitem">
                      <Icon name="copy" />
                      <span>Copy All Config</span>
                    </button>
                    <button type="button" onClick={() => handleCreateCopy("colors")} role="menuitem">
                      <Icon name="copy" />
                      <span>Copy Colors Only</span>
                    </button>
                    <button type="button" onClick={() => handleCreateCopy("products")} role="menuitem">
                      <Icon name="copy" />
                      <span>Copy Products Only</span>
                    </button>
                    <button type="button" onClick={() => handleCreateCopy("adult_content")} role="menuitem">
                      <Icon name="copy" />
                      <span>Copy Adult Content Only</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="toolbar-menu-wrap">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!hasClipboard()}
                  onClick={() => setOpenCreateMenu((current) => (current === "paste" ? null : "paste"))}
                >
                  <Icon name="file" />
                  <span>Paste</span>
                  <Icon name="chevronDown" />
                </button>
                {openCreateMenu === "paste" && (
                  <div className="toolbar-dropdown" role="menu">
                    <button type="button" onClick={() => handleCreatePaste("current")} role="menuitem">
                      <Icon name="file" />
                      <span>Paste to Current Design</span>
                    </button>
                    <button type="button" onClick={() => handleCreatePaste("all")} role="menuitem">
                      <Icon name="file" />
                      <span>Paste to All Designs</span>
                    </button>
                  </div>
                )}
              </div>
              <span className="create-command-spacer" />
              <button type="button" className="secondary-button icon-only-button" onClick={onBackToDesigns} aria-label="Close editor">
                <Icon name="x" />
              </button>
              <LoadingButton
                type="submit"
                className="primary-button"
                disabled={selectedCreateImages.length === 0}
                loading={isSavingCreated}
                loadingText="Saving all designs..."
              >
                <Icon name="file" />
                Save All ({selectedCreateImages.length})
              </LoadingButton>
            </div>

            {activeCreateImage ? (
              <div className="create-config-card">
                <div className="create-config-card-heading">
                  <h3 style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    Design Configuration
                    <span className="image-quality-info-tooltip-container">
                      <Info className="image-quality-info-icon" size={16} />
                      <span className="image-quality-info-tooltip-text">
                        Fast preview only. Upload uses your original image quality.
                      </span>
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="local-design-remove-button local-design-remove-button-header"
                    onClick={() => removeCreateDesignLocally(activeCreateImage.id)}
                    aria-label="Remove this design from this local session"
                    title="Remove this design from this local session"
                  >
                    <Icon name="x" />
                  </button>
                </div>
                <div className="create-editor create-editor-polished">
                  <aside className="create-left-column">
                    <input
                      ref={createReplacementInputRef}
                      type="file"
                      accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                      style={{ display: "none" }}
                      onChange={handleCreateReplacementFileChange}
                    />
                    {activeCreateImagePreview ? (
                      <div
                        className="create-preview teepublic-shirt-preview"
                        style={{ "--teepublic-shirt-preview-bg": activeCreateTshirtPreviewBackground, position: "relative" }}
                      >
                        <CachedThumbnail
                          design={{ id: activeCreateImage.id, image_r2_key: activeCreateImage.imagePath || activeCreateImage.image_r2_key }}
                          userId={userId}
                          cacheVariant="preview"
                          cacheR2Key={activeCreateImage.imagePath || activeCreateImage.image_r2_key}
                          src={activeCreateImagePreview}
                          alt={activeCreateImage.name}
                        />
                        <button
                          type="button"
                          className="design-preview-remove"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearCreatePreview(activeCreateImage.id);
                          }}
                          aria-label="Clear design preview"
                          title="Change design image"
                        >
                          <Icon name="x" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="design-upload-placeholder"
                        onClick={() => createReplacementInputRef.current?.click()}
                      >
                        <span className="design-upload-placeholder-icon"><Icon name="upload" /></span>
                        <strong>Upload replacement design</strong>
                        <small>PNG or JPEG only</small>
                      </button>
                    )}
                  </aside>

                  <div className="tp-create-settings">
                    <div className="tp-tab-bar">
                      {["Info", "Colors", "Products"].map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`tp-tab${activeTab === tab ? " active" : ""}`}
                          onClick={() => setActiveTab(tab)}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {activeTab === "Info" && (
                      <div className="tp-info-tab">
                        <label className="tp-field">
                          <span>Design Title</span>
                          <input
                            value={activeCreateDraft.title}
                            onChange={(event) => updateCreateDraft("title", event.target.value)}
                            required
                          />
                        </label>
                        <label className="tp-field">
                          <span>Description</span>
                          <textarea
                            rows={3}
                            value={activeCreateDraft.description}
                            onChange={(event) => updateCreateDraft("description", event.target.value)}
                            required
                          />
                        </label>
                        <label className="tp-field">
                          <span>Primary Tag</span>
                          <input
                            value={parseTags(activeCreateDraft.tags)[0] || ""}
                            onChange={(event) => {
                              const currentTags = splitTagDraft(activeCreateDraft.tags);
                              updateCreateDraft("tags", joinTagDraft(event.target.value, currentTags.supporting));
                            }}
                            placeholder="market basket"
                            required
                          />
                        </label>
                        <label className="tp-field">
                          <span>Supporting Tags</span>
                          <input
                            value={splitTagDraft(activeCreateDraft.tags).supporting}
                            onChange={(event) => {
                              const currentTags = splitTagDraft(activeCreateDraft.tags);
                              updateCreateDraft("tags", joinTagDraft(currentTags.main, event.target.value));
                            }}
                            placeholder="tag1, tag2, tag3"
                            required
                          />
                        </label>
                        <div className="tp-field">
                          <span>Does this design contain Mature Content?</span>
                          <div className="tp-radio-group">
                            <label><input type="radio" name={`tp-create-adult-${activeCreateImage.id}`} checked={activeCreateDraft.adult_content === "Yes"} onChange={() => updateCreateDraft("adult_content", "Yes")} /> Yes</label>
                            <label><input type="radio" name={`tp-create-adult-${activeCreateImage.id}`} checked={activeCreateDraft.adult_content !== "Yes"} onChange={() => updateCreateDraft("adult_content", "No")} /> No</label>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === "Colors" && (
                      <div className="tp-colors-tab">
                        <div className="tp-color-pref">
                          <strong>Color Preference</strong>
                          <div className="tp-radio-group">
                            {["Light Colors", "Dark Colors", "All Colors"].map((pref) => (
                              <label key={pref}>
                                <input
                                  type="radio"
                                  name={`create_color_pref_${activeCreateImage.id}`}
                                  checked={(activeCreateDraft.color_preference || "Dark Colors") === pref}
                                  onChange={() => updateCreateDraft("color_preference", pref)}
                                />
                                {pref}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="tp-color-grid">
                          {TEEPUBLIC_COLOR_PRODUCTS.map((productKey) => {
                            const filtered = filterColorsForProduct(
                              productKey,
                              activeCreateDraft.color_preference
                            );
                            const current =
                              (activeCreateDraft.colors || {})[productKey] ||
                              TEEPUBLIC_DEFAULT_COLORS[productKey] ||
                              filtered[0] ||
                              "";
                            return (
                              <ColorDropdown
                                key={productKey}
                                label={TEEPUBLIC_PRODUCTS[productKey]}
                                colors={filtered}
                                value={current}
                                onChange={(color) =>
                                  updateCreateDraft("colors", {
                                    ...(activeCreateDraft.colors || {}),
                                    [productKey]: color,
                                  })
                                }
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {activeTab === "Products" && (
                      <div className="tp-products-tab">
                        <div className="tp-product-grid">
                          {TEEPUBLIC_ALL_PRODUCT_KEYS.map((productKey) => {
                            const isEnabled = (activeCreateDraft.products || {})[productKey] !== false;
                            return (
                              <div key={productKey} className="tp-product-card">
                                <span>{TEEPUBLIC_PRODUCTS[productKey]}</span>
                                <label className="tp-toggle">
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() =>
                                      updateCreateDraft("products", {
                                        ...(activeCreateDraft.products || {}),
                                        [productKey]: !isEnabled,
                                      })
                                    }
                                  />
                                  <span className="tp-toggle-slider" />
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-state create-empty-state">
                <strong>No images selected</strong>
                <span>Choose one or more uploaded images.</span>
              </div>
            )}

            {createUploadError && <div className="alert alert-error">{createUploadError}</div>}
            {createError && <div className="alert alert-error">{createError}</div>}
          </form>
        )}
        <SavingOverlay
          show={isSavingCreated}
          message={`Saving ${selectedCreateImages.length || createImageIds.length} TeePublic design${(selectedCreateImages.length || createImageIds.length) === 1 ? "" : "s"}...`}
          subtext="Uploading image files and creating your TeePublic design records. Please keep this page open."
          progress={saveProgress}
        />
      </section>
    );
  }

  return (
    <section className="workflow-panel manager-panel marketplace-manager teepublic-manager">
      <div className="manager-header">
        <div>
          <span className="marketplace-kicker">Active automation workspace</span>
          <h2>TeePublic Upload Designs</h2>
          <p>Prepare TeePublic metadata, image matches, product settings, and upload readiness in one focused view.</p>
        </div>
        <div className="manager-actions">
          <button type="button" className="secondary-button" onClick={onImportClick}>
            <Icon name="import" />
            <span>Import</span>
          </button>
          <div className="manager-refresh-action">
            <small>Click if you can&apos;t see your uploaded designs</small>
            <button type="button" className="secondary-button" onClick={onRefreshFromBackend} disabled={isLoading}>
              <Icon name="refresh" />
              <span>{isLoading ? "Updating..." : "Refresh"}</span>
            </button>
          </div>
          <button type="button" className="primary-button" onClick={startAdd}>
            <Icon name="add" />
            <span>Add New</span>
          </button>
        </div>
      </div>

      {editingId === "new" && typeof onEditorOpen !== "function" && (
        <form className="edit-panel create-panel" onSubmit={saveCreatedDesigns}>
          <div className="edit-panel-heading">
            <div>
              <h3>Create TeePublic Designs</h3>
              <span className="form-hint">
                Add images first, then fill listing fields manually or use AI Listing.
              </span>
            </div>
            <button type="button" className="icon-button" onClick={cancelEdit} aria-label="Close editor">
              <Icon name="x" />
            </button>
          </div>

          {uploadedImages.length === 0 ? (
            <div className="empty-state create-empty-state">
              <strong>Upload images first</strong>
              <span>Add Design attaches images without generating listing text.</span>
              <button type="button" className="primary-button" onClick={onUploadImagesClick}>
                Upload Images
              </button>
            </div>
          ) : (
            <>
              <div className="create-image-picker">
                {uploadedImages.map((image) => (
                  <button
                    type="button"
                    key={image.id}
                    className={
                      createImageIds.includes(image.id)
                        ? "create-image-option create-image-option-active"
                        : "create-image-option"
                    }
                    onClick={() => toggleCreateImage(image)}
                  >
                    <div className="create-image-option-thumb-wrap">
                      <CachedThumbnail
                        design={{ id: image.id, image_r2_key: image.imagePath || image.image_r2_key }}
                        userId={userId}
                        cacheVariant="preview"
                        cacheR2Key={image.imagePath || image.image_r2_key}
                        src={image.previewUrl}
                        alt={image.name}
                      />
                    </div>
                    <span>{image.name}</span>
                  </button>
                ))}
              </div>

              {activeCreateImage ? (
                <>
                  <div className="create-switcher">
                      <button type="button" className="secondary-button icon-only-button" onClick={() => moveCreateIndex(-1)} aria-label="Previous design">
                        <Icon name="chevronLeft" />
                      </button>
                    <div>
                      <strong>{activeCreateImage.name}</strong>
                      <span>
                        {activeCreateIndex + 1} / {selectedCreateImages.length}
                      </span>
                    </div>
                      <button
                        type="button"
                        className="local-design-remove-button local-design-remove-button-inline"
                        onClick={() => removeCreateDesignLocally(activeCreateImage.id)}
                        aria-label="Remove this design from this local session"
                        title="Remove from this local session"
                      >
                        <Icon name="x" />
                      </button>
                      <button type="button" className="secondary-button icon-only-button" onClick={() => moveCreateIndex(1)} aria-label="Next design">
                        <Icon name="chevronRight" />
                      </button>
                  </div>

                  <div className="create-editor" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                    <div
                      className="create-preview teepublic-shirt-preview"
                      style={{
                        "--teepublic-shirt-preview-bg": activeCreateTshirtPreviewBackground,
                        width: '280px',
                        flexShrink: 0,
                        borderRadius: '8px',
                        padding: '20px',
                        aspectRatio: '1/1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CachedThumbnail
                        design={{ id: activeCreateImage.id, image_r2_key: activeCreateImage.imagePath || activeCreateImage.image_r2_key }}
                        userId={userId}
                        cacheVariant="preview"
                        cacheR2Key={activeCreateImage.imagePath || activeCreateImage.image_r2_key}
                        src={activeCreateImage.previewUrl}
                        alt={activeCreateImage.name}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                      <button
                        type="button"
                        className="design-preview-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          clearCreatePreview(activeCreateImage.id);
                        }}
                        aria-label="Clear design preview"
                        title="Change design image"
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div className="design-tabs" style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '4px', marginBottom: '24px' }}>
                        {["Info", "Colors", "Products"].map(tab => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setActiveTab(tab)}
                            style={{
                              flex: 1,
                              padding: '8px 16px',
                              border: 'none',
                              background: activeTab === tab ? '#fff' : 'transparent',
                              borderRadius: '4px',
                              fontWeight: activeTab === tab ? '600' : '400',
                              boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                              cursor: 'pointer'
                            }}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>

                      {activeTab === "Info" && (
                        <div className="edit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <label>
                            Tags
                            <input
                              value={activeCreateDraft.tags}
                              onChange={(event) => updateCreateDraft("tags", event.target.value)}
                              placeholder="Funny,Bowling,sport,dad,boy"
                              required
                            />
                          </label>
                          <label>
                            Design Title
                            <input
                              value={activeCreateDraft.title}
                              onChange={(event) => updateCreateDraft("title", event.target.value)}
                              required
                            />
                          </label>
                          <label>
                            Adult Content
                            <select
                              value={activeCreateDraft.adult_content}
                              onChange={(event) => updateCreateDraft("adult_content", event.target.value)}
                            >
                              <option value="No">No</option>
                              <option value="Yes">Yes</option>
                            </select>
                          </label>
                          <label className="edit-grid-wide" style={{ gridColumn: '1 / -1' }}>
                            Description
                            <textarea
                              value={activeCreateDraft.description}
                              onChange={(event) => updateCreateDraft("description", event.target.value)}
                              rows={4}
                              placeholder="Enter design description"
                              required
                            />
                          </label>
                        </div>
                      )}

                      {activeTab === "Colors" && (
                        <div>
                          <div style={{ marginBottom: '24px' }}>
                            <strong>Color Preference</strong>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                              {["Light Colors", "Dark Colors", "All Colors"].map(pref => (
                                <label key={pref} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                  <input 
                                    type="radio" 
                                    name={`create_color_pref_${activeCreateImage.id}`} 
                                    checked={(activeCreateDraft.color_preference || "Dark Colors") === pref} 
                                    onChange={() => updateCreateDraft("color_preference", pref)} 
                                  />
                                  {pref}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            {TP_PRODUCTS.slice(0, 10).map(product => (
                              <label key={product} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontSize: '13px', fontWeight: '500' }}>{product}</span>
                                <select 
                                  value={(activeCreateDraft.colors || {})[product] || TP_COLOR_OPTIONS[0]}
                                  onChange={(e) => updateCreateDraft("colors", { ...(activeCreateDraft.colors || {}), [product]: e.target.value })}
                                  style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                                >
                                  {TP_COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeTab === "Products" && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                          {TP_PRODUCTS.map(product => {
                            const isEnabled = (activeCreateDraft.products || {})[product] !== false;
                            return (
                              <div 
                                key={product} 
                                style={{ 
                                  border: '1px solid #e2e8f0', 
                                  borderRadius: '8px', 
                                  padding: '12px 16px', 
                                  display: 'flex', 
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}
                              >
                                <span style={{ fontSize: '14px', fontWeight: '500' }}>{product}</span>
                                <div 
                                  style={{ 
                                    width: '36px', 
                                    height: '20px', 
                                    borderRadius: '10px', 
                                    background: isEnabled ? '#10b981' : '#ccc',
                                    position: 'relative',
                                    cursor: 'pointer'
                                  }}
                                  onClick={() => updateCreateDraft("products", { ...(activeCreateDraft.products || {}), [product]: !isEnabled })}
                                >
                                  <div style={{ 
                                    width: '16px', 
                                    height: '16px', 
                                    borderRadius: '50%', 
                                    background: '#fff', 
                                    position: 'absolute', 
                                    top: '2px', 
                                    left: isEnabled ? '18px' : '2px',
                                    transition: 'left 0.2s'
                                  }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state create-empty-state">
                  <strong>No images selected</strong>
                  <span>Choose one or more uploaded images above.</span>
                </div>
              )}
            </>
          )}

          {createError && <div className="alert alert-error">{createError}</div>}

          <div className="edit-actions">
            <span className="form-hint">
              {completedCreateCount} of {selectedCreateImages.length} designs ready
            </span>
            <button type="button" className="secondary-button" onClick={cancelEdit}>
              Cancel
            </button>
            <LoadingButton
              type="submit"
              className="primary-button"
              disabled={selectedCreateImages.length === 0}
              loading={isSavingCreated}
              loadingText="Saving all designs..."
            >
              <Icon name="file" />
              Create All Designs ({selectedCreateImages.length})
            </LoadingButton>
          </div>
        </form>
      )}
      <SavingOverlay
        show={isSavingCreated}
        message={`Saving ${selectedCreateImages.length || createImageIds.length} TeePublic design${(selectedCreateImages.length || createImageIds.length) === 1 ? "" : "s"}...`}
        subtext="Uploading image files and creating your TeePublic design records. Please keep this page open."
        progress={saveProgress}
      />

      {editingId && editingId !== "new" && onEditDesign && (
        (() => {
          // Redirect to the full TeePublicEditor instead of inline edit
          const idx = designs.findIndex((d) => d.id === editingId);
          const design = idx >= 0 ? designs[idx] : null;
          if (idx >= 0) {
            console.info(`[PodPilot][TeePublic Edit] open requested designId=${design?.id || ""} filename=${design?.filename || ""}`);
            setTimeout(() => { cancelEdit(true, false); onEditDesign(idx, design?.id || ""); }, 0);
          }
          return null;
        })()
      )}

      <div className="manager-toolbar">
        <label className="search-field">
          <span>Search designs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search title, filename, tags..."
          />
        </label>
        <div className="manager-toolbar-actions">
          {selectedIds.length > 0 && (
            <LoadingButton
              type="button"
              className="copy-selected-button"
              onClick={() => setConfirmCopy({ count: selectedIds.length })}
              disabled={isCopyingSelected}
              loading={isCopyingSelected}
              loadingText="Copying..."
            >
              Copy to Redbubble
            </LoadingButton>
          )}
          <button
            type="button"
            className="danger-button"
            onClick={() => setConfirmDelete({ type: 'many', count: selectedIds.length })}
            disabled={selectedIds.length === 0}
          >
            Delete Selected
          </button>
        </div>
      </div>

      <div className="table-wrap manager-table-wrap">
        <table className="manager-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleSelection}
                  aria-label="Select visible designs"
                />
              </th>
              <th>Image</th>
              <th>Title & Details</th>
              <th>Tags</th>
              <th>Adult Content</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          {isLoading && designs.length === 0 ? (
            <TableSkeleton rows={4} columns={7} />
          ) : (
          <tbody>
            {visibleDesigns.map((design) => {
              const matchedImage = findImageForDesign(design, uploadedImages);
              const tags = tagList(design);
              const thumbnailSrc = design.cdn_image_url || design.thumbnail_url || matchedImage?.thumbnailUrl || design.image_url || matchedImage?.imageUrl || matchedImage?.previewUrl || "";
              const previewSrc = design.cdn_image_url || design.image_url || matchedImage?.imageUrl || matchedImage?.previewUrl || thumbnailSrc;
              const previewR2Key = design.image_r2_key || matchedImage?.imagePath || matchedImage?.image_r2_key || "";

              return (
                <tr key={design.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(design.id)}
                      onChange={() => toggleSelection(design.id)}
                      aria-label={`Select ${design.title || design.filename}`}
                    />
                  </td>
                  <td>
                    {thumbnailSrc ? (
                      <div className="table-thumb-wrap">
                        <CachedThumbnail
                          design={design}
                          userId={userId}
                          className="table-thumb"
                          src={thumbnailSrc}
                          alt={design.filename}
                        />
                        <div className="table-thumb-popover" role="tooltip" aria-hidden="true">
                          <CachedThumbnail
                            design={design}
                            userId={userId}
                            cacheVariant="preview"
                            cacheR2Key={previewR2Key}
                            src={previewSrc}
                            fallbackSrc={thumbnailSrc}
                            alt=""
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="table-thumb table-thumb-empty">{design.filename?.slice(0, 2) || "?"}</div>
                    )}
                  </td>
                  <td>
                    <strong className="table-title">{design.title || "Untitled design"}</strong>
                    <span className="table-subtext table-subtext-visible">{design.filename}</span>
                    <span className="clamp-text">{design.description || "No description"}</span>
                  </td>
                  <td>
                    <div className="tag-stack">
                      {design.primary_tag && <span className="tag-chip tag-chip-main">{design.primary_tag}</span>}
                      {String(design.supporting_tags || "")
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((tag) => (
                          <span key={tag} className="tag-chip">
                            {tag}
                          </span>
                        ))}
                      {tags.length > 4 && <span className="tag-chip">+{tags.length - 4}</span>}
                    </div>
                  </td>
                  <td>
                    {design.adult_content || "No"}
                  </td>
                  <td>
                    <div className="status-cell">
                      {design.status === "uploaded" ? (
                        <span className="status-badge status-done">Uploaded</span>
                      ) : design.status === "failed" ? (
                        <span className="status-badge status-error">Failed</span>
                      ) : design.status === "uploading" ? (
                        <span className="status-badge status-uploading">Uploading</span>
                      ) : (
                        <span className="status-badge status-pending">Not uploaded</span>
                      )}
                      {design.uploaded_at && <small>{new Date(design.uploaded_at).toLocaleDateString()}</small>}
                      {design.error_message && <small style={{ color: 'var(--danger)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{design.error_message}</small>}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions row-actions-menu">
                      <button
                        type="button"
                        className="icon-button action-menu-trigger"
                        onClick={() => setOpenActionId((currentId) => (currentId === design.id ? null : design.id))}
                        aria-label={`Open actions for ${design.title || design.filename}`}
                        aria-expanded={openActionId === design.id}
                      >
                        <Icon name="dots" />
                      </button>
                      {openActionId === design.id && (
                        <div className="action-menu" role="menu">
                          <button type="button" onClick={() => {
                            setOpenActionId(null);
                            if (onEditDesign) {
                              const idx = designs.findIndex((d) => d.id === design.id);
                              console.info(`[PodPilot][TeePublic Edit] open requested designId=${design.id || ""} filename=${design.filename || ""}`);
                              onEditDesign(idx >= 0 ? idx : 0, design.id);
                            }
                          }} role="menuitem">
                            <Icon name="edit" />
                            <span>Edit</span>
                          </button>
                          <button type="button" className="action-menu-danger" onClick={() => { setOpenActionId(null); setConfirmDelete({ type: 'one', id: design.id, name: design.title || design.filename }); }} role="menuitem">
                            <Icon name="trash" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          )}
        </table>
      </div>

      {!isLoading && filteredDesigns.length === 0 && (
        <div className="empty-state">
          <strong>No designs found</strong>
          <span>Try adjusting your search or filters</span>
        </div>
      )}

      <div className="pagination-bar">
        <span>
          Showing {filteredDesigns.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1} to{" "}
          {Math.min(safePage * rowsPerPage, filteredDesigns.length)} of {filteredDesigns.length} entries
        </span>
        <label>
          Rows per page
          <select
            value={rowsPerPage}
            onChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(1);
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
        <div className="pagination-buttons">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <button type="button" className="secondary-button" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}>
            Previous
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setPage(safePage + 1)}
            disabled={safePage >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
      {confirmCopy && createPortal(
        <div
          className="pp-modal-overlay"
          onClick={isCopyingSelected ? undefined : () => setConfirmCopy(null)}
        >
          <div className="pp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Copy selected designs?</h3>
            <p>
              This will create new designs in Redbubble using the current image and listing data from the selected designs. The original designs will not be changed.
            </p>
            <div className="pp-modal-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmCopy(null)} disabled={isCopyingSelected}>
                Cancel
              </button>
              <LoadingButton
                type="button"
                className="copy-selected-button"
                onClick={copySelectedToRedbubble}
                disabled={isCopyingSelected}
                loading={isCopyingSelected}
                loadingText="Copying..."
              >
                Copy designs
              </LoadingButton>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Delete confirmation modal */}
      {confirmDelete && createPortal(
        <div
          className="pp-modal-overlay"
          onClick={isDeleting ? undefined : () => {
            setDeleteProgress(null);
            setConfirmDelete(null);
          }}
        >
          {isDeleting || deleteProgress ? (
            <DeleteProgressModal
              progress={deleteProgress}
              onCancel={requestDeleteCancel}
              onClose={() => {
                if (deleteAutoCloseTimerRef.current) clearTimeout(deleteAutoCloseTimerRef.current);
                setIsDeleting(false);
                setDeleteProgress(null);
                setConfirmDelete(null);
              }}
              onRetry={async () => {
                const target = confirmDelete;
                deleteCancelRequestedRef.current = false;
                setIsDeleting(true);
                if (target.type === 'many') {
                  await deleteSelected();
                } else {
                  startDeleteProgress(1);
                  const result = await deleteDesign(target.id);
                  finishDeleteProgress(1, result?.deletedIds?.length || 0, result?.failedIds?.length || 0);
                }
                setIsDeleting(false);
              }}
            />
          ) : (
            <div className="pp-modal pp-modal-danger" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <h3>{confirmDelete.type === 'many' ? 'Delete selected designs?' : 'Delete this design?'}</h3>
              <p>
                {confirmDelete.type === 'many'
                  ? `Are you sure you want to delete ${confirmDelete.count} selected design${confirmDelete.count === 1 ? '' : 's'}? This will remove them from your dashboard and delete their images from storage if possible.`
                  : `Are you sure you want to delete "${confirmDelete.name}"? This will remove the design from your dashboard and delete its image from storage if possible.`}
              </p>
              <div className="pp-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="pp-btn-delete"
                  onClick={async () => {
                    const target = confirmDelete;
                    setIsDeleting(true);
                    try {
                      if (target.type === 'many') {
                        await deleteSelected();
                      } else {
                        startDeleteProgress(1);
                        const result = await deleteDesign(target.id);
                        finishDeleteProgress(1, result?.deletedIds?.length || 0, result?.failedIds?.length || 0);
                      }
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                >
                  {confirmDelete.type === 'many' ? 'Delete Designs' : 'Delete Design'}
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </section>
  );
}

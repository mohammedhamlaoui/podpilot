import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDropzone } from "react-dropzone";
import { batchDeleteDesigns, checkCopyrightRisk, checkTrademarkForDesign, createDesign, generateDraftListingContent, generateListingContent, updateDesign, uploadDesignImage, uploadStandaloneImages, logFailingRequest } from "../api/client";
import { createImagePreviewDataUrl } from "../utils/imagePreview";
import { clearCachedDesignImages } from "../utils/imageCache";
import { deleteDesignBatch } from "../utils/designDeleteBatch";
import { PREMIUM_LOCK_MESSAGE } from "../lib/subscriptionAccess";
import CachedThumbnail from "./CachedThumbnail";
import DeleteProgressModal from "./DeleteProgressModal";
import Icon from "./Icon";
import CopyrightRiskModal from "./CopyrightRiskModal";
import { LoadingButton, ProgressLoader, SavingOverlay, TableSkeleton } from "./LoadingComponents";
import TrademarkModal from "./TrademarkModal";
import { isLocalId } from "../utils/draftHelper";
import { IconShieldSearch } from "@tabler/icons-react";
import { BotMessageSquare, Info } from "lucide-react";

const EMPTY_FORM = {
  filename: "",
  title: "",
  description: "",
  main_tag: "",
  supporting_tags: "",
  copy_link: "",
  sticker_color: "",
  stickers_color_enabled: "Off"
};

const ACCEPTED_REPLACEMENT_TYPES = new Set(["image/png", "image/jpeg"]);
const ACCEPTED_REPLACEMENT_EXTENSIONS = /\.(png|jpe?g)$/i;
const MAX_CREATE_DESIGNS = 50;
const MAX_CREATE_DESIGNS_MESSAGE = "Maximum 50 designs per session.";

function makeTempDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `temp_${crypto.randomUUID()}`;
  }
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isAcceptedReplacementImage(file) {
  return Boolean(file && (ACCEPTED_REPLACEMENT_TYPES.has(file.type) || ACCEPTED_REPLACEMENT_EXTENSIONS.test(file.name || "")));
}

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
  return [design.main_tag, ...String(design.supporting_tags || "").split(",")]
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return { deletedIds: [id], failedIds: [] };
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
    copy_link: "",
    description: "",
    sticker_color: "#000000",
    stickers_color_enabled: "Off"
  };
}

function validHexColor(value, fallback = "#000000") {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : fallback;
}

function isValidUrlString(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
  const [openActionId, setOpenActionId] = useState(null);
  const [openCreateMenu, setOpenCreateMenu] = useState(null);
  const [copiedStickerConfig, setCopiedStickerConfig] = useState(null);
  const [openEditMenu, setOpenEditMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: 'one' | 'many', id?, count?, name? }
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [isSavingCreated, setIsSavingCreated] = useState(false);
  const [isDeletingMany, setIsDeletingMany] = useState(false);
  const [isPastingAll, setIsPastingAll] = useState(false);
  const deleteCancelRequestedRef = useRef(false);
  const deleteAutoCloseTimerRef = useRef(null);

  // Custom toast notification state
  const [toast, setToast] = useState(null);

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

  // Image replacement states
  const [pendingReplacementFile, setPendingReplacementFile] = useState(null);
  const [replacementPreviewUrl, setReplacementPreviewUrl] = useState("");
  const [isPreviewCleared, setIsPreviewCleared] = useState(false);
  const [imageReplacementError, setImageReplacementError] = useState("");
  const replacementInputRef = useRef(null);
  const replacementPreviewUrlRef = useRef("");
  const localDraftPreviewUrlsRef = useRef(new Set());

  const [createImageReplacements, setCreateImageReplacements] = useState({});
  const [clearedCreateImageIds, setClearedCreateImageIds] = useState(new Set());
  const createReplacementInputRef = useRef(null);

  // AI Listing generation states
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiTarget, setAiTarget] = useState("create");
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingAllIndex, setGeneratingAllIndex] = useState(0);
  const [saveProgress, setSaveProgress] = useState(null);
  const [generatingAllTotal, setGeneratingAllTotal] = useState(0);
  const [generatingAllError, setGeneratingAllError] = useState("");
  const stopGeneratingAllRef = useRef(false);
  const [showBatchProgressModal, setShowBatchProgressModal] = useState(false);
  const [batchItems, setBatchItems] = useState([]);

  const [trademarkModalOpen, setTrademarkModalOpen] = useState(false);
  const [trademarkLoading, setTrademarkLoading] = useState(false);
  const [trademarkError, setTrademarkError] = useState("");
  const [trademarkResults, setTrademarkResults] = useState([]);
  const [trademarkPhrase, setTrademarkPhrase] = useState("");
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [riskResult, setRiskResult] = useState(null);

  useEffect(() => () => {
    if (replacementPreviewUrlRef.current) {
      URL.revokeObjectURL(replacementPreviewUrlRef.current);
    }
    localDraftPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    localDraftPreviewUrlsRef.current.clear();
    Object.values(createImageReplacements).forEach((rep) => {
      if (rep.previewUrl) URL.revokeObjectURL(rep.previewUrl);
    });
  }, []);

  function getLocalDraftPreviewUrl(design) {
    return design?.imagePreviewUrl || design?.previewUrl || "";
  }

  function getLocalDraftFile(design) {
    return design?.imageFile || design?.file || null;
  }

  function revokeLocalDraftPreview(design) {
    const previewUrl = getLocalDraftPreviewUrl(design);
    if (previewUrl && localDraftPreviewUrlsRef.current.has(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
      localDraftPreviewUrlsRef.current.delete(previewUrl);
    }
  }

  function replacePreviewUrl(nextUrl = "") {
    if (replacementPreviewUrlRef.current) {
      URL.revokeObjectURL(replacementPreviewUrlRef.current);
    }
    replacementPreviewUrlRef.current = nextUrl;
    setReplacementPreviewUrl(nextUrl);
  }

  function resetImageReplacementState() {
    replacePreviewUrl("");
    setPendingReplacementFile(null);
    setIsPreviewCleared(false);
    setImageReplacementError("");
  }

  function clearPreview() {
    if (!requireUnlocked()) return;
    const currentDesign = designs.find((design) => design.id === editingId);
    if (currentDesign && isLocalId(currentDesign.id)) {
      revokeLocalDraftPreview(currentDesign);
      onDesignsChange((current) => current.map((design) => (
        design.id === currentDesign.id
          ? { ...design, imageFile: null, imagePreviewUrl: "", file: null, previewUrl: "", image_url: "", thumbnail_url: "" }
          : design
      )));
      setReplacementPreviewUrl("");
      replacementPreviewUrlRef.current = "";
    } else {
      replacePreviewUrl("");
    }
    setPendingReplacementFile(null);
    setIsPreviewCleared(true);
    setImageReplacementError("");
  }

  function handleReplacementFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAcceptedReplacementImage(file)) {
      setImageReplacementError("Unsupported file type. Please upload PNG or JPEG designs only.");
      return;
    }
    const currentDesign = designs.find((design) => design.id === editingId);
    if (currentDesign && isLocalId(currentDesign.id)) {
      const previewUrl = URL.createObjectURL(file);
      localDraftPreviewUrlsRef.current.add(previewUrl);
      revokeLocalDraftPreview(currentDesign);
      setPendingReplacementFile(file);
      setReplacementPreviewUrl("");
      replacementPreviewUrlRef.current = "";
      setIsPreviewCleared(false);
      setImageReplacementError("");
      onDesignsChange((current) => current.map((design) => (
        design.id === currentDesign.id
          ? { ...design, imageFile: file, imagePreviewUrl: previewUrl, file, previewUrl, filename: file.name }
          : design
      )));
      return;
    }
    setPendingReplacementFile(file);
    replacePreviewUrl(URL.createObjectURL(file));
    setIsPreviewCleared(false);
    setImageReplacementError("");
  }

  function clearCreatePreview(imageId) {
    if (!requireUnlocked()) return;
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

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function buildTrademarkPayloadFromDesign(design, overrideForm = null) {
    const source = overrideForm || design || {};
    return {
      title: source.title || "",
      primary_tag: source.primary_tag || source.main_tag || "",
      main_tag: source.main_tag || source.primary_tag || "",
      supporting_tags: source.supporting_tags || "",
      description: source.description || "",
    };
  }

  function titleForTrademarkModal(results) {
    const termsWithMatches = (results || [])
      .flatMap((result) => result.matches || [])
      .map((match) => match.term || match.matched_term)
      .filter(Boolean);
    if (termsWithMatches.length > 0) return termsWithMatches[0];
    return (results || []).flatMap((result) => result.checked_terms || []).filter(Boolean)[0] || "";
  }

  function trademarkHitTerms() {
    const byTerm = new Map();
    trademarkResults.forEach((result) => {
      (result.matches || []).forEach((match) => {
        [match.term, match.matched_term].filter(Boolean).forEach((term) => {
          const key = String(term).toLowerCase();
          const tone = trademarkTone(match);
          const previous = byTerm.get(key);
          if (!previous || toneRank(tone) < toneRank(previous.tone)) {
            byTerm.set(key, { term: key, tone });
          }
        });
      });
    });
    return [...byTerm.values()];
  }

  function hitsForText(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return [];
    return trademarkHitTerms().filter((hit) => hit.term && text.includes(hit.term));
  }

  function trademarkTone(match) {
    const status = String(match?.status || "").toLowerCase();
    if (status.includes("live")) return "live";
    if (status.includes("dead")) return "dead";
    return "review";
  }

  function toneRank(tone) {
    if (tone === "live") return 0;
    if (tone === "review") return 1;
    return 2;
  }

  function TrademarkHits({ value }) {
    const hits = hitsForText(value);
    if (hits.length === 0) return null;
    return (
      <div className="pp-tm-hits">
        <span className="pp-tm-hits-label">TM match</span>
        {hits.map((hit) => <span key={hit.term} className={`pp-tm-hit-chip pp-tm-hit-chip-${hit.tone}`}>{hit.term}</span>)}
      </div>
    );
  }

  async function runTrademarkChecks(items) {
    if (!requireUnlocked()) return;
    if (trademarkLoading) return;
    setOpenEditMenu(null);
    setTrademarkError("");
    setTrademarkResults([]);
    setTrademarkPhrase("");
    setTrademarkLoading(true);

    try {
      const settled = await Promise.allSettled(
        items.map(async (item) => {
          const data = await checkTrademarkForDesign(item.payload);
          return { ...data, designLabel: item.label };
        })
      );
      const nextResults = settled.map((entry, index) => {
        if (entry.status === "fulfilled") return entry.value;
        const detail = entry.reason?.response?.data?.detail;
        return {
          designLabel: items[index]?.label,
          matches: [],
          checked_terms: [],
          failed_terms: [{
            term: items[index]?.label || "design",
            error: typeof detail === "string" ? detail : entry.reason?.message || "Trademark check failed.",
          }],
          errors: [],
        };
      });
      setTrademarkResults(nextResults);
      setTrademarkPhrase(titleForTrademarkModal(nextResults));
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

  function handleTrademarkCurrent() {
    const current = editingDesign || {};
    runTrademarkChecks([{
      label: form.title || current.title || current.filename || "Current design",
      payload: buildTrademarkPayloadFromDesign(current, form),
    }]);
  }

  function handleTrademarkAll() {
    const list = (filteredDesigns.length > 0 ? filteredDesigns : designs).filter(Boolean);
    runTrademarkChecks(list.map((design) => {
      const isActive = design.id === editingId;
      return {
        label: isActive ? (form.title || design.title || design.filename) : (design.title || design.filename || "Design"),
        payload: buildTrademarkPayloadFromDesign(design, isActive ? form : null),
      };
    }));
  }

  function closeRiskModal() {
    if (riskLoading) return;
    setRiskModalOpen(false);
  }

  async function runRiskCheck(payload) {
    if (riskLoading) return;
    setOpenCreateMenu(null);
    setOpenEditMenu(null);
    setRiskError("");
    setRiskResult(null);
    setRiskLoading(true);

    try {
      const result = await checkCopyrightRisk({
        ...payload,
        detected_trademark_terms: trademarkHitTerms().map((hit) => hit.term),
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

  async function handleCreateRiskCheck() {
    if (!requireUnlocked()) return;
    if (!activeCreateImage) return;
    const tags = parseTags(activeCreateDraft.tags);
    const replacement = createImageReplacements[activeCreateImage.id];
    const imageBase64 = replacement?.file
      ? await fileToDataUrl(replacement.file)
      : activeCreateImage.previewDataUrl || (activeCreateImage.file ? await fileToDataUrl(activeCreateImage.file) : "");

    runRiskCheck({
      platform: "redbubble",
      title: activeCreateDraft.title || "",
      description: activeCreateDraft.description || "",
      main_tag: tags[0] || "",
      primary_tag: tags[0] || "",
      supporting_tags: tags.slice(1),
      image_base64: imageBase64,
    });
  }

  async function handleEditRiskCheck() {
    if (!requireUnlocked()) return;
    if (!editingDesign?.id) return;
    const imageBase64 = pendingReplacementFile
      ? await fileToDataUrl(pendingReplacementFile)
      : editingImage?.previewDataUrl || "";

    runRiskCheck({
      platform: "redbubble",
      design_id: editingDesign.id,
      title: form.title || "",
      description: form.description || "",
      main_tag: form.main_tag || "",
      primary_tag: form.main_tag || "",
      supporting_tags: parseTags(form.supporting_tags),
      image_r2_key: editingDesign.image_r2_key || "",
      image_base64: imageBase64,
    });
  }

  const filteredDesigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return designs;

    return designs.filter((design) =>
      [design.filename, design.title, design.description, design.main_tag, design.supporting_tags]
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
    setForm((current) => ({ ...current, [field]: value }));
  }

  function mergeFormIntoDesign(design) {
    if (!design) return design;
    return {
      ...design,
      filename: form.filename || design.filename,
      title: form.title,
      description: form.description,
      primary_tag: form.main_tag,
      main_tag: form.main_tag,
      supporting_tags: form.supporting_tags,
      copy_link: form.copy_link,
      sticker_color: form.sticker_color,
      stickers_color_enabled: form.stickers_color_enabled,
    };
  }

  function persistEditingForm() {
    if (!editingId || editingId === "new") return;
    onDesignsChange((current) => current.map((design) => (
      design.id === editingId ? mergeFormIntoDesign(design) : design
    )));
  }

  function startAdd() {
    if (!requireUnlocked()) return;
    setOpenActionId(null);
    setEditingId("new");
    setForm(EMPTY_FORM);
    setCreateError("");
    setCreateUploadError("");
    setSessionImages([]);
    setCreateImageIds([]);
    setActiveCreateIndex(0);
    setCreateDrafts({});
    console.log("[PodPilot] Add New opened for marketplace redbubble");
  }

  function handleAddLocalDesignDraft() {
    if (createImageIds.length >= MAX_CREATE_DESIGNS) {
      setCreateError(`${MAX_CREATE_DESIGNS_MESSAGE} Remove a design before adding more.`);
      return;
    }

    setCreateError("");
    const newId = "local_" + Date.now();
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

  function handleAddLocalDesignDraftInEdit() {
    const newId = makeTempDraftId();
    const newDesign = {
      id: newId,
      filename: "",
      marketplace: "redbubble",
      title: "",
      description: "",
      primary_tag: "",
      main_tag: "",
      supporting_tags: "",
      copy_link: "",
      sticker_color: "#000000",
      stickers_color_enabled: "Off",
      image_r2_key: "",
      thumbnail_url: "",
      image_url: "",
      imageFile: null,
      imagePreviewUrl: "",
    };
    onDesignsChange((current) => [
      newDesign,
      ...current.map((design) => (design.id === editingId ? mergeFormIntoDesign(design) : design)),
    ]);
    startEdit(newDesign);
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
          file, // keep the raw File object for later upload
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

  // ── Close 3-dot menu on outside click / scroll / Escape ─────────────────
  useEffect(() => {
    if (!openActionId) return undefined;

    function onDocClick(e) {
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

  // ── Close edit-page Copy/Paste dropdowns on outside click / Escape ─────
  useEffect(() => {
    if (!openEditMenu) return undefined;
    function onDocClick(e) {
      const t = e.target.closest && e.target.closest(".toolbar-menu-wrap");
      if (t) return;
      setOpenEditMenu(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpenEditMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openEditMenu]);

  function startEdit(design) {
    setOpenActionId(null);
    setEditingId(design.id);
    resetImageReplacementState();
    setForm({
      filename: design.filename || "",
      title: design.title || "",
      description: design.description || "",
      main_tag: design.main_tag || "",
      supporting_tags: design.supporting_tags || "",
      copy_link: design.copy_link || "",
      sticker_color: design.sticker_color || "",
      stickers_color_enabled: design.stickers_color_enabled || "Off"
    });
  }

  function cancelEdit(silent = false) {
    // Only show the leave-warning when the user explicitly navigates away,
    // NOT when this is called programmatically after a successful save.
    // Create-session local drafts are tracked in createImageIds / sessionImages;
    // edit-session local drafts (handleAddLocalDesignDraftInEdit) are in the designs prop.
    const hasUnsavedCreateImages = createImageIds.length > 0;
    const hasUnsavedEditDrafts = designs.some((d) => isLocalId(d.id));
    if (!silent && (hasUnsavedCreateImages || hasUnsavedEditDrafts)) {
      const ok = window.confirm("You have unsaved designs. Leave without saving?");
      if (!ok) return;
    }

    // Remove any local draft designs from the edit-session list when the user
    // explicitly cancels (not when we call this silently after a successful save).
    if (!silent && hasUnsavedEditDrafts) {
      designs.filter((d) => isLocalId(d.id)).forEach(revokeLocalDraftPreview);
      onDesignsChange(designs.filter((d) => !isLocalId(d.id)));
    }

    setEditingId(null);
    setForm(EMPTY_FORM);
    setCreateError("");
    resetImageReplacementState();
    setCreateImageReplacements({});
    setClearedCreateImageIds(new Set());
  }

  async function saveDesign(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (!requireUnlocked()) return;
    if (form.title.trim().length === 0) {
      setCreateError("Title is required.");
      return;
    }
    const currentDesign = designs.find((design) => design.id === editingId);
    const filename = editingId === "new" ? form.filename.trim() : currentDesign?.filename || form.filename.trim();

    setCreateError("");
    setIsSavingDesign(true);
    setSaveProgress(null);

    try {
      if (editingId === "new") {
        const created = await createDesign({
          filename,
          marketplace: "redbubble",
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.main_tag.trim(),
          main_tag: form.main_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          copy_link: form.copy_link.trim(),
        });
        onDesignsChange((current) => [created, ...current.filter((design) => design.id !== created.id)]);
      } else if (isLocalId(editingId)) {
        const fileToUpload = pendingReplacementFile || getLocalDraftFile(currentDesign);
        let savedKey = undefined;
        if (fileToUpload) {
          setSaveProgress({
            percent: 0,
            loadedBytes: 0,
            totalBytes: fileToUpload.size,
            currentFileName: fileToUpload.name,
            status: "Uploading"
          });
          const uploadResp = await uploadStandaloneImages([fileToUpload], "redbubble", (progressEvent) => {
            const percent = fileToUpload.size > 0 ? Math.min(Math.round((progressEvent.loaded / fileToUpload.size) * 70), 70) : 0;
            setSaveProgress({
              percent,
              loadedBytes: progressEvent.loaded,
              totalBytes: fileToUpload.size,
              currentFileName: fileToUpload.name,
              status: "Uploading"
            });
          });
          const saved = Array.isArray(uploadResp?.files) ? uploadResp.files[0] : {};
          savedKey = saved?.image_r2_key;
          setSaveProgress(current => current ? { ...current, percent: 70, status: "Processing" } : null);
        }

        const created = await createDesign({
          filename,
          marketplace: "redbubble",
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.main_tag.trim(),
          main_tag: form.main_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          copy_link: form.copy_link.trim(),
          image_r2_key: savedKey,
        });
        setSaveProgress(current => current ? { ...current, percent: 100, status: "Completed" } : null);
        revokeLocalDraftPreview(currentDesign);
        onDesignsChange((current) => [created, ...current.filter((design) => design.id !== editingId && design.id !== created.id)]);
      } else {
        let imageUpdate = null;
        if (pendingReplacementFile) {
          await clearCachedDesignImages(currentDesign, userId);
          setSaveProgress({
            percent: 0,
            loadedBytes: 0,
            totalBytes: pendingReplacementFile.size,
            currentFileName: pendingReplacementFile.name,
            status: "Uploading"
          });
          imageUpdate = await uploadDesignImage(editingId, pendingReplacementFile, (progressEvent) => {
            const percent = pendingReplacementFile.size > 0 ? Math.min(Math.round((progressEvent.loaded / pendingReplacementFile.size) * 70), 70) : 0;
            setSaveProgress({
              percent,
              loadedBytes: progressEvent.loaded,
              totalBytes: pendingReplacementFile.size,
              currentFileName: pendingReplacementFile.name,
              status: "Uploading"
            });
          });
          setSaveProgress(current => current ? { ...current, percent: 70, status: "Processing" } : null);
        }
        const updated = await updateDesign(editingId, {
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.main_tag.trim(),
          main_tag: form.main_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          copy_link: form.copy_link.trim(),
        });
        setSaveProgress(current => current ? { ...current, percent: 100, status: "Completed" } : null);
        onDesignsChange((current) => current.map((design) => (design.id === editingId ? { ...design, ...(imageUpdate || {}), ...updated } : design)));
      }
      cancelEdit(true); // silent=true: skip leave-warning, this is a successful save
    } catch (saveError) {
      logFailingRequest(saveError);
      const detail = saveError.response?.data?.detail;
      const status = saveError.response?.status;
      let finalMessage = typeof detail === "string" ? detail : saveError.message || "Could not save design.";
      if (finalMessage.includes("Authentication service is temporarily unavailable") && status !== 503) {
        finalMessage = saveError.message || "Could not save design.";
      }
      setCreateError(finalMessage);
    } finally {
      setIsSavingDesign(false);
      setSaveProgress(null);
    }
  }

  function getCreateImageById(imageId) {
    // Look first in this session's just-uploaded images, then fall back to
    // the parent's uploadedImages list.
    return sessionImages.find((image) => image.id === imageId)
        || uploadedImages.find((image) => image.id === imageId);
  }

  function updateCreateDraft(field, value) {
    const imageId = createImageIds[activeCreateIndex];
    if (!imageId) return;

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

  function normalizeAiListingResult(result) {
    if (!result) return null;
    const title = result.title || result.design_title || "";
    const description = result.description || "";
    
    let main_tag = result.main_tag || result.primary_tag || "";
    let supporting_tags = result.supporting_tags || result.tags || result.keywords || "";
    
    if (Array.isArray(main_tag)) {
      main_tag = main_tag[0] || "";
    }
    main_tag = String(main_tag).trim();
    
    let tagList = [];
    if (Array.isArray(supporting_tags)) {
      tagList = supporting_tags.map(t => String(t).trim()).filter(Boolean);
    } else if (typeof supporting_tags === "string") {
      tagList = supporting_tags.split(/,|;/).map(t => String(t).trim()).filter(Boolean);
    }
    
    if (main_tag) {
      const mainTagLower = main_tag.toLowerCase();
      tagList = tagList.filter(t => t.toLowerCase() !== mainTagLower);
    }
    
    const uniqueTags = [];
    const seen = new Set();
    for (const tag of tagList) {
      const lower = tag.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueTags.push(tag);
      }
    }
    
    return {
      title,
      description,
      main_tag,
      supporting_tags: uniqueTags.join(", "),
    };
  }

  async function handleCreateAiGenerate() {
    if (!requireUnlocked()) return;
    if (!activeCreateImage || isAiGenerating) return;
    setOpenCreateMenu(null);
    setAiTarget("create");
    setAiError("");
    setAiResult(null);
    setIsAiGenerating(true);

    const requestDesignId = activeCreateImage.id;

    try {
      const tags = parseTags(activeCreateDraft.tags);
      const result = await generateDraftListingContent("redbubble", {
        filename: activeCreateImage.name || "",
        title: activeCreateDraft.title,
        description: activeCreateDraft.description,
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
      }, activeCreateImage.file || null);

      if (activeCreateImage?.id !== requestDesignId) {
        showToast("AI result ignored because the selected design changed.", "warning");
        return;
      }

      const normalized = normalizeAiListingResult(result);
      if (normalized) {
        updateCreateDraft("title", normalized.title || activeCreateDraft.title);
        updateCreateDraft("description", normalized.description || activeCreateDraft.description);
        const combinedTags = [normalized.main_tag, normalized.supporting_tags].filter(Boolean).join(", ");
        updateCreateDraft("tags", combinedTags);
        showToast("AI listing applied.", "success");
        setActiveTab("Info");
      }
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

  function applyCreateAiResult() {
    // No-op
  }

  async function handleEditAiGenerate() {
    if (!requireUnlocked()) return;
    if (!editingDesign?.id || isAiGenerating) return;
    setOpenEditMenu(null);
    setAiTarget("edit");
    setAiError("");
    setAiResult(null);
    setIsAiGenerating(true);

    const requestDesignId = editingDesign.id;

    try {
      const result = await generateListingContent(editingDesign.id, "redbubble", {
        filename: editingDesign.filename || "",
        title: form.title,
        description: form.description,
        primary_tag: form.main_tag,
        supporting_tags: form.supporting_tags,
      });

      if (editingDesign?.id !== requestDesignId) {
        showToast("AI result ignored because the selected design changed.", "warning");
        return;
      }

      const normalized = normalizeAiListingResult(result);
      if (normalized) {
        setForm((current) => ({
          ...current,
          title: normalized.title || current.title,
          description: normalized.description || current.description,
          main_tag: normalized.main_tag || current.main_tag,
          supporting_tags: normalized.supporting_tags || current.supporting_tags,
        }));
        showToast("AI listing applied.", "success");
      }
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

  function applyEditAiResult() {
    // No-op
  }

  function closeAiModal() {
    if (isAiGenerating) return;
    setAiResult(null);
    setAiError("");
  }

  function handleCreateTrademarkCurrent() {
    if (!activeCreateImage) return;
    const tags = parseTags(activeCreateDraft.tags);
    runTrademarkChecks([{
      label: activeCreateDraft.title || activeCreateImage.name || "Current design",
      payload: {
        title: activeCreateDraft.title || "",
        primary_tag: tags[0] || "",
        main_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
        description: activeCreateDraft.description || "",
      },
    }]);
    setOpenCreateMenu(null);
  }

  function handleCreateTrademarkAll() {
    const batch = selectedCreateImages;
    if (batch.length === 0) return;
    
    const items = batch.map((img) => {
      const draft = createDrafts[img.id] || makeCreateDraft(img);
      const tags = parseTags(draft.tags);
      return {
        label: draft.title || img.name || "Design",
        payload: {
          title: draft.title || "",
          primary_tag: tags[0] || "",
          main_tag: tags[0] || "",
          supporting_tags: tags.slice(1).join(", "),
          description: draft.description || "",
        }
      };
    });
    
    runTrademarkChecks(items);
    setOpenCreateMenu(null);
  }

  function renderAiListingModal() {
    return null;
  }

  async function handleRetryDesignCreate(item) {
    if (!requireUnlocked()) return;
    
    setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'generating', error: '' } : x));
    
    const image = item.image;
    const draft = createDrafts[image.id] || makeCreateDraft(image);
    const tags = parseTags(draft.tags);
    
    try {
      const result = await generateDraftListingContent("redbubble", {
        filename: image.name || "",
        title: draft.title,
        description: draft.description,
        primary_tag: tags[0] || "",
        supporting_tags: tags.slice(1).join(", "),
      }, image.file || null);
      
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
        const result = await generateDraftListingContent("redbubble", {
          filename: image.name || "",
          title: draft.title,
          description: draft.description,
          primary_tag: tags[0] || "",
          supporting_tags: tags.slice(1).join(", "),
        }, image.file || null);

        if (stopGeneratingAllRef.current) {
          break;
        }

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

  function moveCreateIndex(direction) {
    setActiveCreateIndex((currentIndex) => {
      if (createImageIds.length === 0) return 0;
      return (currentIndex + direction + createImageIds.length) % createImageIds.length;
    });
  }

  async function saveCreatedDesigns(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
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
    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "redbubble" });

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
          "redbubble",
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

        const row = await createDesign({
          filename: filename,
          marketplace: "redbubble",
          title,
          description,
          primary_tag: safeTags[0] || "",
          main_tag: safeTags[0] || "",
          supporting_tags: safeTags.slice(1).join(", "),
          copy_link: (draft.copy_link || "").trim(),
          image_r2_key: saved.image_r2_key || image.imagePath || undefined,
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
      revokeLocalDraftPreview(designs.find((design) => design.id === id));
      onDesignsChange((current) => current.filter((design) => design.id !== id));
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      return { deletedIds: [id], failedIds: [] };
    }
    const targetDesign = designs.find((design) => design.id === id);
    try {
      const response = await batchDeleteDesigns([id]);
      const result = Array.isArray(response?.results) ? response.results[0] : null;
      if (!result?.success) {
        throw new Error(result?.reason || "Design delete failed.");
      }
      await clearCachedDesignImages(targetDesign, userId);
      // Only remove from UI after backend confirms deletion.
      onDesignsChange((current) => current.filter((design) => design.id !== id));
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
      return { deletedIds: [id], failedIds: [] };
    } catch (error) {
      console.warn("[PodPilot] delete design failed:", error?.message || error);
      return { deletedIds: [], failedIds: [id], error };
      // Do NOT remove from UI — backend didn't confirm.
    }
  }

  async function deleteSelected() {
    if (!requireUnlocked()) return;
    if (selectedIds.length === 0) return;
    if (isDeletingMany) return;
    const ids = [...selectedIds];
    setIsDeletingMany(true);
    startDeleteProgress(ids.length);
    try {
      const result = await deleteDesignBatch({
        ids,
        designs,
        userId,
        deleteBackendDesigns: batchDeleteDesigns,
        onDesignsChange,
        setSelectedIds,
        updateProgress: updateDeleteProgress,
        isCancelled: () => deleteCancelRequestedRef.current,
        revokeLocalDraftPreview,
      });
      finishDeleteProgress(ids.length, result.deletedIds.length, result.failedIds.length, {
        cancelled: result.cancelled,
        completed: result.completed ?? ids.length,
      });
    } finally {
      setIsDeletingMany(false);
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

  const matchedCount = designs.filter((design) => findImageForDesign(design, uploadedImages)).length;
  const missingCount = Math.max(designs.length - matchedCount, 0);
  const editingDesign = editingId && editingId !== "new"
    ? designs.find((design) => design.id === editingId)
    : null;
  const editVisibleDesigns = useMemo(() => {
    const filteredIds = new Set(filteredDesigns.map((design) => design.id));
    const localDrafts = designs.filter((design) => isLocalId(design.id) && !filteredIds.has(design.id));
    return filteredDesigns.length > 0 ? [...filteredDesigns, ...localDrafts] : designs;
  }, [designs, filteredDesigns]);
  const activeEditIndex = editingId && editingId !== "new"
    ? editVisibleDesigns.findIndex((design) => design.id === editingId)
    : -1;
  const editingImage = useMemo(() => {
    if (isPreviewCleared) return null;
    if (editingDesign && isLocalId(editingDesign.id)) {
      const previewUrl = getLocalDraftPreviewUrl(editingDesign) || editingDesign.thumbnail_url || editingDesign.image_url;
      return previewUrl ? { previewUrl } : null;
    }
    if (replacementPreviewUrl) return { previewUrl: replacementPreviewUrl };
    if (editingDesign?.thumbnail_url || editingDesign?.image_url) {
      return { previewUrl: editingDesign.image_url || editingDesign.thumbnail_url };
    }
    return editingDesign ? findImageForDesign(editingDesign, uploadedImages) : null;
  }, [editingDesign, uploadedImages, replacementPreviewUrl, isPreviewCleared]);
  const formStickerEnabled = form.stickers_color_enabled === "On";
  const formStickerColor = validHexColor(form.sticker_color);
  const copyLinkRaw = String(form.copy_link || "").trim();
  const lockedTitle = isWorkspaceLocked ? PREMIUM_LOCK_MESSAGE : undefined;
  const lockedButtonClass = isWorkspaceLocked ? " pp-locked-action" : "";
  const copyLinkInvalid = copyLinkRaw.length > 0 && !isValidUrlString(copyLinkRaw);
  const canUpdateDesign =
    Boolean(form.title.trim()) &&
    Boolean(form.main_tag.trim()) &&
    Boolean(form.supporting_tags.trim()) &&
    Boolean(form.description.trim()) &&
    isValidUrlString(copyLinkRaw);
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
  const activeStickerEnabled = activeCreateDraft.stickers_color_enabled === "On";
  const activeStickerColor = validHexColor(activeCreateDraft.sticker_color);
  const completedCreateCount = selectedCreateImages.filter((image) => {
    return Boolean(image);
  }).length;

  function getStickerConfig(draft) {
    return {
      sticker_color: validHexColor(draft.sticker_color),
      stickers_color_enabled: draft.stickers_color_enabled === "On" ? "On" : "Off"
    };
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

  // ── Edit-mode helpers (navigate between designs + copy/paste sticker) ──
  function moveEditingIndex(direction) {
    if (!editingId || editingId === "new") return;
    if (editVisibleDesigns.length === 0) return;
    const currentIndex = editVisibleDesigns.findIndex((d) => d.id === editingId);
    if (currentIndex === -1) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= editVisibleDesigns.length) return;
    const nextDesign = editVisibleDesigns[nextIndex];
    if (nextDesign) {
      persistEditingForm();
      startEdit(nextDesign);
      setOpenEditMenu(null);
    }
  }

  function copyEditStickerConfig() {
    setCopiedStickerConfig({
      sticker_color: validHexColor(form.sticker_color),
      stickers_color_enabled: form.stickers_color_enabled === "On" ? "On" : "Off"
    });
    setOpenEditMenu(null);
  }

  function pasteEditStickerConfigToCurrent() {
    if (!requireUnlocked()) return;
    if (!copiedStickerConfig) return;
    updateForm("sticker_color", copiedStickerConfig.sticker_color);
    updateForm("stickers_color_enabled", copiedStickerConfig.stickers_color_enabled);
    setOpenEditMenu(null);
  }

  async function pasteEditStickerConfigToAll() {
    if (!requireUnlocked()) return;
    if (!copiedStickerConfig) return;
    try {
      const updates = await Promise.all(
        designs.map(async (design) => {
          const updated = await updateDesign(design.id, {
            sticker_color: copiedStickerConfig.sticker_color,
            stickers_color_enabled: copiedStickerConfig.stickers_color_enabled
          });
          return { id: design.id, updated };
        })
      );
      const byId = new Map(updates.map((u) => [u.id, u.updated]));
      onDesignsChange(designs.map((d) => ({ ...d, ...(byId.get(d.id) || {}) })));
      if (editingId && editingId !== "new") {
        updateForm("sticker_color", copiedStickerConfig.sticker_color);
        updateForm("stickers_color_enabled", copiedStickerConfig.stickers_color_enabled);
      }
    } catch (error) {
      console.error("[PodPilot] Paste sticker config to all failed", error);
    } finally {
      setOpenEditMenu(null);
    }
  }

  function handleStickerColorToggle(checked) {
    updateCreateDraft("stickers_color_enabled", checked ? "On" : "Off");
    if (checked && !activeCreateDraft.sticker_color) {
      updateCreateDraft("sticker_color", "#000000");
    }
  }

  if (editingId === "new") {
    return (
      <section className="workflow-panel manager-panel create-page">
        <div className="create-page-header">
          <div>
            <h2>Create Redbubble Design</h2>
            <button type="button" className="secondary-button" onClick={cancelEdit}>
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

        {renderAiListingModal()}
        <CopyrightRiskModal
          open={riskModalOpen}
          loading={riskLoading}
          error={riskError}
          result={riskResult}
          onClose={closeRiskModal}
        />
        <TrademarkModal
          open={trademarkModalOpen}
          loading={trademarkLoading}
          error={trademarkError}
          results={trademarkResults}
          phrase={trademarkPhrase}
          onClose={() => setTrademarkModalOpen(false)}
        />

        {createImageIds.length === 0 ? (
          <div className="create-upload-card">
            <div
              {...createDropzone.getRootProps({
                className: createDropzone.isDragActive ? "create-upload-drop create-upload-drop-active" : "create-upload-drop"
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
                onClick={createDropzone.open}
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
                    <button type="button" onClick={copyStickerConfig} role="menuitem">
                      <Icon name="copy" />
                      <span>Copy Sticker Config</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="toolbar-menu-wrap">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!copiedStickerConfig}
                  onClick={() => setOpenCreateMenu((current) => (current === "paste" ? null : "paste"))}
                >
                  <Icon name="file" />
                  <span>Paste</span>
                  <Icon name="chevronDown" />
                </button>
                {openCreateMenu === "paste" && (
                  <div className="toolbar-dropdown" role="menu">
                    <button type="button" onClick={pasteStickerConfigToCurrent} role="menuitem">
                      <Icon name="file" />
                      <span>Paste to Current Design</span>
                    </button>
                    <button type="button" onClick={pasteStickerConfigToAll} role="menuitem">
                      <Icon name="file" />
                      <span>Paste to All Designs</span>
                    </button>
                  </div>
                )}
              </div>
              <span className="create-command-spacer" />
              <button type="button" className="secondary-button icon-only-button" onClick={cancelEdit} aria-label="Close editor">
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
                <h3 style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  Design Configuration
                  <span className="image-quality-info-tooltip-container">
                    <Info className="image-quality-info-icon" size={16} />
                    <span className="image-quality-info-tooltip-text">
                      Fast preview only. Upload uses your original image quality.
                    </span>
                  </span>
                </h3>
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
                        className="create-preview create-sticker-preview"
                        style={{ "--sticker-preview-color": activeStickerEnabled ? activeStickerColor : "#7d7d7d", position: 'relative' }}
                      >
                        <CachedThumbnail
                          design={{ id: activeCreateImage.id, image_r2_key: activeCreateImage.imagePath || activeCreateImage.image_r2_key }}
                          userId={userId}
                          cacheVariant="preview"
                          cacheR2Key={activeCreateImage.imagePath || activeCreateImage.image_r2_key}
                          src={activeCreateImagePreview}
                          alt={activeCreateImage.name}
                        />
                        <button type="button" className="design-preview-remove" onClick={() => clearCreatePreview(activeCreateImage.id)} aria-label="Clear design preview">
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
                    <label className="toggle-card">
                      <span>
                        <strong>Enable Sticker Color</strong>
                        <small>Enable color selection for stickers</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={activeStickerEnabled}
                        onChange={(event) => handleStickerColorToggle(event.target.checked)}
                      />
                    </label>
                    {activeStickerEnabled && (
                      <div className="sticker-color-card">
                        <span>Sticker Color:</span>
                        <strong className="sticker-color-swatch" style={{ background: activeStickerColor }} />
                        <input
                          type="color"
                          value={activeStickerColor}
                          onChange={(event) => updateCreateDraft("sticker_color", event.target.value.toUpperCase())}
                          aria-label="Choose sticker color"
                        />
                        <input
                          type="text"
                          value={activeCreateDraft.sticker_color || activeStickerColor}
                          onChange={(event) => updateCreateDraft("sticker_color", normalizeHexTyping(event.target.value))}
                          onBlur={() => updateCreateDraft("sticker_color", activeStickerColor)}
                          aria-label="Sticker color hex code"
                        />
                      </div>
                    )}
                  </aside>

                  <div className="edit-grid create-meta-grid">
                    <label>
                      Design Title *
                      <textarea
                        value={activeCreateDraft.title}
                        onChange={(event) => updateCreateDraft("title", event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Main Tag *
                      <textarea
                        value={parseTags(activeCreateDraft.tags)[0] || ""}
                        onChange={(event) => {
                          const currentTags = parseTags(activeCreateDraft.tags);
                          updateCreateDraft("tags", [event.target.value, ...currentTags.slice(1)].filter(Boolean).join(", "));
                        }}
                        placeholder="Enter main tag (e.g., cat lover)"
                        required
                      />
                    </label>
                    <label>
                      Supporting Tags *
                      <textarea
                        value={parseTags(activeCreateDraft.tags).slice(1).join(",")}
                        onChange={(event) => {
                          const currentMainTag = parseTags(activeCreateDraft.tags)[0] || "";
                          updateCreateDraft("tags", [currentMainTag, event.target.value].filter(Boolean).join(", "));
                        }}
                        placeholder="Enter supporting tags separated by commas"
                        required
                      />
                    </label>
                    <label>
                      Description *
                      <textarea
                        value={activeCreateDraft.description}
                        onChange={(event) => updateCreateDraft("description", event.target.value)}
                        placeholder="Enter design description"
                        required
                      />
                    </label>
                    <label className="edit-grid-wide copy-link-field">
                      Copy Link *
                      <div>
                        <input
                          value={activeCreateDraft.copy_link}
                          onChange={(event) => updateCreateDraft("copy_link", event.target.value)}
                          placeholder="https://www.redbubble.com/portfolio/images/123456789-design-name/duplicate"
                          required
                        />
                        <button type="button" className="secondary-button icon-only-button" aria-label="Open copy link">
                          <Icon name="link" />
                        </button>
                      </div>
                    </label>
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
          message={`Saving ${selectedCreateImages.length || createImageIds.length} Redbubble design${(selectedCreateImages.length || createImageIds.length) === 1 ? "" : "s"}...`}
          subtext="Uploading image files and creating your Redbubble design records. Please keep this page open."
          progress={saveProgress}
        />
      </section>
    );
  }

  if (editingId && editingId !== "new") {
    return (
      <section className="workflow-panel manager-panel edit-page redbubble-edit-page">
        <div className="create-page-header">
          <div>
            <button type="button" className="secondary-button" onClick={cancelEdit}>
              <Icon name="chevronLeft" />
              <span>Back to Designs</span>
            </button>
          </div>
          <div className="edit-toolbar">
            <div className="create-nav-buttons">
              <button
                type="button"
                className="secondary-button icon-only-button"
                onClick={() => moveEditingIndex(-1)}
                disabled={activeEditIndex <= 0}
                aria-label="Previous design"
                title="Previous design"
              >
                <Icon name="chevronLeft" />
              </button>
              <div className="tp-dots">
                {editVisibleDesigns.map((design) => (
                  <span
                    key={design.id}
                    className={`tp-dot${design.id === editingId ? " active" : ""}`}
                    onClick={() => {
                      if (design.id === editingId) return;
                      persistEditingForm();
                      startEdit(design);
                      setOpenEditMenu(null);
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="secondary-button icon-only-button"
                onClick={() => moveEditingIndex(1)}
                disabled={activeEditIndex < 0 || activeEditIndex >= editVisibleDesigns.length - 1}
                aria-label="Next design"
                title="Next design"
              >
                <Icon name="chevronRight" />
              </button>
              <button type="button" className="secondary-button icon-only-button" onClick={handleAddLocalDesignDraftInEdit} aria-label="Add design" title="Add design">
                <Icon name="upload" />
              </button>
            </div>
            <button
              type="button"
              className="secondary-button ai-generate-button pp-stabilized-btn pp-ai-listing-btn"
              onClick={handleEditAiGenerate}
              disabled={isAiGenerating || !editingDesign?.id}
            >
              {isAiGenerating && aiTarget === "edit" ? (
                <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
              ) : (
                <Icon name="sparkles" />
              )}
              <span>{isAiGenerating && aiTarget === "edit" ? "Generating..." : "AI Listing"}</span>
            </button>
            <button
              type="button"
              className="secondary-button ai-generate-button pp-stabilized-btn pp-ai-check-btn"
              onClick={handleEditRiskCheck}
              disabled={riskLoading || !editingDesign?.id}
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
                className="secondary-button"
                onClick={() => setOpenEditMenu((current) => (current === "copy" ? null : "copy"))}
              >
                <Icon name="copy" />
                <span>Copy</span>
                <Icon name="chevronDown" />
              </button>
              {openEditMenu === "copy" && (
                <div className="toolbar-dropdown" role="menu">
                  <button type="button" onClick={copyEditStickerConfig} role="menuitem">
                    <Icon name="copy" />
                    <span>Copy Sticker Config</span>
                  </button>
                </div>
              )}
            </div>
            <div className="toolbar-menu-wrap">
              <button
                type="button"
                className="secondary-button"
                disabled={!copiedStickerConfig}
                onClick={() => setOpenEditMenu((current) => (current === "paste" ? null : "paste"))}
              >
                <Icon name="file" />
                <span>Paste</span>
                <Icon name="chevronDown" />
              </button>
              {openEditMenu === "paste" && (
                <div className="toolbar-dropdown" role="menu">
                  <button type="button" onClick={pasteEditStickerConfigToCurrent} role="menuitem">
                    <Icon name="file" />
                    <span>Paste to Current Design</span>
                  </button>
                  <button type="button" onClick={pasteEditStickerConfigToAll} role="menuitem">
                    <Icon name="file" />
                    <span>Paste to All Designs</span>
                  </button>
                </div>
              )}
            </div>
            <div className="toolbar-menu-wrap">
              <button
                type="button"
                className={`secondary-button pp-stabilized-btn pp-trademark-btn${trademarkResults.some((r) => (r.matches || []).length > 0) ? " tp-toolbar-btn-danger" : ""}`}
                onClick={() => setOpenEditMenu((current) => (current === "trademark" ? null : "trademark"))}
                disabled={trademarkLoading}
                aria-haspopup="menu"
                aria-expanded={openEditMenu === "trademark"}
              >
                {trademarkLoading ? (
                  <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                ) : (
                  <IconShieldSearch size={20} stroke={2} />
                )}
                <span>{trademarkLoading ? "Checking..." : "Check Trademark"}</span>
                <Icon name="chevronDown" />
              </button>
              {openEditMenu === "trademark" && (
                <div className="toolbar-dropdown" role="menu">
                  <button type="button" onClick={handleTrademarkCurrent} role="menuitem">
                    <span>Check this design (TM)</span>
                  </button>
                  <button type="button" onClick={handleTrademarkAll} role="menuitem">
                    <span>Check all designs (TM)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
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
        {renderAiListingModal()}

        <form className="edit-panel" onSubmit={saveDesign}>
          <div className="edit-panel-heading">
            <h3 style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              Design Configuration
              <span className="image-quality-info-tooltip-container">
                <Info className="image-quality-info-icon" size={16} />
                <span className="image-quality-info-tooltip-text">
                  Fast preview only. Upload uses your original image quality.
                </span>
              </span>
            </h3>
            <button type="button" className="icon-button" onClick={cancelEdit} aria-label="Close editor">
              <Icon name="x" />
            </button>
          </div>
          <div className="edit-panel-layout">
            <aside className="edit-preview-column">
              <input
                ref={replacementInputRef}
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                style={{ display: "none" }}
                onChange={handleReplacementFileChange}
              />
              <div className="edit-preview-card">
                {editingImage ? (
                  <div className={`design-preview-frame${pendingReplacementFile ? " design-preview-pending" : ""}`}>
                    <CachedThumbnail
                      design={{ ...editingDesign, image_r2_key: editingDesign?.image_r2_key || editingImage.imagePath }}
                      userId={userId}
                      cacheVariant="preview"
                      cacheR2Key={editingDesign?.image_r2_key || editingImage.imagePath}
                      className={formStickerEnabled ? "edit-sticker-preview" : "edit-preview-image"}
                      style={formStickerEnabled ? { "--sticker-preview-color": formStickerColor } : undefined}
                      src={editingImage.previewUrl}
                      alt={editingDesign?.filename || form.title}
                    />
                    <button type="button" className="design-preview-remove" onClick={clearPreview} aria-label="Clear design preview">
                      <Icon name="x" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="design-upload-placeholder"
                    onClick={() => replacementInputRef.current?.click()}
                  >
                    <span className="design-upload-placeholder-icon"><Icon name="upload" /></span>
                    <strong>Upload replacement design</strong>
                    <small>PNG or JPEG only</small>
                  </button>
                )}
                <strong>{form.title || "Untitled design"}</strong>
                <span>{editingDesign?.filename || form.filename || "No filename"}</span>
              </div>
              {imageReplacementError && <small className="design-image-error">{imageReplacementError}</small>}
              <label className="toggle-card">
                <span>
                  <strong>Enable Sticker Color</strong>
                  <small>Enable color selection for stickers</small>
                </span>
                <input
                  type="checkbox"
                  checked={formStickerEnabled}
                  onChange={(event) => {
                    updateForm("stickers_color_enabled", event.target.checked ? "On" : "Off");
                    if (event.target.checked && !form.sticker_color) {
                      updateForm("sticker_color", "#000000");
                    }
                  }}
                />
              </label>
              {formStickerEnabled && (
                <div className="sticker-color-card">
                  <span>Sticker Color:</span>
                  <strong className="sticker-color-swatch" style={{ background: formStickerColor }} />
                  <input
                    type="color"
                    value={formStickerColor}
                    onChange={(event) => updateForm("sticker_color", event.target.value.toUpperCase())}
                    aria-label="Choose sticker color"
                  />
                  <input
                    type="text"
                    value={form.sticker_color || formStickerColor}
                    onChange={(event) => updateForm("sticker_color", normalizeHexTyping(event.target.value))}
                    onBlur={() => updateForm("sticker_color", formStickerColor)}
                    aria-label="Sticker color hex code"
                  />
                </div>
              )}
            </aside>

            <div className="edit-grid">
              <label>
                Design Title <span className="req-asterisk">*</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  placeholder="Enter design title"
                  required
                />
                <TrademarkHits value={form.title} />
              </label>
              <label>
                Main Tag <span className="req-asterisk">*</span>
                <input
                  type="text"
                  value={form.main_tag}
                  onChange={(event) => updateForm("main_tag", event.target.value)}
                  placeholder="Enter main tag (e.g., cat lover)"
                  required
                />
                <TrademarkHits value={form.main_tag} />
              </label>
              <label>
                Supporting Tags <span className="req-asterisk">*</span>
                <textarea
                  value={form.supporting_tags}
                  onChange={(event) => updateForm("supporting_tags", event.target.value)}
                  rows={2}
                  placeholder="Enter supporting tags separated by commas"
                  required
                />
                <TrademarkHits value={form.supporting_tags} />
              </label>
              <label>
                Description <span className="req-asterisk">*</span>
                <textarea
                  value={form.description}
                  onChange={(event) => updateForm("description", event.target.value)}
                  rows={2}
                  placeholder="Enter design description"
                  required
                />
                <TrademarkHits value={form.description} />
              </label>
              <label className="edit-grid-wide copy-link-field">
                <span className="copy-link-label">
                  Copy Link <span className="req-asterisk">*</span>
                  <a
                    href="https://help.redbubble.com/hc/en-us/articles/4419104213517"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="copy-link-help"
                    title="Setup guide"
                  >
                    <span className="copy-link-help-icon">?</span> Setup guide (PDF)
                  </a>
                </span>
                <div className="copy-link-row">
                  <input
                    type="url"
                    value={form.copy_link}
                    onChange={(event) => updateForm("copy_link", event.target.value)}
                    placeholder="https://www.redbubble.com/portfolio/images/123456789-design-name/duplicate"
                    className={copyLinkInvalid ? "field-invalid" : undefined}
                    aria-invalid={copyLinkInvalid || undefined}
                    required
                  />
                  <button
                    type="button"
                    className="copy-link-open"
                    onClick={() => form.copy_link && window.open(form.copy_link, "_blank", "noreferrer")}
                    disabled={!form.copy_link || copyLinkInvalid}
                    aria-label="Open copy link"
                    title="Open copy link"
                  >
                    <Icon name="link" />
                  </button>
                </div>
                {copyLinkInvalid && (
                  <small className="field-error">Enter a valid URL starting with http:// or https://</small>
                )}
              </label>
            </div>
          </div>
          <div className="edit-actions">
            <button type="button" className="secondary-button" onClick={cancelEdit} disabled={isSavingDesign}>
              Cancel
            </button>
            <LoadingButton
              type="submit"
              className="primary-button"
              disabled={!canUpdateDesign}
              loading={isSavingDesign}
              loadingText="Updating..."
              title={!canUpdateDesign ? "Fill all required fields with a valid copy link" : undefined}
            >
              Update Design
            </LoadingButton>
          </div>
        </form>
        <SavingOverlay
          show={isSavingDesign}
          message="Saving Redbubble design..."
          subtext="Updating your design metadata and image changes. Please keep this page open."
          progress={saveProgress}
        />
      </section>
    );
  }

  return (
    <section className="workflow-panel manager-panel marketplace-manager redbubble-manager">
      {/* Toast */}
      {toast && (
        <div className={`tp-toast tp-toast-${toast.type}`}>{toast.msg}</div>
      )}



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

      <div className="manager-header">
        <div>
          <span className="marketplace-kicker">Active automation workspace</span>
          <h2>Redbubble Upload Designs</h2>
          <p>Manage titles, tags, copy links, images, and queue readiness in one place.</p>
        </div>
        <div className="manager-actions">
          <button type="button" className="secondary-button" onClick={onImportClick}>
            <Icon name="import" />
            <span>Import</span>
          </button>
          <button type="button" className="secondary-button" onClick={onRefreshFromBackend} disabled={isLoading}>
            <Icon name="refresh" />
            <span>{isLoading ? "Updating..." : "Refresh"}</span>
          </button>
          <button type="button" className="primary-button" onClick={startAdd}>
            <Icon name="add" />
            <span>Add New</span>
          </button>
        </div>
      </div>

      <div className="manager-stats">
        <article>
          <span>Total Designs</span>
          <strong>{designs.length}</strong>
          <small>{uploadedImages.length} images available</small>
        </article>
        <article>
          <span>Matched</span>
          <strong>{matchedCount}</strong>
          <small>ready for upload queue</small>
        </article>
        <article>
          <span>Missing</span>
          <strong>{missingCount}</strong>
          <small>need image review</small>
        </article>
        <article>
          <span>Selected</span>
          <strong>{selectedIds.length}</strong>
          <small>bulk actions prepared</small>
        </article>
      </div>

      {editingId === "new" && (
        <form className="edit-panel create-panel" onSubmit={saveCreatedDesigns}>
          <div className="edit-panel-heading">
            <div>
              <h3>Create Redbubble Designs</h3>
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
                      <button type="button" className="secondary-button icon-only-button" onClick={() => moveCreateIndex(1)} aria-label="Next design">
                        <Icon name="chevronRight" />
                      </button>
                  </div>

                  <div className="create-editor">
                    <div className="create-preview">
                      <CachedThumbnail
                        design={{ id: activeCreateImage.id, image_r2_key: activeCreateImage.imagePath || activeCreateImage.image_r2_key }}
                        userId={userId}
                        cacheVariant="preview"
                        cacheR2Key={activeCreateImage.imagePath || activeCreateImage.image_r2_key}
                        src={activeCreateImage.previewUrl}
                        alt={activeCreateImage.name}
                      />
                    </div>
                    <div className="edit-grid">
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
                        Copy Link
                        <input
                          value={activeCreateDraft.copy_link}
                          onChange={(event) => updateCreateDraft("copy_link", event.target.value)}
                          placeholder="https://www.redbubble.com/portfolio/images/.../duplicate"
                          required
                        />
                      </label>
                      <label className="edit-grid-wide">
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
            <button type="submit" className="primary-button" disabled={selectedCreateImages.length === 0}>
              <Icon name="file" />
              Create All Designs ({selectedCreateImages.length})
            </button>
          </div>
        </form>
      )}

      {editingId && editingId !== "new" && null}

      <div className="manager-toolbar">
        <label className="search-field">
          <span>Search title</span>
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
          <LoadingButton
            type="button"
            className="danger-button"
            onClick={() => setConfirmDelete({ type: 'many', count: selectedIds.length })}
            disabled={selectedIds.length === 0}
            loading={isDeletingMany}
            loadingText="Deleting..."
          >
            Delete Selected
          </LoadingButton>
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
              <th>Copy Link</th>
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
              const thumbnailSrc = design.thumbnail_url || matchedImage?.thumbnailUrl || design.image_url || matchedImage?.imageUrl || matchedImage?.previewUrl || "";
              const previewSrc = design.image_url || matchedImage?.imageUrl || matchedImage?.previewUrl || thumbnailSrc;
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
                      {design.main_tag && <span className="tag-chip tag-chip-main">{design.main_tag}</span>}
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
                    {design.copy_link ? (
                      <a href={design.copy_link} target="_blank" rel="noreferrer">
                        View Link
                      </a>
                    ) : (
                      <span className="muted-text">Missing</span>
                    )}
                  </td>
                  <td>
                    <div className="status-cell">
                      {(() => {
                        // Render whatever status the backend has for this row
                        // (driven by the extension's POST /designs/{id}/status).
                        // Fall back to "pending" → "Not uploaded" so legacy
                        // local-only rows still render the same as before.
                        const raw = String(design.status || "pending").toLowerCase();
                        let label = "Not uploaded";
                        let cls = "status-pending";
                        if (raw === "done") {
                          label = "Uploaded";
                          cls = "status-done";
                        } else if (raw === "error" || raw === "failed") {
                          label = "Failed";
                          cls = "status-error";
                        } else if (raw === "in_progress" || raw === "uploading") {
                          label = "Uploading...";
                          cls = "status-running";
                        }
                        return <span className={`status-badge ${cls}`}>{label}</span>;
                      })()}
                      <small>{formatToday()}</small>
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
                          <button type="button" onClick={() => startEdit(design)} role="menuitem">
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

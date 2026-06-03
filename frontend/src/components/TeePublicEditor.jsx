import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { batchUpdateDesigns, checkCopyrightRisk, checkTrademarkForDesign, createDesign, generateListingContent, listDesigns, updateDesign, uploadDesignImage, uploadStandaloneImages, logFailingRequest } from "../api/client";
import { PREMIUM_LOCK_MESSAGE } from "../lib/subscriptionAccess";
import { clearCachedDesignImages } from "../utils/imageCache";
import CachedThumbnail from "./CachedThumbnail";
import ColorDropdown from "./ColorDropdown";
import CopyrightRiskModal from "./CopyrightRiskModal";
import Icon from "./Icon";
import { LoadingButton, ProgressLoader, SavingOverlay } from "./LoadingComponents";
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
  TEEPUBLIC_TOGGLE_ONLY_PRODUCTS,
  canonicalizeSettings,
  getDefaultColorSettings,
  getDefaultProductSettings,
} from "../config/teepublicOptions";
import { getColorCategory } from "../config/teepublicColorHex";
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

const TABS = ["Info", "Colors", "Products"];
const ACCEPTED_REPLACEMENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPTED_REPLACEMENT_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

function isAcceptedReplacementImage(file) {
  return Boolean(file && (ACCEPTED_REPLACEMENT_TYPES.has(file.type) || ACCEPTED_REPLACEMENT_EXTENSIONS.test(file.name || "")));
}

function makeTempDraftId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `temp_${crypto.randomUUID()}`;
  }
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

function mergeColorSettings(saved) {
  const defaults = getDefaultColorSettings();
  const canonical = canonicalizeSettings(saved);
  return { ...defaults, ...canonical };
}

function mergeProductSettings(saved) {
  const defaults = getDefaultProductSettings();
  const canonical = canonicalizeSettings(saved);
  return { ...defaults, ...canonical };
}

export default function TeePublicEditor({
  designs,
  activeIndex: activeIndexProp,
  onActiveIndexChange,
  onDesignsChange,
  onBack,
  uploadedImages,
  userId = "",
  isWorkspaceLocked = false,
  onLockedAction,
}) {
  const [activeTab, setActiveTab] = useState("Info");
  const [colorPreference, setColorPreference] = useState("all");
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [pasteMenuOpen, setPasteMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingAllIndex, setGeneratingAllIndex] = useState(0);
  const [generatingAllTotal, setGeneratingAllTotal] = useState(0);
  const [generatingAllError, setGeneratingAllError] = useState("");
  const stopGeneratingAllRef = useRef(false);
  const [showBatchProgressModal, setShowBatchProgressModal] = useState(false);
  const [batchItems, setBatchItems] = useState([]);

  const [pendingReplacementFile, setPendingReplacementFile] = useState(null);
  const [replacementPreviewUrl, setReplacementPreviewUrl] = useState("");
  const [isPreviewCleared, setIsPreviewCleared] = useState(false);
  const [imageReplacementError, setImageReplacementError] = useState("");
  const replacementInputRef = useRef(null);
  const localDraftPreviewUrlsRef = useRef(new Set());

  function handleLockedAction() {
    showToast(PREMIUM_LOCK_MESSAGE, "error");
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
  const replacementPreviewUrlRef = useRef("");
  const [trademarkMenuOpen, setTrademarkMenuOpen] = useState(false);
  const [trademarkModalOpen, setTrademarkModalOpen] = useState(false);
  const [trademarkLoading, setTrademarkLoading] = useState(false);
  const [trademarkError, setTrademarkError] = useState("");
  const [trademarkResults, setTrademarkResults] = useState([]);
  const [trademarkPhrase, setTrademarkPhrase] = useState("");
  const [riskModalOpen, setRiskModalOpen] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [riskResult, setRiskResult] = useState(null);

  const visibleDesigns = useMemo(() => [...(designs || [])], [designs]);
  const [activeDesignId, setActiveDesignId] = useState(() => visibleDesigns[activeIndexProp]?.id || visibleDesigns[0]?.id || "");
  const activeDesignIndex = visibleDesigns.findIndex((item) => item.id === activeDesignId);
  const activeIndex = activeDesignIndex >= 0
    ? activeDesignIndex
    : Math.max(0, Math.min(activeIndexProp || 0, visibleDesigns.length - 1));
  const design = visibleDesigns[activeIndex] || visibleDesigns[0];
  const designId = design?.id;

  // Local editable state for current design
  const [form, setForm] = useState(() => buildForm(design));

  useEffect(() => {
    if (visibleDesigns.length === 0) {
      setActiveDesignId("");
      return;
    }
    if (activeDesignId && visibleDesigns.some((item) => item.id === activeDesignId)) return;
    const fallbackIndex = Math.max(0, Math.min(activeIndexProp || 0, visibleDesigns.length - 1));
    const fallback = visibleDesigns[fallbackIndex] || visibleDesigns[visibleDesigns.length - 1];
    if (fallback?.id) {
      setActiveDesignId(fallback.id);
      onActiveIndexChange(fallbackIndex);
    }
  }, [activeDesignId, activeIndexProp, onActiveIndexChange, visibleDesigns]);

  useEffect(() => () => {
    if (replacementPreviewUrlRef.current) {
      URL.revokeObjectURL(replacementPreviewUrlRef.current);
    }
    localDraftPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    localDraftPreviewUrlsRef.current.clear();
  }, []);

  function getLocalDraftPreviewUrl(item) {
    return item?.imagePreviewUrl || item?.previewUrl || "";
  }

  function getLocalDraftFile(item) {
    return item?.imageFile || item?.file || null;
  }

  function revokeLocalDraftPreview(item) {
    const previewUrl = getLocalDraftPreviewUrl(item);
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
    const activeD = designs[activeIndex];
    if (activeD && isLocalId(activeD.id)) {
      revokeLocalDraftPreview(activeD);
      onDesignsChange((current) => current.map((item) => (
        item.id === activeD.id
          ? { ...item, imageFile: null, imagePreviewUrl: "", file: null, previewUrl: "", image_url: "", thumbnail_url: "" }
          : item
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
    if (!requireUnlocked()) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAcceptedReplacementImage(file)) {
      setImageReplacementError("Choose a PNG, JPG, JPEG, or WEBP image.");
      return;
    }
    const activeD = designs[activeIndex];
    if (activeD && isLocalId(activeD.id)) {
      const pUrl = URL.createObjectURL(file);
      localDraftPreviewUrlsRef.current.add(pUrl);
      revokeLocalDraftPreview(activeD);
      setPendingReplacementFile(file);
      setReplacementPreviewUrl("");
      replacementPreviewUrlRef.current = "";
      setIsPreviewCleared(false);
      setImageReplacementError("");
      onDesignsChange((current) => current.map((item) => (
        item.id === activeD.id
          ? { ...item, imageFile: file, imagePreviewUrl: pUrl, file, previewUrl: pUrl, filename: file.name }
          : item
      )));
      return;
    }

    setPendingReplacementFile(file);
    replacePreviewUrl(URL.createObjectURL(file));
    setIsPreviewCleared(false);
    setImageReplacementError("");
  }

  useEffect(() => {
    const next = buildForm(designs[activeIndex]);
    setForm(next);
    setAiResult(null);
    setAiError("");
    setGeneratingAllError("");
    setAiMenuOpen(false);
    setTrademarkMenuOpen(false);

    const activeD = designs[activeIndex];
    if (activeD && isLocalId(activeD.id)) {
      setPendingReplacementFile(getLocalDraftFile(activeD));
      replacePreviewUrl("");
      setIsPreviewCleared(false);
      setImageReplacementError("");
    } else {
      resetImageReplacementState();
    }

    if (designs[activeIndex]?.id) {
      console.log("[PodPilot] loaded color_settings from backend:", designs[activeIndex].color_settings || {});
      console.log("[PodPilot] loaded product_settings from backend:", designs[activeIndex].product_settings || {});
      console.log("[PodPilot] form after load:", { color_settings: next.color_settings, product_settings: next.product_settings });
    }
  }, [activeIndex, designId]);

  function buildForm(d) {
    if (!d) return { title: "", description: "", primary_tag: "", supporting_tags: "", adult_content: false, color_settings: getDefaultColorSettings(), product_settings: getDefaultProductSettings() };
    return {
      title: d.title || "",
      description: d.description || "",
      primary_tag: d.primary_tag || d.main_tag || "",
      supporting_tags: typeof d.supporting_tags === "string" ? d.supporting_tags : (d.supporting_tags || []).join(", "),
      adult_content: Boolean(d.adult_content),
      color_settings: mergeColorSettings(d.color_settings),
      product_settings: mergeProductSettings(d.product_settings),
    };
  }

  function updateForm(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function mergeFormIntoDesign(item, sourceForm = form) {
    if (!item) return item;
    return {
      ...item,
      title: sourceForm.title,
      description: sourceForm.description,
      primary_tag: sourceForm.primary_tag,
      main_tag: sourceForm.primary_tag,
      supporting_tags: sourceForm.supporting_tags,
      adult_content: sourceForm.adult_content,
      color_settings: sourceForm.color_settings,
      product_settings: sourceForm.product_settings,
    };
  }

  function persistActiveForm() {
    const activeId = design?.id;
    if (!activeId) return;
    onDesignsChange((current) => current.map((item, index) => (
      item.id === activeId || (!item.id && index === activeIndex) ? mergeFormIntoDesign(item) : item
    )));
  }

  function updateColor(product, color) {
    setForm((f) => ({
      ...f,
      color_settings: { ...f.color_settings, [product]: color },
    }));
  }

  function toggleProduct(product) {
    setForm((f) => ({
      ...f,
      product_settings: { ...f.product_settings, [product]: !f.product_settings[product] },
    }));
  }

  // Filter colors by preference
  function getFilteredColors(product) {
    const all = TEEPUBLIC_COLORS[product] || [];
    if (colorPreference === "all") return all;
    return all.filter((c) => {
      const cat = getColorCategory(c);
      if (colorPreference === "light") return cat === "light" || cat === "medium";
      if (colorPreference === "dark") return cat === "dark" || cat === "medium";
      return true;
    });
  }

  // Image for current design
  const currentImage = useMemo(() => {
    if (isPreviewCleared) return null;
    if (!design) return null;
    if (isLocalId(design.id)) {
      return getLocalDraftPreviewUrl(design) || design.thumbnail_url || design.image_url || null;
    }
    if (replacementPreviewUrl) return replacementPreviewUrl;
    if (design.thumbnail_url) return design.thumbnail_url;
    if (design.image_url) return design.image_url;
    const match = (uploadedImages || []).find((img) => {
      const n = (img.name || "").toLowerCase();
      const f = (design.filename || "").toLowerCase();
      return n === f || n.replace(/\.[^.]+$/, "") === f.replace(/\.[^.]+$/, "");
    });
    return match?.imageUrl || match?.previewUrl || null;
  }, [design, uploadedImages, replacementPreviewUrl, isPreviewCleared]);

  // ── Copy/Paste ──────────────────────────────────────────────────────────
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

  async function handleAiGenerate() {
    if (!requireUnlocked()) return;
    if (!design?.id || isAiGenerating) return;
    setAiMenuOpen(false);
    setCopyMenuOpen(false);
    setPasteMenuOpen(false);
    setAiError("");
    setAiResult(null);
    setIsAiGenerating(true);

    const requestDesignId = design.id;

    try {
      const result = await generateListingContent(design.id, "teepublic", {
        filename: design.filename || "",
        title: form.title,
        description: form.description,
        primary_tag: form.primary_tag,
        supporting_tags: form.supporting_tags,
      });

      if (design?.id !== requestDesignId) {
        showToast("AI result ignored because the selected design changed.", "warning");
        return;
      }

      const normalized = normalizeAiListingResult(result);
      if (normalized) {
        setForm((current) => ({
          ...current,
          title: normalized.title || current.title,
          description: normalized.description || current.description,
          primary_tag: normalized.main_tag || current.primary_tag,
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

  function applyAiResult() {
    // No-op
  }

  function closeAiModal() {
    if (isAiGenerating) return;
    setAiResult(null);
    setAiError("");
  }

  async function handleRetryDesignEdit(item) {
    if (!requireUnlocked()) return;
    
    setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'generating', error: '' } : x));
    
    const isActiveDesign = item.id === design?.id;
    const currentMetadata = isActiveDesign
      ? {
          filename: item.filename || "",
          title: form.title,
          description: form.description,
          primary_tag: form.primary_tag,
          supporting_tags: form.supporting_tags,
        }
      : {
          filename: item.filename || "",
          title: item.title || "",
          description: item.description || "",
          primary_tag: item.primary_tag || item.main_tag || "",
          supporting_tags: typeof item.supporting_tags === "string" ? item.supporting_tags : (item.supporting_tags || []).join(", "),
        };
        
    try {
      const result = await generateListingContent(item.id, "teepublic", currentMetadata);
      const patch = {
        title: result.title || currentMetadata.title,
        description: result.description || currentMetadata.description,
        primary_tag: result.main_tag || currentMetadata.primary_tag,
        main_tag: result.main_tag || currentMetadata.primary_tag,
        supporting_tags: result.supporting_tags || currentMetadata.supporting_tags,
      };

      const nextDesigns = designs.map((designItem) => (designItem.id === item.id ? { ...designItem, ...patch } : designItem));
      onDesignsChange(nextDesigns);

      if (isActiveDesign) {
        setForm((current) => ({
          ...current,
          title: patch.title,
          description: patch.description,
          primary_tag: patch.primary_tag,
          supporting_tags: patch.supporting_tags,
        }));
        setActiveTab("Info");
      }
      
      setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'success' } : x));
    } catch (error) {
      const detail = error.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : error.message || "AI generation failed.";
      setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'failed', error: msg } : x));
    }
  }

  async function handleGenerateForAllEdit() {
    if (!requireUnlocked()) return;
    const batch = designs.filter((item) => item?.id);
    if (batch.length < 2 || isGeneratingAll) return;
    const total = batch.length;

    setAiMenuOpen(false);
    setCopyMenuOpen(false);
    setPasteMenuOpen(false);
    setAiError("");
    setAiResult(null);
    setIsGeneratingAll(true);
    setShowBatchProgressModal(true);
    setGeneratingAllIndex(0);
    setGeneratingAllTotal(total);
    setGeneratingAllError("");
    stopGeneratingAllRef.current = false;

    // Initialize batchItems
    const initialItems = batch.map(item => ({
      id: item.id,
      name: item.title || item.filename || "Unnamed Design",
      status: 'pending',
      error: '',
      item: item
    }));
    setBatchItems(initialItems);

    let successCount = 0;
    let failedCount = 0;
    let nextDesigns = designs;

    for (let i = 0; i < total; i++) {
      if (stopGeneratingAllRef.current) {
        setBatchItems(current => current.map(x => x.status === 'pending' ? { ...x, status: 'failed', error: 'Canceled by user.' } : x));
        break;
      }

      const item = batch[i];
      setGeneratingAllIndex(i + 1);
      setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'generating' } : x));

      const isActiveDesign = item.id === design?.id;
      const currentMetadata = isActiveDesign
        ? {
            filename: item.filename || "",
            title: form.title,
            description: form.description,
            primary_tag: form.primary_tag,
            supporting_tags: form.supporting_tags,
          }
        : {
            filename: item.filename || "",
            title: item.title || "",
            description: item.description || "",
            primary_tag: item.primary_tag || item.main_tag || "",
            supporting_tags: typeof item.supporting_tags === "string" ? item.supporting_tags : (item.supporting_tags || []).join(", "),
          };

      try {
        const result = await generateListingContent(item.id, "teepublic", currentMetadata);
        const patch = {
          title: result.title || currentMetadata.title,
          description: result.description || currentMetadata.description,
          primary_tag: result.main_tag || currentMetadata.primary_tag,
          main_tag: result.main_tag || currentMetadata.primary_tag,
          supporting_tags: result.supporting_tags || currentMetadata.supporting_tags,
        };

        nextDesigns = nextDesigns.map((designItem) => (designItem.id === item.id ? { ...designItem, ...patch } : designItem));
        onDesignsChange(nextDesigns);

        if (isActiveDesign) {
          setForm((current) => ({
            ...current,
            title: patch.title,
            description: patch.description,
            primary_tag: patch.primary_tag,
            supporting_tags: patch.supporting_tags,
          }));
          setActiveTab("Info");
        }
        setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'success' } : x));
        successCount++;
      } catch (error) {
        failedCount++;
        const detail = error.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : error.message || "AI generation failed.";
        setBatchItems(current => current.map(x => x.id === item.id ? { ...x, status: 'failed', error: msg } : x));
      }
    }

    setIsGeneratingAll(false);
    if (failedCount === 0) {
      setShowBatchProgressModal(false);
      showToast(`Generated ${successCount} of ${total} listings successfully.`);
    } else {
      setGeneratingAllError(`Generated ${successCount} of ${total} listings successfully. ${failedCount} failed.`);
    }
  }

  function handleCopy(type) {
    setAiMenuOpen(false);
    setCopyMenuOpen(false);
    // Use the LIVE form state (not stale design prop) and canonicalize keys
    // so the clipboard always holds the current UI values in canonical form.
    const liveDesign = {
      ...design,
      ...form,
      color_settings: canonicalizeSettings(form.color_settings),
      product_settings: canonicalizeSettings(form.product_settings),
    };
    let clip;
    if (type === "all") clip = copyAllConfig(liveDesign);
    else if (type === "colors") clip = copyColorsOnly(liveDesign);
    else if (type === "products") clip = copyProductsOnly(liveDesign);
    else if (type === "adult_content") clip = copyAdultContentOnly(liveDesign);

    console.log("[PodPilot] Copied:", { type, data: clip?.data });
    showToast(`Copied: ${type === "all" ? "All Config" : type === "colors" ? "Colors" : type === "products" ? "Products" : "Adult Content"}`);
  }

  async function handlePaste(target) {
    if (!requireUnlocked()) return;
    setAiMenuOpen(false);
    setPasteMenuOpen(false);
    const clip = getClipboard();
    if (!clip) { showToast("Nothing copied yet.", "error"); return; }
    if (clip.marketplace !== "teepublic") { showToast("Clipboard is not TeePublic config.", "error"); return; }

    // Canonicalize clipboard data on its way out so saves never accumulate
    // mixed key formats.
    const canonicalData = {};
    if (clip.data?.color_settings !== undefined) canonicalData.color_settings = canonicalizeSettings(clip.data.color_settings);
    if (clip.data?.product_settings !== undefined) canonicalData.product_settings = canonicalizeSettings(clip.data.product_settings);
    if (clip.data?.adult_content !== undefined) canonicalData.adult_content = clip.data.adult_content;

    console.log("[PodPilot] Paste:", { target, clipType: clip.type, canonicalData });

    setSaving(true);

    try {
      if (target === "current") {
        // Apply to current design form
        const patched = applyClipboardToDesign(form, { ...clip, data: canonicalData });
        const newForm = { ...form, ...patched };
        setForm(newForm);

        // Persist to backend immediately
        if (design?.id) {
          const patch = { ...canonicalData };
          console.log("[PodPilot] Paste current - saving to backend:", { design_id: design.id, patch });
          const updated = await updateDesign(design.id, patch);
          console.log("[PodPilot] Paste current - backend response:", updated);

          // Update parent state
          const next = [...designs];
          next[activeIndex] = { ...next[activeIndex], ...updated };
          onDesignsChange(next);
        }

        showToast(`Pasted ${getClipboardLabel(clip)} to current design.`);

      } else if (target === "all") {
        // Apply to all designs
        const updatedDesigns = designs.map((d) => applyClipboardToDesign(d, { ...clip, data: canonicalData }));

        // Update current form too
        const patched = applyClipboardToDesign(form, { ...clip, data: canonicalData });
        setForm({ ...form, ...patched });
        // Build patches for backend
        const patches = updatedDesigns.map((d) => ({ id: d.id, ...canonicalData }));

        console.log("[PodPilot] Paste all - saving to backend:", { count: patches.length, samplePatch: patches[0] });
        const result = await batchUpdateDesigns(patches);
        console.log("[PodPilot] Paste all - backend response:", result);

        // Update parent state with backend-confirmed data, or refetch as fallback
        if (result?.designs && result.designs.length > 0) {
          onDesignsChange(result.designs);
        } else {
          const refreshed = await listDesigns("teepublic");
          if (refreshed?.designs) {
            onDesignsChange(refreshed.designs);
          } else {
            onDesignsChange(updatedDesigns);
          }
        }

        showToast(`Pasted ${getClipboardLabel(clip)} to all ${designs.length} designs.`);
      }
    } catch (err) {
      console.error("[PodPilot] Paste failed:", err);
      showToast(err?.response?.data?.detail || err.message || "Paste failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSaveCurrent() {
    if (!requireUnlocked()) return;
    if (!design?.id) return;
    setSaving(true);
    setSaveProgress(null);
    try {
      const colorSettings = canonicalizeSettings(form.color_settings);
      const productSettings = canonicalizeSettings(form.product_settings);
      const patch = {
        title: form.title,
        description: form.description,
        primary_tag: form.primary_tag,
        supporting_tags: form.supporting_tags,
        adult_content: form.adult_content,
        color_settings: colorSettings,
        product_settings: productSettings,
      };
      console.log("[PodPilot] saving current design payload:", { design_id: design.id, patch });
      let imageUpdate = null;
      let updated = null;

      if (isLocalId(design.id)) {
        const fileToUpload = pendingReplacementFile || getLocalDraftFile(design);
        let savedKey = undefined;
        if (fileToUpload) {
          setSaveProgress({
            percent: 0,
            loadedBytes: 0,
            totalBytes: fileToUpload.size,
            currentFileName: fileToUpload.name,
            status: "Uploading"
          });
          const uploadResp = await uploadStandaloneImages([fileToUpload], "teepublic", (progressEvent) => {
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

        updated = await createDesign({
          filename: fileToUpload ? fileToUpload.name : design.filename,
          marketplace: "teepublic",
          title: patch.title.trim(),
          description: patch.description.trim(),
          primary_tag: patch.primary_tag.trim(),
          supporting_tags: patch.supporting_tags.trim(),
          adult_content: patch.adult_content,
          image_r2_key: savedKey,
          color_settings: patch.color_settings,
          product_settings: patch.product_settings,
        });
        setSaveProgress(current => current ? { ...current, percent: 100, status: "Completed" } : null);
      } else {
        if (pendingReplacementFile) {
          await clearCachedDesignImages(design, userId);
          setSaveProgress({
            percent: 0,
            loadedBytes: 0,
            totalBytes: pendingReplacementFile.size,
            currentFileName: pendingReplacementFile.name,
            status: "Uploading"
          });
          imageUpdate = await uploadDesignImage(design.id, pendingReplacementFile, (progressEvent) => {
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
        } else {
          setSaveProgress({
            percent: 30,
            loadedBytes: 0,
            totalBytes: 0,
            currentFileName: "",
            status: "Processing"
          });
        }
        updated = await updateDesign(design.id, patch);
        setSaveProgress(current => current ? { ...current, percent: 100, status: "Completed" } : null);
      }
      console.log("[PodPilot] save current response:", updated);
      console.log("[PodPilot] saved color_settings:", updated?.color_settings);
      console.log("[PodPilot] saved product_settings:", updated?.product_settings);

      // Verify the backend actually persisted both settings columns. If
      // the migration hasn't been run yet, the backend silently drops them
      // and the API returns the old data — surface that so the user knows.
      if (!updated?.color_settings || !updated?.product_settings) {
        console.warn(
          "[PodPilot] Backend response is missing color_settings or product_settings — " +
          "run docs/migration_color_product_settings.sql in Supabase if you haven't yet."
        );
        showToast(
          "Saved title/tags, but color_settings/product_settings columns are missing — run the Supabase migration.",
          "error",
        );
      } else {
        showToast("Design saved.");
      }

      // Update parent state with the fresh DB row so a re-edit doesn't
      // clobber what just persisted.
      const savedDesign = { ...(designs[activeIndex] || {}), ...(imageUpdate || {}), ...updated };
      if (isLocalId(design.id)) {
        revokeLocalDraftPreview(design);
        onDesignsChange((current) => [savedDesign, ...current.filter((item) => item.id !== design.id && item.id !== savedDesign.id)]);
        onActiveIndexChange(0);
      } else {
        onDesignsChange((current) => current.map((item) => (item.id === design.id ? savedDesign : item)));
      }
      // Rebuild the form from the just-saved row so anything the backend
      // normalised (e.g., trimmed whitespace) is reflected.
      setForm(buildForm(savedDesign));
      resetImageReplacementState();
    } catch (err) {
      logFailingRequest(err);
      console.error("[PodPilot] save current error:", err);
      const detail = err.response?.data?.detail;
      const status = err.response?.status;
      let finalMessage = typeof detail === "string" ? detail : err.message || "Save failed.";
      if (finalMessage.includes("Authentication service is temporarily unavailable") && status !== 503) {
        finalMessage = err.message || "Save failed.";
      }
      showToast(finalMessage, "error");
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  }

  async function handleSaveAll() {
    if (!requireUnlocked()) return;
    setSaving(true);
    setSaveProgress(null);
    try {
      let nextDesigns = designs.map((item, index) => (
        index === activeIndex ? mergeFormIntoDesign(item) : item
      ));
      const localDraftsToRevoke = nextDesigns.filter((item) => isLocalId(item.id));
      const createdFromLocalDrafts = [];
      const activeStartedAsLocalDraft = Boolean(nextDesigns[activeIndex] && isLocalId(nextDesigns[activeIndex].id));

      // 1. Process all local drafts first
      const localDraftIndices = nextDesigns
        .map((d, index) => ({ id: d.id, index }))
        .filter((item) => isLocalId(item.id));

      if (localDraftIndices.length > 0) {
        setSaveProgress({
          percent: 10,
          loadedBytes: 0,
          totalBytes: 0,
          currentFileName: "Preparing drafts...",
          status: "Uploading"
        });

        for (let i = 0; i < localDraftIndices.length; i++) {
          const { id, index } = localDraftIndices[i];
          const item = nextDesigns[index];

          // Determine the correct field values (from local form if active, else from stored design object)
          const isCurrentActive = index === activeIndex;
          const activeTitle = isCurrentActive ? form.title : item.title;
          const activeDesc = isCurrentActive ? form.description : item.description;
          const activeTag = isCurrentActive ? form.primary_tag : (item.primary_tag || item.main_tag);
          const activeSupp = isCurrentActive ? form.supporting_tags : (typeof item.supporting_tags === "string" ? item.supporting_tags : (item.supporting_tags || []).join(", "));
          const activeAdult = isCurrentActive ? form.adult_content : Boolean(item.adult_content);
          const activeColors = canonicalizeSettings(isCurrentActive ? form.color_settings : item.color_settings);
          const activeProducts = canonicalizeSettings(isCurrentActive ? form.product_settings : item.product_settings);

          // Determine the file to upload
          const fileToUpload = isCurrentActive ? (pendingReplacementFile || getLocalDraftFile(item)) : getLocalDraftFile(item);
          let savedKey = undefined;

          if (fileToUpload) {
            setSaveProgress({
              percent: 10 + Math.round((i / localDraftIndices.length) * 50),
              loadedBytes: 0,
              totalBytes: fileToUpload.size,
              currentFileName: fileToUpload.name,
              status: "Uploading"
            });
            const uploadResp = await uploadStandaloneImages([fileToUpload], "teepublic");
            const saved = Array.isArray(uploadResp?.files) ? uploadResp.files[0] : {};
            savedKey = saved?.image_r2_key;
          }

          setSaveProgress({
            percent: 15 + Math.round((i / localDraftIndices.length) * 50),
            loadedBytes: 0,
            totalBytes: 0,
            currentFileName: fileToUpload ? fileToUpload.name : "Creating draft...",
            status: "Processing"
          });

          const created = await createDesign({
            filename: fileToUpload ? fileToUpload.name : item.filename,
            marketplace: "teepublic",
            title: activeTitle.trim(),
            description: activeDesc.trim(),
            primary_tag: activeTag.trim(),
            supporting_tags: activeSupp.trim(),
            adult_content: activeAdult,
            image_r2_key: savedKey,
            color_settings: activeColors,
            product_settings: activeProducts,
          });

          nextDesigns[index] = created;
          createdFromLocalDrafts.push(created);
        }
      }

      // 2. Process all pre-existing backend designs
      const backendIndices = nextDesigns
        .map((d, index) => ({ id: d.id, index }))
        .filter((item) => !isLocalId(item.id));

      let imageUpdate = null;
      // Handle active design image replacement if it was a pre-existing backend design
      const activeDesign = nextDesigns[activeIndex];
      if (activeDesign && !activeStartedAsLocalDraft && !isLocalId(activeDesign.id) && pendingReplacementFile) {
        await clearCachedDesignImages(activeDesign, userId);
        setSaveProgress({
          percent: 70,
          loadedBytes: 0,
          totalBytes: pendingReplacementFile.size,
          currentFileName: pendingReplacementFile.name,
          status: "Uploading"
        });
        imageUpdate = await uploadDesignImage(activeDesign.id, pendingReplacementFile, (progressEvent) => {
          const percent = pendingReplacementFile.size > 0 ? 70 + Math.min(Math.round((progressEvent.loaded / pendingReplacementFile.size) * 15), 15) : 70;
          setSaveProgress({
            percent,
            loadedBytes: progressEvent.loaded,
            totalBytes: pendingReplacementFile.size,
            currentFileName: pendingReplacementFile.name,
            status: "Uploading"
          });
        });
      }

      if (backendIndices.length > 0) {
        setSaveProgress({
          percent: 85,
          loadedBytes: 0,
          totalBytes: 0,
          currentFileName: "Saving changes...",
          status: "Processing"
        });

        const patches = nextDesigns
          .filter((d) => !isLocalId(d.id))
          .map((d, index) => {
            const originalIndex = nextDesigns.findIndex((item) => item.id === d.id);
            if (originalIndex === activeIndex) {
              return {
                id: d.id,
                title: form.title,
                description: form.description,
                primary_tag: form.primary_tag,
                supporting_tags: form.supporting_tags,
                adult_content: form.adult_content,
                color_settings: canonicalizeSettings(form.color_settings),
                product_settings: canonicalizeSettings(form.product_settings),
              };
            }
            return {
              id: d.id,
              title: d.title,
              description: d.description,
              primary_tag: d.primary_tag || d.main_tag,
              supporting_tags: typeof d.supporting_tags === "string" ? d.supporting_tags : (d.supporting_tags || []).join(", "),
              adult_content: Boolean(d.adult_content),
              color_settings: canonicalizeSettings(d.color_settings),
              product_settings: canonicalizeSettings(d.product_settings),
            };
          });

        const result = await batchUpdateDesigns(patches);
        if (result?.designs) {
          // Merge batch results back into nextDesigns
          nextDesigns = nextDesigns.map((d) => {
            const match = result.designs.find((r) => r.id === d.id);
            if (match) {
              return match.id === activeDesign?.id && imageUpdate ? { ...match, ...imageUpdate } : match;
            }
            return d;
          });
        }
      }

      setSaveProgress({
        percent: 100,
        loadedBytes: 0,
        totalBytes: 0,
        currentFileName: "",
        status: "Completed"
      });

      const createdIds = new Set(createdFromLocalDrafts.map((item) => item.id).filter(Boolean));
      const orderedDesigns = createdFromLocalDrafts.length > 0
        ? [...createdFromLocalDrafts, ...nextDesigns.filter((item) => !createdIds.has(item.id))]
        : nextDesigns;
      onDesignsChange(orderedDesigns);
      localDraftsToRevoke.forEach(revokeLocalDraftPreview);
      // Re-sync form for the active design
      const refreshedActive = orderedDesigns.find((item) => item.id === activeDesign?.id) || orderedDesigns[activeIndex];
      if (refreshedActive) setForm(buildForm(refreshedActive));
      resetImageReplacementState();
      showToast(`Saved ${designs.length} designs.`);
    } catch (err) {
      logFailingRequest(err);
      console.error("[PodPilot] save all error:", err);
      const detail = err.response?.data?.detail;
      const status = err.response?.status;
      let finalMessage = typeof detail === "string" ? detail : err.message || "Save failed.";
      if (finalMessage.includes("Authentication service is temporarily unavailable") && status !== 503) {
        finalMessage = err.message || "Save failed.";
      }
      showToast(finalMessage, "error");
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  }

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function buildTrademarkPayload(item, overrideForm = null) {
    const source = overrideForm || item || {};
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

  function closeRiskModal() {
    if (riskLoading) return;
    setRiskModalOpen(false);
  }

    async function handleRiskCheck() {
    if (!requireUnlocked()) return;
    if (!design?.id || riskLoading) return;
    setAiMenuOpen(false);
    setCopyMenuOpen(false);
    setPasteMenuOpen(false);
    setTrademarkMenuOpen(false);
    setRiskError("");
    setRiskResult(null);
    setRiskLoading(true);

    try {
      const imageBase64 = pendingReplacementFile ? await fileToDataUrl(pendingReplacementFile) : "";
      const result = await checkCopyrightRisk({
        platform: "teepublic",
        design_id: design.id,
        title: form.title || "",
        description: form.description || "",
        main_tag: form.primary_tag || "",
        primary_tag: form.primary_tag || "",
        supporting_tags: String(form.supporting_tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        detected_trademark_terms: trademarkHitTerms().map((hit) => hit.term),
        image_r2_key: design.image_r2_key || "",
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

    async function runTrademarkChecks(items) {
    if (trademarkLoading) return;
    setTrademarkMenuOpen(false);
    setAiMenuOpen(false);
    setCopyMenuOpen(false);
    setPasteMenuOpen(false);
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
    if (!requireUnlocked()) return;
    runTrademarkChecks([{
      label: form.title || design?.title || design?.filename || "Current design",
      payload: buildTrademarkPayload(design, form),
    }]);
  }

  function handleTrademarkAll() {
    if (!requireUnlocked()) return;
    runTrademarkChecks((designs || []).filter(Boolean).map((item, index) => ({
      label: index === activeIndex ? (form.title || item.title || item.filename) : (item.title || item.filename || "Design"),
      payload: buildTrademarkPayload(item, index === activeIndex ? form : null),
    })));
  }

  function handleBack() {
    const hasLocalDrafts = designs.some((d) => isLocalId(d.id));
    if (hasLocalDrafts) {
      const ok = window.confirm("You have unsaved designs. Leave without saving?");
      if (!ok) return;
      designs.filter((d) => isLocalId(d.id)).forEach(revokeLocalDraftPreview);
      onDesignsChange(designs.filter((d) => !isLocalId(d.id)));
    }
    resetImageReplacementState();
    setAiMenuOpen(false);
    setTrademarkMenuOpen(false);
    setIsGeneratingAll(false);
    setGeneratingAllError("");
    onBack();
  }

  function handleAddLocalDesignDraft() {
    const newId = makeTempDraftId();
    const newDesign = {
      id: newId,
      filename: "",
      marketplace: "teepublic",
      title: "",
      description: "",
      primary_tag: "",
      supporting_tags: "",
      adult_content: false,
      color_settings: getDefaultColorSettings(),
      product_settings: getDefaultProductSettings(),
      image_r2_key: "",
      thumbnail_url: "",
      image_url: "",
      imageFile: null,
      imagePreviewUrl: "",
      file: null, 
      previewUrl: "",
    };
    const activeId = design?.id;
    onDesignsChange((current) => [
      newDesign,
      ...current.map((item, index) => (
        item.id === activeId || (!item.id && index === activeIndex) ? mergeFormIntoDesign(item) : item
      )),
    ]);
    setActiveDesignId(newId);
    onActiveIndexChange(0);
  }

  function switchToIndex(nextIndex) {
    if (nextIndex < 0 || nextIndex >= visibleDesigns.length || nextIndex === activeIndex) return;
    const target = visibleDesigns[nextIndex];
    if (!target?.id) return;
    persistActiveForm();
    setActiveDesignId(target.id);
    onActiveIndexChange(nextIndex);
  }

  // ── Navigation ──────────────────────────────────────────────────────────
  function goNext() {
    switchToIndex(activeIndex + 1);
  }
  function goPrev() {
    switchToIndex(activeIndex - 1);
  }

  // ── Trademark check ─────────────────────────────────────────────────────
  // Disabled for now — trademark checker will be restored later when a
  // reliable provider is wired up. Backend endpoints stay in place; only
  // the UI integration is removed.

  // ── Navigation ──────────────────────────────────────────────────────────
  function goNext() {
    switchToIndex(activeIndex + 1);
  }
  function goPrev() {
    switchToIndex(activeIndex - 1);
  }

  // ── Trademark check ─────────────────────────────────────────────────────
  // Disabled for now — trademark checker will be restored later when a
  // reliable provider is wired up. Backend endpoints stay in place; only
  // the UI integration is removed.

  if (!design) {
    return <div className="tp-editor-empty">No designs loaded.</div>;
  }

  return (
    <section className="tp-editor">
      {/* Toast */}
      {toast && (
        <div className={`tp-toast tp-toast-${toast.type}`}>{toast.msg}</div>
      )}

      {/* Toolbar */}
      <div className="tp-toolbar">
        <button type="button" className="tp-btn-back" onClick={handleBack}>
          <Icon name="chevronLeft" /> Back to Designs
        </button>
        <button type="button" className="tp-btn-back" onClick={handleAddLocalDesignDraft} style={{ marginLeft: "10px", padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: "6px" }} aria-label="Add design" title="Add design">
          <Icon name="upload" />
        </button>

        <div className="tp-toolbar-right">
          <button type="button" className="tp-nav-btn" onClick={goPrev} disabled={activeIndex <= 0}>‹</button>
          <div className="tp-dots">
            {visibleDesigns.map((item, i) => (
              <span key={item.id} className={`tp-dot${item.id === activeDesignId ? " active" : ""}`} onClick={() => switchToIndex(i)} />
            ))}
          </div>
          <button type="button" className="tp-nav-btn" onClick={goNext} disabled={activeIndex >= visibleDesigns.length - 1}>›</button>

          {visibleDesigns.length > 1 ? (
                                    <div className="tp-dropdown-wrap tp-ai-generate-menu">
              <button
                type="button"
                className="tp-toolbar-btn ai-generate-button pp-stabilized-btn pp-ai-listing-btn"
                onClick={() => { setAiMenuOpen(!aiMenuOpen); setCopyMenuOpen(false); setPasteMenuOpen(false); setTrademarkMenuOpen(false); }}
                disabled={isAiGenerating || isGeneratingAll}
                aria-haspopup="menu"
                aria-expanded={aiMenuOpen}
              >
                {isAiGenerating || isGeneratingAll ? (
                  <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
                ) : (
                  <Icon name="sparkles" />
                )}
                <span>{isAiGenerating || isGeneratingAll ? "Generating..." : "AI Listing"}</span>
                <Icon name="chevronDown" />
              </button>
              {aiMenuOpen && (
                <div className="tp-dropdown-menu tp-ai-generate-dropdown" role="menu">
                  <button type="button" onClick={handleAiGenerate} role="menuitem">
                    <Icon name="sparkles" />
                    <span>Generate current design</span>
                  </button>
                  <button type="button" onClick={handleGenerateForAllEdit} role="menuitem">
                    <Icon name="sparkles" />
                    <span>Generate for all designs</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
                                    <button type="button" className="tp-toolbar-btn ai-generate-button pp-stabilized-btn pp-ai-listing-btn" onClick={handleAiGenerate} disabled={isAiGenerating || isGeneratingAll}>
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
            className="tp-toolbar-btn ai-generate-button pp-stabilized-btn pp-ai-check-btn"
            onClick={handleRiskCheck}
            disabled={riskLoading || !design?.id}
          >
            {riskLoading ? (
              <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
            ) : (
              <BotMessageSquare size={20} />
            )}
            <span>{riskLoading ? "Checking..." : "AI Check"}</span>
          </button>

          {/* Copy dropdown */}
          <div className="tp-dropdown-wrap">
            <button type="button" className="tp-toolbar-btn" onClick={() => { setCopyMenuOpen(!copyMenuOpen); setPasteMenuOpen(false); setAiMenuOpen(false); setTrademarkMenuOpen(false); }}>
              <Icon name="copy" /> Copy <Icon name="chevronDown" />
            </button>
            {copyMenuOpen && (
              <div className="tp-dropdown-menu">
                <button type="button" onClick={() => handleCopy("all")}>Copy All Config</button>
                <button type="button" onClick={() => handleCopy("colors")}>Copy Colors Only</button>
                <button type="button" onClick={() => handleCopy("products")}>Copy Products Only</button>
                <button type="button" onClick={() => handleCopy("adult_content")}>Copy Adult Content Only</button>
              </div>
            )}
          </div>

          {/* Paste dropdown */}
          <div className="tp-dropdown-wrap">
            <button type="button" className="tp-toolbar-btn" onClick={() => { setPasteMenuOpen(!pasteMenuOpen); setCopyMenuOpen(false); setAiMenuOpen(false); setTrademarkMenuOpen(false); }} disabled={!hasClipboard()}>
              <Icon name="file" /> Paste <Icon name="chevronDown" />
            </button>
            {pasteMenuOpen && (
              <div className="tp-dropdown-menu">
                <button type="button" onClick={() => handlePaste("current")}>Paste to Current Design</button>
                <button type="button" onClick={() => handlePaste("all")}>Paste to All Designs</button>
              </div>
            )}
          </div>

                              <div className="tp-dropdown-wrap">
            <button
              type="button"
              className={`tp-toolbar-btn pp-stabilized-btn pp-trademark-btn${trademarkResults.some((r) => (r.matches || []).length > 0) ? " tp-toolbar-btn-danger" : ""}`}
              onClick={() => {
                setTrademarkMenuOpen(!trademarkMenuOpen);
                setCopyMenuOpen(false);
                setPasteMenuOpen(false);
                setAiMenuOpen(false);
              }}
              disabled={trademarkLoading}
              aria-haspopup="menu"
              aria-expanded={trademarkMenuOpen}
            >
              {trademarkLoading ? (
                <span className="pp-spinner pp-spinner-sm pp-spinner-on-button" />
              ) : (
                <IconShieldSearch size={20} stroke={2} />
              )}
              <span>{trademarkLoading ? "Checking..." : "Check Trademark"}</span>
              <Icon name="chevronDown" />
            </button>
            {trademarkMenuOpen && (
              <div className="tp-dropdown-menu" role="menu">
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

                        {null}

      {showBatchProgressModal && createPortal(
        <div className="pp-modal-overlay ai-listing-overlay">
          <div className="pp-modal ai-listing-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: "550px" }}>
            <div className="ai-listing-modal-head">
              <span className="ai-listing-icon"><Icon name="robot" /></span>
              <div>
                <h3>Generating listings...</h3>
                <p>PodPilot is generating AI listing metadata for all designs in this edit batch.</p>
              </div>
            </div>

            {isGeneratingAll && (
              <div className="ai-listing-loading" style={{ margin: "1rem 0" }}>
                <ProgressLoader
                  title="Generating listings..."
                  subtitle={`Design ${generatingAllIndex} of ${generatingAllTotal}`}
                  value={generatingAllTotal > 0 ? (generatingAllIndex / generatingAllTotal) * 100 : undefined}
                  steps={["Reading batch", "Generating metadata", "Saving drafts", "Finishing"]}
                />
              </div>
            )}

            {generatingAllError && (
              <div className="ai-listing-error" role="alert" style={{ margin: "1rem 0" }}>
                {generatingAllError}
              </div>
            )}

            <div className="ai-listing-batch-list" style={{ maxHeight: "250px", overflowY: "auto", margin: "1rem 0", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px", padding: "0.5rem" }}>
              {batchItems.map((item, index) => (
                <div key={item.id} className="ai-listing-batch-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem", borderBottom: index < batchItems.length - 1 ? "1px solid var(--border-color, #f1f5f9)" : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column", maxWidth: "70%" }}>
                    <span style={{ fontSize: "14px", fontWeight: "500", color: "var(--text-primary, #1e293b)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.name}
                    </span>
                    {item.error && (
                      <span style={{ fontSize: "12px", color: "var(--danger-color, #ef4444)", marginTop: "2px" }}>
                        {item.error}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {item.status === 'pending' && <span style={{ fontSize: "12px", color: "var(--text-secondary, #64748b)" }}>Pending</span>}
                    {item.status === 'generating' && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span className="pp-spinner" style={{ width: "12px", height: "12px", borderWidth: "2px" }} />
                        <span style={{ fontSize: "12px", color: "var(--primary-color, #6366f1)" }}>Generating...</span>
                      </div>
                    )}
                    {item.status === 'success' && <span style={{ fontSize: "12px", color: "var(--success-color, #10b981)", fontWeight: "bold" }}>✓ Done</span>}
                    {item.status === 'failed' && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "12px", color: "var(--danger-color, #ef4444)", fontWeight: "bold" }}>✗ Failed</span>
                        <button
                          type="button"
                          className="primary-button text-button"
                          style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
                          onClick={() => handleRetryDesignEdit(item)}
                          disabled={isGeneratingAll || isAiGenerating}
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pp-modal-actions ai-listing-actions">
              {isGeneratingAll && (
                <button type="button" className="secondary-button" onClick={() => { stopGeneratingAllRef.current = true; }}>
                  Stop
                </button>
              )}
              {!isGeneratingAll && (
                <button type="button" className="primary-button" onClick={() => { setShowBatchProgressModal(false); setGeneratingAllError(""); setBatchItems([]); }}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Main content */}
      <div className="tp-editor-body">
        {/* Left: image preview */}
        <div className="tp-preview">
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            Design Configuration
            <span className="image-quality-info-tooltip-container">
              <Info className="image-quality-info-icon" size={16} />
              <span className="image-quality-info-tooltip-text">
                Fast preview only. Upload uses your original image quality.
              </span>
            </span>
          </h2>
          <input
            ref={replacementInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="design-replacement-input"
            onChange={handleReplacementFileChange}
          />
          {currentImage ? (
            <div className={`design-preview-frame${pendingReplacementFile ? " design-preview-pending" : ""}`}>
              <CachedThumbnail
                design={design}
                userId={userId}
                cacheVariant="preview"
                cacheR2Key={design?.image_r2_key}
                src={currentImage}
                alt={design.filename}
                className="tp-preview-img"
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
              <small>PNG, JPG, or WEBP</small>
            </button>
          )}
          {imageReplacementError && <small className="design-image-error">{imageReplacementError}</small>}
        </div>

        {/* Right: tabs */}
        <div className="tp-settings">
          <div className="tp-tab-bar">
            {TABS.map((tab) => (
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

          <div className="tp-tab-content">
            {activeTab === "Info" && (
              <div className="tp-info-tab">
                <label className="tp-field">
                  <span>Design Title</span>
                  <input value={form.title} onChange={(e) => updateForm("title", e.target.value)} />
                  <TrademarkHits value={form.title} />
                </label>
                <label className="tp-field">
                  <span>Description</span>
                  <textarea rows={3} value={form.description} onChange={(e) => updateForm("description", e.target.value)} />
                  <TrademarkHits value={form.description} />
                </label>
                <label className="tp-field">
                  <span>Primary Tag</span>
                  <input value={form.primary_tag} onChange={(e) => updateForm("primary_tag", e.target.value)} />
                  <TrademarkHits value={form.primary_tag} />
                </label>
                <label className="tp-field">
                  <span>Supporting Tags</span>
                  <input value={form.supporting_tags} onChange={(e) => updateForm("supporting_tags", e.target.value)} placeholder="tag1, tag2, tag3" />
                  <TrademarkHits value={form.supporting_tags} />
                </label>
                <div className="tp-field">
                  <span>Does this design contain Mature Content?</span>
                  <div className="tp-radio-group">
                    <label><input type="radio" name="adult" checked={form.adult_content === true} onChange={() => updateForm("adult_content", true)} /> Yes</label>
                    <label><input type="radio" name="adult" checked={form.adult_content === false} onChange={() => updateForm("adult_content", false)} /> No</label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Colors" && (
              <div className="tp-colors-tab">
                <div className="tp-color-pref">
                  <strong>Color Preference</strong>
                  <div className="tp-radio-group">
                    <label><input type="radio" name="colorPref" checked={colorPreference === "light"} onChange={() => setColorPreference("light")} /> Light Colors</label>
                    <label><input type="radio" name="colorPref" checked={colorPreference === "dark"} onChange={() => setColorPreference("dark")} /> Dark Colors</label>
                    <label><input type="radio" name="colorPref" checked={colorPreference === "all"} onChange={() => setColorPreference("all")} /> All Colors</label>
                  </div>
                </div>
                <div className="tp-color-grid">
                  {TEEPUBLIC_COLOR_PRODUCTS.map((product) => {
                    const filtered = getFilteredColors(product);
                    const current = form.color_settings[product] || TEEPUBLIC_DEFAULT_COLORS[product] || filtered[0] || "";
                    return (
                      <ColorDropdown
                        key={product}
                        label={TEEPUBLIC_PRODUCTS[product]}
                        colors={filtered}
                        value={current}
                        onChange={(color) => updateColor(product, color)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === "Products" && (
              <div className="tp-products-tab">
                <div className="tp-product-grid">
                  {TEEPUBLIC_ALL_PRODUCT_KEYS.map((key) => (
                    <div key={key} className="tp-product-card">
                      <span>{TEEPUBLIC_PRODUCTS[key]}</span>
                      <label className="tp-toggle">
                        <input
                          type="checkbox"
                          checked={form.product_settings[key] !== false}
                          onChange={() => toggleProduct(key)}
                        />
                        <span className="tp-toggle-slider" />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="tp-editor-footer">
        <button type="button" className="tp-btn-secondary" onClick={handleBack} disabled={saving}>Cancel</button>
        <LoadingButton
          type="button"
          className="tp-btn-primary"
          onClick={handleSaveCurrent}
          loading={saving}
          loadingText="Saving..."
        >
          Save Current Design
        </LoadingButton>
        <LoadingButton
          type="button"
          className="tp-btn-primary"
          onClick={handleSaveAll}
          loading={saving}
          loadingText="Saving all..."
        >
          Save All Designs
        </LoadingButton>
      </div>
      <SavingOverlay show={saving} message="Saving TeePublic designs..." progress={saveProgress} />
    </section>
  );
}

// Trademark check UI was removed for now — backend service in
// app/services/trademark_service.py is preserved for later restoration.


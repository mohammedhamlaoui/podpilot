styles_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\frontend\src\components\TeePublicDesignManager.jsx"

with open(styles_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's locate the segment to replace.
# The bad segment starts with:
bad_start = """  function toggleCreateImage(image) {
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

  async function saveDesign(event) {"""

# And ends with:
bad_end = """    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });"""

# Let's find where bad_start begins and bad_end ends.
start_idx = content.find("function toggleCreateImage(image) {")
# We want the second or first toggleCreateImage? The duplicate starts around position 17079 (which is the first one).
# Let's print index of occurrences
print("Index of toggleCreateImage:", content.find("function toggleCreateImage(image) {"))
print("Index of saveCreatedDesigns:", content.find("async function saveCreatedDesigns(event) {"))

# Let's perform an exact replacement of the entire duplicated block.
# We will match the entire block from the first "toggleCreateImage(image)" to "console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });"
# Let's see what is inside this block.
# We can find the exact text in inspected_segment.txt and use it!

# Let's construct the complete bad block:
bad_block = """  function toggleCreateImage(image) {
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

  async function saveDesign(event) {
    event.preventDefault();
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
        onDesignsChange([...designs, created]);
      } else {
        const updated = await updateDesign(editingId, {
          title: form.title.trim(),
          description: form.description.trim(),
          primary_tag: form.primary_tag.trim(),
          supporting_tags: form.supporting_tags.trim(),
          adult_content: String(form.adult_content || "").trim().toLowerCase() === "yes",
        });
        onDesignsChange(designs.map((design) => (design.id === editingId ? { ...design, ...updated } : design)));
      }
      cancelEdit();
    } catch (saveError) {
      const detail = saveError.response?.data?.detail;
      setCreateError(typeof detail === "string" ? detail : saveError.message || "Could not save design.");
    }
  }

  function getCreateImageById(imageId) {
    # Look first in this session's just-uploaded images, then fall back to
    # the parent's uploadedImages list. This way the Create flow works even
    # if the parent doesn't track session uploads.
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

  function moveCreateIndex(direction) {
    setActiveCreateIndex((currentIndex) => {
      if (createImageIds.length === 0) return 0;
      return (currentIndex + direction + createImageIds.length) % createImageIds.length;
    });
  }

  async function saveCreatedDesigns(event) {
    event.preventDefault();
    if (isSavingCreated) return;

    if (createImageIds.length === 0) {
      setCreateError("Choose at least one image.");
      return;
    }

    setCreateError("");
    setIsSavingCreated(true);
    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });"""

# The good replacement:
good_block = """  function toggleCreateImage(image) {
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

  function moveCreateIndex(direction) {
    setActiveCreateIndex((currentIndex) => {
      if (createImageIds.length === 0) return 0;
      return (currentIndex + direction + createImageIds.length) % createImageIds.length;
    });
  }

  async function saveCreatedDesigns(event) {
    event.preventDefault();
    if (isSavingCreated) return;

    if (createImageIds.length === 0) {
      setCreateError("Choose at least one image.");
      return;
    }

    setCreateError("");
    setIsSavingCreated(true);
    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });"""

# Support comment hash representation mismatch in bad_block (getCreateImageById had a python comment instead of JS comment in block representation)
bad_block = bad_block.replace('# Look first', '// Look first')

if bad_block in content:
    content = content.replace(bad_block, good_block)
    print("Deduplicated successfully.")
else:
    bad_norm = bad_block.replace('\n', '\r\n')
    good_norm = good_block.replace('\n', '\r\n')
    if bad_norm in content:
        content = content.replace(bad_norm, good_norm)
        print("Deduplicated successfully (CRLF).")
    else:
        print("Could not match bad block. Let's do positional replacement.")
        # Find start and end indices
        s_idx = content.find("function toggleCreateImage(image) {")
        e_idx = content.find('console.log("[PodPilot] creating designs (Save All)"')
        # We need the end index to be after e_idx, containing the line
        e_idx = content.find('\n', e_idx) + 1
        print(f"Positional replacement from {s_idx} to {e_idx}")
        content = content[:s_idx] + good_block + content[e_idx:]
        print("Positional replacement complete.")

with open(styles_path, 'w', encoding='utf-8') as f:
    f.write(content)

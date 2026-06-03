      if (createImageIds.length === 0) return 0;
      return (currentIndex + direction + createImageIds.length) % createImageIds.length;
    });
  }

  async function saveCreatedDesigns(event) {
    event.preventDefault();

    if (createImageIds.length === 0) {
      setCreateError("Choose at least one image.");
      return;
    }

    setCreateError("");
    console.log("[PodPilot] creating designs (Save All)", { count: createImageIds.length, marketplace: "teepublic" });

    try {
      // 1. Collect raw File objects that need uploading to R2.
      const filesToUpload = [];
      for (const imageId of createImageIds) {
        const image = getCreateImageById(imageId);
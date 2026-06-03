export function createImagePreviewDataUrl(file, options = {}) {
  const maxSize = options.maxSize || 420;
  const quality = options.quality || 0.78;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = width;
      canvas.height = height;

      if (!context) {
        URL.revokeObjectURL(objectUrl);
        resolve(objectUrl);
        return;
      }

      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      URL.revokeObjectURL(objectUrl);

      try {
        resolve(canvas.toDataURL("image/webp", quality));
      } catch {
        resolve(canvas.toDataURL("image/png"));
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    };

    image.src = objectUrl;
  });
}

"""Service to generate and cache compressed design preview images for AI listing content."""
import io
import time
import logging
from typing import Any

from PIL import Image

from app.services import r2_service, supabase_service

logger = logging.getLogger("podpilot.image_preview")


def generate_preview_bytes(image_bytes: bytes, max_side: int = 1024) -> tuple[bytes, str, str]:
    """
    Take original image bytes, resize the longest side to max_side (e.g. 1024px)
    preserving aspect ratio. Do not upscale smaller images.
    
    Save in WebP format with quality 80 and preserve the alpha/transparency.
    If WebP is not supported or fails, fall back to JPEG on a neutral white background.
    Strips EXIF/metadata.
    
    Returns a tuple: (preview_bytes, extension, mime_type)
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
            if width > max_side or height > max_side:
                aspect_ratio = height / width
                if width > height:
                    new_width = max_side
                    new_height = int(max_side * aspect_ratio)
                else:
                    new_height = max_side
                    new_width = int(max_side / aspect_ratio)
                img_resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            else:
                img_resized = img.copy()

            # WebP format generation
            try:
                out_io = io.BytesIO()
                if img_resized.mode in ("RGBA", "LA") or (img_resized.mode == "P" and "transparency" in img_resized.info):
                    working = img_resized
                else:
                    working = img_resized.convert("RGB")
                
                working.save(out_io, format="WEBP", quality=80)
                return out_io.getvalue(), "webp", "image/webp"
            except Exception as webp_err:
                logger.warning("WebP save failed, trying JPEG fallback: %s", webp_err)
                
                out_io = io.BytesIO()
                if img_resized.mode in ("RGBA", "LA") or (img_resized.mode == "P" and "transparency" in img_resized.info):
                    # JPEG has no alpha support, merge onto a solid white background
                    bg = Image.new("RGB", img_resized.size, (255, 255, 255))
                    if img_resized.mode != "RGBA":
                        rgba_img = img_resized.convert("RGBA")
                    else:
                        rgba_img = img_resized
                    bg.paste(rgba_img, (0, 0), rgba_img)
                    working = bg
                else:
                    working = img_resized.convert("RGB")

                working.save(out_io, format="JPEG", quality=80)
                return out_io.getvalue(), "jpeg", "image/jpeg"
    except Exception as exc:
        raise ValueError(f"Could not process image: {exc}") from exc


async def ensure_ai_preview_for_design(user_id: str, design: dict[str, Any]) -> tuple[str, str, bool]:
    """
    Lazily ensure that a compressed preview image exists for the design.
    If it exists, return the signed URL.
    If not, download original from R2, compress, upload as preview, cache in DB, and return signed URL.
    
    Returns (signed_url, image_source, generated_now)
    where image_source is 'ai_preview' or 'original_fallback'
    """
    design_id = design.get("id")
    image_key = design.get("image_r2_key")
    preview_key = design.get("ai_preview_r2_key")
    marketplace = design.get("marketplace") or "redbubble"
    
    # 1. Return signed URL if preview already exists
    if preview_key:
        try:
            url = r2_service.signed_get_url(preview_key)
            return url, "ai_preview", False
        except Exception as e:
            logger.error("Failed to sign existing preview key %s: %s", preview_key, e)

    # 2. If no original image, fallback directly
    if not image_key:
        return "", "original_fallback", False

    start_time = time.perf_counter()
    try:
        # Download original design image
        logger.info("Lazy preview generation: downloading original R2 key: %s", image_key)
        original_bytes = r2_service.get_object_bytes(image_key)
        
        # Compress and format
        preview_bytes, ext, mime_type = generate_preview_bytes(original_bytes)
        
        # Upload preview separately to R2
        target_preview_key = f"users/{user_id}/previews/{design_id}.{ext}"
        logger.info("Uploading compressed preview to key: %s (%d bytes)", target_preview_key, len(preview_bytes))
        r2_service.upload_bytes(target_preview_key, preview_bytes, content_type=mime_type)
        
        # Save key to database if column is supported
        if supabase_service._probe_ai_preview_column():
            logger.info("Saving ai_preview_r2_key to Supabase designs table for design_id=%s", design_id)
            supabase_service.update_design(
                design_id=design_id,
                user_id=user_id,
                patch={"ai_preview_r2_key": target_preview_key}
            )
            
        url = r2_service.signed_get_url(target_preview_key)
        generation_ms = int((time.perf_counter() - start_time) * 1000)
        logger.info("[AI TIMING] preview_generation_ms=%d image_source=ai_preview", generation_ms)
        return url, "ai_preview", True
    except Exception as e:
        logger.exception("Failed to lazily generate preview for design %s: %s", design_id, e)
        # Bounding fallback to original image signed URL
        try:
            url = r2_service.signed_get_url(image_key)
            return url, "original_fallback", False
        except Exception as sign_err:
            logger.exception("Failed to sign original fallback key %s: %s", image_key, sign_err)
            return "", "original_fallback", False

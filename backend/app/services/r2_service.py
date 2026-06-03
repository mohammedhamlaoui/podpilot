"""Cloudflare R2 file storage.

R2 is S3-compatible — boto3 with a custom endpoint_url just works.
Path layout (every key is namespaced by user_id so two users never collide):

  users/{user_id}/{marketplace}/{design_id}/image.png
  users/{user_id}/imports/{import_id}/sheet.xlsx

The backend is the only place these credentials live. The frontend and the
Chrome extension never see R2_SECRET_ACCESS_KEY — they receive short-lived
signed URLs instead.
"""
from __future__ import annotations

import io
import mimetypes
import os
import warnings
from typing import BinaryIO, Optional
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image
from PIL import UnidentifiedImageError

from app.core.config import (
    R2_ACCESS_KEY_ID,
    R2_BUCKET_NAME,
    R2_ENDPOINT,
    R2_SECRET_ACCESS_KEY,
    R2_SIGNED_URL_TTL_SECONDS,
)


_client = boto3.client(
    "s3",
    endpoint_url=R2_ENDPOINT,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto",
    # SigV4 with the path-style addressing R2 expects.
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

MAX_IMAGE_PIXELS = 100_000_000
MAX_IMAGE_SIDE_PIXELS = 15_000
ALLOWED_IMAGE_FORMATS = {"PNG", "JPEG", "WEBP"}

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class R2Error(Exception):
    """Raised when an R2 operation fails. Wraps boto exceptions."""


class ImageValidationError(ValueError):
    """Raised when uploaded image bytes are invalid or unsafe to process."""


def validate_image_bytes(image_bytes: bytes) -> tuple[int, int, str]:
    """Validate image bytes before upload/thumbnail work.

    Returns (width, height, format) when the file is a safe PNG/JPEG/WEBP.
    """
    if not image_bytes:
        raise ImageValidationError("Image file is empty.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as img:
                img.verify()
            with Image.open(io.BytesIO(image_bytes)) as img:
                image_format = (img.format or "").upper()
                width, height = img.size
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageValidationError("Image dimensions are too large.")
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ImageValidationError("Invalid or corrupt image file.") from error

    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ImageValidationError("Only PNG, JPG, JPEG, or WEBP images are supported.")
    if width <= 0 or height <= 0:
        raise ImageValidationError("Invalid image dimensions.")
    if width > MAX_IMAGE_SIDE_PIXELS or height > MAX_IMAGE_SIDE_PIXELS:
        raise ImageValidationError("Image dimensions are too large.")
    if width * height > MAX_IMAGE_PIXELS:
        raise ImageValidationError("Image dimensions are too large.")

    return width, height, image_format


def _safe_filename(name: str) -> str:
    base = (name or "file").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = base.replace("\0", "").strip() or "file"
    return base


def design_image_key(user_id: str, marketplace: str, design_id: str, filename: str) -> str:
    """Canonical R2 key for a design image."""
    safe_name = _safe_filename(filename)
    return f"users/{user_id}/{marketplace}/{design_id}/{safe_name}"


def design_thumbnail_key(user_id: str, marketplace: str, design_id: str, filename: str) -> str:
    """Canonical R2 key for a design image thumbnail."""
    safe_name = _safe_filename(filename)
    base_name, _ = os.path.splitext(safe_name)
    return f"users/{user_id}/{marketplace}/{design_id}/thumbnails/{base_name}.webp"


def generate_thumbnail_bytes(image_bytes: bytes, max_width: int = 300) -> bytes:
    """Generate a thumbnail image (around 300px wide) from original image bytes.
    Preserves aspect ratio, optimized, webp format.
    """
    validate_image_bytes(image_bytes)
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            # Preserve transparency for PNGs / conversions
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                working = img.copy()
            else:
                working = img.convert("RGB")

            width, height = working.size
            if width <= max_width:
                out_io = io.BytesIO()
                working.save(out_io, format="WEBP", quality=80, method=6)
                return out_io.getvalue()

            aspect_ratio = height / width
            new_width = max_width
            new_height = int(max_width * aspect_ratio)

            img_resized = working.resize((new_width, new_height), Image.Resampling.LANCZOS)
            out_io = io.BytesIO()
            img_resized.save(out_io, format="WEBP", quality=80, method=6)
            return out_io.getvalue()
    except ImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ImageValidationError("Invalid or corrupt image file.") from error


def import_excel_key(user_id: str, import_id: str, filename: str) -> str:
    """Canonical R2 key for an imported Excel sheet."""
    safe_name = _safe_filename(filename)
    return f"users/{user_id}/imports/{import_id}/{safe_name}"


def new_design_id() -> str:
    return uuid4().hex


def new_import_id() -> str:
    return uuid4().hex


def upload_bytes(
    key: str,
    data: bytes,
    content_type: Optional[str] = None,
) -> str:
    """Upload raw bytes to R2 under `key`. Returns the key on success."""
    if content_type is None:
        guess, _ = mimetypes.guess_type(key)
        content_type = guess or "application/octet-stream"
    try:
        _client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 upload failed for {key}: {error}") from error
    return key


def upload_fileobj(
    key: str,
    fileobj: BinaryIO,
    content_type: Optional[str] = None,
) -> str:
    if content_type is None:
        guess, _ = mimetypes.guess_type(key)
        content_type = guess or "application/octet-stream"
    extra_args = {"ContentType": content_type}
    try:
        _client.upload_fileobj(
            Fileobj=fileobj,
            Bucket=R2_BUCKET_NAME,
            Key=key,
            ExtraArgs=extra_args,
        )
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 upload failed for {key}: {error}") from error
    return key


def signed_get_url(key: str, ttl_seconds: Optional[int] = None) -> str:
    """Return a short-lived presigned GET URL for `key`.

    The extension uses these to download images without ever seeing R2
    credentials. The TTL defaults to R2_SIGNED_URL_TTL_SECONDS (1 hour).
    """
    ttl = ttl_seconds if ttl_seconds is not None else R2_SIGNED_URL_TTL_SECONDS
    try:
        return _client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET_NAME, "Key": key},
            ExpiresIn=ttl,
        )
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 sign failed for {key}: {error}") from error


def get_object_bytes(key: str) -> bytes:
    """Download raw bytes of an object from R2."""
    try:
        response = _client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return response["Body"].read()
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 get failed for {key}: {error}") from error


def delete_object(key: str) -> bool:
    """Delete an object from R2. Returns True if the object existed and was
    deleted, False if it didn't exist (R2 returns 204 either way, so we
    check with head_object first).
    """
    # Check if the object actually exists before deleting.
    try:
        _client.head_object(Bucket=R2_BUCKET_NAME, Key=key)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            return False  # Object doesn't exist — nothing to delete.
        # Other errors (permissions, network) — raise.
        raise R2Error(f"R2 head check failed for {key}: {error}") from error

    # Object exists — delete it.
    try:
        _client.delete_object(Bucket=R2_BUCKET_NAME, Key=key)
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 delete failed for {key}: {error}") from error
    return True


def list_objects(prefix: str) -> list[str]:
    """List all object keys in R2 under the given prefix, handling pagination."""
    keys = []
    continuation_token = None
    try:
        while True:
            params = {
                "Bucket": R2_BUCKET_NAME,
                "Prefix": prefix,
            }
            if continuation_token:
                params["ContinuationToken"] = continuation_token
            
            response = _client.list_objects_v2(**params)
            
            contents = response.get("Contents", [])
            for obj in contents:
                key = obj.get("Key")
                if key:
                    keys.append(key)
            
            if not response.get("IsTruncated"):
                break
                
            continuation_token = response.get("NextContinuationToken")
    except (BotoCoreError, ClientError) as error:
        raise R2Error(f"R2 list failed under {prefix}: {error}") from error
    return keys


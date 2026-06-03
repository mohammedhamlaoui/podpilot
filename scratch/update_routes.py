routes_path = r"c:\Users\dynast\Desktop\chofi bntk\my project autmation\backend\app\api\routes.py"

with open(routes_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Edit 1: Top imports
bad_imports = """from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional"""

good_imports = """from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("podpilot.routes")"""

if bad_imports in content:
    content = content.replace(bad_imports, good_imports)
    print("Edit 1: Imports updated.")
else:
    bad_imports_crlf = bad_imports.replace('\n', '\r\n')
    good_imports_crlf = good_imports.replace('\n', '\r\n')
    if bad_imports_crlf in content:
        content = content.replace(bad_imports_crlf, good_imports_crlf)
        print("Edit 1: Imports updated (CRLF).")

# Edit 2: _design_with_signed_url helper
bad_signing = """def _design_with_signed_url(row: dict) -> dict:
    image_key = row.get("image_r2_key")
    signed_url = None
    if image_key:
        try:
            signed_url = r2_service.signed_get_url(image_key)
        except r2_service.R2Error:
            signed_url = None
    return design_to_response(row, image_signed_url=signed_url)"""

good_signing = """def _design_with_signed_url(row: dict) -> dict:
    image_key = row.get("image_r2_key")
    signed_url = None
    if image_key:
        try:
            signed_url = r2_service.signed_get_url(image_key)
        except r2_service.R2Error:
            signed_url = None

    thumbnail_key = row.get("thumbnail_r2_key")
    thumbnail_signed = None
    if thumbnail_key:
        try:
            thumbnail_signed = r2_service.signed_get_url(thumbnail_key)
        except r2_service.R2Error:
            thumbnail_signed = None

    return design_to_response(
        row,
        image_signed_url=signed_url,
        thumbnail_signed_url=thumbnail_signed,
    )"""

if bad_signing in content:
    content = content.replace(bad_signing, good_signing)
    print("Edit 2: URL signing helper updated.")
else:
    bad_signing_crlf = bad_signing.replace('\n', '\r\n')
    good_signing_crlf = good_signing.replace('\n', '\r\n')
    if bad_signing_crlf in content:
        content = content.replace(bad_signing_crlf, good_signing_crlf)
        print("Edit 2: URL signing helper updated (CRLF).")

# Edit 3: /designs/import (Excel one-shot import)
bad_import = """        if match is not None:
            blob, ext, content_type = match
            image_key = r2_service.design_image_key(
                user_id=user.id,
                marketplace=marketplace,
                design_id=slot_id,
                filename=raw["filename"] or f"image{ext}",
            )
            pending_uploads.append((image_key, blob, content_type or "image/png"))
            row["image_r2_key"] = image_key

        rows.append(row)"""

good_import = """        if match is not None:
            blob, ext, content_type = match
            image_key = r2_service.design_image_key(
                user_id=user.id,
                marketplace=marketplace,
                design_id=slot_id,
                filename=raw["filename"] or f"image{ext}",
            )
            pending_uploads.append((image_key, blob, content_type or "image/png"))
            row["image_r2_key"] = image_key

            # Generate and upload thumbnail
            try:
                thumbnail_key = r2_service.design_thumbnail_key(
                    user_id=user.id,
                    marketplace=marketplace,
                    design_id=slot_id,
                    filename=raw["filename"] or f"image{ext}",
                )
                thumbnail_blob = r2_service.generate_thumbnail_bytes(blob)
                pending_uploads.append((thumbnail_key, thumbnail_blob, "image/webp"))
                row["thumbnail_r2_key"] = thumbnail_key
            except Exception as thumbnail_err:
                logger.warning(
                    "Failed to generate thumbnail for import user_id=%s design_filename=%s: %s",
                    user.id, raw["filename"], thumbnail_err
                )

        rows.append(row)"""

if bad_import in content:
    content = content.replace(bad_import, good_import)
    print("Edit 3: Excel import route updated.")
else:
    bad_import_crlf = bad_import.replace('\n', '\r\n')
    good_import_crlf = good_import.replace('\n', '\r\n')
    if bad_import_crlf in content:
        content = content.replace(bad_import_crlf, good_import_crlf)
        print("Edit 3: Excel import route updated (CRLF).")

# Edit 4: /designs/{design_id}/image (Single replacement upload)
bad_replacement = """    try:
        r2_service.upload_bytes(
            image_key,
            contents,
            content_type=file.content_type or None,
        )
    except r2_service.R2Error as error:
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {error}") from error

    updated = supabase_service.update_design(
        design_id, user.id, {"image_r2_key": image_key}
    )"""

good_replacement = """    thumbnail_key = r2_service.design_thumbnail_key(
        user_id=user.id,
        marketplace=design.get("marketplace") or "redbubble",
        design_id=str(design_id),
        filename=file.filename or "image.png",
    )
    try:
        r2_service.upload_bytes(
            image_key,
            contents,
            content_type=file.content_type or None,
        )
    except r2_service.R2Error as error:
        raise HTTPException(status_code=502, detail=f"R2 upload failed: {error}") from error

    # Generate and upload thumbnail
    try:
        thumbnail_bytes = r2_service.generate_thumbnail_bytes(contents)
        r2_service.upload_bytes(
            thumbnail_key,
            thumbnail_bytes,
            content_type="image/webp",
        )
    except Exception as error:
        logger.warning("Failed to generate or upload thumbnail for design %s: %s", design_id, error)
        thumbnail_key = None

    update_payload = {"image_r2_key": image_key}
    if thumbnail_key:
        update_payload["thumbnail_r2_key"] = thumbnail_key

    updated = supabase_service.update_design(
        design_id, user.id, update_payload
    )"""

if bad_replacement in content:
    content = content.replace(bad_replacement, good_replacement)
    print("Edit 4: Design image replacement route updated.")
else:
    bad_replacement_crlf = bad_replacement.replace('\n', '\r\n')
    good_replacement_crlf = good_replacement.replace('\n', '\r\n')
    if bad_replacement_crlf in content:
        content = content.replace(bad_replacement_crlf, good_replacement_crlf)
        print("Edit 4: Design image replacement route updated (CRLF).")

# Edit 5: /designs/import/images (Bulk standalone upload)
bad_bulk = """        try:
            r2_service.upload_bytes(
                image_key,
                contents,
                content_type=image.content_type or None,
            )
        except r2_service.R2Error as error:
            raise HTTPException(status_code=502, detail=f"R2 upload failed: {error}") from error

        results.append({
            "original_name": image.filename,
            "filename": image.filename,
            "image_r2_key": image_key,
            "image_url": r2_service.signed_get_url(image_key),
            "size": len(contents),
            "stored_name": _safe_name(image.filename or ""),
        })"""

good_bulk = """        thumbnail_key = r2_service.design_thumbnail_key(
            user_id=user.id,
            marketplace=marketplace,
            design_id=slot_id,
            filename=image.filename or f"image{extension}",
        )
        try:
            r2_service.upload_bytes(
                image_key,
                contents,
                content_type=image.content_type or None,
            )
        except r2_service.R2Error as error:
            raise HTTPException(status_code=502, detail=f"R2 upload failed: {error}") from error

        # Generate and upload thumbnail
        try:
            thumbnail_bytes = r2_service.generate_thumbnail_bytes(contents)
            r2_service.upload_bytes(
                thumbnail_key,
                thumbnail_bytes,
                content_type="image/webp",
            )
        except Exception as thumbnail_err:
            logger.warning(
                "Failed to generate thumbnail in bulk upload for filename=%s: %s",
                image.filename, thumbnail_err
            )
            thumbnail_key = None

        file_dict = {
            "original_name": image.filename,
            "filename": image.filename,
            "image_r2_key": image_key,
            "image_url": r2_service.signed_get_url(image_key),
            "size": len(contents),
            "stored_name": _safe_name(image.filename or ""),
        }
        if thumbnail_key:
            file_dict["thumbnail_r2_key"] = thumbnail_key
            try:
                file_dict["thumbnail_url"] = r2_service.signed_get_url(thumbnail_key)
            except Exception:
                file_dict["thumbnail_url"] = None
        else:
            file_dict["thumbnail_r2_key"] = None
            file_dict["thumbnail_url"] = None

        results.append(file_dict)"""

if bad_bulk in content:
    content = content.replace(bad_bulk, good_bulk)
    print("Edit 5: Standalone images bulk upload updated.")
else:
    bad_bulk_crlf = bad_bulk.replace('\n', '\r\n')
    good_bulk_crlf = good_bulk.replace('\n', '\r\n')
    if bad_bulk_crlf in content:
        content = content.replace(bad_bulk_crlf, good_bulk_crlf)
        print("Edit 5: Standalone images bulk upload updated (CRLF).")

with open(routes_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Exact routes rebuilding finished.")

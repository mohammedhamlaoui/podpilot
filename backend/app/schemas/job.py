"""Request/response schemas.

The Supabase `designs` table column is `primary_tag` (singular). The
legacy frontend code uses `main_tag` — we accept both on input and
mirror both on output for backwards compatibility.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


Marketplace = Literal["redbubble", "teepublic"]
DesignStatus = Literal["pending", "uploading", "uploaded", "failed"]


class DesignCreateIn(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    marketplace: Marketplace = "redbubble"
    title: str = ""
    description: str = ""
    primary_tag: str = ""
    supporting_tags: Union[str, list[str]] = ""
    copy_link: str = ""
    image_r2_key: Optional[str] = None
    thumbnail_r2_key: Optional[str] = None
    excel_r2_key: Optional[str] = None
    adult_content: Optional[bool] = None
    color_settings: Optional[dict[str, Any]] = None
    product_settings: Optional[dict[str, Any]] = None

    # Backwards-compat alias from the old React UI.
    main_tag: Optional[str] = None

    def to_db_row(self, user_id: str) -> dict[str, Any]:
        primary_tag = (self.primary_tag or self.main_tag or "").strip()
        row: dict[str, Any] = {
            "user_id": user_id,
            "marketplace": self.marketplace,
            "filename": self.filename.strip(),
            "title": self.title.strip(),
            "description": self.description.strip(),
            "primary_tag": primary_tag,
            "supporting_tags": self.supporting_tags,
            "copy_link": self.copy_link.strip(),
            "status": "pending",
        }
        if self.image_r2_key is not None:
            row["image_r2_key"] = self.image_r2_key
        if self.thumbnail_r2_key is not None:
            row["thumbnail_r2_key"] = self.thumbnail_r2_key
        if self.excel_r2_key is not None:
            row["excel_r2_key"] = self.excel_r2_key
        if self.adult_content is not None:
            row["adult_content"] = self.adult_content
        if self.color_settings is not None:
            row["color_settings"] = self.color_settings
        if self.product_settings is not None:
            row["product_settings"] = self.product_settings
        return row


class DesignUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    primary_tag: Optional[str] = None
    main_tag: Optional[str] = None
    supporting_tags: Union[str, list[str], None] = None
    copy_link: Optional[str] = None
    image_r2_key: Optional[str] = None
    thumbnail_r2_key: Optional[str] = None
    adult_content: Optional[bool] = None
    color_settings: Optional[dict[str, Any]] = None
    product_settings: Optional[dict[str, Any]] = None

    def to_patch(self) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        if self.title is not None:
            patch["title"] = self.title.strip()
        if self.description is not None:
            patch["description"] = self.description.strip()
        primary = self.primary_tag if self.primary_tag is not None else self.main_tag
        if primary is not None:
            patch["primary_tag"] = primary.strip()
        if self.supporting_tags is not None:
            patch["supporting_tags"] = self.supporting_tags
        if self.copy_link is not None:
            patch["copy_link"] = self.copy_link.strip()
        if self.image_r2_key is not None:
            patch["image_r2_key"] = self.image_r2_key
        if self.thumbnail_r2_key is not None:
            patch["thumbnail_r2_key"] = self.thumbnail_r2_key
        if self.adult_content is not None:
            patch["adult_content"] = self.adult_content
        if self.color_settings is not None:
            patch["color_settings"] = self.color_settings
        if self.product_settings is not None:
            patch["product_settings"] = self.product_settings
        return patch


class DesignStatusUpdateIn(BaseModel):
    """Status update from the Chrome extension after each upload step."""

    status: DesignStatus
    stage: Optional[str] = Field(default=None, max_length=64)
    error_message: Optional[str] = Field(default=None, max_length=4000)
    redbubble_work_id: Optional[str] = Field(default=None, max_length=64)
    updated_at: Optional[datetime] = None


class DesignsImportConfirmIn(BaseModel):
    """Persist parsed-Excel rows after the user reviews the preview."""

    marketplace: Marketplace = "redbubble"
    excel_r2_key: Optional[str] = None
    upload_job_id: Optional[str] = None
    designs: list[DesignCreateIn]


class UploadJobCreateIn(BaseModel):
    marketplace: Marketplace = "redbubble"
    total_designs: int = 0
    design_ids: list[str] = Field(default_factory=list)


class UploadJobUpdateIn(BaseModel):
    status: Optional[Literal["pending", "running", "completed", "failed"]] = None
    total_designs: Optional[int] = None
    uploaded_count: Optional[int] = None
    failed_count: Optional[int] = None

    def to_patch(self) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        if self.status is not None:
            patch["status"] = self.status
        if self.total_designs is not None:
            patch["total_designs"] = self.total_designs
        if self.uploaded_count is not None:
            patch["uploaded_count"] = self.uploaded_count
        if self.failed_count is not None:
            patch["failed_count"] = self.failed_count
        return patch


class UploadLogIn(BaseModel):
    design_id: Optional[str] = None
    job_id: Optional[str] = None
    level: Literal["info", "warn", "error"] = "info"
    message: str = ""


def design_to_response(
    row: dict[str, Any],
    image_url: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
) -> dict[str, Any]:
    """Shape a Supabase design row for the API response.

    Adds `id` as string, mirrors `primary_tag` to `main_tag` for the
    legacy frontend, joins the `supporting_tags` text[] back into a
    comma-separated string the React UI expects, and includes API-backed
    `image_url` and `thumbnail_url` values when supplied.
    """
    out = dict(row or {})
    if "id" in out and out["id"] is not None:
        out["id"] = str(out["id"])
    primary_tag = out.get("primary_tag") or ""
    out["primary_tag"] = primary_tag
    out["main_tag"] = primary_tag
    if isinstance(out.get("supporting_tags"), list):
        out["supporting_tags"] = ", ".join(str(t) for t in out["supporting_tags"] if t)
    if image_url is not None:
        out["image_url"] = image_url
    if thumbnail_url is not None:
        out["thumbnail_url"] = thumbnail_url
    else:
        out["thumbnail_url"] = None
    return out



# ── Trademark check ────────────────────────────────────────────────────────

class TrademarkCheckIn(BaseModel):
    """Free-form list of terms to look up against USPTO."""
    terms: list[str] = Field(default_factory=list)


class TrademarkBuildTermsIn(BaseModel):
    """Build the term list from one design's metadata, then check it.

    Use this from the frontend when you don't want to duplicate the
    'split text into useful search terms' logic on the client.
    """
    title: Optional[str] = ""
    primary_tag: Optional[str] = ""
    main_tag: Optional[str] = None  # legacy alias
    supporting_tags: Union[str, list[str], None] = ""
    description: Optional[str] = ""

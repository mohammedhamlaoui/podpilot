"""Excel parser for both Redbubble and TeePublic upload sheets.

Redbubble columns required:
    filename, title, description, main_tag, supporting_tags, copy_link

TeePublic columns required:
    filename, title, primary_tag, description, adult_content, supporting_tags

The parser auto-detects which marketplace the sheet came from by looking
at the column headers. Output rows are normalized to a single shape so
downstream code does not need to branch:
    {
        filename, title, description,
        main_tag,           # primary tag (both marketplaces)
        supporting_tags,
        copy_link,          # always present, "" for TeePublic
        adult_content,      # bool, defaults to False for Redbubble
        source_row,
    }
"""
from __future__ import annotations

from zipfile import BadZipFile
from io import BytesIO
from pathlib import Path
from typing import BinaryIO

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


REDBUBBLE_REQUIRED = (
    "filename",
    "title",
    "description",
    "main_tag",
    "supporting_tags",
    "copy_link",
)

TEEPUBLIC_REQUIRED = (
    "filename",
    "title",
    "primary_tag",
    "description",
    "adult_content",
    "supporting_tags",
)


class ExcelParserError(ValueError):
    pass


def _normalize_cell(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_truthy(value: str) -> bool:
    return value.strip().lower() in {"on", "yes", "true", "1", "enabled", "y"}


def _detect_schema(headers: list[str]) -> str:
    if all(col in headers for col in REDBUBBLE_REQUIRED):
        return "redbubble"
    if all(col in headers for col in TEEPUBLIC_REQUIRED):
        return "teepublic"
    redbubble_missing = [c for c in REDBUBBLE_REQUIRED if c not in headers]
    teepublic_missing = [c for c in TEEPUBLIC_REQUIRED if c not in headers]
    raise ExcelParserError(
        "The Excel headers don't match either marketplace template.\n"
        f"  Redbubble missing: {', '.join(redbubble_missing) or 'none'}\n"
        f"  TeePublic missing: {', '.join(teepublic_missing) or 'none'}"
    )


def _load_workbook(source: str | Path | bytes | BinaryIO):
    try:
        if isinstance(source, bytes):
            return load_workbook(BytesIO(source), read_only=True, data_only=True)
        return load_workbook(source, read_only=True, data_only=True)
    except (BadZipFile, InvalidFileException, OSError, ValueError) as error:
        raise ExcelParserError("Invalid .xlsx Excel file.") from error


def parse_excel_designs(source: str | Path | bytes | BinaryIO) -> list[dict]:
    workbook = _load_workbook(source)
    sheet = workbook.active

    header_values = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), ())
    headers = [_normalize_cell(value) for value in header_values]
    schema = _detect_schema(headers)

    column_indexes = {header: index for index, header in enumerate(headers) if header}

    designs: list[dict] = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        values = [_normalize_cell(value) for value in row]

        def cell(name: str, default: str = "") -> str:
            idx = column_indexes.get(name)
            if idx is None or idx >= len(values):
                return default
            return values[idx]

        if schema == "redbubble":
            design = {
                "filename": cell("filename"),
                "title": cell("title"),
                "description": cell("description"),
                "main_tag": cell("main_tag"),
                "supporting_tags": cell("supporting_tags"),
                "copy_link": cell("copy_link"),
                "adult_content": False,
                "source_row": row_number,
            }
        else:
            design = {
                "filename": cell("filename"),
                "title": cell("title"),
                "description": cell("description"),
                "main_tag": cell("primary_tag"),
                "supporting_tags": cell("supporting_tags"),
                "copy_link": "",
                "adult_content": _parse_truthy(cell("adult_content")),
                "source_row": row_number,
            }

        if not any(value for key, value in design.items() if key != "source_row"):
            continue
        designs.append(design)

    if not designs:
        raise ExcelParserError("The Excel file has the correct columns but no design rows.")

    return designs

"""Backend-only trademark lookup service using TMHunt.

TMHunt is queried only from the FastAPI backend. The browser never calls
TMHunt directly, and trademark results are informational only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import datetime
from typing import Any, Optional

import httpx


logger = logging.getLogger("podpilot.trademark")

TMHUNT_SEARCH_URL = "http://tmhunt.com/search.php"
TMHUNT_SOURCE_NAME = "TMHunt"
TMHUNT_CLASSIFICATION = "025"
TMHUNT_OFFICE = "US"
TMHUNT_TIMEOUT_SECONDS = 9.0
MAX_PHRASE_LENGTH = 120
MAX_TERMS_PER_CHECK = 30
CACHE_TTL_SECONDS = 30 * 60
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 90

_match_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_rate_window_started = time.monotonic()
_rate_window_count = 0
_rate_lock = asyncio.Lock()


_STOP_WORDS = {
    "a", "an", "the", "and", "or", "for", "with", "of", "in", "on", "to",
    "from", "by", "is", "are", "be", "this", "that", "it", "as", "at",
    "cute", "design", "designs", "sticker", "stickers", "shirt", "shirts",
    "tshirt", "tshirts", "t-shirt", "t-shirts", "tee", "tees", "gift",
    "gifts", "merch", "apparel", "art", "graphic", "graphics", "funny",
    "simple", "lover", "lovers", "love", "fan", "fans", "novelty",
    "vintage", "retro", "classic", "minimalist", "aesthetic", "themed",
    "style", "styled",
}

_BRAND_WHITELIST = {
    "nike", "adidas", "puma", "reebok", "vans", "converse",
    "disney", "pixar", "marvel", "dc",
    "pokemon", "pokémon", "nintendo", "xbox", "playstation", "sony",
    "starbucks", "coke", "pepsi", "coca", "cola",
    "apple", "google", "microsoft", "amazon", "facebook", "meta",
    "harley", "davidson", "ford", "chevy", "toyota", "honda", "tesla",
    "barbie", "lego", "hasbro", "mattel",
    "supreme", "gucci", "prada", "chanel", "louis", "vuitton",
    "rolex", "ferrari", "lamborghini", "porsche",
    "netflix", "youtube", "instagram", "tiktok", "twitter",
    "harry", "potter", "hogwarts",
}


class TrademarkLookupError(Exception):
    """Provider failure that should be surfaced as a clean check error."""


class TrademarkRateLimitError(TrademarkLookupError):
    """Local safety limit reached before contacting TMHunt."""


def normalize_term(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _display_phrase(text: str) -> str:
    return " ".join(str(text or "").strip().split())


def _validate_phrase(phrase: str) -> str:
    cleaned = _display_phrase(phrase)
    if not cleaned:
        raise TrademarkLookupError("Provide a phrase to check.")
    if len(cleaned) > MAX_PHRASE_LENGTH:
        raise TrademarkLookupError(f"Phrase must be {MAX_PHRASE_LENGTH} characters or fewer.")
    return cleaned


def _is_searchable(term: str) -> bool:
    n = normalize_term(term)
    if not n:
        return False
    tokens = n.split()
    if any(t in _BRAND_WHITELIST for t in tokens):
        return True
    if n in _STOP_WORDS:
        return False
    if len(n) < 3:
        return False
    if len(tokens) == 1 and tokens[0] in _STOP_WORDS:
        return False
    return True


def split_terms(
    *,
    title: str = "",
    primary_tag: str = "",
    supporting_tags: Any = "",
    description: str = "",
) -> list[str]:
    """Build meaningful exact phrases from design metadata."""
    out: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        display = _display_phrase(term)
        norm = normalize_term(display)
        if not norm or norm in seen or not _is_searchable(norm):
            return
        seen.add(norm)
        out.append(display)

    if title and len(title.strip().split()) <= 8:
        add(title)
    for word in normalize_term(title).split():
        if word in _BRAND_WHITELIST or len(word) >= 4:
            add(word)
    if primary_tag:
        add(primary_tag)
        for word in normalize_term(primary_tag).split():
            if word in _BRAND_WHITELIST or len(word) >= 4:
                add(word)

    if isinstance(supporting_tags, str):
        tags = [t.strip() for t in supporting_tags.split(",") if t.strip()]
    elif isinstance(supporting_tags, list):
        tags = [str(t).strip() for t in supporting_tags if str(t).strip()]
    else:
        tags = []
    for tag in tags:
        add(tag)

    for blob in (title, description):
        words = [w for w in normalize_term(blob).split() if len(w) > 2 and w not in _STOP_WORDS]
        for i in range(len(words) - 1):
            add(f"{words[i]} {words[i + 1]}")

    blob = " ".join(filter(None, [title, primary_tag, str(supporting_tags or ""), description])).lower()
    for brand in _BRAND_WHITELIST:
        if brand in blob:
            add(brand)

    return out[:MAX_TERMS_PER_CHECK]


def _cache_get(phrase: str) -> Optional[dict[str, Any]]:
    key = normalize_term(phrase)
    cached = _match_cache.get(key)
    if not cached:
        return None
    expires_at, value = cached
    if expires_at < time.time():
        _match_cache.pop(key, None)
        return None
    return value


def _cache_put(phrase: str, value: dict[str, Any]) -> None:
    _match_cache[normalize_term(phrase)] = (time.time() + CACHE_TTL_SECONDS, value)


async def _check_rate_limit() -> None:
    global _rate_window_count, _rate_window_started
    async with _rate_lock:
        now = time.monotonic()
        if now - _rate_window_started >= RATE_LIMIT_WINDOW_SECONDS:
            _rate_window_started = now
            _rate_window_count = 0
        if _rate_window_count >= RATE_LIMIT_MAX_REQUESTS:
            raise TrademarkRateLimitError("Trademark checker is busy. Please try again shortly.")
        _rate_window_count += 1


def _build_tsdr_url(serial: Any) -> str:
    digits = re.sub(r"\D", "", str(serial or ""))
    return f"https://tsdr.uspto.gov/#caseNumber={digits}" if digits else ""


def _parse_registered(raw: Any) -> tuple[str, bool]:
    text = str(raw or "").strip()
    if not text or text.lower() == "not":
        return "", False

    registered = text.lower().endswith("-yes")
    date_text = re.sub(r"-yes$", "", text, flags=re.IGNORECASE)
    try:
        parsed = datetime.strptime(date_text, "%b-%d-%Y")
        return parsed.date().isoformat(), registered
    except ValueError:
        return date_text, registered


def _parse_filed_on(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    try:
        return datetime.strptime(text, "%b-%d-%Y").date().isoformat()
    except ValueError:
        return text


def _normalize_tmhunt_row(row: Any, phrase: str) -> Optional[dict[str, Any]]:
    if not isinstance(row, list) or len(row) < 6:
        return None
    serial = str(row[0] or "").strip()
    trademark = str(row[1] or "").strip()
    if not serial or not trademark:
        return None

    registration_date, registered = _parse_registered(row[5])
    status = str(row[2] or "").strip().upper()
    return {
        "term": phrase,
        "matched_term": phrase,
        "serial": serial,
        "office": TMHUNT_OFFICE,
        "trademark": trademark.upper(),
        "classification": TMHUNT_CLASSIFICATION,
        "registration_date": registration_date,
        "status": status,
        "type": str(row[3] or "").strip(),
        "filed_on": _parse_filed_on(row[4]),
        "registered": registered,
        "source": TMHUNT_SOURCE_NAME,
        "source_url": _build_tsdr_url(serial),
    }


async def check_phrase(phrase: str) -> dict[str, Any]:
    """Check one exact phrase against TMHunt and return normalized rows."""
    cleaned = _validate_phrase(phrase)
    cached = _cache_get(cleaned)
    if cached is not None:
        return {**cached, "cached": True}

    await _check_rate_limit()

    try:
        async with httpx.AsyncClient(timeout=TMHUNT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                TMHUNT_SEARCH_URL,
                data={
                    "query": json.dumps(cleaned),
                    "searchType": "exactMatch",
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "application/json, text/plain, */*",
                },
                follow_redirects=False,
            )
    except httpx.TimeoutException as exc:
        raise TrademarkLookupError("TMHunt timed out. Please try again.") from exc
    except httpx.HTTPError as exc:
        logger.warning("[TMHunt] request failed for phrase=%r error_type=%s", cleaned, type(exc).__name__)
        raise TrademarkLookupError("TMHunt is unavailable. Please try again.") from exc

    if response.status_code != 200:
        logger.warning("[TMHunt] HTTP %s for phrase=%r", response.status_code, cleaned)
        raise TrademarkLookupError("TMHunt is unavailable. Please try again.")

    body = response.text or ""
    if not body.strip():
        data: Any = []
    else:
        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("[TMHunt] invalid response for phrase=%r", cleaned)
            raise TrademarkLookupError("TMHunt returned an invalid response. Please try again.") from exc

    if not isinstance(data, list):
        raise TrademarkLookupError("TMHunt returned an unexpected response. Please try again.")

    matches = [
        match
        for match in (_normalize_tmhunt_row(row, cleaned) for row in data)
        if match is not None
    ]
    result = {
        "phrase": cleaned,
        "source": TMHUNT_SOURCE_NAME,
        "matches": matches,
        "count": len(matches),
        "checked_terms": [cleaned],
        "failed_terms": [],
        "errors": [],
        "manual": False,
        "disclaimer": "Trademark results are informational only and are not legal advice.",
    }
    _cache_put(cleaned, result)
    logger.info("[TMHunt] phrase=%r matches=%d", cleaned, len(matches))
    return result


async def check_terms(terms: list[str]) -> dict[str, Any]:
    """Run exact TMHunt checks for a list of phrases."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for term in terms or []:
        try:
            phrase = _validate_phrase(term)
        except TrademarkLookupError:
            continue
        key = normalize_term(phrase)
        if key and key not in seen and _is_searchable(key):
            seen.add(key)
            cleaned.append(phrase)
        if len(cleaned) >= MAX_TERMS_PER_CHECK:
            break

    if not cleaned:
        return {
            "matches": [],
            "checked_terms": [],
            "failed_terms": [],
            "errors": [],
            "manual": False,
            "disclaimer": "Trademark results are informational only and are not legal advice.",
        }

    matches: list[dict[str, Any]] = []
    checked: list[str] = []
    failed: list[dict[str, str]] = []
    sem = asyncio.Semaphore(4)

    async def run(term: str) -> None:
        async with sem:
            try:
                result = await check_phrase(term)
                matches.extend(result.get("matches") or [])
                checked.append(term)
            except TrademarkLookupError as exc:
                failed.append({"term": term, "error": str(exc)})
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("[TMHunt] unexpected error for term=%r", term)
                failed.append({"term": term, "error": f"Unexpected error: {type(exc).__name__}"})

    await asyncio.gather(*(run(term) for term in cleaned))

    return {
        "matches": matches,
        "checked_terms": checked,
        "failed_terms": failed,
        "errors": failed,
        "manual": False,
        "source": TMHUNT_SOURCE_NAME,
        "disclaimer": "Trademark results are informational only and are not legal advice.",
    }

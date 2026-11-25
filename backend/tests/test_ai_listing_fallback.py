import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

for name in (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
):
    os.environ.setdefault(name, f"test-{name.lower()}")

from app.services import ai_listing_service, openrouter_service  # noqa: E402


VALID_LISTING = {
    "title": "Floral Teacup Line Art",
    "description": "A simple black line drawing of a floral teacup.",
    "main_tag": "teacup",
    "primary_tag": "teacup",
    "supporting_tags": "line art, floral pattern",
}


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeAsyncClient:
    responses = []
    requests = []

    def __init__(self, *args, **kwargs):
        self.timeout = kwargs.get("timeout")

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        self.requests.append({"url": url, "timeout": self.timeout, **kwargs})
        return self.responses.pop(0)


class AIListingFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_listing_generation_uses_configured_openrouter_model_only(self):
        openrouter_mock = AsyncMock(return_value=VALID_LISTING)

        with (
            patch.object(ai_listing_service, "AI_LISTING_PROVIDER", "openrouter"),
            patch.object(ai_listing_service, "OPENROUTER_API_KEY", "test-key"),
            patch.object(ai_listing_service, "OPENROUTER_MODEL", "paid/model"),
            patch.object(openrouter_service, "generate_listing_openrouter", openrouter_mock),
        ):
            result = await ai_listing_service.generate_listing_content(
                design={"id": "design-1"},
                platform="redbubble",
                image_url="https://example.com/design.png",
            )

        self.assertEqual(result, VALID_LISTING)
        openrouter_mock.assert_awaited_once()
        self.assertEqual(openrouter_mock.await_args.kwargs["model"], "paid/model")
        self.assertFalse(openrouter_mock.await_args.kwargs["structured_output"])
        self.assertEqual(openrouter_mock.await_args.kwargs["timeout_seconds"], 180.0)

    async def test_openrouter_response_uses_compressed_image_payload(self):
        FakeAsyncClient.requests = []
        FakeAsyncClient.responses = [
            FakeResponse(
                200,
                {
                    "model": "free/vision-model",
                    "choices": [{"message": {"content": (
                        '{"title":"Tea Cup","description":"A floral tea cup.",'
                        '"main_keyword":"teacup","tags":["floral","line art"]}'
                    )}}],
                },
            )
        ]

        with (
            patch.object(openrouter_service.config, "OPENROUTER_API_KEY", "test-key"),
            patch.object(openrouter_service.httpx, "AsyncClient", FakeAsyncClient),
            patch.object(openrouter_service, "_download_image", AsyncMock(return_value=b"image-bytes")),
            patch.object(openrouter_service, "_compress_image_for_ai", return_value=b"jpeg-bytes"),
        ):
            result = await openrouter_service.generate_listing_openrouter(
                design={"filename": "cup.png"},
                platform="redbubble",
                image_url="https://example.com/cup.png",
                model="openrouter/free",
                timeout_seconds=20.0,
                structured_output=True,
                require_tags_array=True,
                provider_label="openrouter_free",
            )

        supporting_tags = [tag.strip() for tag in result["supporting_tags"].split(",")]
        self.assertEqual(supporting_tags[:2], ["floral", "line art"])
        self.assertEqual(len(supporting_tags), openrouter_service.LISTING_EXACT_TAG_COUNT)
        request = FakeAsyncClient.requests[0]
        self.assertEqual(request["timeout"], 20.0)
        self.assertEqual(request["json"]["model"], "openrouter/free")
        self.assertEqual(request["json"]["response_format"]["type"], "json_schema")
        image_part = request["json"]["messages"][0]["content"][1]
        self.assertEqual(image_part["image_url"]["url"], "data:image/jpeg;base64,anBlZy1ieXRlcw==")

    async def test_listing_rejects_non_openrouter_provider(self):
        with (
            patch.object(ai_listing_service, "AI_LISTING_PROVIDER", "gemini"),
            patch.object(ai_listing_service, "OPENROUTER_API_KEY", "test-key"),
        ):
            with self.assertRaisesRegex(ai_listing_service.AIListingError, "OpenRouter/Edge only"):
                await ai_listing_service.generate_listing_content(
                    design={"id": "design-2"},
                    platform="teepublic",
                )

    async def test_openrouter_rate_limit_returns_listing_error(self):
        provider_error = openrouter_service.OpenRouterListingError("OpenRouter API returned status code 429")
        with (
            patch.object(ai_listing_service, "AI_LISTING_PROVIDER", "openrouter"),
            patch.object(ai_listing_service, "OPENROUTER_API_KEY", "test-key"),
            patch.object(openrouter_service, "generate_listing_openrouter", AsyncMock(side_effect=provider_error)),
        ):
            with self.assertRaisesRegex(ai_listing_service.AIListingError, "OpenRouter API returned status code 429"):
                await ai_listing_service.generate_listing_content(
                    design={"id": "design-3"},
                    platform="teepublic",
                )

    def test_invalid_json_and_wrong_tag_shape_are_rejected(self):
        with self.assertRaises(openrouter_service.OpenRouterListingError):
            openrouter_service._parse_json_response("not json")

        with self.assertRaisesRegex(openrouter_service.OpenRouterListingError, "must be an array"):
            openrouter_service._clean_and_normalize_metadata(
                {
                    "title": "Tea Cup",
                    "description": "A tea cup.",
                    "main_tag": "teacup",
                    "supporting_tags": "floral, line art",
                },
                "redbubble",
                require_tags_array=True,
            )


if __name__ == "__main__":
    unittest.main()

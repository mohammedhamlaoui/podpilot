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
    async def test_free_fallback_runs_after_paid_openrouter_and_gemini(self):
        paid_error = openrouter_service.OpenRouterListingError("paid provider unavailable")
        openrouter_mock = AsyncMock(side_effect=[paid_error, VALID_LISTING])
        gemini_mock = AsyncMock(side_effect=ai_listing_service.AIListingError("gemini unavailable"))

        with (
            patch.object(ai_listing_service, "AI_LISTING_PROVIDER", "openrouter"),
            patch.object(ai_listing_service, "OPENROUTER_API_KEY", "test-key"),
            patch.object(ai_listing_service, "OPENROUTER_MODEL", "paid/model"),
            patch.object(ai_listing_service, "GEMINI_API_KEY", "test-gemini-key"),
            patch.object(ai_listing_service, "ENABLE_OPENROUTER_FREE_FALLBACK", True),
            patch.object(ai_listing_service, "OPENROUTER_FREE_FALLBACK_MODEL", "openrouter/free"),
            patch.object(openrouter_service, "generate_listing_openrouter", openrouter_mock),
            patch.object(ai_listing_service, "_generate_listing_gemini", gemini_mock),
        ):
            result = await ai_listing_service.generate_listing_content(
                design={"id": "design-1"},
                platform="redbubble",
                image_url="https://example.com/design.png",
            )

        self.assertEqual(result, VALID_LISTING)
        self.assertEqual(openrouter_mock.await_count, 2)
        self.assertEqual(openrouter_mock.await_args_list[0].kwargs["model"], "paid/model")
        self.assertEqual(openrouter_mock.await_args_list[1].kwargs["model"], "openrouter/free")
        self.assertTrue(openrouter_mock.await_args_list[1].kwargs["structured_output"])
        self.assertEqual(openrouter_mock.await_args_list[1].kwargs["timeout_seconds"], 20.0)
        gemini_mock.assert_awaited_once()

    async def test_mocked_free_response_repairs_wrapped_json_and_uses_image_url(self):
        FakeAsyncClient.requests = []
        FakeAsyncClient.responses = [
            FakeResponse(
                200,
                {
                    "model": "free/vision-model",
                    "choices": [{"message": {"content": (
                        'Result:\n{"title":"Tea Cup","description":"A floral tea cup.",'
                        '"main_tag":"teacup","supporting_tags":["floral","floral","line art"]}'
                    )}}],
                },
            )
        ]

        with (
            patch.object(openrouter_service.config, "OPENROUTER_API_KEY", "test-key"),
            patch.object(openrouter_service.httpx, "AsyncClient", FakeAsyncClient),
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

        self.assertEqual(result["supporting_tags"], "floral, line art")
        request = FakeAsyncClient.requests[0]
        self.assertEqual(request["timeout"], 20.0)
        self.assertEqual(request["json"]["model"], "openrouter/free")
        self.assertEqual(request["json"]["response_format"]["type"], "json_schema")
        image_part = request["json"]["messages"][0]["content"][1]
        self.assertEqual(image_part["image_url"]["url"], "https://example.com/cup.png")

    async def test_free_rate_limit_returns_normal_listing_error(self):
        free_error = openrouter_service.OpenRouterListingError("OpenRouter API returned status code 429")
        with (
            patch.object(ai_listing_service, "AI_LISTING_PROVIDER", "gemini"),
            patch.object(ai_listing_service, "GEMINI_API_KEY", "test-gemini-key"),
            patch.object(ai_listing_service, "OPENROUTER_API_KEY", "test-key"),
            patch.object(ai_listing_service, "ENABLE_OPENROUTER_FREE_FALLBACK", True),
            patch.object(ai_listing_service, "_generate_listing_gemini", AsyncMock(side_effect=RuntimeError("down"))),
            patch.object(openrouter_service, "generate_listing_openrouter", AsyncMock(side_effect=free_error)),
        ):
            with self.assertRaisesRegex(ai_listing_service.AIListingError, "temporarily unavailable"):
                await ai_listing_service.generate_listing_content(
                    design={"id": "design-2"},
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

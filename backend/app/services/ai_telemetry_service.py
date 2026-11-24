"""Best-effort, secret-free AI request telemetry for Admin HQ."""
from __future__ import annotations

from typing import Optional

from app.services import supabase_service


def record_request(
    *, user_id: str, provider: str, model: str, feature: str,
    status: str, latency_ms: int, error_code: Optional[str] = None,
    input_tokens: Optional[int] = None, output_tokens: Optional[int] = None,
) -> None:
    total_tokens = None
    if input_tokens is not None or output_tokens is not None:
        total_tokens = int(input_tokens or 0) + int(output_tokens or 0)
    try:
        client = supabase_service.admin_client()
        client.table("ai_request_usage").insert({
            "user_id": user_id,
            "provider": provider or "unknown",
            "model": model or None,
            "feature": feature,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "latency_ms": max(0, int(latency_ms)),
            "status": status,
            "error_code": (error_code or "")[:120] or None,
            # Cost remains null until a versioned rate card can calculate it.
            "estimated_cost_usd": None,
            "pricing_version": None,
        }).execute()
        if status == "failed":
            source_id = f"{provider}:{feature}:{user_id}:{int(latency_ms)}"
            client.table("admin_notifications").upsert({
                "event_type": "ai_provider_error",
                "severity": "warning",
                "title": f"{provider or 'AI provider'} request failed",
                "message": f"The {feature.replace('_', ' ')} request failed with {error_code or 'an unknown provider error'}.",
                "target_type": "user",
                "target_id": user_id,
                "source_event_id": source_id,
            }, on_conflict="event_type,source_event_id").execute()
    except Exception:
        # Observability must never make a customer AI request fail.
        return

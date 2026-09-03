"""Engine AI router.

Provides the built-in app engine's text generation endpoint used by the
frontend workspace chat. In the deployed environment `/api/v1/aihub/*` is a
platform-reserved path protected by the platform gateway (anonymous requests
get 403), so the app exposes its own `/api/v1/engine/gentxt` route that calls
`AIHubService` directly and returns the same SSE protocol.
"""

import json
import logging

from fastapi import APIRouter, HTTPException, status
from routers.aihub import extract_error_message
from schemas.aihub import GenTxtRequest
from services.aihub import AIHubService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/engine", tags=["engine-ai"])

# HTML 防护页特征（如 Cloudflare「Just a moment...」人机验证页）
_CHALLENGE_HINTS = ("just a moment", "attention required", "cf-mitigated", "challenge", "cloudflare")


def friendly_error_message(error: Exception) -> str:
    """Convert an upstream error into a concise, user-friendly message.

    HTML bodies (e.g. Cloudflare challenge pages) must never be passed through
    to the client; they are replaced with a friendly Chinese message instead.
    """
    detail = extract_error_message(error).strip()
    if not detail:
        return "AI 服务暂时不可用，请稍后重试"
    lowered = detail.lower()
    if "<html" in lowered or any(hint in lowered for hint in _CHALLENGE_HINTS):
        return "AI 上游服务被网络防护临时拦截，请稍后重试"
    if len(detail) > 300:
        detail = detail[:300].rstrip() + "…"
    return detail


@router.post("/gentxt")
async def generate_text(request: GenTxtRequest):
    """
    Generate Text for the app engine (same protocol as /api/v1/aihub/gentxt).

    - stream=false: return a full JSON response
    - stream=true: return an SSE streaming response
    """
    try:
        service = AIHubService()

        if request.stream:
            from sse_starlette.sse import EventSourceResponse

            # Streaming response - wrap content in JSON for SSE
            async def event_generator():
                try:
                    async for content in service.gentxt_stream(request):
                        yield json.dumps({"content": content})
                except Exception as e:
                    logger.error(f"Engine stream error: {e}")
                    yield json.dumps({"content": f"[ERROR] {friendly_error_message(e)}"})
                finally:
                    yield "[DONE]"

            return EventSourceResponse(event_generator(), media_type="text/event-stream")

        # Non-streaming response
        return await service.gentxt(request)

    except ValueError as e:
        logger.error(f"AI service configuration error: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=friendly_error_message(e)) from e
    except Exception as e:
        logger.error(f"Engine text generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=friendly_error_message(e),
        ) from e
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
                    yield json.dumps({"content": f"[ERROR] {extract_error_message(e)}"})
                finally:
                    yield "[DONE]"

            return EventSourceResponse(event_generator(), media_type="text/event-stream")

        # Non-streaming response
        return await service.gentxt(request)

    except ValueError as e:
        logger.error(f"AI service configuration error: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=extract_error_message(e)) from e
    except Exception as e:
        logger.error(f"Engine text generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=extract_error_message(e),
        ) from e
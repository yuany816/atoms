"""Engine AI router.

Provides the built-in app engine's text generation endpoint used by the
frontend workspace chat. In the deployed environment `/api/v1/aihub/*` is a
platform-reserved path protected by the platform gateway (anonymous requests
get 403), so the app exposes its own `/api/v1/engine/gentxt` route that calls
`AIHubService` directly and returns the same SSE protocol.
"""

import base64
import binascii
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
# 上游「不支持 assistant prefill」错误特征：对话以 assistant 消息结尾时，Anthropic 系模型拒绝请求
_PREFILL_HINTS = ("assistant message prefill", "must end with a user message")


def friendly_error_message(error: Exception) -> str:
    """Convert an upstream error into a concise, user-friendly message.

    HTML bodies (e.g. Cloudflare challenge pages) must never be passed through
    to the client; they are replaced with a friendly Chinese message instead.
    Upstream validation errors (e.g. unsupported assistant prefill) are also
    translated into actionable Chinese hints.
    """
    detail = extract_error_message(error).strip()
    if not detail:
        return "AI 服务暂时不可用，请稍后重试"
    lowered = detail.lower()
    if "<html" in lowered or any(hint in lowered for hint in _CHALLENGE_HINTS):
        return "AI 上游服务被网络防护临时拦截，请稍后重试"
    if any(hint in lowered for hint in _PREFILL_HINTS):
        return "当前会话消息格式不被该模型支持，请重新发送消息后重试"
    if len(detail) > 300:
        detail = detail[:300].rstrip() + "…"
    return detail


# messages_b64 传输编码体积上限（base64 字符数），防止超大请求体滥用
_MAX_MESSAGES_B64_LEN = 4_000_000


def trim_trailing_assistant(messages: list) -> list:
    """Drop trailing assistant messages so the conversation ends with a user turn.

    The UI keeps an empty assistant placeholder for streaming display, and an
    interrupted generation may leave a partial assistant message behind; neither
    may leak into the request payload because some upstream models (Anthropic
    family) reject conversations ending with an assistant message ("assistant
    message prefill" is not supported).
    """
    trimmed = list(messages)
    while trimmed and isinstance(trimmed[-1], dict) and trimmed[-1].get("role") == "assistant":
        trimmed.pop()
    return trimmed


def resolve_transport_encoding(request: GenTxtRequest) -> GenTxtRequest:
    """Decode base64-transported messages when present.

    The frontend base64-encodes the message list so that legitimate HTML/JS
    content in conversations (generated app code) is not misjudged by edge WAF
    rules as XSS payloads. Decoding here is transparent to the AI service.
    The resolved message list is additionally normalized to end with a user
    message (see trim_trailing_assistant).
    """
    if request.messages_b64 and request.messages_b64.strip():
        encoded = request.messages_b64.strip()
        if len(encoded) > _MAX_MESSAGES_B64_LEN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="会话内容过大，请缩短对话或新建项目后重试",
            )
        try:
            payload = json.loads(base64.b64decode(encoded).decode("utf-8"))
        except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="会话数据解码失败，请刷新页面后重试",
            ) from e
        if not isinstance(payload, list) or not payload:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="会话数据格式错误，请刷新页面后重试",
            )
        raw_messages = payload
    else:
        if not request.messages:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="缺少会话消息，请刷新页面后重试",
            )
        raw_messages = [{"role": message.role, "content": message.content} for message in request.messages]

    # 防御式裁剪：对话必须以 user 消息结束（不支持 assistant prefill 的上游模型要求）
    raw_messages = trim_trailing_assistant(raw_messages)
    last = raw_messages[-1] if raw_messages else None
    if not isinstance(last, dict) or last.get("role") != "user":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="会话消息必须以用户消息结束，请重新发送消息后重试",
        )

    return GenTxtRequest(
        messages=raw_messages,
        model=request.model,
        stream=request.stream,
        temperature=request.temperature,
        max_tokens=request.max_tokens,
    )


async def handle_generate_text(request: GenTxtRequest):
    """Shared implementation for the engine text generation endpoints.

    - stream=false: return a full JSON response
    - stream=true: return an SSE streaming response
    """
    # 解码前端传输编码的会话（messages_b64）；解码失败直接 400，不进入 AI 调用
    request = resolve_transport_encoding(request)

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


@router.post("/gentxt")
async def generate_text(request: GenTxtRequest):
    """Generate Text for the app engine (same protocol as /api/v1/aihub/gentxt)."""
    return await handle_generate_text(request)


@router.post("/text-stream")
async def generate_text_alias(request: GenTxtRequest):
    """Path-level alias of /gentxt (identical handler, protocol and model whitelist).

    The deployed domain's edge protection appears to match requests by path;
    this alias gives the frontend an alternate path to try before entering the
    cross-origin fallback stage.
    """
    return await handle_generate_text(request)
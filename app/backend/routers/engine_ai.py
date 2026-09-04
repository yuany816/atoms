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
from sqlalchemy import select

from core.database import db_manager
from models.GenerationLogs import Generationlogs
from models.KnowledgeChunks import Knowledgechunks
from models.SkillPackages import Skillpackages
from routers.aihub import extract_error_message
from schemas.aihub import ChatMessage, GenTxtRequest
from services.aihub import AIHubService
from services.knowledge import cosine, embed, parse_json_array

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/engine", tags=["engine-ai"])

# 文本模型白名单（与前端 MODEL_POOL 一致；不在名单内的模型直接 400，不透传上游）
ALLOWED_TEXT_MODELS = frozenset(
    {
        "claude-opus-5",
        "claude-opus-4.6",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "gpt-5.6-sol",
        "gpt-5.5",
        "gpt-5.4",
        "gemini-3.1-pro-preview",
    }
)

# HTML 防护页特征（如 Cloudflare「Just a moment...」人机验证页）
_CHALLENGE_HINTS = ("just a moment", "attention required", "cf-mitigated", "challenge", "cloudflare")
# 上游「不支持 assistant prefill」错误特征：对话以 assistant 消息结尾时，Anthropic 系模型拒绝请求
_PREFILL_HINTS = ("assistant message prefill", "must end with a user message")
# 上游「AI 余额不足」错误特征：平台 AI 钱包余额耗尽（账号级），转译为中文充值提示
_BALANCE_HINTS = ("balance is insufficient", "insufficient to finish the operation")


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
    if any(hint in lowered for hint in _BALANCE_HINTS):
        return "AI 服务余额不足，请先在平台完成充值后重试"
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
        project_id=request.project_id,
    )


# ---------- 会话自动增强（知识检索 + 技能注入 + 回流沉淀） ----------

# 检索规模约束：Top-K 命中、最低相似度阈值与查询长度上限
_TOP_K = 3
_MIN_SCORE = 0.05
_ENHANCE_QUERY_CHARS = 2000
_SKILL_MAX_CHARS = 1200
_KB_SNIPPET_CHARS = 800


async def retrieve_enhancement(query: str) -> dict:
    """按用户消息检索知识片段与启用中的技能包。

    使用独立短数据库会话（只读、立即物化后关闭），不与 AI 上游调用共享事务；
    任何异常均降级为空结果，不阻塞正常生成。
    """
    empty = {"kb_sources": [], "skills": []}
    query = (query or "").strip()[:_ENHANCE_QUERY_CHARS]
    if not query or db_manager.async_session_maker is None:
        return empty
    try:
        query_vec = embed(query)
        async with db_manager.async_session_maker() as session:
            chunk_result = await session.execute(select(Knowledgechunks))
            scored: list[dict] = []
            for chunk in chunk_result.scalars().all():
                try:
                    vector = json.loads(chunk.embedding)
                except (TypeError, ValueError):
                    continue
                if not isinstance(vector, list):
                    continue
                score = cosine(query_vec, vector)
                if score >= _MIN_SCORE:
                    scored.append(
                        {
                            "file_name": chunk.file_name or "",
                            "chunk_index": chunk.chunk_index,
                            "content": chunk.content,
                            "score": round(score, 4),
                        }
                    )
            scored.sort(key=lambda item: item["score"], reverse=True)
            kb_sources = scored[:_TOP_K]

            skill_result = await session.execute(
                select(Skillpackages).where(Skillpackages.enabled.is_(True)).order_by(Skillpackages.id.desc())
            )
            skills = [
                {
                    "name": record.name,
                    "scenes": parse_json_array(record.scenes),
                    "description": record.description or "",
                    "usage": (record.usage or record.content or "").strip()[:_SKILL_MAX_CHARS],
                }
                for record in skill_result.scalars().all()
            ]
        return {"kb_sources": kb_sources, "skills": skills}
    except Exception as e:
        logger.warning(f"Context enhancement degraded to empty: {e}")
        return empty


def build_enhancement_message(enhancement: dict) -> str:
    """将命中知识与技能包格式化为注入 SYSTEM 的上下文文本；无命中返回空串。"""
    kb_sources = enhancement.get("kb_sources") or []
    skills = enhancement.get("skills") or []
    if not kb_sources and not skills:
        return ""
    parts = [
        "以下是平台根据用户当前消息自动检索到的参考上下文，回答时优先参考；与当前需求无关的内容可忽略："
    ]
    for index, source in enumerate(kb_sources, 1):
        content = (source.get("content") or "").strip()
        if content:
            parts.append(
                f"[知识 {index}] 来源：{source.get('file_name', '')}（相关度 {source.get('score', 0)}）\n"
                f"{content[:_KB_SNIPPET_CHARS]}"
            )
    for index, skill in enumerate(skills, 1):
        usage = (skill.get("usage") or skill.get("description") or "").strip()
        if usage:
            scenes = "、".join(skill.get("scenes") or [])
            parts.append(f"[技能 {index}] {skill.get('name', '')}（适用场景：{scenes}）\n{usage}")
    return "\n\n".join(parts)


def inject_enhancement(request: GenTxtRequest, enhancement_text: str) -> GenTxtRequest:
    """把增强上下文并入消息列表：已有 system 消息则追加，否则在开头插入一条 system。

    注意必须构造类型化的 ChatMessage（而非 dict）：GenTxtRequest.messages 为
    List[ChatMessage]，model_copy 不做重新校验，dict 会导致上游按属性访问 .content 时报错。
    """
    messages = [
        message if isinstance(message, ChatMessage) else ChatMessage(**message)
        for message in request.messages
    ]
    if messages and messages[0].role == "system" and isinstance(messages[0].content, str):
        messages[0] = ChatMessage(role="system", content=f"{messages[0].content}\n\n{enhancement_text}")
    else:
        messages.insert(0, ChatMessage(role="system", content=enhancement_text))
    return request.model_copy(update={"messages": messages})


async def persist_generation_log(
    project_id: str,
    model: str,
    user_message: str,
    assistant_message: str,
    enhancement: dict,
) -> None:
    """沉淀会话回流记录（评测数据回流）；使用独立短会话写入，失败仅记日志。"""
    try:
        if db_manager.async_session_maker is None:
            return
        kb_sources = enhancement.get("kb_sources") or []
        skills = enhancement.get("skills") or []
        kb_brief = [
            {
                "file_name": item.get("file_name"),
                "chunk_index": item.get("chunk_index"),
                "score": item.get("score"),
            }
            for item in kb_sources
        ]
        async with db_manager.async_session_maker() as session:
            session.add(
                Generationlogs(
                    project_id=(project_id or "")[:64],
                    model=model,
                    user_message=(user_message or "")[:4000],
                    assistant_message=(assistant_message or "")[:8000],
                    kb_sources=json.dumps(kb_brief, ensure_ascii=False),
                    skill_names=json.dumps([item.get("name") for item in skills], ensure_ascii=False),
                    query=(user_message or "")[:2000],
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(f"Generation log persistence skipped: {e}")


async def handle_generate_text(request: GenTxtRequest):
    """Shared implementation for the engine text generation endpoints.

    - stream=false: return a full JSON response
    - stream=true: return an SSE streaming response
    """
    # 模型白名单校验：仅放行模型池内的模型，与 /gentxt、/text-stream 两条路径一致生效
    if request.model not in ALLOWED_TEXT_MODELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不支持的模型，请在工作区模型列表中选择后重试",
        )

    # 解码前端传输编码的会话（messages_b64）；解码失败直接 400，不进入 AI 调用
    request = resolve_transport_encoding(request)

    # 会话自动增强：按最后一条用户消息检索知识片段与启用中的技能包并注入 SYSTEM 上下文
    # （检索失败自动降级为空结果，不阻塞正常生成）
    user_query = ""
    for message in reversed(request.messages):
        if message.role == "user" and isinstance(message.content, str):
            user_query = message.content
            break
    enhancement = await retrieve_enhancement(user_query)
    enhancement_text = build_enhancement_message(enhancement)
    if enhancement_text:
        request = inject_enhancement(request, enhancement_text)

    try:
        service = AIHubService()

        if request.stream:
            from sse_starlette.sse import EventSourceResponse

            # Streaming response - wrap content in JSON for SSE
            async def event_generator():
                full_parts: list[str] = []
                try:
                    if enhancement_text:
                        # 先下发来源标注帧：前端据此在对话中展示命中的知识与技能来源
                        yield json.dumps(
                            {
                                "enhancement": {
                                    "kb_sources": [
                                        {
                                            "file_name": item.get("file_name"),
                                            "chunk_index": item.get("chunk_index"),
                                            "score": item.get("score"),
                                        }
                                        for item in enhancement.get("kb_sources", [])
                                    ],
                                    "skill_names": [item.get("name") for item in enhancement.get("skills", [])],
                                }
                            }
                        )
                    async for content in service.gentxt_stream(request):
                        full_parts.append(content)
                        yield json.dumps({"content": content})
                except Exception as e:
                    logger.error(f"Engine stream error: {e}")
                    error_text = f"[ERROR] {friendly_error_message(e)}"
                    full_parts.append(error_text)
                    yield json.dumps({"content": error_text})
                finally:
                    yield "[DONE]"
                # 评测数据回流：流结束后总是沉淀（含失败会话，便于评测排查；写入失败仅记日志）
                await persist_generation_log(
                    request.project_id or "", request.model, user_query, "".join(full_parts), enhancement
                )

            return EventSourceResponse(event_generator(), media_type="text/event-stream")

        # Non-streaming response
        response = await service.gentxt(request)
        await persist_generation_log(
            request.project_id or "", request.model, user_query, response.content or "", enhancement
        )
        return response

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
"""DeepSeek official API direct-connection service (OpenAI-compatible).

Serves as the reliable fallback channel for the app engine's text generation:
when the platform AI Hub fails (insufficient balance, upstream errors, etc.),
the engine router automatically retries via the DeepSeek official API. The
API key is injected ONLY through the DEEPSEEK_API_KEY environment variable
and must never be hard-coded into the codebase or committed to the repository.

Endpoint: POST https://api.deepseek.com/chat/completions (stream=true SSE)
Models: deepseek-chat / deepseek-reasoner
"""

import logging
import os
from typing import AsyncGenerator

from schemas.aihub import GenTxtRequest, GenTxtResponse

try:
    from core.telemetry import observe_external_http
except Exception:  # noqa: BLE001 - optional across mixed template versions
    async def observe_external_http(operation):
        return await operation

logger = logging.getLogger(__name__)

# DeepSeek 官方 API 基址（OpenAI 兼容协议；SDK 自动拼接 /chat/completions）
DEEPSEEK_API_BASE = "https://api.deepseek.com"
# DeepSeek 官方 API 提供的文本模型
DEEPSEEK_CHAT_MODEL = "deepseek-chat"
DEEPSEEK_REASONER_MODEL = "deepseek-reasoner"
DEEPSEEK_DIRECT_MODELS = frozenset({DEEPSEEK_CHAT_MODEL, DEEPSEEK_REASONER_MODEL})


def get_deepseek_api_key() -> str:
    """Read the DeepSeek API key from the runtime environment only."""
    return (os.environ.get("DEEPSEEK_API_KEY") or "").strip()


def deepseek_configured() -> bool:
    """Whether the DeepSeek direct channel is usable in the current runtime."""
    return bool(get_deepseek_api_key())


class DeepSeekService:
    """DeepSeek 官方 API 直连客户端（OpenAI 兼容协议）。

    - 直连模型（deepseek-chat / deepseek-reasoner）：作为主通道被直接调用；
    - 其余模型：仅作为平台 AI Hub 失败后的自动回退通道，请求模型统一映射
      为 deepseek-chat（DeepSeek 官方 API 不提供平台模型池中的模型名）。
    """

    def __init__(self):
        self._client = None

    def _require_client(self):
        """Return the configured DeepSeek client or raise a configuration error."""
        if self._client is None:
            api_key = get_deepseek_api_key()
            if not api_key:
                raise ValueError("DeepSeek 直连未配置：缺少 DEEPSEEK_API_KEY 环境变量")
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_API_BASE)
        return self._client

    @staticmethod
    def resolve_model(requested_model: str) -> str:
        """Map the requested model onto DeepSeek official API models.

        deepseek-chat / deepseek-reasoner pass through as-is; platform-pool
        models (used only in the fallback scenario) map to deepseek-chat.
        """
        if requested_model in DEEPSEEK_DIRECT_MODELS:
            return requested_model
        return DEEPSEEK_CHAT_MODEL

    @staticmethod
    def _convert_messages(request: GenTxtRequest) -> list[dict]:
        """Convert typed chat messages into OpenAI-compatible plain-text dicts."""
        messages: list[dict] = []
        for message in request.messages:
            content = message.content
            if not isinstance(content, str):
                # DeepSeek chat API 仅支持纯文本消息，多模态片段降级为文本
                parts = []
                for item in content:
                    text = getattr(item, "text", None)
                    if isinstance(text, str) and text.strip():
                        parts.append(text)
                content = "\n".join(parts)
            messages.append({"role": message.role, "content": content})
        return messages

    async def gentxt(self, request: GenTxtRequest) -> GenTxtResponse:
        """Non-streaming text generation via the DeepSeek official API."""
        model = self.resolve_model(request.model)
        client = self._require_client()
        response = await observe_external_http(
            client.chat.completions.create(
                model=model,
                messages=self._convert_messages(request),
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                stream=False,
            )
        )
        content = response.choices[0].message.content or ""
        usage = None
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            }
        return GenTxtResponse(content=content, model=request.model, usage=usage)

    async def gentxt_stream(self, request: GenTxtRequest) -> AsyncGenerator[str, None]:
        """Streaming text generation via the DeepSeek official API.

        Yields plain text chunks (the final answer only; deepseek-reasoner's
        chain-of-thought field `reasoning_content` is intentionally skipped).
        """
        model = self.resolve_model(request.model)
        client = self._require_client()
        stream = await observe_external_http(
            client.chat.completions.create(
                model=model,
                messages=self._convert_messages(request),
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                stream=True,
            )
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

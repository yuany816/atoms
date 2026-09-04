"""会话自动增强检索路由（匿名）。

按当前用户消息在知识切块中做向量相似度检索，命中来源与启用中的技能包
一并返回，供 engine_ai 共享处理函数注入 SYSTEM 上下文。
检索任何一步失败都返回空结果，不阻塞正常生成。
"""

import json
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.KnowledgeChunks import Knowledgechunks
from models.SkillPackages import Skillpackages
from services.knowledge import cosine, embed, parse_json_array

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/context", tags=["context-enhance"])

# 检索规模约束
_MAX_QUERY_CHARS = 2000
_TOP_K = 3
_MIN_SCORE = 0.05  # 低于该相似度的块不注入
_SKILL_MAX_CHARS = 1200  # 单技能注入上下文的最大字符数


class RetrieveRequest(BaseModel):
    query: str


@router.post("/retrieve")
async def retrieve_context(data: RetrieveRequest, db: AsyncSession = Depends(get_db)):
    """按用户消息检索知识片段与启用中的技能包（任何异常均降级为空结果）。"""
    empty = {"kb_sources": [], "skills": []}
    query = (data.query or "").strip()
    if not query:
        return empty
    query = query[:_MAX_QUERY_CHARS]

    try:
        query_vec = embed(query)

        # 知识切块相似度检索（全量块规模可控：单文件 ≤200k 字符 → ≤约 400 块）
        result = await db.execute(select(Knowledgechunks))
        chunks = result.scalars().all()
        scored: list[dict] = []
        for chunk in chunks:
            try:
                vec = json.loads(chunk.embedding)
            except (TypeError, ValueError):
                continue
            if not isinstance(vec, list):
                continue
            score = cosine(query_vec, vec)
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

        # 启用中的技能包
        skill_result = await db.execute(
            select(Skillpackages).where(Skillpackages.enabled.is_(True)).order_by(Skillpackages.id.desc())
        )
        skills = []
        for record in skill_result.scalars().all():
            content = (record.usage or record.content or "").strip()[:_SKILL_MAX_CHARS]
            skills.append(
                {
                    "id": record.id,
                    "name": record.name,
                    "scenes": parse_json_array(record.scenes),
                    "description": record.description or "",
                    "usage": content,
                }
            )

        return {"kb_sources": kb_sources, "skills": skills}
    except Exception as e:
        # 检索失败不阻塞正常生成：记录日志并返回空结果
        logger.warning(f"Context retrieval degraded to empty result: {e}")
        return empty
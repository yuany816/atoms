"""分享业务路由（匿名）：创建分享快照 / 读取只读快照。

数据落在 sharelinks 表；快照含对话过程（可含文件），公开只读访问。
"""

import json
import logging
import re
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.ShareLinks import Sharelinks
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/share", tags=["share"])

MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


class ShareRequest(BaseModel):
    project_id: str
    name: str
    snapshot: dict


class ShareResponse(BaseModel):
    token: str
    url: str


class ShareDetailResponse(BaseModel):
    name: str
    project_id: str
    snapshot: dict
    created_at: Optional[datetime] = None


def _validate_payload(data: ShareRequest) -> tuple[str, str, int]:
    if not data.project_id or len(data.project_id) > 64:
        raise HTTPException(status_code=400, detail="project_id 非法")
    name = (data.name or "未命名项目").strip()[:120]
    try:
        snapshot_size = len(json.dumps(data.snapshot, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="分享快照序列化失败")
    if snapshot_size > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="分享快照超过 2MB 限制，请精简内容后重试")
    return name, data.project_id, snapshot_size


@router.post("", response_model=ShareResponse)
async def create_share(
    data: ShareRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """创建分享链接：快照上云，返回只读访问 token。"""
    check_write_rate_limit(request)
    name, project_id, snapshot_size = _validate_payload(data)

    token = secrets.token_hex(12)  # 24 字符，匹配 token 列长度 32
    record = Sharelinks(project_id=project_id, token=token, name=name, snapshot=data.snapshot)
    db.add(record)
    await db.commit()

    logger.info(f"Share created: token={token} project_id={project_id} size={snapshot_size}")
    return ShareResponse(token=token, url=f"/share/{token}")


@router.get("/{token}", response_model=ShareDetailResponse)
async def get_share(token: str, db: AsyncSession = Depends(get_db)):
    """按 token 读取分享快照；仅允许 URL 安全字符，防止非法输入。"""
    normalized = token.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{6,32}", normalized):
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    result = await db.execute(select(Sharelinks).where(Sharelinks.token == normalized))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="分享链接不存在或已失效")
    return ShareDetailResponse(
        name=record.name,
        project_id=record.project_id,
        snapshot=record.snapshot,
        created_at=record.created_at,
    )
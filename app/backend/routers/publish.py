"""发布业务路由（匿名）：slug 校验 / 发布快照 / 已发布应用读取。

数据落在 publishedapps 表；项目主体数据在浏览器本地，
云端仅以 project_id 维度隔离发布快照。
"""

import json
import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.PublishedApps import Publishedapps
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/publish", tags=["publish"])

SLUG_PATTERN = re.compile(r"^[a-z0-9-]{3,40}$")
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


class PublishRequest(BaseModel):
    project_id: str
    name: str
    slug: str
    files: dict


class SlugCheckResponse(BaseModel):
    available: bool


class PublishResponse(BaseModel):
    slug: str
    url: str
    published_at: Optional[datetime] = None


@router.get("/check-slug", response_model=SlugCheckResponse)
async def check_slug(slug: str, db: AsyncSession = Depends(get_db)):
    """校验 slug 格式与占用情况。"""
    normalized = slug.strip()
    if not SLUG_PATTERN.match(normalized):
        return SlugCheckResponse(available=False)
    result = await db.execute(select(Publishedapps.id).where(Publishedapps.slug == normalized))
    return SlugCheckResponse(available=result.scalar_one_or_none() is None)


@router.post("", response_model=PublishResponse)
async def publish_app(
    data: PublishRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """发布应用：写发布快照（同项目重复发布覆盖更新，slug 被其他项目占用则拒绝）。"""
    check_write_rate_limit(request)

    slug = data.slug.strip()
    if not SLUG_PATTERN.match(slug):
        raise HTTPException(status_code=400, detail="链接路径仅支持小写字母、数字和中划线，长度 3-40 位")
    if not data.project_id or len(data.project_id) > 64:
        raise HTTPException(status_code=400, detail="project_id 非法")
    name = (data.name or "未命名应用").strip()[:120]

    try:
        snapshot_size = len(json.dumps(data.files, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="应用文件快照序列化失败")
    if snapshot_size > MAX_SNAPSHOT_BYTES:
        raise HTTPException(status_code=413, detail="应用快照超过 2MB 限制，请精简文件后重试")

    result = await db.execute(select(Publishedapps).where(Publishedapps.slug == slug))
    existing = result.scalar_one_or_none()
    if existing is not None and existing.project_id != data.project_id:
        raise HTTPException(status_code=400, detail="该链接已被使用，请更换路径")

    if existing is not None:
        existing.name = name
        existing.files = data.files
        await db.commit()
        record = existing
    else:
        record = Publishedapps(project_id=data.project_id, name=name, slug=slug, files=data.files)
        db.add(record)
        await db.commit()

    logger.info(f"Published app: slug={slug} project_id={data.project_id} size={snapshot_size}")
    return PublishResponse(slug=slug, url=f"/p/{slug}", published_at=record.updated_at or record.created_at)


@router.get("/{slug}")
async def get_published(slug: str, db: AsyncSession = Depends(get_db)):
    """按 slug 读取已发布应用快照；404 表示链接不存在或已删除。"""
    result = await db.execute(select(Publishedapps).where(Publishedapps.slug == slug.strip()))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="应用不存在或已被删除")
    return {
        "name": record.name,
        "slug": record.slug,
        "project_id": record.project_id,
        "files": record.files,
        "published_at": record.updated_at or record.created_at,
    }
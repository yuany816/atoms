"""技能配置业务路由（匿名）：技能包上传解析 / 列表 / 启用禁用 / 删除。

上传 skills 包（zip/md/yaml）后解析应用场景与用法，落云端数据库 skillpackages 表。
"""

import base64
import binascii
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.SkillPackages import Skillpackages
from services.knowledge import parse_json_array, parse_skill_package
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])

MAX_PACKAGE_BYTES = 5 * 1024 * 1024
ALLOWED_EXTS = (".zip", ".md", ".markdown", ".yaml", ".yml")


class SkillUploadRequest(BaseModel):
    file_name: str
    content_base64: str


class SkillToggleRequest(BaseModel):
    enabled: bool


def _decode_upload(data: SkillUploadRequest) -> tuple[str, bytes]:
    file_name = (data.file_name or "").strip()
    if not file_name or len(file_name) > 200:
        raise HTTPException(status_code=400, detail="文件名非法")
    if not file_name.lower().endswith(ALLOWED_EXTS):
        raise HTTPException(status_code=400, detail="仅支持 zip / md / yaml 技能包")

    encoded = (data.content_base64 or "").strip()
    if encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[1] if "," in encoded else ""
    if not encoded:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(encoded) > (MAX_PACKAGE_BYTES // 3) * 4 + 8:
        raise HTTPException(status_code=413, detail="技能包超过 5MB 限制")

    try:
        content = base64.b64decode(encoded)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=400, detail="文件内容解码失败，请重试") from e
    if len(content) > MAX_PACKAGE_BYTES:
        raise HTTPException(status_code=413, detail="技能包超过 5MB 限制")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="文件内容为空")
    return file_name, content


def _skill_response(record: Skillpackages) -> dict:
    return {
        "id": record.id,
        "name": record.name,
        "file_name": record.file_name,
        "file_type": record.file_type,
        "scenes": parse_json_array(record.scenes),
        "description": record.description,
        "usage": record.usage,
        "enabled": bool(record.enabled),
        "created_at": record.created_at,
    }


@router.post("")
async def upload_skill_package(
    data: SkillUploadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """上传技能包：解析应用场景与用法后存储，默认启用。"""
    check_write_rate_limit(request)
    file_name, content = _decode_upload(data)

    try:
        info = parse_skill_package(file_name, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    record = Skillpackages(
        name=info["name"],
        file_name=file_name,
        file_type=info["file_type"],
        scenes=json.dumps(info["scenes"], ensure_ascii=False),
        description=info["description"],
        usage=info["usage"],
        content=info["content"],
        enabled=True,
    )
    db.add(record)
    await db.commit()

    logger.info(f"Skill package uploaded: {info['name']} scenes={info['scenes']}")
    return _skill_response(record)


@router.get("")
async def list_skills(db: AsyncSession = Depends(get_db)):
    """技能列表（新技能在前）。"""
    result = await db.execute(select(Skillpackages).order_by(Skillpackages.id.desc()).limit(200))
    records = result.scalars().all()
    return {"items": [_skill_response(r) for r in records], "total": len(records)}


@router.put("/{skill_id}/enabled")
async def toggle_skill(
    skill_id: int,
    data: SkillToggleRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """启用 / 禁用技能（禁用后不参与会话自动增强）。"""
    check_write_rate_limit(request)
    result = await db.execute(select(Skillpackages).where(Skillpackages.id == skill_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="技能不存在或已被删除")

    record.enabled = bool(data.enabled)
    await db.commit()
    return _skill_response(record)


@router.delete("/{skill_id}")
async def delete_skill(skill_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """删除技能包。"""
    check_write_rate_limit(request)
    result = await db.execute(select(Skillpackages).where(Skillpackages.id == skill_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="技能不存在或已被删除")

    await db.delete(record)
    await db.commit()
    return {"deleted": True, "id": skill_id}
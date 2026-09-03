"""用户应用数据路由（匿名）：通用 JSONB 记录 CRUD。

供生成应用内的 window.atoms SDK 调用，按 project_id + entity_type 隔离。
"""

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.AppRecords import Apprecords
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/appdata", tags=["appdata"])

ENTITY_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}$")
MAX_LIST_RECORDS = 500


class AppRecordCreate(BaseModel):
    project_id: str
    data: dict


class AppRecordUpdate(BaseModel):
    project_id: str
    data: dict


class AppRecordResponse(BaseModel):
    id: int
    project_id: str
    entity_type: str
    data: dict


def _validate(entity_type: str, project_id: str) -> None:
    if not ENTITY_PATTERN.match(entity_type):
        raise HTTPException(status_code=400, detail="entity_type 仅支持小写字母、数字、下划线和中划线")
    if not project_id or len(project_id) > 64:
        raise HTTPException(status_code=400, detail="project_id 非法")


@router.get("/{entity_type}", response_model=list[AppRecordResponse])
async def list_records(entity_type: str, project_id: str, db: AsyncSession = Depends(get_db)):
    """按 project_id + entity_type 精确匹配读取记录列表。"""
    _validate(entity_type, project_id)
    result = await db.execute(
        select(Apprecords)
        .where(Apprecords.entity_type == entity_type, Apprecords.project_id == project_id)
        .order_by(Apprecords.id)
        .limit(MAX_LIST_RECORDS)
    )
    return [
        AppRecordResponse(id=record.id, project_id=record.project_id, entity_type=record.entity_type, data=record.data)
        for record in result.scalars()
    ]


@router.post("/{entity_type}", response_model=AppRecordResponse)
async def create_record(
    entity_type: str,
    data: AppRecordCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """新增一条应用记录。"""
    check_write_rate_limit(request)
    _validate(entity_type, data.project_id)
    record = Apprecords(project_id=data.project_id, entity_type=entity_type, data=data.data)
    db.add(record)
    await db.commit()
    return AppRecordResponse(id=record.id, project_id=record.project_id, entity_type=record.entity_type, data=record.data)


@router.put("/{entity_type}/{record_id}", response_model=AppRecordResponse)
async def update_record(
    entity_type: str,
    record_id: int,
    data: AppRecordUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """更新记录；project_id 不匹配返回 403。"""
    check_write_rate_limit(request)
    _validate(entity_type, data.project_id)
    result = await db.execute(
        select(Apprecords).where(Apprecords.id == record_id, Apprecords.entity_type == entity_type)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.project_id != data.project_id:
        raise HTTPException(status_code=403, detail="无权修改该记录")
    record.data = data.data
    await db.commit()
    return AppRecordResponse(id=record.id, project_id=record.project_id, entity_type=record.entity_type, data=record.data)


@router.delete("/{entity_type}/{record_id}")
async def delete_record(
    entity_type: str,
    record_id: int,
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """删除记录；project_id 不匹配返回 403。"""
    check_write_rate_limit(request)
    _validate(entity_type, project_id)
    result = await db.execute(
        select(Apprecords).where(Apprecords.id == record_id, Apprecords.entity_type == entity_type)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.project_id != project_id:
        raise HTTPException(status_code=403, detail="无权删除该记录")
    await db.delete(record)
    await db.commit()
    return {"ok": True, "id": record_id}
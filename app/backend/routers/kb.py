"""知识库业务路由（匿名）：知识文件上传解析 / 列表 / 条目浏览 / 删除。

上传的 txt/md/pdf/docx 等知识文件在后端解析切块并向量化，
向量与文本块落云端数据库 knowledgechunks 表，文件元信息落 knowledgefiles 表。
"""

import base64
import binascii
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.KnowledgeChunks import Knowledgechunks
from models.KnowledgeFiles import Knowledgefiles
from services.knowledge import EMBED_DIM, chunk_text, embed, extract_text
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kb", tags=["knowledge-base"])

MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_EXTS = (".txt", ".md", ".markdown", ".pdf", ".docx", ".csv", ".json", ".yaml", ".yml")


class KbUploadRequest(BaseModel):
    file_name: str
    content_base64: str


def _decode_upload(data: KbUploadRequest) -> tuple[str, bytes]:
    """校验并解码上传请求，返回 (文件名, 原始字节)。"""
    file_name = (data.file_name or "").strip()
    if not file_name or len(file_name) > 200:
        raise HTTPException(status_code=400, detail="文件名非法")
    if not file_name.lower().endswith(ALLOWED_EXTS):
        raise HTTPException(status_code=400, detail="仅支持 txt / md / pdf / docx / csv / json / yaml 知识文件")

    encoded = (data.content_base64 or "").strip()
    if encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[1] if "," in encoded else ""
    if not encoded:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(encoded) > (MAX_FILE_BYTES // 3) * 4 + 8:
        raise HTTPException(status_code=413, detail="文件超过 10MB 限制，请拆分后上传")

    try:
        content = base64.b64decode(encoded)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=400, detail="文件内容解码失败，请重试") from e
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 10MB 限制，请拆分后上传")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="文件内容为空")
    return file_name, content


def _file_response(record: Knowledgefiles) -> dict:
    return {
        "id": record.id,
        "file_name": record.file_name,
        "file_type": record.file_type,
        "size_bytes": record.size_bytes,
        "chunk_count": record.chunk_count,
        "status": record.status,
        "created_at": record.created_at,
    }


@router.post("")
async def upload_kb_file(
    data: KbUploadRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """上传知识文件：解析切块并向量化存储，返回文件元信息与切块数量。"""
    check_write_rate_limit(request)
    file_name, content = _decode_upload(data)

    try:
        text = extract_text(file_name, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    blocks = chunk_text(text)
    if not blocks:
        raise HTTPException(status_code=400, detail="未能从文件中提取到有效文本内容")

    file_type = file_name.rsplit(".", 1)[-1].lower()
    record = Knowledgefiles(
        file_name=file_name,
        file_type=file_type,
        size_bytes=len(content),
        chunk_count=len(blocks),
        status="ready",
    )
    db.add(record)
    await db.flush()  # 取得 record.id 供切块关联

    for index, block in enumerate(blocks):
        db.add(
            Knowledgechunks(
                file_id=record.id,
                file_name=file_name,
                chunk_index=index,
                content=block,
                embedding=json.dumps(embed(block), ensure_ascii=False),
                dim=EMBED_DIM,
            )
        )
    await db.commit()

    logger.info(f"KB file uploaded: {file_name} chunks={len(blocks)} size={len(content)}")
    return _file_response(record)


@router.get("/files")
async def list_kb_files(db: AsyncSession = Depends(get_db)):
    """知识文件列表（新文件在前）。"""
    result = await db.execute(select(Knowledgefiles).order_by(Knowledgefiles.id.desc()).limit(200))
    records = result.scalars().all()
    return {"items": [_file_response(r) for r in records], "total": len(records)}


@router.get("/files/{file_id}/chunks")
async def list_kb_chunks(file_id: int, db: AsyncSession = Depends(get_db)):
    """按文件浏览知识条目（切块内容）。"""
    file_result = await db.execute(select(Knowledgefiles).where(Knowledgefiles.id == file_id))
    file_record = file_result.scalar_one_or_none()
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在或已被删除")

    result = await db.execute(
        select(Knowledgechunks)
        .where(Knowledgechunks.file_id == file_id)
        .order_by(Knowledgechunks.chunk_index.asc())
        .limit(500)
    )
    chunks = result.scalars().all()
    return {
        "file": _file_response(file_record),
        "items": [
            {
                "id": c.id,
                "chunk_index": c.chunk_index,
                "content": c.content,
            }
            for c in chunks
        ],
        "total": len(chunks),
    }


@router.delete("/files/{file_id}")
async def delete_kb_file(file_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """删除知识文件及其全部切块。"""
    check_write_rate_limit(request)
    result = await db.execute(select(Knowledgefiles).where(Knowledgefiles.id == file_id))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在或已被删除")

    await db.execute(sa_delete(Knowledgechunks).where(Knowledgechunks.file_id == file_id))
    await db.delete(record)
    await db.commit()
    logger.info(f"KB file deleted: id={file_id} name={record.file_name}")
    return {"deleted": True, "id": file_id}
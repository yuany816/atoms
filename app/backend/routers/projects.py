"""项目素材上传代理路由（匿名）：前端传 base64，服务端代理写入 File Storage。

模板自带 /api/v1/storage 路由依赖登录态，与本平台免登录冲突，
故此处服务端内部调用 StorageService 完成上传，返回稳定访问 URL。
"""

import base64
import binascii
import logging
import re
import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from schemas.storage import FileUpDownRequest
from services.rate_limit import check_write_rate_limit
from services.storage import StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])

BUCKET_NAME = "atoms-clone-apps"
MAX_FILE_BYTES = 5 * 1024 * 1024
# 图片类型白名单（content_type）
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
BASE64_DATA_URI_PATTERN = re.compile(r"^data:(image/(?:png|jpeg|webp|gif));base64,(.+)$", re.DOTALL)


class UploadRequest(BaseModel):
    project_id: str
    filename: str
    content_type: str
    file_base64: str


class UploadResponse(BaseModel):
    url: str
    object_key: str


def _safe_object_key(project_id: str, filename: str) -> str:
    """生成对象键：{project_id}/{随机串}-{安全文件名}，避免路径穿越与覆盖。"""
    clean_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[:80] or "image"
    if not project_id or len(project_id) > 64 or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", project_id):
        raise HTTPException(status_code=400, detail="project_id 非法")
    return f"{project_id}/{secrets.token_hex(4)}-{clean_name}"


@router.post("/upload", response_model=UploadResponse)
async def upload_image(data: UploadRequest, request: Request):
    """接收 base64 图片，代理上传至对象存储，返回可访问 URL。"""
    check_write_rate_limit(request)

    content_type = (data.content_type or "").lower().split(";")[0]
    raw_base64 = data.file_base64 or ""

    # 兼容 data URI 形式
    matched = BASE64_DATA_URI_PATTERN.match(raw_base64)
    if matched:
        content_type = matched.group(1)
        raw_base64 = matched.group(2)

    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 PNG / JPG / WebP / GIF 图片")
    if len(raw_base64) > (MAX_FILE_BYTES // 3) * 4 + 1024:
        raise HTTPException(status_code=413, detail="文件超过 5MB 限制")

    try:
        file_bytes = base64.b64decode(raw_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="图片数据解析失败")
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="文件超过 5MB 限制")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="文件内容为空")

    object_key = _safe_object_key(data.project_id, data.filename or "image.png")

    try:
        service = StorageService()
        upload_url_res = await service.create_upload_url(
            FileUpDownRequest(bucket_name=BUCKET_NAME, object_key=object_key)
        )
        if not upload_url_res.upload_url:
            raise HTTPException(status_code=500, detail="对象存储服务未返回上传地址")

        import httpx

        from core.telemetry import observe_external_http

        async with httpx.AsyncClient(timeout=120.0) as http:
            put_response = await observe_external_http(
                http.put(upload_url_res.upload_url, content=file_bytes, headers={"Content-Type": content_type})
            )
        if put_response.status_code // 100 != 2:
            logger.error(f"Upload to OSS failed: {put_response.status_code} {put_response.text[:200]}")
            raise HTTPException(status_code=500, detail="文件上传失败，请稍后重试")

        download_res = await service.create_download_url(
            FileUpDownRequest(bucket_name=BUCKET_NAME, object_key=object_key)
        )
        url = download_res.download_url or f"/api/v1/storage/download-url?bucket_name={BUCKET_NAME}&object_key={quote(object_key)}"
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload proxy failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="文件上传失败，请稍后重试")

    logger.info(f"Uploaded: key={object_key} size={len(file_bytes)}")
    return UploadResponse(url=url, object_key=object_key)
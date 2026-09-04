"""评测业务路由（匿名）：会话回流日志、人工标注、RAG 质量统计、数据集导出。

- 回流：engine_ai 在生成完成后异步沉淀 GenerationLogs（含命中来源）
- 标注：人工对回流记录打标（good/bad/pending + 备注），落 annotationrecords
- RAG 质量：基于回流记录中的命中分数统计命中率/平均相关性
- 导出：微调数据集（JSONL/CSV），仅导出已标注且 label=good 的样本
"""

import csv
import io
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.AnnotationRecords import Annotationrecords
from models.GenerationLogs import Generationlogs
from services.knowledge import parse_json_array
from services.rate_limit import check_write_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/eval", tags=["evaluation"])

VALID_LABELS = ("good", "bad", "pending")
MAX_EXPORT_ROWS = 2000


class AnnotationUpsertRequest(BaseModel):
    log_id: int
    label: str
    note: str = ""


def _log_response(record: Generationlogs, annotation: dict | None = None) -> dict:
    return {
        "id": record.id,
        "project_id": record.project_id,
        "model": record.model,
        "user_message": record.user_message,
        "assistant_message": record.assistant_message,
        "kb_sources": parse_json_array(record.kb_sources),
        "skill_names": parse_json_array(record.skill_names),
        "query": record.query,
        "created_at": record.created_at,
        "annotation": annotation,
    }


async def _annotations_map(db: AsyncSession, log_ids: list[int]) -> dict[int, dict]:
    """按 log_id 聚合标注记录（一条回流可能有多条标注，取最新一条）。"""
    if not log_ids:
        return {}
    result = await db.execute(
        select(Annotationrecords).where(Annotationrecords.log_id.in_(log_ids)).order_by(Annotationrecords.id.desc())
    )
    mapping: dict[int, dict] = {}
    for record in result.scalars().all():
        mapping.setdefault(record.log_id, {"id": record.id, "label": record.label, "note": record.note or ""})
    return mapping


@router.get("/logs")
async def list_generation_logs(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """回流日志列表（含标注状态），新记录在前。"""
    limit = max(1, min(limit, 200))
    skip = max(0, skip)
    total_result = await db.execute(select(func.count(Generationlogs.id)))
    total = int(total_result.scalar() or 0)

    result = await db.execute(
        select(Generationlogs).order_by(Generationlogs.id.desc()).offset(skip).limit(limit)
    )
    records = result.scalars().all()
    ann_map = await _annotations_map(db, [r.id for r in records])
    return {
        "items": [_log_response(r, ann_map.get(r.id)) for r in records],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/annotations")
async def upsert_annotation(
    data: AnnotationUpsertRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """创建或更新回流记录的人工标注（一条回流保留一条最新标注）。"""
    check_write_rate_limit(request)
    if data.label not in VALID_LABELS:
        raise HTTPException(status_code=400, detail="标注仅支持 good / bad / pending")

    log_result = await db.execute(select(Generationlogs).where(Generationlogs.id == data.log_id))
    log_record = log_result.scalar_one_or_none()
    if log_record is None:
        raise HTTPException(status_code=404, detail="回流记录不存在或已被删除")

    # 简单 upsert：同 log_id 已有标注则更新，否则新建
    existing_result = await db.execute(
        select(Annotationrecords).where(Annotationrecords.log_id == data.log_id).order_by(Annotationrecords.id.asc())
    )
    record = existing_result.scalars().first()
    if record is None:
        record = Annotationrecords(log_id=data.log_id, label=data.label, note=(data.note or "")[:500])
        db.add(record)
    else:
        record.label = data.label
        record.note = (data.note or "")[:500]
    await db.commit()

    logger.info(f"Annotation saved: log_id={data.log_id} label={data.label}")
    return {"id": record.id, "log_id": record.log_id, "label": record.label, "note": record.note or ""}


@router.get("/stats")
async def eval_stats(db: AsyncSession = Depends(get_db)):
    """评测总览：回流总量、标注分布、RAG 检索质量（命中率/平均相关性）。"""
    total_result = await db.execute(select(func.count(Generationlogs.id)))
    total_logs = int(total_result.scalar() or 0)

    label_result = await db.execute(
        select(Annotationrecords.label, func.count(Annotationrecords.id)).group_by(Annotationrecords.label)
    )
    label_counts = {label: int(count) for label, count in label_result.fetchall()}

    # RAG 质量：从 kb_sources JSON 中取 score
    rag_result = await db.execute(select(Generationlogs.kb_sources).where(Generationlogs.kb_sources.isnot(None)))
    hit_logs = 0
    scores: list[float] = []
    for (raw,) in rag_result.fetchall():
        sources = parse_json_array(raw)
        if sources:
            hit_logs += 1
            for item in sources:
                if isinstance(item, dict) and isinstance(item.get("score"), (int, float)):
                    scores.append(float(item["score"]))

    total = total_logs or 1
    return {
        "total_logs": total_logs,
        "labels": {
            "good": label_counts.get("good", 0),
            "bad": label_counts.get("bad", 0),
            "pending": label_counts.get("pending", 0),
        },
        "annotated": sum(label_counts.values()),
        "rag": {
            "hit_logs": hit_logs,
            "hit_rate": round(hit_logs / total, 4),
            "avg_score": round(sum(scores) / len(scores), 4) if scores else None,
            "max_score": round(max(scores), 4) if scores else None,
            "min_score": round(min(scores), 4) if scores else None,
            "score_count": len(scores),
        },
    }


@router.get("/export/dataset")
async def export_dataset(
    format: str = "jsonl",
    include_unlabeled: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """导出微调数据集：JSONL（messages 格式）或 CSV；默认仅含标注为 good 的样本。"""
    fmt = (format or "jsonl").lower()
    if fmt not in ("jsonl", "json", "csv"):
        raise HTTPException(status_code=400, detail="导出格式仅支持 jsonl / json / csv")

    result = await db.execute(
        select(Generationlogs).order_by(Generationlogs.id.desc()).limit(MAX_EXPORT_ROWS)
    )
    records = result.scalars().all()
    ann_map = await _annotations_map(db, [r.id for r in records])

    rows: list[dict] = []
    for r in records:
        annotation = ann_map.get(r.id)
        if not include_unlabeled and (annotation is None or annotation["label"] != "good"):
            continue
        user_message = (r.user_message or "").strip()
        assistant_message = (r.assistant_message or "").strip()
        if not user_message or not assistant_message:
            continue
        rows.append(
            {
                "id": r.id,
                "project_id": r.project_id,
                "model": r.model,
                "label": annotation["label"] if annotation else None,
                "kb_sources": parse_json_array(r.kb_sources),
                "skill_names": parse_json_array(r.skill_names),
                "messages": [
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": assistant_message},
                ],
            }
        )

    if not rows:
        raise HTTPException(status_code=404, detail="暂无可导出的样本（需先在对话中产生回流并完成标注）")

    if fmt in ("jsonl", "json"):
        media_type = "application/x-ndjson" if fmt == "jsonl" else "application/json"
        if fmt == "jsonl":
            body = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
        else:
            body = json.dumps(rows, ensure_ascii=False, indent=2)
        filename = f"finetune-dataset.{fmt}"
    else:
        media_type = "text/csv"
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "project_id", "model", "label", "user_message", "assistant_message", "kb_sources", "skill_names"])
        for row in rows:
            writer.writerow(
                [
                    row["id"],
                    row["project_id"],
                    row["model"],
                    row["label"],
                    row["messages"][0]["content"],
                    row["messages"][1]["content"],
                    json.dumps(row["kb_sources"], ensure_ascii=False),
                    json.dumps(row["skill_names"], ensure_ascii=False),
                ]
            )
        body = output.getvalue()
        filename = "finetune-dataset.csv"

    logger.info(f"Dataset exported: format={fmt} rows={len(rows)}")
    return StreamingResponse(
        io.BytesIO(body.encode("utf-8")),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
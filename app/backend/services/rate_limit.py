"""匿名业务路由的内存级限速（不收集任何个人数据）。"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# 匿名接口安全约定：每 IP 每分钟 30 次写操作
WRITE_LIMIT = 30
WINDOW_SECONDS = 60

_buckets: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_write_rate_limit(request: Request) -> None:
    """写操作限速：超出配额抛 429。"""
    key = _client_ip(request)
    now = time.monotonic()
    bucket = _buckets[key]
    while bucket and now - bucket[0] > WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= WRITE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="请求过于频繁，请稍后再试",
        )
    bucket.append(now)
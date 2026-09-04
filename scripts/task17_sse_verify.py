"""任务17回归：模型池扩充后（3 旧 + 5 新 = 8 个）SSE 真实验证。

覆盖：
1. 预览后端 /api/v1/engine/gentxt × 8 模型（stream=true，真实 SSE）
2. 预览后端 /api/v1/engine/text-stream 别名 × 1 新模型
3. 跨域（部署域名 Origin）→ 预览后端 × 1 新模型
4. 部署域名 /api/v1/engine/gentxt × 1 新模型（部署后端暂无白名单，直接透传）

判定：HTTP 200、含 [DONE]、无 [ERROR]、至少 1 个内容帧。
"""
import base64
import json
import ssl
import sys
import urllib.error
import urllib.request

PREVIEW = "https://x4jln-11eca153605a42838371c1aab05637d0-preview.app.atoms.dev"
DEPLOY = "https://1w4rpkc.pub.atoms.world"

NEW_MODELS = ["gpt-5.4", "gpt-5.5", "gemini-3.1-pro-preview", "deepseek-v4-pro", "claude-opus-4.6"]
OLD_MODELS = ["claude-opus-5", "deepseek-v4-flash", "gpt-5.6-sol"]

CTX = ssl.create_default_context()


def probe(base_url: str, path: str, model: str, origin: str | None = None, timeout: int = 120) -> dict:
    payload = {
        # messages 为 Schema 必填字段：messages_b64 存在时其值会被解码结果覆盖，传空列表即可
        "messages": [],
        "messages_b64": base64.b64encode(
            json.dumps([{"role": "user", "content": "请只回复四个字：模型正常"}]).encode("utf-8")
        ).decode("ascii"),
        "model": model,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 128,
    }
    req = urllib.request.Request(base_url + path, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    # 真实浏览器特征：缺省 Python-urllib UA 会触发 Cloudflare 1010 浏览器签名拦截
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    )
    req.add_header("Accept", "text/event-stream, */*")
    if origin:
        req.add_header("Origin", origin)
    frames = 0
    body = ""
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", errors="replace")[:500]
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": None, "frames": 0, "reason": f"EXC {e}"}

    if status != 200:
        return {"ok": False, "status": status, "frames": 0, "reason": body[:200]}
    for line in body.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload_text = line[5:].strip()
            if payload_text == "[DONE]":
                continue
            frames += 1
    done = "[DONE]" in body
    has_error = "[ERROR]" in body
    ok = done and not has_error and frames > 0
    return {"ok": ok, "status": status, "frames": frames, "reason": "" if ok else f"done={done} err={has_error} frames={frames}"}


def main() -> int:
    results: list[tuple[str, dict]] = []

    for m in NEW_MODELS:
        results.append((f"preview /gentxt new {m}", probe(PREVIEW, "/api/v1/engine/gentxt", m)))
    for m in OLD_MODELS:
        results.append((f"preview /gentxt old {m}", probe(PREVIEW, "/api/v1/engine/gentxt", m)))

    results.append(("preview /text-stream new gemini-3.1-pro-preview", probe(PREVIEW, "/api/v1/engine/text-stream", "gemini-3.1-pro-preview")))
    results.append(("cross-origin(deploy Origin) /gentxt new gpt-5.4", probe(PREVIEW, "/api/v1/engine/gentxt", "gpt-5.4", origin=DEPLOY)))
    results.append(("deploy /gentxt new gpt-5.4", probe(DEPLOY, "/api/v1/engine/gentxt", "gpt-5.4")))

    failed = 0
    for name, r in results:
        mark = "PASS" if r["ok"] else "FAIL"
        if not r["ok"]:
            failed += 1
        print(f"[{mark}] {name} status={r['status']} frames={r['frames']} {r['reason']}")
    print(f"SUMMARY: {len(results) - failed}/{len(results)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
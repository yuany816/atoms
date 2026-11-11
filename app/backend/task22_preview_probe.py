"""任务22 探测脚本：预览入口「间歇性不可用」分层采样。

分层：页面壳 / 静态资源 / 后端接口 / 边缘特征。
方式：多轮次 + 每轮多次采样；每轮交替使用「服务器直连」与「近似浏览器会话」两种请求特征。
输出：逐次记录（时间戳、URL、模式、HTTP 状态、耗时、响应体前 200 字符），并汇总成功率与失败模式。
"""

import base64
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

PREVIEW = "https://x4jln-11eca153605a42838371c1aab05637d0-preview.app.atoms.dev"
DEPLOY = "https://1w4rpkc.pub.atoms.world"

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
CHALLENGE_HINTS = ("just a moment", "attention required", "cf-mitigated", "challenge-platform", "cdn-cgi")

ROUNDS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
ROUND_GAP = float(sys.argv[2]) if len(sys.argv) > 2 else 20.0

records = []


def build_browser_headers(origin):
    return {
        "User-Agent": CHROME_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Origin": origin,
        "Referer": f"{origin}/dashboard",
        "Cache-Control": "no-cache",
    }


def build_plain_headers():
    return {"User-Agent": CHROME_UA, "Accept": "*/*"}


def request_once(url, mode, origin, method="GET", body=None, accept=None):
    headers = build_browser_headers(origin) if mode == "browser" else build_plain_headers()
    if accept:
        headers["Accept"] = accept
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return {
                "status": resp.status,
                "elapsed": round(time.time() - started, 3),
                "size": len(raw),
                "text": raw.decode("utf-8", errors="replace"),
                "error": None,
                "content_type": resp.headers.get("content-type", ""),
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read() or b""
        return {
            "status": exc.code,
            "elapsed": round(time.time() - started, 3),
            "size": len(raw),
            "text": raw.decode("utf-8", errors="replace"),
            "error": None,
            "content_type": exc.headers.get("content-type", "") if exc.headers else "",
        }
    except Exception as exc:  # noqa: BLE001 - 连接重置/超时/解析失败统一归为传输异常
        return {
            "status": 0,
            "elapsed": round(time.time() - started, 3),
            "size": 0,
            "text": "",
            "error": type(exc).__name__ + ": " + str(exc)[:120],
            "content_type": "",
        }


def classify(target, result):
    """把单次结果归类为 OK 或具体失败模式。"""
    if result["error"]:
        return "TRANSFER_ERROR"
    status = result["status"]
    body = result["text"]
    lowered = body[:4000].lower()
    if any(hint in lowered for hint in CHALLENGE_HINTS):
        return "EDGE_CHALLENGE"
    if status in (502, 503, 504):
        return "EDGE_5XX"
    if status == 0:
        return "CONNECT_FAIL"
    if target["kind"] == "ai" and status == 200:
        return "OK" if "[DONE]" in body else "SSE_INCOMPLETE"
    if target["expect"] is not None and status != target["expect"]:
        return f"HTTP_{status}"
    if target["kind"] == "shell":
        # SPA 壳必须包含根节点，否则是白屏/错误页
        return "OK" if re.search(r'id="root"|id=\'root\'', body) else "SHELL_NO_ROOT"
    if target["kind"] == "bundle":
        return "OK" if len(body) > 1000 else "STATIC_TRUNCATED"
    return "OK"


def probe(target, sample_no, mode, round_no):
    origin = target.get("origin", PREVIEW)
    result = request_once(
        target["url"],
        mode,
        origin,
        method=target.get("method", "GET"),
        body=target.get("body"),
        accept=target.get("accept"),
    )
    verdict = classify(target, result)
    snippet = (result["text"] or result["error"] or "").replace("\n", " ")[:200]
    records.append(
        {
            "round": round_no,
            "sample": sample_no,
            "target": target["name"],
            "kind": target["kind"],
            "mode": mode,
            "status": result["status"],
            "elapsed": result["elapsed"],
            "size": result["size"],
            "verdict": verdict,
            "snippet": snippet,
        }
    )
    return verdict


def sse_body(model):
    messages = [{"role": "user", "content": "回复两个字：可用"}]
    encoded = base64.b64encode(json.dumps(messages, ensure_ascii=False).encode("utf-8")).decode("ascii")
    return json.dumps(
        {
            "model": model,
            "stream": True,
            "messages": [],
            "messages_b64": encoded,
            "project_id": "task22-probe",
        }
    ).encode("utf-8")


def detect_dev_server():
    """判断预览入口是否运行在 Vite dev server（开发态）。"""
    result = request_once(f"{PREVIEW}/", "browser", PREVIEW)
    html = result["text"]
    signals = {
        "vite_client": "@vite/client" in html,
        "src_main": "/src/main.tsx" in html,
        "hashed_assets": bool(re.search(r"/assets/index-[A-Za-z0-9_-]+\.js", html)),
        "module_type": 'type="module"' in html,
        "status": result["status"],
        "size": result["size"],
    }
    asset_match = re.search(r'/assets/index-[A-Za-z0-9_-]+\.js', html)
    signals["asset_path"] = asset_match.group(0) if asset_match else None
    src_match = re.search(r'/src/[A-Za-z0-9_./-]+\.tsx?', html)
    signals["src_path"] = src_match.group(0) if src_match else None
    return signals, html[:600]


def main():
    print(f"=== 第 0 步：预览入口形态判定（dev server?） ===")
    signals, head = detect_dev_server()
    for key, value in signals.items():
        print(f"  {key}: {value}")
    print(f"  head: {head[:300].replace(chr(10), ' ')}")

    asset_path = signals.get("asset_path") or "/assets/index-B8_rjsJW.js"

    targets = [
        {"name": "预览根路径", "url": f"{PREVIEW}/", "kind": "shell", "expect": 200},
        {"name": "预览/dashboard", "url": f"{PREVIEW}/dashboard", "kind": "shell", "expect": 200},
        {"name": "预览/knowledge", "url": f"{PREVIEW}/knowledge", "kind": "shell", "expect": 200},
        {"name": "预览/skills", "url": f"{PREVIEW}/skills", "kind": "shell", "expect": 200},
        {"name": "预览/evaluation", "url": f"{PREVIEW}/evaluation", "kind": "shell", "expect": 200},
        {"name": "静态入口bundle", "url": f"{PREVIEW}{asset_path}", "kind": "bundle", "expect": 200,
         "accept": "application/javascript,*/*"},
        {"name": "静态/src/main.tsx", "url": f"{PREVIEW}/src/main.tsx", "kind": "static", "expect": None,
         "accept": "application/javascript,*/*"},
        {"name": "静态/src/lib/engine.ts", "url": f"{PREVIEW}/src/lib/engine.ts", "kind": "static", "expect": None,
         "accept": "application/javascript,*/*"},
        {"name": "接口/docs", "url": f"{PREVIEW}/docs", "kind": "api", "expect": 200},
        {"name": "接口/skills", "url": f"{PREVIEW}/api/v1/skills", "kind": "api", "expect": 200},
        {"name": "接口/eval/stats", "url": f"{PREVIEW}/api/v1/eval/stats", "kind": "api", "expect": 200},
        {"name": "接口/kb(GET)", "url": f"{PREVIEW}/api/v1/kb", "kind": "api", "expect": 405},
        {"name": "AI/gentxt", "url": f"{PREVIEW}/api/v1/engine/gentxt", "kind": "ai", "expect": 200,
         "method": "POST", "body": sse_body("deepseek-chat"),
         "accept": "text/event-stream", "samples": 3},
        {"name": "AI/text-stream", "url": f"{PREVIEW}/api/v1/engine/text-stream", "kind": "ai", "expect": 200,
         "method": "POST", "body": sse_body("deepseek-chat"),
         "accept": "text/event-stream", "samples": 3},
    ]

    samples_by_kind = {"shell": 8, "bundle": 8, "static": 6, "api": 6, "ai": 3}

    for round_no in range(1, ROUNDS + 1):
        print(f"\n=== 第 {round_no} 轮采样（间隔 {ROUND_GAP:.0f}s/轮） ===")
        for target in targets:
            n = target.get("samples") or samples_by_kind[target["kind"]]
            verdicts = []
            for i in range(1, n + 1):
                mode = "browser" if i % 2 == 1 else "plain"
                verdicts.append(probe(target, i, mode, round_no))
                time.sleep(0.25)
            ok = verdicts.count("OK")
            detail = ", ".join(f"{v}:{verdicts.count(v)}" for v in sorted(set(verdicts)))
            print(f"  {target['name']:<24} OK {ok}/{n}  [{detail}]")
        if round_no < ROUNDS:
            time.sleep(ROUND_GAP)

    print("\n=== 汇总：按目标统计 ===")
    by_target = {}
    for rec in records:
        by_target.setdefault(rec["target"], []).append(rec)
    for name, recs in by_target.items():
        total = len(recs)
        ok = sum(1 for r in recs if r["verdict"] == "OK")
        latencies = [r["elapsed"] for r in recs if r["status"]]
        failures = {}
        for r in recs:
            if r["verdict"] != "OK":
                failures[r["verdict"]] = failures.get(r["verdict"], 0) + 1
        p50 = round(statistics.median(latencies), 3) if latencies else None
        p95 = round(sorted(latencies)[int(len(latencies) * 0.95) - 1], 3) if latencies else None
        print(
            f"  {name:<24} 成功 {ok}/{total} ({ok * 100.0 / total:.0f}%)  p50={p50}s p95={p95}s"
            + (f"  失败={failures}" if failures else "")
        )

    print("\n=== 汇总：按请求模式（服务器直连 / 浏览器会话） ===")
    for mode in ("browser", "plain"):
        recs = [r for r in records if r["mode"] == mode]
        ok = sum(1 for r in recs if r["verdict"] == "OK")
        print(f"  {mode}: {ok}/{len(recs)} ({ok * 100.0 / len(recs):.0f}%)")

    print("\n=== 失败明细（最多 40 条） ===")
    for rec in [r for r in records if r["verdict"] != "OK"][:40]:
        print(
            f"  R{rec['round']}S{rec['sample']} {rec['target']} {rec['mode']} "
            f"status={rec['status']} {rec['elapsed']}s {rec['verdict']} | {rec['snippet'][:120]}"
        )

    with open("/workspace/app/backend/task22_probe_records.json", "w", encoding="utf-8") as handle:
        json.dump(records, handle, ensure_ascii=False, indent=2)
    print("\n明细已写入 task22_probe_records.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""任务21 验证脚本：DeepSeek 官方直连通道与平台 Hub 失败自动回退。

覆盖项（浏览器特征请求：Chrome UA + messages_b64 + 无自定义头）：
1. 预览同源 /gentxt × deepseek-chat / deepseek-reasoner（直连主通道）
2. 部署域名同源 /gentxt、/text-stream × deepseek-chat（新代码随发布流程刷新前预期 400，属发布节奏）
3. 跨域回退路径（部署 Origin → 预览后端）× deepseek-chat
4. 平台 Hub 失败自动回退：claude-opus-5 / deepseek-v4-flash（当前 Hub 余额不足）
   → 期望无 [ERROR]、返回真实内容（DeepSeek 兜底出内容，回退在 [ERROR] 帧之前完成）
"""

import base64
import json
import urllib.error
import urllib.request

PREVIEW = "https://x4jln-11eca153605a42838371c1aab05637d0-preview.app.atoms.dev"
DEPLOY = "https://1w4rpkc.pub.atoms.world"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def build_payload(model):
    messages = [{"role": "user", "content": "用一句简短的中文介绍你自己，并说明你由哪个模型驱动"}]
    encoded = base64.b64encode(json.dumps(messages, ensure_ascii=False).encode("utf-8")).decode("ascii")
    body = {
        "model": model,
        "stream": True,
        "messages": [],
        "messages_b64": encoded,
        "project_id": "task21-verify",
    }
    return json.dumps(body).encode("utf-8")


def sse_call(url, model, origin=None):
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "User-Agent": UA}
    if origin:
        headers["Origin"] = origin
        headers["Referer"] = f"{origin}/"
    request = urllib.request.Request(url, data=build_payload(model), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            status = response.status
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")[:300], ""
    except Exception as exc:  # noqa: BLE001
        return 0, f"EXCEPTION {exc}", ""

    parts = []
    errored = False
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
        except json.JSONDecodeError:
            continue
        content = obj.get("content")
        if isinstance(content, str) and content:
            if content.startswith("[ERROR]"):
                errored = True
            parts.append(content)
    text = "".join(parts)
    verdict = "OK" if (status == 200 and text and not errored and "[DONE]" in raw) else "FAIL"
    return status, text, verdict


def run(name, url, model, origin=None, expect_ok=True):
    status, text, verdict = sse_call(url, model, origin)
    tag = verdict if expect_ok else "INFO"
    snippet = text.replace("\n", " ")[:150]
    print(f"[{tag}] {name} | model={model} | HTTP={status} | {snippet}")
    return (verdict == "OK") if expect_ok else True


def main():
    results = []
    print("== 1. 预览同源（DeepSeek 直连主通道） ==")
    results.append(run("预览同源 /gentxt", f"{PREVIEW}/api/v1/engine/gentxt", "deepseek-chat"))
    results.append(run("预览同源 /gentxt", f"{PREVIEW}/api/v1/engine/gentxt", "deepseek-reasoner"))

    print("== 2. 部署域名同源（新代码待发布流程刷新，白名单 400 属预期） ==")
    results.append(run("部署同源 /gentxt", f"{DEPLOY}/api/v1/engine/gentxt", "deepseek-chat", expect_ok=False))
    results.append(run("部署同源 /text-stream", f"{DEPLOY}/api/v1/engine/text-stream", "deepseek-chat", expect_ok=False))

    print("== 3. 跨域回退路径（部署 Origin → 预览后端） ==")
    results.append(run("跨域回退 /gentxt", f"{PREVIEW}/api/v1/engine/gentxt", "deepseek-chat", origin=DEPLOY))

    print("== 4. 平台 Hub 失败自动回退（Hub 当前余额不足 → DeepSeek 兜底） ==")
    results.append(run("Hub失败回退 claude-opus-5", f"{PREVIEW}/api/v1/engine/gentxt", "claude-opus-5"))
    results.append(run("Hub失败回退 deepseek-v4-flash", f"{PREVIEW}/api/v1/engine/gentxt", "deepseek-v4-flash"))

    print(f"\nSUMMARY: {sum(results)}/{len(results)} 项符合预期")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())

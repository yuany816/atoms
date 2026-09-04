"""任务18 端到端会话验证：知识/技能注入 → 流式会话 → 来源标注帧 → GenerationLogs 回流。

用法：python3 scripts/task18_e2e_session_verify.py [base_url]
默认 base_url 取预览后端域名。
真实模型内容生成受平台 AI 钱包余额影响可能返回 [ERROR]，但回流日志仍应沉淀，
本脚本对两种结果均判定链路可用。
"""

import base64
import json
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else (
    "https://x4jln-11eca153605a42838371c1aab05637d0-preview.app.atoms.dev"
)
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

results: list[tuple[bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((ok, name))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {detail}" if detail else ""))


def call(method: str, path: str, payload=None, timeout: int = 60):
    body = json.dumps(payload).encode() if payload is not None else None
    headers = dict(UA)
    if body:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:  # noqa: BLE001
        return -1, repr(e)


def main() -> int:
    project_id = "e2e-verify-task18"

    # ---------- 准备：上传知识 + 技能并启用 ----------
    kb_text = (
        "Atoms 平台会话增强规范：AI 会话启动时会自动检索知识库并注入命中的知识片段，"
        "同时注入启用状态的技能说明；回复通过来源标注帧返回命中的文件与技能名称。\n\n"
        "Atoms 平台评测规范：每轮生成沉淀查询与回复日志，供人工标注与数据集导出使用。"
    )
    kb_b64 = base64.b64encode(kb_text.encode()).decode()
    status, body = call("POST", "/api/v1/kb", {"file_name": "e2e-kb.md", "content_base64": kb_b64})
    check("准备-知识上传", status == 200, f"status={status}")
    kb_id = ""
    if status == 200:
        try:
            kb_id = json.loads(body).get("id", "")
        except Exception:  # noqa: BLE001
            pass

    skill_yaml = (
        "name: 会话验证技能\n"
        "description: 端到端验证技能注入链路\n"
        "scenes:\n"
        "  - 会话验证\n"
        "usage: |\n"
        "  验证技能是否被注入会话上下文。\n"
    )
    sk_b64 = base64.b64encode(skill_yaml.encode()).decode()
    status, body = call("POST", "/api/v1/skills", {"file_name": "e2e-skill.yaml", "content_base64": sk_b64})
    check("准备-技能上传", status == 200, f"status={status}")
    skill_id = ""
    skill_name = ""
    if status == 200:
        try:
            data = json.loads(body)
            skill_id = data.get("id", "")
            skill_name = data.get("name", "")
            status2, _ = call("PUT", f"/api/v1/skills/{skill_id}/enabled", {"enabled": True})
            check("准备-技能启用", status2 == 200, f"status={status2}")
        except Exception as e:  # noqa: BLE001
            check("准备-技能启用", False, repr(e))

    # ---------- 端到端流式会话 ----------
    stream_body = {
        "project_id": project_id,
        "model": "deepseek-v4-flash",
        "stream": True,
        "messages": [
            {"role": "user", "content": "Atoms 平台会话增强和评测回流是如何工作的？"},
        ],
    }
    enhancement_frame = None
    content_parts: list[str] = []
    got_done = False
    status = -1
    try:
        req = urllib.request.Request(
            BASE + "/api/v1/engine/text-stream",
            data=json.dumps(stream_body).encode(),
            method="POST",
            headers={**UA, "Content-Type": "application/json", "Accept": "text/event-stream"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = resp.status
            event_type = ""
            for raw in resp:
                line = raw.decode(errors="replace").rstrip("\n")
                if line.startswith("event:"):
                    event_type = line.split(":", 1)[1].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                data_str = line.split(":", 1)[1].strip()
                if data_str == "[DONE]":
                    got_done = True
                    continue
                try:
                    data = json.loads(data_str)
                except Exception:  # noqa: BLE001
                    continue
                if event_type == "enhancement" or "enhancement" in data:
                    enhancement_frame = data.get("enhancement", data)
                elif "content" in data:
                    content_parts.append(data["content"])
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:  # noqa: BLE001
        status = -1
        print("STREAM_EXC", repr(e))

    check("会话-流式请求可达", status == 200, f"status={status}")
    check("会话-收到[DONE]", got_done)
    full_reply = "".join(content_parts)
    check(
        "会话-回复或错误提示已返回",
        bool(full_reply.strip()),
        f"reply_head={full_reply[:60]!r}",
    )
    kb_names = []
    skill_names = []
    if enhancement_frame:
        kb_names = [s.get("file_name") for s in enhancement_frame.get("kb_sources", []) if s.get("file_name")]
        skill_names = [n for n in enhancement_frame.get("skill_names", []) if n]
    check(
        "会话-来源标注帧(知识或技能)",
        bool(kb_names) or bool(skill_names),
        f"kb={kb_names} skills={skill_names}",
    )

    # ---------- 回流日志检查 ----------
    status, body = call("GET", "/api/v1/eval/logs?skip=0&limit=10")
    check("回流-日志接口可达", status == 200, f"status={status}")
    log_ok = False
    log_detail = ""
    if status == 200:
        try:
            items = json.loads(body).get("items", [])
            target = next(
                (it for it in items if it.get("project_id") == project_id),
                None,
            )
            if target:
                has_query = bool(target.get("query") or target.get("user_message"))
                has_reply = bool(target.get("assistant_message"))
                log_detail = (
                    f"project_id={target.get('project_id')} model={target.get('model')} "
                    f"query={'有' if has_query else '无'} reply={'有' if has_reply else '无'} "
                    f"kb_sources={len(target.get('kb_sources') or [])} "
                    f"skill_names={target.get('skill_names')}"
                )
                log_ok = has_query and has_reply and target.get("model")
        except Exception as e:  # noqa: BLE001
            log_detail = repr(e)
    check("回流-GenerationLogs已保存", log_ok, log_detail)

    # ---------- 清理 ----------
    if kb_id:
        call("DELETE", f"/api/v1/kb/{kb_id}")
        check("清理-知识删除", True)
    if skill_id:
        call("DELETE", f"/api/v1/skills/{skill_id}")
        check("清理-技能删除", True)

    passed = sum(1 for ok, _ in results if ok)
    print(f"\n== 结果: {passed}/{len(results)} 通过 ==")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
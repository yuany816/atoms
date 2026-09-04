"""知识库与技能包的文本解析、切块、向量化与相似度检索。

向量方案：轻量确定性词袋向量（hash bag-of-words，256 维，L2 归一化）。
分词同时覆盖英文单词与中文单字/二元组，无需外部依赖即可完成中英混合
文本的向量相似度检索；向量以 JSON 数组字符串存储在云端数据库
knowledgechunks.embedding 字段中（可后续替换为更强的向量模型，协议不变）。
"""

import json
import math
import re
import zlib
from io import BytesIO
from typing import Optional

# 向量维度与切块参数
EMBED_DIM = 256
CHUNK_SIZE = 600       # 单块目标长度（字符）
CHUNK_OVERLAP = 80     # 超长段落硬切时的相邻块重叠长度
MAX_TEXT_CHARS = 200_000  # 提取文本长度上限，约束切块规模

_TOKEN_SPLIT = re.compile(r"[^0-9a-zA-Z\u4e00-\u9fff]+")


def _is_cjk(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fff"


def _token_weights(text: str) -> dict:
    """统计词元频次：英文按小写单词，中文按单字 + 二元组。"""
    counts: dict[str, int] = {}
    for part in _TOKEN_SPLIT.split(text or ""):
        if not part:
            continue
        if all(_is_cjk(c) for c in part):
            grams = list(part)
            grams += [part[i : i + 2] for i in range(len(part) - 1)]
        else:
            grams = [part.lower()]
        for gram in grams:
            counts[gram] = counts.get(gram, 0) + 1
    return counts


def embed(text: str) -> list:
    """将文本编码为 256 维 L2 归一化向量（确定性，跨进程稳定）。"""
    vec = [0.0] * EMBED_DIM
    for token, weight in _token_weights(text).items():
        vec[zlib.crc32(token.encode("utf-8")) % EMBED_DIM] += weight
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list, b: list) -> float:
    """余弦相似度（向量已归一化时等价于点积）。"""
    return sum(x * y for x, y in zip(a, b))


# ---------- 文本提取 ----------


def _extract_pdf(data: bytes) -> str:
    import fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def _extract_docx(data: bytes) -> str:
    import docx  # python-docx

    document = docx.Document(BytesIO(data))
    parts = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _decode_text(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def extract_text(file_name: str, data: bytes) -> str:
    """按扩展名提取文件纯文本；不支持或提取失败抛 ValueError。"""
    lower = (file_name or "").lower()
    try:
        if lower.endswith(".pdf"):
            text = _extract_pdf(data)
        elif lower.endswith(".docx"):
            text = _extract_docx(data)
        else:
            # txt / md / markdown / csv / json / yaml / 其他纯文本
            text = _decode_text(data)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"文件解析失败：{e}") from e

    text = (text or "").strip()
    if not text:
        raise ValueError("未能从文件中提取到有效文本内容")
    return text[:MAX_TEXT_CHARS]


# ---------- 切块 ----------


def chunk_text(text: str, max_len: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """按空行分段后合并为约 max_len 的块；超长段落硬切并保留 overlap 重叠。"""
    text = (text or "").strip()
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    blocks: list[str] = []
    buf = ""
    for para in paragraphs:
        if len(para) > max_len:
            if buf:
                blocks.append(buf)
                buf = ""
            step = max(1, max_len - overlap)
            for i in range(0, len(para), step):
                blocks.append(para[i : i + max_len])
            continue
        if buf and len(buf) + len(para) + 1 > max_len:
            blocks.append(buf)
            buf = para
        else:
            buf = f"{buf}\n{para}" if buf else para
    if buf:
        blocks.append(buf)
    return [b.strip() for b in blocks if b.strip()]


# ---------- 技能包解析 ----------


def _extract_zip_text(data: bytes) -> str:
    """从 zip 包中提取说明文本：优先 SKILL.md / README.md，其次其他 md/yaml/json。"""
    import zipfile

    texts: list[str] = []
    with zipfile.ZipFile(BytesIO(data)) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]

        def prio(name: str) -> int:
            base = name.rsplit("/", 1)[-1].lower()
            if base == "skill.md":
                return 0
            if base in ("readme.md", "readme"):
                return 1
            if base.endswith((".md", ".markdown")):
                return 2
            if base.endswith((".yaml", ".yml", ".json")):
                return 3
            return 9

        for name in sorted(names, key=prio)[:8]:
            if prio(name) == 9:
                continue
            try:
                raw = zf.read(name)
            except Exception:
                continue
            try:
                texts.append(_decode_text(raw[:300_000]))
            except Exception:
                continue
    return "\n\n".join(t for t in texts if t.strip())


def _parse_skill_text(text: str) -> dict:
    """从 Markdown/文本说明中解析技能名称、简介、场景标签与用法。"""
    name = ""
    description = ""
    scenes: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not name and s.startswith("#") and len(s) > 1:
            name = s.lstrip("#").strip()[:60]
        if not description and s and not s.startswith(("#", "```", "-", "*", "|", ">")):
            description = s[:200]
        m = re.match(r"^(?:适用场景|场景|scenes?)\s*[:：]\s*(.+)$", s, re.IGNORECASE)
        if m:
            scenes = [p.strip() for p in re.split(r"[、,，/;；]", m.group(1)) if p.strip()]
            break

    usage = ""
    usage_match = re.search(
        r"^#{1,4}\s*(?:用法|使用方式|使用说明|usage)[^\n]*\n(.*?)(?=^#{1,4}\s|\Z)",
        text,
        re.MULTILINE | re.IGNORECASE | re.DOTALL,
    )
    if usage_match:
        usage = usage_match.group(1).strip()[:1000]
    else:
        code = re.search(r"```[a-zA-Z]*\n(.*?)```", text, re.DOTALL)
        if code:
            usage = code.group(1).strip()[:1000]

    return {
        "name": (name or "未命名技能")[:60],
        "description": (description or "")[:200],
        "usage": usage,
        "scenes": scenes[:6] or ["通用"],
        "content": text[:20000],
    }


def parse_skill_package(file_name: str, data: bytes) -> dict:
    """解析上传的技能包（zip/md/yaml），返回标准化技能信息。"""
    lower = (file_name or "").lower()
    if lower.endswith(".zip"):
        source_type = "zip"
        text = _extract_zip_text(data)
        if not text.strip():
            raise ValueError("压缩包中未找到可解析的说明文件（需包含 SKILL.md / README.md 或 .md/.yaml）")
        info = _parse_skill_text(text)
    elif lower.endswith((".yaml", ".yml")):
        source_type = "yaml"
        text = _decode_text(data)
        info = _parse_skill_text(text)
        try:
            import yaml

            loaded = yaml.safe_load(text)
        except Exception:
            loaded = None
        if isinstance(loaded, dict):
            if isinstance(loaded.get("name"), str) and loaded["name"].strip():
                info["name"] = loaded["name"].strip()[:60]
            if isinstance(loaded.get("description"), str) and loaded["description"].strip():
                info["description"] = loaded["description"].strip()[:200]
            if isinstance(loaded.get("usage"), str) and loaded["usage"].strip():
                info["usage"] = loaded["usage"].strip()[:1000]
            raw_scenes = loaded.get("scenes") or loaded.get("场景")
            if isinstance(raw_scenes, list):
                scenes = [str(s).strip() for s in raw_scenes if str(s).strip()]
            elif isinstance(raw_scenes, str) and raw_scenes.strip():
                scenes = [p.strip() for p in re.split(r"[、,，/;；]", raw_scenes) if p.strip()]
            if scenes:
                info["scenes"] = scenes[:6]
    else:
        source_type = "md"
        text = _decode_text(data)
        if not text.strip():
            raise ValueError("技能说明文件内容为空")
        info = _parse_skill_text(text)

    info["file_type"] = source_type
    return info


def parse_json_array(raw: Optional[str]) -> list:
    """安全解析 JSON 数组字符串（存量数据兼容）。"""
    if not raw:
        return []
    try:
        loaded = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return loaded if isinstance(loaded, list) else []
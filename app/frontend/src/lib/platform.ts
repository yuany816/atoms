import { client } from '@/lib/api';

/**
 * 平台层：共享类型、模型池、内置模板、云端 API 封装与文件字典转换。
 * 所有后端调用统一走 web-sdk 的 client.apiCall.invoke，禁止直接 fetch。
 */

// ---------- 共享类型 ----------

export interface ProjectFile {
  path: string;
  content: string;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  createdAt: number;
  error?: boolean;
}

export interface TerminalLog {
  id: string;
  time: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface Project {
  id: string;
  name: string;
  templateId: string;
  files: ProjectFile[];
  messages: ChatMessage[];
  logs: TerminalLog[];
  publishedSlug?: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- 文本模型池（用户指定白名单，claude-opus-5 为默认；2026-09-04 扩充：3 原有 + 5 新增；2026-09-10 增补 DeepSeek 官方直连 2 项） ----------

export const MODEL_POOL = [
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat（官方直连）' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner（官方直连）' },
] as const;

export const DEFAULT_MODEL: string = MODEL_POOL[0].id;

// ---------- 工具函数 ----------

export function uid(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}-${rand}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function getErrorDetail(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const err = e as {
    message?: string;
    data?: { detail?: string };
    response?: { data?: { detail?: string } };
  };
  return err.data?.detail || err.response?.data?.detail || err.message || String(e);
}

export function filesToDict(files: ProjectFile[]): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const f of files) dict[f.path] = f.content;
  return dict;
}

export function dictToFiles(dict: Record<string, string>): ProjectFile[] {
  return Object.entries(dict).map(([path, content]) => ({ path, content, updatedAt: Date.now() }));
}

export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  if (base.length >= 3) return base;
  return `app-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- 内置官方模板（静态模板包，创建项目时深拷贝） ----------

export interface AppTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  files: { path: string; content: string }[];
}

const TODO_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>待办清单</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f7f7f5; color: #37352f; display: flex; justify-content: center; padding: 48px 16px; }
  .app { width: 100%; max-width: 520px; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  .sub { color: #9b9a97; margin-bottom: 24px; font-size: 14px; }
  .row { display: flex; gap: 8px; margin-bottom: 20px; }
  input { flex: 1; padding: 10px 12px; border: 1px solid #e3e2e0; border-radius: 6px; font-size: 14px; outline: none; }
  input:focus { border-color: #9b9a97; }
  button.add { padding: 10px 18px; background: #37352f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button.add:hover { background: #55534e; }
  .item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid #ececeb; border-radius: 6px; margin-bottom: 8px; }
  .item input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; }
  .item .text { flex: 1; font-size: 14px; }
  .item.done .text { text-decoration: line-through; color: #9b9a97; }
  .item .del { background: none; border: none; color: #c3c2c0; cursor: pointer; font-size: 16px; }
  .item .del:hover { color: #eb5757; }
  .empty { text-align: center; color: #9b9a97; padding: 32px 0; font-size: 14px; }
  .count { margin-top: 12px; font-size: 12px; color: #9b9a97; }
</style>
</head>
<body>
<div class="app">
  <h1>待办清单</h1>
  <p class="sub">数据通过 window.atoms.data 云端保存</p>
  <div class="row">
    <input id="input" placeholder="添加一条待办，回车确认" />
    <button class="add" id="addBtn">添加</button>
  </div>
  <div id="list"></div>
  <div class="count" id="count"></div>
</div>
<script>
  var items = [];
  var listEl = document.getElementById('list');
  var countEl = document.getElementById('count');

  function render() {
    listEl.innerHTML = '';
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'item' + (item.data.done ? ' done' : '');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!item.data.done;
      box.onchange = function () { toggle(item); };
      var text = document.createElement('span');
      text.className = 'text';
      text.textContent = item.data.text;
      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.onclick = function () { remove(item); };
      row.appendChild(box); row.appendChild(text); row.appendChild(del);
      listEl.appendChild(row);
    });
    var done = items.filter(function (i) { return i.data.done; }).length;
    countEl.textContent = '共 ' + items.length + ' 条，已完成 ' + done + ' 条';
  }

  function addItem() {
    var input = document.getElementById('input');
    var text = input.value.trim();
    if (!text) return;
    window.atoms.data.create('todos', { text: text, done: false }).then(function (created) {
      items.push(created);
      input.value = '';
      render();
    });
  }

  function toggle(item) {
    window.atoms.data.update('todos', item.id, { text: item.data.text, done: !item.data.done }).then(function (updated) {
      item.data = updated.data;
      render();
    });
  }

  function remove(item) {
    window.atoms.data.remove('todos', item.id).then(function () {
      items = items.filter(function (i) { return i.id !== item.id; });
      render();
    });
  }

  document.getElementById('addBtn').onclick = addItem;
  document.getElementById('input').addEventListener('keydown', function (e) { if (e.key === 'Enter') addItem(); });

  window.atoms.data.list('todos').then(function (data) { items = data; render(); });
</script>
</body>
</html>
`;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>云笔记 · 让灵感随时落地</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #37352f; background: #fff; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 48px; border-bottom: 1px solid #f0f0ef; }
  .logo { font-weight: 700; font-size: 18px; }
  nav a { margin-left: 24px; color: #5f5e5b; text-decoration: none; font-size: 14px; }
  nav a:hover { color: #37352f; }
  .hero { text-align: center; padding: 96px 24px 72px; background: linear-gradient(180deg, #fbfbfa 0%, #fff 100%); }
  .hero h1 { font-size: 44px; line-height: 1.25; margin-bottom: 16px; }
  .hero p { color: #787774; font-size: 18px; margin-bottom: 32px; }
  .cta { display: inline-block; background: #37352f; color: #fff; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-size: 15px; }
  .cta:hover { background: #55534e; }
  .features { display: flex; gap: 24px; padding: 64px 48px; max-width: 1080px; margin: 0 auto; flex-wrap: wrap; }
  .card { flex: 1; min-width: 240px; border: 1px solid #f0f0ef; border-radius: 12px; padding: 28px; background: #fbfbfa; }
  .card h3 { margin: 12px 0 8px; font-size: 17px; }
  .card p { color: #787774; font-size: 14px; line-height: 1.7; }
  .icon { font-size: 28px; }
  footer { text-align: center; color: #9b9a97; font-size: 13px; padding: 40px; border-top: 1px solid #f0f0ef; }
</style>
</head>
<body>
<header>
  <div class="logo">☁️ 云笔记</div>
  <nav><a href="#features">功能</a><a href="#features">价格</a><a href="#features">关于</a></nav>
</header>
<section class="hero">
  <h1>让每一个灵感，随时落地</h1>
  <p>云笔记 —— 团队协作与知识管理的一站式工作空间，免费开始使用。</p>
  <a class="cta" href="#features">免费开始</a>
</section>
<section class="features" id="features">
  <div class="card"><div class="icon">📝</div><h3>多端同步</h3><p>手机、平板、电脑实时同步，随时随地记录与查阅你的每一个想法。</p></div>
  <div class="card"><div class="icon">👥</div><h3>团队协作</h3><p>与团队成员共享页面、分配任务、实时评论，让协作更顺畅。</p></div>
  <div class="card"><div class="icon">🔍</div><h3>强大检索</h3><p>全文检索与标签体系，帮助你在海量笔记中快速找到所需内容。</p></div>
</section>
<footer>© 2026 云笔记 · 用心记录每一刻</footer>
</body>
</html>
`;

const PROFILE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>李晓阳 · 个人主页</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f7f7f5; color: #37352f; display: flex; justify-content: center; padding: 56px 16px; }
  .page { max-width: 640px; width: 100%; }
  .head { display: flex; align-items: center; gap: 20px; margin-bottom: 32px; }
  .avatar { width: 88px; height: 88px; border-radius: 50%; background: #e8e7e4; display: flex; align-items: center; justify-content: center; font-size: 40px; flex-shrink: 0; }
  h1 { font-size: 26px; }
  .bio { color: #787774; font-size: 14px; margin-top: 6px; line-height: 1.7; }
  h2 { font-size: 16px; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e9e8e6; }
  ul { list-style: none; }
  li { background: #fff; border: 1px solid #ececeb; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; font-size: 14px; }
  li b { display: block; margin-bottom: 4px; }
  li span { color: #787774; line-height: 1.6; }
  .tags span { display: inline-block; background: #ececeb; color: #5f5e5b; border-radius: 4px; padding: 3px 10px; font-size: 12px; margin: 0 6px 6px 0; }
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div class="avatar">🧑‍💻</div>
    <div>
      <h1>李晓阳</h1>
      <p class="bio">前端工程师 / 独立开发者。热爱构建简洁有用的产品，现专注于效率工具与 Web 体验。</p>
    </div>
  </div>
  <h2>项目经历</h2>
  <ul>
    <li><b>📊 数据看板助手</b><span>面向小团队的轻量级数据可视化工具，支持一键生成图表看板。</span></li>
    <li><b>✅ 轻待办</b><span>极简待办应用，专注快速录入与清晰回顾，累计用户 2 万+。</span></li>
  </ul>
  <h2>技能标签</h2>
  <div class="tags"><span>React</span><span>TypeScript</span><span>Node.js</span><span>产品设计</span><span>独立开发</span></div>
</div>
</body>
</html>
`;

export const TEMPLATES: AppTemplate[] = [
  {
    id: 'blank',
    name: '空白项目',
    emoji: '✨',
    description: '从零开始，通过对话描述你的想法，由 AI 生成应用。',
    files: [],
  },
  {
    id: 'todo',
    name: '待办清单',
    emoji: '✅',
    description: '带云端数据保存的极简待办应用，演示 window.atoms.data 用法。',
    files: [{ path: 'index.html', content: TODO_HTML }],
  },
  {
    id: 'landing',
    name: '产品落地页',
    emoji: '🚀',
    description: 'Notion 风格的 SaaS 产品落地页，含导航、主视觉与功能卡片。',
    files: [{ path: 'index.html', content: LANDING_HTML }],
  },
  {
    id: 'profile',
    name: '个人主页',
    emoji: '🧑‍💻',
    description: '简洁的个人介绍页，适合作品集与个人品牌展示。',
    files: [{ path: 'index.html', content: PROFILE_HTML }],
  },
];

export function getTemplate(id: string): AppTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

// ---------- 云端 API 封装（匿名接口，经 web-sdk 调用） ----------

export async function checkSlug(slug: string): Promise<{ available: boolean }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/publish/check-slug',
    method: 'GET',
    data: { slug },
  });
  return (res as unknown as { data: { available: boolean } }).data;
}

export async function publishProject(payload: {
  project_id: string;
  name: string;
  slug: string;
  files: Record<string, string>;
}): Promise<{ slug: string; url: string }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/publish',
    method: 'POST',
    data: payload,
  });
  return (res as unknown as { data: { slug: string; url: string } }).data;
}

export interface PublishedSnapshot {
  name: string;
  slug: string;
  project_id: string;
  files: Record<string, string>;
  published_at?: string;
}

export async function fetchPublished(slug: string): Promise<PublishedSnapshot> {
  const res = await client.apiCall.invoke({
    url: `/api/v1/publish/${encodeURIComponent(slug)}`,
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: PublishedSnapshot }).data;
}

export async function createShare(payload: {
  project_id: string;
  name: string;
  snapshot: Record<string, unknown>;
}): Promise<{ token: string; url: string }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/share',
    method: 'POST',
    data: payload,
  });
  return (res as unknown as { data: { token: string; url: string } }).data;
}

export interface ShareSnapshot {
  name: string;
  project_id: string;
  snapshot: { messages?: unknown; files?: Record<string, string> };
  created_at?: string;
}

export async function fetchShare(token: string): Promise<ShareSnapshot> {
  const res = await client.apiCall.invoke({
    url: `/api/v1/share/${encodeURIComponent(token)}`,
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: ShareSnapshot }).data;
}

export async function uploadAsset(payload: {
  project_id: string;
  filename: string;
  content_type: string;
  file_base64: string;
}): Promise<{ url: string; object_key: string }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/projects/upload',
    method: 'POST',
    data: payload,
  });
  return (res as unknown as { data: { url: string; object_key: string } }).data;
}

// ---------- 知识库 API（任务18） ----------

export interface KbFile {
  id: number;
  file_name: string;
  file_type: string;
  size_bytes: number;
  chunk_count: number;
  status: string;
  created_at?: string;
}

export interface KbChunk {
  id: number;
  chunk_index: number;
  content: string;
}

export async function uploadKbFile(payload: {
  file_name: string;
  content_base64: string;
}): Promise<KbFile> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/kb',
    method: 'POST',
    data: payload,
  });
  return (res as unknown as { data: KbFile }).data;
}

export async function listKbFiles(): Promise<{ items: KbFile[]; total: number }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/kb/files',
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: { items: KbFile[]; total: number } }).data;
}

export async function listKbChunks(
  fileId: number,
): Promise<{ file: KbFile; items: KbChunk[]; total: number }> {
  const res = await client.apiCall.invoke({
    url: `/api/v1/kb/files/${fileId}/chunks`,
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: { file: KbFile; items: KbChunk[]; total: number } }).data;
}

export async function deleteKbFile(fileId: number): Promise<void> {
  await client.apiCall.invoke({
    url: `/api/v1/kb/files/${fileId}`,
    method: 'DELETE',
    data: {},
  });
}

// ---------- 技能配置 API（任务18） ----------

export interface SkillPackage {
  id: number;
  name: string;
  file_name: string;
  file_type: string;
  scenes: string[];
  description: string;
  usage: string;
  enabled: boolean;
  created_at?: string;
}

export async function uploadSkillPackage(payload: {
  file_name: string;
  content_base64: string;
}): Promise<SkillPackage> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/skills',
    method: 'POST',
    data: payload,
  });
  return (res as unknown as { data: SkillPackage }).data;
}

export async function listSkills(): Promise<{ items: SkillPackage[]; total: number }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/skills',
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: { items: SkillPackage[]; total: number } }).data;
}

export async function toggleSkill(skillId: number, enabled: boolean): Promise<SkillPackage> {
  const res = await client.apiCall.invoke({
    url: `/api/v1/skills/${skillId}/enabled`,
    method: 'PUT',
    data: { enabled },
  });
  return (res as unknown as { data: SkillPackage }).data;
}

export async function deleteSkill(skillId: number): Promise<void> {
  await client.apiCall.invoke({
    url: `/api/v1/skills/${skillId}`,
    method: 'DELETE',
    data: {},
  });
}

// ---------- 评测 API（任务18） ----------

export interface EvalStats {
  total_logs: number;
  labels: { good: number; bad: number; pending: number };
  annotated: number;
  rag: {
    hit_logs: number;
    hit_rate: number;
    avg_score: number | null;
    max_score: number | null;
    min_score: number | null;
    score_count: number;
  };
}

export interface GenerationLog {
  id: number;
  project_id: string;
  model: string;
  user_message: string;
  assistant_message: string;
  kb_sources: Array<{ file_name?: string; chunk_index?: number; score?: number }>;
  skill_names: string[];
  query: string;
  created_at?: string;
  annotation: { id: number; label: string; note: string } | null;
}

export async function fetchEvalStats(): Promise<EvalStats> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/eval/stats',
    method: 'GET',
    data: {},
  });
  return (res as unknown as { data: EvalStats }).data;
}

export async function fetchEvalLogs(
  skip = 0,
  limit = 50,
): Promise<{ items: GenerationLog[]; total: number; skip: number; limit: number }> {
  const res = await client.apiCall.invoke({
    url: '/api/v1/eval/logs',
    method: 'GET',
    data: { skip, limit },
  });
  return (
    res as unknown as { data: { items: GenerationLog[]; total: number; skip: number; limit: number } }
  ).data;
}

export async function saveAnnotation(payload: {
  log_id: number;
  label: 'good' | 'bad' | 'pending';
  note?: string;
}): Promise<void> {
  await client.apiCall.invoke({
    url: '/api/v1/eval/annotations',
    method: 'POST',
    data: payload,
  });
}

export function datasetExportUrl(format: 'jsonl' | 'json' | 'csv', includeUnlabeled = false): string {
  const params = new URLSearchParams({ format, include_unlabeled: String(includeUnlabeled) });
  return `/api/v1/eval/export/dataset?${params.toString()}`;
}

/** 下载微调数据集文件（文件流下载，非数据接口调用）：浏览器侧落盘 JSONL / CSV。 */
export async function downloadDataset(
  format: 'jsonl' | 'json' | 'csv',
  includeUnlabeled = false,
): Promise<void> {
  const res = await fetch(datasetExportUrl(format, includeUnlabeled), {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(await res.text()) as { detail?: string };
      if (data.detail) detail = data.detail;
    } catch {
      // 非 JSON 错误体，保留状态码提示
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `finetune-dataset.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
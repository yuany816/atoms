import { client } from '@/lib/api';
import { dictToFiles, getErrorDetail, type ProjectFile } from '@/lib/platform';

/**
 * AI 引擎：真实模型流式生成（Atoms Cloud AI Hub）、文件块协议解析、
 * 预览 HTML 构建（文件内联化 + window.atoms 运行时桥）与 iframe 宿主桥接。
 */

// ---------- 系统提示词（输出协议） ----------

export const SYSTEM_PROMPT = `你是「Atoms 克隆」平台的内置应用开发引擎，负责根据用户需求生成并迭代一个静态单页应用。

硬性要求：
1. 技术形态：仅允许纯 HTML / CSS / 原生 JavaScript 的静态单页应用，入口必须为 index.html，可选 style.css 与 app.js；禁止使用任何构建工具、框架、npm 包。
2. 引用方式：index.html 引用本地文件只能用 <link rel="stylesheet" href="style.css"> 和 <script src="app.js"></script>；图片必须使用 https:// 图片链接或用户提供的素材 URL。
3. 界面语言：应用内所有可见文案使用中文；界面需美观、现代、有真实功能，不允许出现占位文本或 TODO。
4. 数据存储：如需保存数据，必须使用平台提供的 window.atoms.data API（基于 Promise）：
   - await window.atoms.data.list('todos')  // 返回 [{ id, data }]
   - await window.atoms.data.create('todos', { text: '买牛奶', done: false })  // 返回 { id, data }
   - await window.atoms.data.update('todos', id, { done: true })
   - await window.atoms.data.remove('todos', id)
   第一个参数是数据类型名，仅允许小写字母、数字、下划线和中划线。
5. 单文件长度控制在 500 行以内，保持自包含、可直接运行。

输出协议（严格遵守）：
- 先用 1-3 句简体中文说明本次改动要点。
- 之后对每个需要写入或更新的文件输出一个文件块，内容必须完整，不得省略：
<atoms-file path="index.html">
（完整文件内容）
</atoms-file>
- 无需改动的文件不要输出；除说明文字与文件块外，不要输出任何其他内容（包括 Markdown 代码围栏）。`;

// ---------- 生成参数与调用（真实模型，SSE 流式） ----------

export interface GenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function extractChunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk;
  if (chunk && typeof chunk === 'object' && 'content' in chunk) {
    return String((chunk as { content?: unknown }).content ?? '');
  }
  return '';
}

/**
 * 调用真实文本模型流式生成。禁止任何模拟回复；失败时抛错由调用方处理。
 */
export function streamGenerate(opts: {
  messages: GenMessage[];
  model: string;
  onChunk: (text: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const params = {
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      model: opts.model,
      stream: true,
      onChunk: (chunk: unknown) => {
        const text = extractChunkText(chunk);
        if (text) opts.onChunk(text);
      },
      onComplete: (result: unknown) => resolve(extractChunkText(result)),
      onError: (error: unknown) => {
        reject(new Error(getErrorDetail(error) || 'AI 生成失败，请稍后重试'));
      },
    };
    void client.ai.gentxt(params as Parameters<typeof client.ai.gentxt>[0]);
  });
}

// ---------- 回复解析：文件块协议 ----------

export interface ParsedFile {
  path: string;
  content: string;
}

export function sanitizePath(raw: string): string | null {
  const path = raw.trim().replace(/^\/+/, '');
  if (!path || path.includes('..') || path.length > 120) return null;
  return path;
}

export function parseFileBlocks(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const pattern = /<atoms-file path="([^"]+)">\s*\n?([\s\S]*?)\n?\s*<\/atoms-file>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const path = sanitizePath(match[1]);
    if (!path) continue;
    files.push({ path, content: match[2] });
  }
  return files;
}

// ---------- 预览构建：文件内联化 + window.atoms 运行时桥 ----------

// 通过 postMessage + MessageChannel 与宿主页通信，代理云端应用数据接口。
const BRIDGE_SOURCE = `(function(){
  var PROJECT_ID = '__ATOMS_PROJECT_ID__';
  function call(op, payload){
    return new Promise(function(resolve, reject){
      var channel = new MessageChannel();
      channel.port1.onmessage = function(event){
        var data = event.data || {};
        if (data.ok) { resolve(data.data); } else { reject(new Error(data.error || '请求失败')); }
      };
      window.parent.postMessage({ source: 'atoms-bridge', op: op, projectId: PROJECT_ID, payload: payload }, '*', [channel.port2]);
    });
  }
  function normalizeType(t){ return String(t || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase(); }
  window.atoms = {
    version: '1.0',
    data: {
      list: function(t){ return call('list', { entityType: normalizeType(t) }); },
      create: function(t, d){ return call('create', { entityType: normalizeType(t), data: d || {} }); },
      update: function(t, id, d){ return call('update', { entityType: normalizeType(t), id: id, data: d || {} }); },
      remove: function(t, id){ return call('remove', { entityType: normalizeType(t), id: id }); }
    }
  };
})();`;

function findFile(files: ProjectFile[], ref: string): ProjectFile | undefined {
  const normalized = ref.replace(/^\/+/, '').trim();
  return files.find((f) => f.path === normalized);
}

/**
 * 将项目文件构建为可直接在 iframe 中渲染的完整 HTML：
 * index.html 为入口，style.css / app.js 内联注入，并注入 window.atoms 桥。
 */
export function buildPreviewHtml(
  filesInput: ProjectFile[] | Record<string, string>,
  projectId: string,
): string | null {
  const files = Array.isArray(filesInput) ? filesInput : dictToFiles(filesInput);
  const index = files.find((f) => f.path === 'index.html');
  if (!index) return null;

  let html = index.content;

  html = html.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href: string) => {
    if (!href.trim().toLowerCase().endsWith('.css')) return match;
    const asset = findFile(files, href);
    return asset ? `<style>\n${asset.content}\n</style>` : match;
  });

  html = html.replace(
    /<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src: string) => {
      if (!src.trim().toLowerCase().endsWith('.js')) return match;
      const asset = findFile(files, src);
      return asset ? `<script>\n${asset.content}\n</script>` : match;
    },
  );

  const bridge = `<script>${BRIDGE_SOURCE.replace('__ATOMS_PROJECT_ID__', projectId)}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${bridge}`);
  } else {
    html = bridge + html;
  }
  return html;
}

// ---------- 宿主侧桥接：代理 window.atoms 请求到云端接口 ----------

interface BridgePayload {
  source?: string;
  op?: string;
  projectId?: string;
  payload?: { entityType?: string; id?: number; data?: Record<string, unknown> };
}

async function invokeAppdata(
  op: string,
  projectId: string,
  payload: { entityType: string; id?: number; data?: Record<string, unknown> },
): Promise<unknown> {
  const entityType = encodeURIComponent(payload.entityType);
  if (op === 'list') {
    const res = await client.apiCall.invoke({
      url: `/api/v1/appdata/${entityType}`,
      method: 'GET',
      data: { project_id: projectId },
    });
    return (res as unknown as { data: unknown }).data;
  }
  if (op === 'create') {
    const res = await client.apiCall.invoke({
      url: `/api/v1/appdata/${entityType}`,
      method: 'POST',
      data: { project_id: projectId, data: payload.data ?? {} },
    });
    return (res as unknown as { data: unknown }).data;
  }
  if (op === 'update') {
    const res = await client.apiCall.invoke({
      url: `/api/v1/appdata/${entityType}/${payload.id}`,
      method: 'PUT',
      data: { project_id: projectId, data: payload.data ?? {} },
    });
    return (res as unknown as { data: unknown }).data;
  }
  const res = await client.apiCall.invoke({
    url: `/api/v1/appdata/${entityType}/${payload.id}`,
    method: 'DELETE',
    data: { project_id: projectId },
  });
  return (res as unknown as { data: unknown }).data;
}

/**
 * 在宿主页面监听 iframe 内 window.atoms 桥的请求并代理到云端。
 * 返回清理函数；projectId 以 iframe 消息携带的值为准（发布页/预览均适用）。
 */
export function attachAtomsHost(): () => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as BridgePayload | null;
    if (!data || data.source !== 'atoms-bridge' || !data.op) return;
    const port = event.ports?.[0];
    if (!port) return;

    void (async () => {
      try {
        const projectId = data.projectId || '';
        if (!projectId) throw new Error('缺少项目标识');
        const entityType = data.payload?.entityType || '';
        if (!entityType) throw new Error('缺少数据类型');
        const result = await invokeAppdata(data.op, projectId, {
          entityType,
          id: data.payload?.id,
          data: data.payload?.data,
        });
        port.postMessage({ ok: true, data: result });
      } catch (e) {
        port.postMessage({ ok: false, error: getErrorDetail(e) || '请求失败' });
      }
    })();
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
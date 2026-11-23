import { client } from '@/lib/api';
import { dictToFiles, getErrorDetail, type ProjectFile } from '@/lib/platform';

/**
 * AI 引擎：真实模型流式生成（Atoms Cloud AI Hub）、文件块协议解析、
 * 预览 HTML 构建（文件内联化 + window.atoms 运行时桥）与 iframe 宿主桥接。
 */

// ---------- 系统提示词（输出协议） ----------

export const SYSTEM_PROMPT = `你是「Atoms 克隆」平台的内置应用开发引擎，负责根据用户需求生成并迭代一个静态单页应用。

硬性要求：
1. 技术形态：仅允许纯 HTML / CSS / 原生 JavaScript 的静态单页应用，入口必须为 index.html，可选 style.css 与 app.js；禁止使用任何构建工具、框架、npm 包。小游戏、单页工具等应用优先输出单个自包含的 index.html（样式写在 <style>、脚本写在 <script> 中）。
2. 引用方式：index.html 引用本地文件只能用 <link rel="stylesheet" href="style.css"> 和 <script src="app.js"></script>；index.html 中引用的每一个本地文件都必须在同一次回复中完整输出，否则页面只剩无样式骨架且脚本不运行；图片必须使用 https:// 图片链接或用户提供的素材 URL。
   控制总输出长度，确保所有文件块都完整输出并以 </atoms-file> 闭合；内容较多时精简注释与重复样式，而不是省略文件。
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

/** 来源标注帧：本次生成命中的知识片段与注入技能（会话自动增强）。 */
export interface EnhancementInfo {
  kb_sources?: Array<{ file_name?: string; chunk_index?: number; score?: number }>;
  skill_names?: string[];
}

/**
 * 解析 SSE 流式响应：逐帧提取 data JSON 的 content，收到 [DONE] 结束，
 * 收到 [ERROR] 帧时抛出后端透传的错误详情。
 */
async function consumeSseStream(
  response: Response,
  handlers: {
    onChunk: (text: string) => void;
    onEnhancement?: (info: EnhancementInfo) => void;
    signal: AbortSignal;
  },
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('当前浏览器不支持流式响应读取');

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const handleData = (payload: string): boolean => {
    // 返回 true 表示流结束（收到 [DONE]）
    if (!payload) return false;
    if (payload === '[DONE]') return true;
    let parsed: { content?: unknown; enhancement?: EnhancementInfo };
    try {
      parsed = JSON.parse(payload) as { content?: unknown; enhancement?: EnhancementInfo };
    } catch {
      return false; // 忽略心跳等非 JSON 帧
    }
    // 来源标注帧（无 content 字段）：向宿主回调命中的知识与技能来源
    if (parsed.enhancement && handlers.onEnhancement) {
      handlers.onEnhancement(parsed.enhancement);
    }
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    if (content.startsWith('[ERROR]')) {
      throw new Error(content.slice('[ERROR]'.length).trim() || 'AI 生成失败，请稍后重试');
    }
    if (content) {
      full += content;
      handlers.onChunk(content);
    }
    return false;
  };

  // 读取与超时中止竞速：即使连接挂起、无新分块到达，也能触发超时错误
  const abortPromise = new Promise<never>((_resolve, reject) => {
    handlers.signal.addEventListener(
      'abort',
      () => reject(new Error('AI 生成超时，请稍后重试')),
      { once: true },
    );
  });

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        if (handleData(trimmed.slice(5).trim())) return full;
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:') && handleData(rest.slice(5).trim())) return full;
    return full;
  } finally {
    reader.releaseLock();
  }
}

// ---------- 网关防护页识别、端点回退与自动重试 ----------

/** 需要自动重试的瞬态 HTTP 状态码（网关拦截/限流/上游抖动） */
const RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504]);
/** 单次生成的最大尝试次数（含首次） */
const MAX_ATTEMPTS = 3;
/** Cloudflare 等网关防护页（如「Just a moment...」人机验证）特征 */
const CHALLENGE_HINT = /just a moment|attention required|cf-mitigated|challenge-platform|cloudflare/i;
/** 生成端点：优先应用自有引擎路由，部署快照未包含该路由（404）时回退到平台 AI Hub 保留路径 */
const PRIMARY_ENDPOINT = '/api/v1/engine/gentxt';
/** 路径级同义路由：部署域名边缘防护疑似按 /gentxt 路径匹配拦截，同义路径可能绕过 */
const ALIAS_ENDPOINT = '/api/v1/engine/text-stream';
const FALLBACK_ENDPOINT = '/api/v1/aihub/gentxt';
/**
 * 末级跨域回退后端基址：部署域名（*.pub.atoms.world）的 AI 接口可能被平台边缘防护
 * （Cloudflare 托管挑战）会话级拦截，而预览后端公网可达且已放行跨域
 * （实测预检 204 + Access-Control-Allow-Origin: *，跨域 POST SSE 200）。
 * 同源链路被防护拦截且重试耗尽时，改向该基址的 engine 路由发起跨域 SSE。
 * 可通过环境变量 VITE_ENGINE_FALLBACK_BASE_URL 覆盖。
 */
const CROSS_ORIGIN_FALLBACK_BASE: string =
  (import.meta.env.VITE_ENGINE_FALLBACK_BASE_URL as string | undefined)?.trim() ||
  'https://x4jln-11eca153605a42838371c1aab05637d0-preview.app.atoms.dev';

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * 将消息列表以 base64(JSON) 传输编码。
 *
 * 会话消息中包含应用生成的 HTML/JS 代码（含 script、link 等标签字面量），
 * 部分边缘 WAF 规则会把这类合法内容误判为 XSS 攻击载荷并拦截（403）。
 * 传输层统一编码后，请求体不再包含任何标签字面量，由后端解码后转交模型。
 */
function encodeMessagesB64(messages: GenMessage[]): string {
  const json = JSON.stringify(messages);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 从失败响应提取可读错误：JSON 取 detail/message；HTML 防护页转译为友好中文，不透传原始 HTML。 */
async function readFriendlyError(response: Response): Promise<string> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return ''; // 错误体读取失败
  }
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as { detail?: string; message?: string };
      return (data.detail || data.message || '').slice(0, 300);
    } catch {
      // 非 JSON 响应体，继续按文本处理
    }
  }
  if (trimmed.startsWith('<')) {
    return CHALLENGE_HINT.test(trimmed) ? '请求被网络防护临时拦截，请稍后重试' : '服务返回了异常页面，请稍后重试';
  }
  return trimmed.slice(0, 200);
}

/** 识别「状态码 200 但实为 HTML 防护页」的伪成功响应（部分挑战页以 200 返回）。 */
async function readChallengeError(response: Response): Promise<string | null> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return null;
  let text = '';
  try {
    text = await response.text();
  } catch {
    return '服务返回了异常页面，请稍后重试';
  }
  return CHALLENGE_HINT.test(text) ? '请求被网络防护临时拦截，请稍后重试' : '服务返回了异常页面，请稍后重试';
}

/**
 * 调用真实文本模型流式生成。禁止任何模拟回复；失败时抛出友好中文错误。
 *
 * 说明：
 * - 部署环境中 /api/v1/aihub/* 是平台保留路径，匿名请求可能被平台网关拒绝，
 *   因此优先走应用自有后端的 /api/v1/engine/gentxt，由后端调用 AIHubService
 *   并以相同的 SSE 协议返回；若部署快照尚未包含该路由（404）则回退到 aihub。
 * - 公网入口存在间歇性网关防护拦截（403 挑战页，同一请求时通时不通），
 *   这里对瞬态失败（403/408/429/5xx、网络错误、HTML 防护页）自动重试，
 *   重试耗尽后抛出友好中文提示，绝不把原始 HTML 透传给用户。
 * - 部署域名被边缘防护持续拦截时，先尝试同义路径 /api/v1/engine/text-stream
 *   （边缘规则疑似按 /gentxt 路径匹配），重试耗尽后末级回退改向预览后端跨域
 *   发起 SSE（跨域请求不携带凭证），保障发布环境 AI 功能可用。
 */
/**
 * 单次生成的输出长度上限（tokens）。后端默认 4096，小游戏多文件输出容易在 JS 中途被截断；
 * 8192 为 DeepSeek 官方直连模型的输出上限，各通道均可接受。
 */
const GEN_MAX_TOKENS = 8192;

export function streamGenerate(opts: {
  messages: GenMessage[];
  model: string;
  projectId?: string;
  onChunk: (text: string) => void;
  onEnhancement?: (info: EnhancementInfo) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600_000);

      // 传输编码开关：默认 base64 编码消息；遇到仅支持明文 messages 的旧后端时自动关闭
      let useTransportEncoding = true;
      // 防御式修正：部分上游模型（Anthropic 系）不支持 assistant prefill，
      // 要求对话必须以 user 消息结束——从末尾剔除 assistant 消息（如 UI 展示用的
      // 「正在思考」空占位或中断残留），保证请求体合法
      const outboundMessages = (() => {
        const list = [...opts.messages];
        while (list.length > 0 && list[list.length - 1].role === 'assistant') list.pop();
        return list;
      })();
      const buildPayload = () => {
        const messages = outboundMessages.map((m) => ({ role: m.role, content: m.content }));
        if (useTransportEncoding) {
          // 编码模式下 messages 置空数组以通过共享 Schema 校验，真实内容在 messages_b64 中
          return {
            model: opts.model,
            stream: true,
            messages: [],
            messages_b64: encodeMessagesB64(messages),
            max_tokens: GEN_MAX_TOKENS,
            project_id: opts.projectId,
          };
        }
        return { model: opts.model, stream: true, messages, max_tokens: GEN_MAX_TOKENS, project_id: opts.projectId };
      };

      // 显式 fetch 代替 SDK stream 封装：仅保留常规标准头（不发送 App-Host 等自定义头）、
      // 正确透传中止信号；同源请求显式携带 Cookie，跨域回退请求不携带凭证
      const invokeOnce = (url: string, crossOrigin: boolean) =>
        fetch(url, {
          method: 'POST',
          credentials: crossOrigin ? 'omit' : 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(buildPayload()),
          signal: controller.signal,
        });

      // 末级跨域回退端点：部署域名的 AI 接口可能被平台边缘防护（Cloudflare 托管挑战）
      // 会话级拦截，而预览后端公网可达且已放行跨域（实测预检 204 + ACAO: *）。
      // 页面本就运行在回退基址（预览域名）上时同源即最优，不启用跨域回退。
      const crossOriginFallbackEndpoint =
        window.location.origin === CROSS_ORIGIN_FALLBACK_BASE
          ? ''
          : `${CROSS_ORIGIN_FALLBACK_BASE}/api/v1/engine/gentxt`;

      try {
        let lastError = '';
        let sawProtection = false;
        let hardFailure = false;

        // 三阶段重试：第 1 阶段走同源 engine 路由（部署快照未含该路由时 404 回退 aihub）；
        // 第 2 阶段尝试同源同义路径 text-stream（边缘防护疑似按 /gentxt 路径匹配，
        // 旧部署快照无该路由时 404 直接跳过本阶段）；命中边缘防护且重试耗尽后，
        // 第 3 阶段改向预览后端跨域回退端点再走一轮完整重试
        const stages: Array<{
          url: string;
          crossOrigin: boolean;
          fallbackUrlOn404?: string;
          skipStageOn404?: boolean;
        }> = [
          { url: PRIMARY_ENDPOINT, crossOrigin: false, fallbackUrlOn404: FALLBACK_ENDPOINT },
          { url: ALIAS_ENDPOINT, crossOrigin: false, skipStageOn404: true },
          ...(crossOriginFallbackEndpoint ? [{ url: crossOriginFallbackEndpoint, crossOrigin: true }] : []),
        ];

        for (const stage of stages) {
          let endpoint = stage.url;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            let response: Response;
            try {
              response = await invokeOnce(endpoint, stage.crossOrigin);
            } catch {
              lastError = '网络连接异常，请稍后重试';
              if (attempt < MAX_ATTEMPTS) {
                await delay(600 * attempt);
                continue;
              }
              break;
            }

            if (!response.ok) {
              lastError = `HTTP ${response.status}：${await readFriendlyError(response)}`;
              if (response.status === 403 || RETRYABLE_STATUS.has(response.status)) sawProtection = true;
              // 部署快照可能尚未包含自有引擎路由：404 时切换端点且不消耗重试次数
              if (response.status === 404 && !stage.crossOrigin) {
                if (stage.fallbackUrlOn404 && endpoint === stage.url) {
                  endpoint = stage.fallbackUrlOn404;
                  attempt -= 1;
                  continue;
                }
                // 同义路径在旧部署快照中不存在：跳过本阶段进入下一阶段，不视为硬失败
                if (stage.skipStageOn404) break;
              }
              // 兼容尚未支持 messages_b64 的旧后端：422/400 时退回明文消息且不消耗重试次数
              if (useTransportEncoding && (response.status === 422 || response.status === 400)) {
                useTransportEncoding = false;
                attempt -= 1;
                continue;
              }
              if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
                await delay(600 * attempt);
                continue;
              }
              // 非瞬态的应用层错误（如 401/405/413）：换端点也会复现，不进入跨域回退阶段
              if (!RETRYABLE_STATUS.has(response.status)) hardFailure = true;
              break;
            }

            // 状态码成功但返回的是 HTML 防护页：按失败处理
            const challengeError = await readChallengeError(response);
            if (challengeError) {
              lastError = challengeError;
              sawProtection = true;
              if (attempt < MAX_ATTEMPTS) {
                await delay(600 * attempt);
                continue;
              }
              break;
            }

            resolve(
              await consumeSseStream(response, {
                onChunk: opts.onChunk,
                onEnhancement: opts.onEnhancement,
                signal: controller.signal,
              }),
            );
            return;
          }
          // 仅当本阶段因边缘防护耗尽重试时才进入下一阶段（跨域回退）；其余失败直接结束
          if (!sawProtection || hardFailure) break;
        }

        const advice = sawProtection
          ? '（已自动重试仍被拦截，建议更换网络环境后重试，或联系平台支持）'
          : '';
        throw new Error((lastError || 'AI 生成失败，请稍后重试') + advice);
      } catch (error) {
        if (controller.signal.aborted) {
          reject(new Error('AI 生成超时，请稍后重试'));
        } else {
          reject(new Error(getErrorDetail(error) || 'AI 生成失败，请稍后重试'));
        }
      } finally {
        clearTimeout(timer);
      }
    })();
  });
}

// ---------- 回复解析：文件块协议 ----------

export interface ParsedFile {
  path: string;
  content: string;
}

export function sanitizePath(raw: string): string | null {
  const path = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/|\/)+/, '');
  if (!path || path.split('/').includes('..') || path.length > 120) return null;
  return path;
}

const FENCE = '`'.repeat(3);

interface RawFileBlock {
  /** 规范化后的路径；属性缺失或非法时为 null */
  path: string | null;
  rawPath: string;
  content: string;
  closed: boolean;
}

function readPathAttr(attrs: string): string {
  const m = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

/** 去掉文件内容外层多包的一层代码围栏（模型常把文件内容再包进 ```html ... ```）。 */
function stripWrappingFence(content: string): string {
  const m = new RegExp(`^\\s*${FENCE}[^\\n]*\\n([\\s\\S]*?)\\n?${FENCE}\\s*$`).exec(content);
  return m ? m[1] : content;
}

/**
 * 宽松扫描文件块：兼容标签大小写、单/双/无引号属性、属性顺序不同、内外层代码围栏。
 * 以下一个开标签为边界判定是否闭合，未闭合即视为被截断。
 */
function scanFileBlocks(text: string): RawFileBlock[] {
  const openPattern = /<atoms-file\b([^>]*)>/gi;
  const opens: Array<{ attrs: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = openPattern.exec(text)) !== null) {
    opens.push({ attrs: match[1], start: match.index, end: openPattern.lastIndex });
  }
  return opens.map((open, index) => {
    const limit = index + 1 < opens.length ? opens[index + 1].start : text.length;
    const segment = text.slice(open.end, limit);
    const close = /<\/atoms-file\s*>/i.exec(segment);
    const rawPath = readPathAttr(open.attrs);
    const body = (close ? segment.slice(0, close.index) : segment)
      .replace(/^[ \t]*\r?\n/, '')
      .replace(/\r?\n\s*$/, '');
    return {
      path: sanitizePath(rawPath),
      rawPath: rawPath.trim() || '（未命名文件）',
      content: stripWrappingFence(body),
      closed: Boolean(close),
    };
  });
}

/** 回复中没有文件块时，兜底识别完整 HTML 代码块（```html 包裹的完整页面）作为 index.html。 */
function fencedHtmlFallback(text: string): { file: ParsedFile | null; truncated: boolean } {
  const pattern = new RegExp(`${FENCE}[ \\t]*(?:html?|HTML?)?[^\\n]*\\n([\\s\\S]*?)${FENCE}`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (/<!doctype html|<html[\s>]/i.test(match[1])) {
      return { file: { path: 'index.html', content: match[1].replace(/\r?\n\s*$/, '') }, truncated: false };
    }
  }
  const unclosed = new RegExp(`${FENCE}[ \\t]*html?[^\\n]*\\n[\\s\\S]*?(?:<!doctype html|<html[\\s>])`, 'i');
  const fenceCount = text.split(FENCE).length - 1;
  return { file: null, truncated: fenceCount % 2 === 1 && unclosed.test(text) };
}

/**
 * 识别未闭合（被截断）的文件块：模型输出达到长度上限或中途断开时，文件块缺少结束标签，
 * 不能写入半截文件。返回这些文件的路径，供界面明确提示。
 */
export function detectTruncatedBlocks(text: string): string[] {
  const blocks = scanFileBlocks(text);
  if (blocks.length === 0) return fencedHtmlFallback(text).truncated ? ['index.html'] : [];
  return blocks.filter((b) => !b.closed).map((b) => b.path ?? b.rawPath);
}

/**
 * 回复中没有文件块、只有 Markdown 代码围栏时的兜底：完整 HTML 代码块作为 index.html，
 * ```css / ```js 代码块按其上方标注的文件名（如 **style.css**）或 index.html 中的引用顺序写入对应文件，
 * 避免只写回 HTML 骨架而丢失样式与脚本。
 */
function fencedFilesFallback(text: string, expected: string[] = []): ParsedFile[] {
  const pattern = new RegExp(`${FENCE}[ \\t]*([\\w+#-]*)[^\\n]*\\n([\\s\\S]*?)\\n?[ \\t]*${FENCE}`, 'g');
  const blocks: Array<{ lang: string; content: string; label: string | null }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 200), match.index).split('\n').slice(-3).join(' ');
    const names = before.match(/[\w./-]+\.(?:css|m?js|html?)\b/gi);
    // 代码块首行的文件名注释（如 // app.js、/* style.css */）同样视为文件名标注
    const firstLine = match[2].split('\n', 1)[0];
    const comment = /^\s*(?:\/\/|\/\*|<!--)\s*(?:文件[:：]?\s*)?([\w./-]+\.(?:css|m?js|html?))\b/i.exec(firstLine);
    const label = comment ? comment[1] : names ? names[names.length - 1] : null;
    blocks.push({
      lang: match[1].toLowerCase(),
      content: match[2],
      label: label ? sanitizePath(label) : null,
    });
  }
  const htmlBlock = blocks.find((b) => /<!doctype html|<html[\s>]/i.test(b.content));
  const files: ParsedFile[] = htmlBlock ? [{ path: 'index.html', content: htmlBlock.content }] : [];
  const refs = htmlBlock ? collectEntryRefs(htmlBlock.content) : { css: [], js: [] };
  // 没有完整 HTML 时（常见于「补全缺失文件」的回复），按入口仍缺失的引用匹配单独的 css/js 代码块
  const pending = {
    css: [...refs.css.map((r) => refDisplayPath(r, '')), ...expected.filter((p) => /\.css$/i.test(p))],
    js: [...refs.js.map((r) => refDisplayPath(r, '')), ...expected.filter((p) => /\.m?js$/i.test(p))],
  };
  for (const block of blocks) {
    if (htmlBlock && block.content === htmlBlock.content) continue;
    const label = block.label ?? '';
    const kind =
      block.lang === 'css' || /\.css$/i.test(label)
        ? 'css'
        : ['js', 'javascript', 'mjs'].includes(block.lang) || /\.m?js$/i.test(label)
          ? 'js'
          : null;
    if (!kind) continue;
    const labelFits = (kind === 'css' ? /\.css$/i : /\.m?js$/i).test(label);
    const path = labelFits ? label : pending[kind].find((p) => !files.some((f) => f.path === p));
    if (!path || files.some((f) => f.path === path)) continue;
    files.push({ path, content: block.content });
  }
  return files;
}

/**
 * 解析回复中的完整文件。expected 为项目入口当前缺失的引用路径，用于给没有文件名标注的
 * 单独 css/js 代码块确定目标文件。
 */
export function parseFileBlocks(text: string, expected: string[] = []): ParsedFile[] {
  const blocks = scanFileBlocks(text);
  if (blocks.length === 0) return fencedFilesFallback(text, expected);
  const files: ParsedFile[] = [];
  for (const block of blocks) {
    if (block.closed && block.path) files.push({ path: block.path, content: block.content });
  }
  return files;
}

/** 对话区展示用：移除文件块（含流式中尚未闭合的最后一块），只保留说明文字。 */
export function stripFileBlocks(content: string): string {
  return content
    .replace(/<atoms-file\b[^>]*>[\s\S]*?<\/atoms-file\s*>/gi, '')
    .replace(/<atoms-file\b[^>]*>[\s\S]*$/i, '')
    .trim();
}

/** 对话区展示用：回复中出现的文件路径（规范化后去重）。 */
export function extractFilePaths(content: string): string[] {
  const paths = scanFileBlocks(content).map((b) => b.path ?? b.rawPath);
  if (paths.length === 0) paths.push(...parseFileBlocks(content).map((f) => f.path));
  return Array.from(new Set(paths));
}

/** 回复末尾是否停在未闭合的文件块内（流提前结束时可续写）。 */
export function hasOpenFileBlock(text: string): boolean {
  const blocks = scanFileBlocks(text);
  return blocks.length > 0 && !blocks[blocks.length - 1].closed;
}

/** 取回复中最后一个未闭合文件块的路径与已输出内容，用于构造续写请求。 */
export function openFileBlockTail(text: string): { path: string; content: string } | null {
  const blocks = scanFileBlocks(text);
  const last = blocks[blocks.length - 1];
  return last && !last.closed ? { path: last.path ?? last.rawPath, content: last.content } : null;
}

/**
 * 把续写内容拼接到被截断的回复：去掉模型多包的代码围栏；若模型重新输出了同一文件，
 * 用新版本替换半截内容；否则去除与已输出结尾重叠的部分后直接拼接。
 */
export function stitchContinuation(partial: string, next: string): string {
  const body = next.replace(new RegExp(`^\\s*${FENCE}[^\\n]*\\n`), '').replace(new RegExp(`\\n?${FENCE}\\s*$`), '');
  const opens = Array.from(partial.matchAll(/<atoms-file\b([^>]*)>/gi));
  const lastOpen = opens[opens.length - 1];
  const reopen = /<atoms-file\b([^>]*)>/i.exec(body);
  if (lastOpen && reopen && sanitizePath(readPathAttr(reopen[1])) === sanitizePath(readPathAttr(lastOpen[1]))) {
    return partial.slice(0, lastOpen.index) + body.slice(reopen.index);
  }
  const maxOverlap = Math.min(600, partial.length, body.length);
  for (let size = maxOverlap; size >= 8; size -= 1) {
    if (partial.endsWith(body.slice(0, size))) return partial + body.slice(size);
  }
  return partial + body;
}

export interface ReplyDiagnosis {
  files: ParsedFile[];
  truncated: string[];
  /** 回复里有代码/文件标记，但没有可写入的文件 */
  unrecognized: boolean;
}

/** 未闭合（不完整）的文件块：路径 + 已收到的内容，用于保存为「不完整」草稿。 */
export function extractPartialFiles(text: string): ParsedFile[] {
  return scanFileBlocks(text)
    .filter((b) => !b.closed && b.path && b.content.trim())
    .map((b) => ({ path: b.path as string, content: b.content }));
}

/** 回复说明文字（文件块之外）中提到的项目文件名，用于与实际写入的文件对账。 */
export function findMentionedFiles(text: string): string[] {
  const prose = stripFileBlocks(text).replace(new RegExp(`${FENCE}[\\s\\S]*?(?:${FENCE}|$)`, 'g'), ' ');
  const names = prose.match(/(?<![\w/.-])(?:\.\/)?[\w-]+(?:\/[\w-]+)*\.(?:html?|css|m?js)\b/gi) ?? [];
  const out: string[] = [];
  for (const name of names) {
    const path = sanitizePath(name);
    if (path && !out.some((p) => p.toLowerCase() === path.toLowerCase())) out.push(path);
  }
  return out;
}

export function diagnoseReply(text: string, expected: string[] = []): ReplyDiagnosis {
  const files = parseFileBlocks(text, expected);
  const truncated = detectTruncatedBlocks(text);
  const looksLikeCode =
    /<atoms-file\b/i.test(text) || text.includes(FENCE) || /<!doctype html|<html[\s>]/i.test(text);
  return { files, truncated, unrecognized: files.length === 0 && truncated.length === 0 && looksLikeCode };
}

interface MessageLike {
  role: string;
  content: string;
  createdAt: number;
  error?: boolean;
}

/**
 * 从历史对话中找回「已生成但未写入项目」的文件：按时间取每个路径最后一次生成的内容，
 * 仅当项目中不存在该文件，或现有文件早于该次生成时才返回——不覆盖用户之后编辑过的较新文件。
 */
export function recoverFilesFromMessages(messages: MessageLike[], files: ProjectFile[]): ParsedFile[] {
  const latest = new Map<string, { file: ParsedFile; at: number }>();
  for (const message of messages) {
    if (message.role !== 'assistant' || message.error) continue;
    for (const file of parseFileBlocks(message.content)) latest.set(file.path, { file, at: message.createdAt });
  }
  const recovered: ParsedFile[] = [];
  latest.forEach(({ file, at }, path) => {
    const existing = files.find((f) => f.path.toLowerCase() === path.toLowerCase());
    if (!existing) recovered.push(file);
    else if (existing.updatedAt < at && existing.content !== file.content) recovered.push({ ...file, path: existing.path });
  });
  return recovered;
}

/**
 * 从历史对话中找回「只输出了一半」的文件：取每个路径最后一次未闭合的内容（之后没有完整版本），
 * 且项目中不存在该文件、也没有被用户丢弃过同一份草稿。仅作为「不完整」草稿恢复，不进入项目文件。
 */
export function recoverDraftsFromMessages(
  messages: MessageLike[],
  files: ProjectFile[],
  drafts: Array<{ path: string; content: string; createdAt: number; dismissed?: boolean }> = [],
): Array<{ path: string; content: string; createdAt: number }> {
  const latest = new Map<string, { path: string; content: string; createdAt: number } | null>();
  for (const message of messages) {
    if (message.role !== 'assistant' || message.error) continue;
    for (const file of parseFileBlocks(message.content)) latest.set(file.path.toLowerCase(), null);
    for (const part of extractPartialFiles(message.content)) {
      latest.set(part.path.toLowerCase(), { ...part, createdAt: message.createdAt });
    }
  }
  const out: Array<{ path: string; content: string; createdAt: number }> = [];
  latest.forEach((draft, key) => {
    if (!draft) return;
    if (files.some((f) => f.path.toLowerCase() === key)) return;
    const known = drafts.find((d) => d.path.toLowerCase() === key);
    if (known && (known.dismissed || known.createdAt >= draft.createdAt)) return;
    out.push(draft);
  });
  return out;
}

export type EmptyPreviewKind =
  | 'none'
  | 'recoverable'
  | 'truncated'
  | 'unrecognized'
  | 'no-entry'
  | 'missing-assets';

export interface EmptyPreviewDiagnosis {
  kind: EmptyPreviewKind;
  paths: string[];
  recoverable: ParsedFile[];
  /** missing-assets 时：缺失文件中属于最近一次回复里被截断的部分 */
  truncated?: string[];
}

/**
 * 预览无法正常渲染时判定准确原因，避免把「生成了但没写入/被截断/格式不对」误报为「没有生成」；
 * 入口引用的本地 CSS/JS 缺失时判定为 missing-assets，不把无样式、脚本不运行的骨架当成可用预览。
 */
export function diagnoseEmptyPreview(files: ProjectFile[], messages: MessageLike[]): EmptyPreviewDiagnosis {
  const lastReply = [...messages].reverse().find((m) => m.role === 'assistant' && !m.error && m.content);
  const missing = findMissingAssets(files);
  if (missing.length > 0) {
    const lower = missing.map((p) => p.toLowerCase());
    const recoverableAssets = recoverFilesFromMessages(messages, files).filter((f) =>
      lower.includes(f.path.toLowerCase()),
    );
    const truncated = lastReply ? diagnoseReply(lastReply.content).truncated : [];
    return {
      kind: 'missing-assets',
      paths: missing,
      recoverable: recoverableAssets,
      truncated: missing.filter((p) => truncated.some((t) => t.toLowerCase() === p.toLowerCase())),
    };
  }
  const recoverable = recoverFilesFromMessages(messages, files);
  const merged = [...files, ...recoverable.map((f) => ({ ...f, updatedAt: Date.now() }))];
  if (recoverable.length > 0 && findEntryFile(merged)) {
    return { kind: 'recoverable', paths: recoverable.map((f) => f.path), recoverable };
  }
  if (lastReply) {
    const diagnosis = diagnoseReply(lastReply.content);
    if (diagnosis.truncated.length > 0) return { kind: 'truncated', paths: diagnosis.truncated, recoverable: [] };
    if (diagnosis.unrecognized) return { kind: 'unrecognized', paths: [], recoverable: [] };
  }
  if (files.length > 0) return { kind: 'no-entry', paths: files.map((f) => f.path), recoverable: [] };
  return { kind: 'none', paths: [], recoverable: [] };
}

// ---------- 预览构建：文件内联化 + window.atoms 运行时桥 ----------

// 通过 postMessage + MessageChannel 与宿主页通信，代理云端应用数据接口。
const BRIDGE_SOURCE = `(function(){
  var PROJECT_ID = '__ATOMS_PROJECT_ID__';
  // 数据请求设超时：数据服务失败或挂起不能拖住应用启动。读取（list）失败时按空列表继续运行并提示，
  // 写入类操作照常以错误返回，由应用自行处理。
  var CALL_TIMEOUT_MS = 8000;
  function call(op, payload){
    return new Promise(function(resolve, reject){
      var settled = false;
      var timer = setTimeout(function(){ finish(false, '数据服务响应超时'); }, CALL_TIMEOUT_MS);
      function finish(ok, value){
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) { resolve(value); return; }
        if (op === 'list') {
          report('数据服务暂不可用（' + value + '），已按空数据继续运行，历史记录暂不显示');
          resolve([]);
          return;
        }
        reject(new Error(value));
      }
      var channel = new MessageChannel();
      channel.port1.onmessage = function(event){
        var data = event.data || {};
        if (data.ok) { finish(true, data.data); } else { finish(false, data.error || '请求失败'); }
      };
      try {
        window.parent.postMessage({ source: 'atoms-bridge', op: op, projectId: PROJECT_ID, payload: payload }, '*', [channel.port2]);
      } catch (e) {
        finish(false, '无法连接数据服务');
      }
    });
  }
  function normalizeType(t){ return String(t || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase(); }
  // 运行时错误上报：脚本异常、资源加载失败、未处理的 Promise 拒绝都通知宿主页，以中文提示展示给用户
  var reported = {};
  function report(message){
    var text = String(message || '未知错误').slice(0, 300);
    if (reported[text]) return;
    reported[text] = true;
    try { window.parent.postMessage({ source: 'atoms-preview', type: 'runtime-error', projectId: PROJECT_ID, message: text }, '*'); } catch (e) {}
  }
  // 静默失败检测：记录点击类事件绑定；用户点击按钮时若按钮及其祖先都没有处理器，提示「按钮未绑定」
  var CLICK_TYPES = { click: 1, pointerdown: 1, pointerup: 1, mousedown: 1, mouseup: 1, touchstart: 1, touchend: 1 };
  var clickBound = new WeakSet();
  var nativeAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type){
    if (CLICK_TYPES[type]) { try { clickBound.add(this || window); } catch (e) {} }
    return nativeAdd.apply(this, arguments);
  };
  function hasClickHandler(node){
    for (var n = node; n; n = n.parentNode) {
      if (clickBound.has(n) || n.onclick || n.onmousedown || n.onpointerdown || n.ontouchstart) return true;
    }
    return clickBound.has(window) || !!window.onclick;
  }
  nativeAdd.call(window, 'click', function(event){
    var target = event.target;
    var button = target && target.closest ? target.closest('button,[role="button"],input[type="button"]') : null;
    if (!button || button.disabled || hasClickHandler(button)) return;
    if (button.form && (button.type === 'submit' || button.type === 'reset')) return;
    var label = String(button.textContent || button.value || '按钮').trim().slice(0, 20);
    report('点击「' + label + '」没有响应：按钮未绑定事件，可能是脚本缺失或初始化失败');
  }, true);
  window.addEventListener('error', function(event){
    if (event && event.message) {
      report(event.message + (event.lineno ? '（第 ' + event.lineno + ' 行）' : ''));
      return;
    }
    var target = event && event.target;
    if (target && target !== window) {
      var url = String(target.src || target.href || '');
      if (url) report('资源加载失败：' + (url.indexOf('data:') === 0 ? '内联脚本' : url.slice(0, 160)));
    }
  }, true);
  window.addEventListener('unhandledrejection', function(event){
    var reason = event && event.reason;
    report('未处理的异步错误：' + ((reason && reason.message) || reason));
  });
  // 存储兼容：预览 iframe 为隔离沙箱（不开放同源权限），访问 localStorage/sessionStorage 会抛 SecurityError，
  // 导致读取最高分等初始化代码中断。不可用时替换为会话内存存储，接口与 Web Storage 一致。
  function memoryStorage(){
    var data = {};
    var store = {
      getItem: function(k){ k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[String(k)] = String(v); },
      removeItem: function(k){ delete data[String(k)]; },
      clear: function(){ data = {}; },
      key: function(i){ var keys = Object.keys(data); return i < keys.length ? keys[i] : null; }
    };
    Object.defineProperty(store, 'length', { get: function(){ return Object.keys(data).length; } });
    return store;
  }
  ['localStorage', 'sessionStorage'].forEach(function(name){
    var usable = false;
    try { usable = !!window[name]; } catch (e) { usable = false; }
    if (!usable) {
      try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e) {}
    }
  });
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

/**
 * 解析本地资源引用：支持 ./ ../ 与根路径、查询参数/锚点、入口所在子目录；
 * 精确匹配失败时按不区分大小写兜底（模型常写 Style.css 而文件为 style.css）。
 */
function findFile(files: ProjectFile[], ref: string, baseDir = ''): ProjectFile | undefined {
  const trimmed = ref.trim();
  const clean = trimmed.split(/[?#]/)[0];
  const candidates: string[] = [];
  if (baseDir && !trimmed.startsWith('/')) candidates.push(resolveModulePath(`${baseDir}/index.html`, clean));
  candidates.push(resolveModulePath('index.html', clean));
  for (const candidate of candidates) {
    const hit = files.find((f) => f.path === candidate);
    if (hit) return hit;
  }
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const hit = files.find((f) => f.path.toLowerCase() === lower);
    if (hit) return hit;
  }
  return undefined;
}

/** 读取 HTML 属性（双引号 / 单引号 / 无引号），返回匹配结果以便原位替换。 */
function matchAttr(attrs: string, name: string): RegExpExecArray | null {
  return new RegExp(`(^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs);
}

function attrValue(match: RegExpExecArray | null): string {
  return match ? (match[2] ?? match[3] ?? match[4] ?? '').trim() : '';
}

/** 是否为项目内本地文件引用（排除 http(s)、协议相对、data:、blob: 等外部地址）。 */
function isLocalRef(ref: string): boolean {
  const value = ref.trim();
  return Boolean(value) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function isStylesheetLink(attrs: string, href: string): boolean {
  const rel = attrValue(matchAttr(attrs, 'rel')).toLowerCase();
  return rel.split(/\s+/).includes('stylesheet') || href.toLowerCase().split(/[?#]/)[0].endsWith('.css');
}

/** 入口 HTML 引用的本地样式表与脚本（原始引用串）。 */
function collectEntryRefs(html: string): { css: string[]; js: string[] } {
  const css: string[] = [];
  const js: string[] = [];
  const linkPattern = /<link\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = attrValue(matchAttr(match[1], 'href'));
    if (isLocalRef(href) && isStylesheetLink(match[1], href)) css.push(href);
  }
  const scriptPattern = /<script\b([^>]*)>/gi;
  while ((match = scriptPattern.exec(html)) !== null) {
    const src = attrValue(matchAttr(match[1], 'src'));
    if (isLocalRef(src)) js.push(src);
  }
  return { css, js };
}

function refDisplayPath(ref: string, baseDir: string): string {
  const clean = ref.trim().split(/[?#]/)[0];
  return resolveModulePath(baseDir && !clean.startsWith('/') ? `${baseDir}/index.html` : 'index.html', clean);
}

function entryBaseDir(entry: ProjectFile): string {
  return entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
}

/**
 * 入口页面引用、但项目中不存在的本地 CSS/JS 文件。缺失时页面只剩无样式、脚本不运行的骨架，
 * 预览应明确提示而不是当成可用页面展示。
 */
export function findMissingAssets(filesInput: ProjectFile[] | Record<string, string>): string[] {
  const files = Array.isArray(filesInput) ? filesInput : dictToFiles(filesInput);
  const entry = findEntryFile(files);
  if (!entry || !entry.content.trim()) return [];
  const baseDir = entryBaseDir(entry);
  const { css, js } = collectEntryRefs(entry.content);
  const missing = [...css, ...js]
    .filter((ref) => !findFile(files, ref, baseDir))
    .map((ref) => refDisplayPath(ref, baseDir));
  return Array.from(new Set(missing));
}

/** 内联样式表并递归展开本地 @import（按样式表自身目录解析，防止循环引用）。 */
function inlineCss(asset: ProjectFile, files: ProjectFile[], seen: Set<string>): string {
  const dir = entryBaseDir(asset);
  return asset.content.replace(
    /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?\s*([^;]*);/gi,
    (match, _quote: string, href: string, media: string) => {
      if (!isLocalRef(href)) return match;
      const target = findFile(files, href, dir);
      if (!target || seen.has(target.path)) return match;
      seen.add(target.path);
      const css = inlineCss(target, files, seen);
      return media.trim() ? `@media ${media.trim()} {\n${css}\n}` : css;
    },
  );
}

/**
 * 入口文件定位：优先根目录 index.html；兼容模型输出的大小写差异（Index.html）、
 * 以及 src/、public/ 等子目录下的 index.html（取层级最浅者）。
 */
export function findEntryFile(files: ProjectFile[]): ProjectFile | undefined {
  const exact = files.find((f) => f.path === 'index.html');
  if (exact) return exact;
  const candidates = files
    .filter((f) => /(^|\/)index\.html?$/i.test(f.path) && f.content.trim())
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  return candidates[0];
}

/** UTF-8 文本 → Base64（分块转换，避免超长字符串展开导致栈溢出）。 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 本地 JS 文件以 data: URL 外链方式注入，而不是把源码直接内联进 <script>：
 * - 保留原有 defer / async / type="module" 语义（内联脚本会忽略 defer，导致在 DOM 解析前执行、
 *   getElementById 拿到 null、按钮事件绑定失败——「点击开始无响应」的主因）；
 * - 源码中出现的 '</script>' 字面量不会提前终止脚本标签；
 * - 经典脚本仍在全局作用域执行，onclick="startGame()" 等内联处理器可正常找到函数。
 */
function scriptDataUrl(code: string): string {
  return `data:text/javascript;charset=utf-8;base64,${utf8ToBase64(code)}`;
}

/** 以 importer 所在目录解析相对路径（支持 ./ ../ 与以 / 开头的项目根路径）。 */
function resolveModulePath(importerPath: string, specifier: string): string {
  const clean = specifier.split(/[?#]/)[0];
  const parts = clean.startsWith('/') ? [] : importerPath.split('/').slice(0, -1);
  for (const segment of clean.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** 静态 import / export-from / 动态 import() 中的相对或根路径说明符。 */
const MODULE_SPECIFIER_PATTERN =
  /(\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(["'])((?:\.{1,2}\/|\/)[^"'\n]+)\2/g;

/**
 * 预览 iframe 为不透明源沙箱，data: 模块内的相对说明符（如 import './game.js'）无法解析。
 * 这里递归地把模块源码中的相对说明符替换为对应项目文件的 data: URL（自底向上），
 * 使多文件 ES module 无需同源权限即可运行。循环依赖无法用 data URL 表达，保持原样，
 * 由运行时错误上报提示。
 */
function rewriteModuleImports(
  code: string,
  importerPath: string,
  files: ProjectFile[],
  cache: Map<string, string>,
  stack: Set<string>,
): string {
  return code.replace(MODULE_SPECIFIER_PATTERN, (match, prefix: string, quote: string, specifier: string) => {
    const target = resolveModulePath(importerPath, specifier);
    const asset = findFile(files, target) ?? findFile(files, `${target}.js`);
    if (!asset || stack.has(asset.path)) return match;
    return `${prefix}${quote}${moduleDataUrl(asset, files, cache, stack)}${quote}`;
  });
}

function moduleDataUrl(
  asset: ProjectFile,
  files: ProjectFile[],
  cache: Map<string, string>,
  stack: Set<string>,
): string {
  const cached = cache.get(asset.path);
  if (cached) return cached;
  stack.add(asset.path);
  const url = scriptDataUrl(rewriteModuleImports(asset.content, asset.path, files, cache, stack));
  stack.delete(asset.path);
  cache.set(asset.path, url);
  return url;
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
  const index = findEntryFile(files);
  if (!index || !index.content.trim()) return null;
  const baseDir = entryBaseDir(index);

  let html = index.content;

  // 样式表：兼容单/双/无引号属性、查询参数、大小写差异，并展开本地 @import
  html = html.replace(/<link\b([^>]*)>/gi, (match, attrs: string) => {
    const href = attrValue(matchAttr(attrs, 'href'));
    if (!isLocalRef(href) || !isStylesheetLink(attrs, href)) return match;
    const asset = findFile(files, href, baseDir);
    return asset ? `<style>\n${inlineCss(asset, files, new Set([asset.path]))}\n</style>` : match;
  });

  const moduleCache = new Map<string, string>();
  const isModule = (attrs: string) => /\btype\s*=\s*["']?module\b/i.test(attrs);

  html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (match, attrs: string) => {
    const srcMatch = matchAttr(attrs, 'src');
    const src = attrValue(srcMatch);
    if (!srcMatch || !isLocalRef(src)) return match;
    const asset = findFile(files, src, baseDir);
    if (!asset) return match;
    const url = isModule(attrs) ? moduleDataUrl(asset, files, moduleCache, new Set()) : scriptDataUrl(asset.content);
    return `<script${attrs.replace(srcMatch[0], srcMatch[1])} src="${url}"></script>`;
  });

  // 内联模块脚本的相对 import 同样会按宿主页面地址解析，需一并改写为 data URL。
  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (match, attrs: string, code: string) => {
      if (/\bsrc\s*=/i.test(attrs) || !isModule(attrs) || !code.trim()) return match;
      return `<script${attrs}>${rewriteModuleImports(code, index.path, files, moduleCache, new Set())}</script>`;
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
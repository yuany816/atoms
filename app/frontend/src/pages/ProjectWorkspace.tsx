import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  FolderTree,
  ImagePlus,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
  Share2,
  SquareTerminal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  attachAtomsHost,
  buildPreviewHtml,
  diagnoseEmptyPreview,
  diagnoseReply,
  extractFilePaths,
  extractPartialFiles,
  findMentionedFiles,
  findMissingAssets,
  hasOpenFileBlock,
  openFileBlockTail,
  recoverDraftsFromMessages,
  recoverFilesFromMessages,
  stitchContinuation,
  streamGenerate,
  stripFileBlocks,
  SYSTEM_PROMPT,
  type ParsedFile,
} from '@/lib/engine';
import {
  DEFAULT_MODEL,
  MODEL_POOL,
  checkSlug,
  filesToDict,
  formatTime,
  getErrorDetail,
  publishProject,
  slugifyName,
  uploadAsset,
  createShare,
  uid,
  type Project,
} from '@/lib/platform';
import { useProjectStore } from '@/store/projects';

const PROJECTS_STORAGE_KEY = 'atoms-clone-projects-v1';
/** 单次生成被截断时，自动从断点续写的最大次数。 */
const MAX_CONTINUE_ROUNDS = 3;

/**
 * 校验文件是否已真正持久化到 localStorage：persist 中间件在配额超限等情况下写入失败不会抛到调用方，
 * 刷新后文件会丢失。返回未能持久化的路径。
 */
function findUnpersistedPaths(projectId: string, files: ParsedFile[]): string[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    const saved = raw
      ? (JSON.parse(raw) as { state?: { projects?: Project[] } }).state?.projects?.find((p) => p.id === projectId)
      : undefined;
    return files
      .filter((f) => saved?.files.find((s) => s.path === f.path)?.content !== f.content)
      .map((f) => f.path);
  } catch {
    return files.map((f) => f.path);
  }
}

/**
 * 项目工作区：真实 AI 流式对话（Atoms Cloud AI Hub）+ 编辑器 + 终端 + iframe 预览
 * + 发布 / 分享 / 素材上传 / Bug 修复，全部走真实接口。
 */
export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const project: Project | undefined = useProjectStore((s) =>
    s.projects.find((p) => p.id === id),
  );

  const addMessage = useProjectStore((s) => s.addMessage);
  const patchMessage = useProjectStore((s) => s.patchMessage);
  const appendMessageChunk = useProjectStore((s) => s.appendMessageChunk);
  const appendLog = useProjectStore((s) => s.appendLog);
  const applyFiles = useProjectStore((s) => s.applyFiles);
  const updateFileContent = useProjectStore((s) => s.updateFileContent);
  const upsertDrafts = useProjectStore((s) => s.upsertDrafts);
  const dismissDraft = useProjectStore((s) => s.dismissDraft);
  const setPublishedSlug = useProjectStore((s) => s.setPublishedSlug);

  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState('preview');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** 当前选中的是「不完整」草稿（只读）而非项目文件 */
  const [selectedIsDraft, setSelectedIsDraft] = useState(false);
  /** 最近一次生成/恢复写入的文件：新增或已修改 */
  const [changeMarks, setChangeMarks] = useState<Record<string, 'new' | 'modified'>>({});
  const [editorDraft, setEditorDraft] = useState('');
  const [previewNonce, setPreviewNonce] = useState(0);
  const [uploading, setUploading] = useState(false);

  const [publishOpen, setPublishOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePreparing, setSharePreparing] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [bugText, setBugText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  // 预览 iframe：window.atoms 桥的宿主代理
  useEffect(() => attachAtomsHost(), []);

  // 预览以 srcdoc 渲染：内容直接随 iframe 挂载，不依赖 blob URL 的创建/撤销时序
  // （避免刷新、重挂载时引用已撤销 URL 导致的偶发空白）；key 变化时才重建 iframe。
  const previewHtml = useMemo(
    () => (project ? buildPreviewHtml(project.files, project.id) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.files, project?.id],
  );
  // 入口引用但项目中不存在的本地 CSS/JS：缺失时页面只剩无样式骨架、脚本不运行，不作为可用预览展示
  const missingAssets = useMemo(
    () => (project ? findMissingAssets(project.files) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.files],
  );
  const previewUrl =
    previewHtml && missingAssets.length === 0 ? `${project?.id}:${previewNonce}:${previewHtml.length}` : null;
  const [writeFailure, setWriteFailure] = useState<string | null>(null);
  useEffect(() => setWriteFailure(null), [project?.id]);
  // 预览不可用时判定准确原因：没有生成 / 可从对话恢复 / 被截断 / 格式无法识别 / 缺少入口 / 缺少引用文件
  const emptyDiagnosis = useMemo(
    () =>
      project && !previewUrl
        ? diagnoseEmptyPreview(project.files, project.messages)
        : { kind: 'none' as const, paths: [], recoverable: [], truncated: [] as string[] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewUrl, project?.files, project?.messages],
  );

  // 预览运行时错误：iframe 内桥接脚本上报的异常以中文提示展示，并提供一键修复入口
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  useEffect(() => {
    setPreviewErrors([]);
  }, [previewUrl]);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; message?: string } | null;
      if (!data || data.source !== 'atoms-preview' || data.type !== 'runtime-error') return;
      if (event.source !== previewFrameRef.current?.contentWindow) return;
      const message = String(data.message || '未知错误');
      setPreviewErrors((prev) => (prev.includes(message) ? prev : [...prev, message].slice(-5)));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const lastMessage = project?.messages[project.messages.length - 1];
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [project?.messages.length, lastMessage?.content.length, lastMessage?.error]);

  useEffect(() => {
    terminalScrollRef.current?.scrollTo({ top: terminalScrollRef.current.scrollHeight });
  }, [project?.logs.length]);

  const drafts = useMemo(
    () => (project?.drafts ?? []).filter((d) => !d.dismissed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.drafts],
  );
  // 对话中已生成但不在编辑器里的文件（完整文件 + 未闭合的不完整内容），不依赖预览是否可用
  const recoverable = useMemo(
    () =>
      project && !generating
        ? {
            files: recoverFilesFromMessages(project.messages, project.files),
            drafts: recoverDraftsFromMessages(project.messages, project.files, project.drafts),
          }
        : { files: [] as ParsedFile[], drafts: [] as { path: string; content: string; createdAt: number }[] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.messages, project?.files, project?.drafts, generating],
  );

  // 切换项目：清空上一个项目的选中状态与变更标记
  useEffect(() => {
    setSelectedPath(null);
    setSelectedIsDraft(false);
    setChangeMarks({});
  }, [project?.id]);

  // 选中项不存在（首次打开、切项目、文件被替换）时自动选中第一个文件，避免编辑区空白
  useEffect(() => {
    if (!project) return;
    const exists = selectedIsDraft
      ? drafts.some((d) => d.path === selectedPath)
      : project.files.some((f) => f.path === selectedPath);
    if (selectedPath && exists) return;
    if (project.files[0]) {
      setSelectedIsDraft(false);
      setSelectedPath(project.files[0].path);
    } else if (drafts[0]) {
      setSelectedIsDraft(true);
      setSelectedPath(drafts[0].path);
    } else if (selectedPath) {
      setSelectedPath(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, project?.files, drafts, selectedPath, selectedIsDraft]);

  // 选中文件变化时同步编辑器草稿
  const selectedFile = selectedIsDraft ? null : (project?.files.find((f) => f.path === selectedPath) ?? null);
  const selectedDraft = selectedIsDraft ? (drafts.find((d) => d.path === selectedPath) ?? null) : null;
  useEffect(() => {
    setEditorDraft(selectedDraft?.content ?? selectedFile?.content ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, selectedIsDraft, selectedFile?.updatedAt, selectedDraft?.createdAt]);

  // ---------- 分享（真实接口）：打开弹窗时创建云端快照（Hook 必须无条件调用，置于早退分支之前） ----------

  const publishedSlugNow = project?.publishedSlug;

  useEffect(() => {
    if (!project || !shareOpen || shareUrl || sharePreparing) return;
    setSharePreparing(true);
    createShare({
      project_id: project.id,
      name: project.name,
      snapshot: {
        messages: project.messages.map((m) => ({
          role: m.role,
          content: m.content,
          model: m.model,
          createdAt: m.createdAt,
        })),
        files: filesToDict(project.files),
      },
    })
      .then(({ url }) => setShareUrl(url))
      .catch((err) => {
        toast.error(getErrorDetail(err) || '创建分享失败，请重试');
        setShareOpen(false);
      })
      .finally(() => setSharePreparing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareOpen]);

  if (!project) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-sm text-muted-foreground">项目不存在或已被删除</p>
        <Button asChild variant="outline">
          <Link to="/dashboard">返回工作台</Link>
        </Button>
      </div>
    );
  }

  /** 写入文件并校验持久化；写入失败时明确提示（刷新后可从对话恢复）。 */
  const writeFiles = (projectId: string, files: ParsedFile[], source = '生成') => {
    const before = useProjectStore.getState().projects.find((p) => p.id === projectId)?.files ?? [];
    const marks: Record<string, 'new' | 'modified'> = {};
    for (const f of files) {
      const old = before.find((b) => b.path === f.path);
      if (!old) marks[f.path] = 'new';
      else if (old.content !== f.content) marks[f.path] = 'modified';
    }
    setChangeMarks((prev) => ({ ...prev, ...marks }));
    // 自动选中第一个新增/修改的文件，切到编辑器即可看到
    const focus = files.find((f) => marks[f.path]) ?? files[0];
    if (focus) {
      setSelectedIsDraft(false);
      setSelectedPath(focus.path);
    }
    let failed: string[] = [];
    try {
      applyFiles(projectId, files);
      failed = findUnpersistedPaths(projectId, files);
    } catch {
      failed = files.map((f) => f.path);
    }
    for (const f of files) appendLog(projectId, `文件已${source === '恢复' ? '恢复' : '更新'}: ${f.path}`, 'success');
    if (failed.length > 0) {
      const tip = `文件保存到浏览器本地存储失败（可能存储空间已满）：${failed.join('、')}。当前预览可用，但刷新后可能丢失，可通过「从对话恢复文件」找回。`;
      appendLog(projectId, tip, 'error');
      setWriteFailure(tip);
      toast.error(tip);
    } else {
      setWriteFailure(null);
      appendLog(projectId, '构建完成，预览已刷新', 'success');
    }
    setTab('preview');
    setPreviewNonce((n) => n + 1);
  };

  /** 从历史对话恢复：完整文件写入项目（不覆盖较新文件），未闭合内容作为「不完整」草稿恢复。 */
  const handleRecover = () => {
    const { files, drafts: partials } = recoverable;
    if (files.length === 0 && partials.length === 0) return;
    if (files.length > 0) writeFiles(project.id, files, '恢复');
    if (partials.length > 0) {
      upsertDrafts(project.id, partials);
      appendLog(project.id, `已恢复不完整内容（未写入项目）：${partials.map((d) => d.path).join('、')}`, 'error');
    }
    setTab('editor');
    toast.success(
      `已从对话恢复 ${files.length} 个文件${partials.length > 0 ? `，${partials.length} 个不完整文件已作为草稿保留` : ''}`,
    );
  };

  const currentReply = (projectId: string, messageId: string) =>
    useProjectStore.getState().projects.find((p) => p.id === projectId)?.messages.find((m) => m.id === messageId)
      ?.content ?? '';

  const completionPrompt = (paths: string[]) =>
    `【补全文件】index.html 引用的 ${paths.join('、')} 缺失或上次输出被截断，导致页面只剩无样式骨架、脚本不运行。请只完整输出这些文件（每个文件用 <atoms-file path="文件路径"> 包裹并以 </atoms-file> 闭合），内容需与现有 index.html 中的元素 id 和结构一致，不要重复输出其他文件。`;

  const regeneratePrompt =
    emptyDiagnosis.kind === 'missing-assets'
      ? completionPrompt(emptyDiagnosis.paths)
      : emptyDiagnosis.kind === 'truncated'
      ? `【重新生成】上次回复中的 ${emptyDiagnosis.paths.join('、')} 输出不完整，请严格按 <atoms-file path="文件路径"> 协议完整输出全部文件，尽量精简以免超长。`
      : '【重新生成】上次回复的代码格式无法识别，请严格按 <atoms-file path="index.html"> ... </atoms-file> 协议完整输出 index.html 及其引用的文件。';

  // ---------- 核心：发送消息 → 真实模型流式生成 → 解析文件 → 更新预览 ----------

  const handleSend = async (raw: string, isContinuation = false) => {
    const text = raw.trim();
    if (!text || generating) return;
    const projectId = project.id;
    let continuation = '';

    setGenerating(true);
    if (!isContinuation) setChangeMarks({});
    const userMsg = { id: uid('m-'), role: 'user' as const, content: text, createdAt: Date.now() };
    addMessage(projectId, userMsg);
    const assistantId = uid('m-');
    addMessage(projectId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      model,
      createdAt: Date.now(),
    });
    appendLog(projectId, `开始调用模型 ${model} 生成`);

    const state = useProjectStore.getState();
    const latest = state.projects.find((p) => p.id === projectId);
    // 构建模型上下文：剔除失败占位消息，并从末尾裁掉 assistant 消息（含本轮「正在思考」
    // 空占位与中断残留）——部分上游模型不支持 assistant prefill，要求对话以 user 消息结尾
    const contextMessages = (latest?.messages ?? [userMsg]).filter((m) => !m.error);
    while (
      contextMessages.length > 0 &&
      contextMessages[contextMessages.length - 1].role === 'assistant'
    ) {
      contextMessages.pop();
    }
    const history = contextMessages
      .slice(-8)
      .map((m) => ({
        role: m.role,
        content: m.role === 'assistant' ? stripFileBlocks(m.content) || m.content : m.content,
      }));
    const fileContext = latest?.files.length
      ? `当前项目已有文件（完整内容）：\n${latest.files
          .map((f) => `<atoms-file path="${f.path}">\n${f.content}\n</atoms-file>`)
          .join('\n')}`
      : '当前项目暂无文件，请生成完整的 index.html。';
    // 入口当前缺失的引用：给没有文件名标注的单独 css/js 代码块确定目标文件
    const expectedMissing = latest ? findMissingAssets(latest.files) : [];
    let streamError = '';

    try {
      try {
      await streamGenerate({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `当前项目状态：\n${fileContext}` },
          ...history,
        ],
        model,
        projectId,
        onChunk: (chunk) => appendMessageChunk(projectId, assistantId, chunk),
        onEnhancement: (info) => {
          // 会话自动增强来源标注：在终端日志中记录命中的知识与注入的技能
          const kb = (info.kb_sources ?? []).map(
            (s) => `${s.file_name || '未知文件'}#${s.chunk_index ?? '-'}(相关度 ${s.score ?? '-'})`,
          );
          const sk = info.skill_names ?? [];
          if (kb.length > 0) appendLog(projectId, `命中知识: ${kb.join('、')}`, 'success');
          if (sk.length > 0) appendLog(projectId, `注入技能: ${sk.join('、')}`, 'success');
          if (kb.length === 0 && sk.length === 0) {
            appendLog(projectId, '本次未命中知识库/技能上下文');
          }
        },
      });
      } catch (streamFailure) {
        // 流中途报错：已收到的内容保留并照常写入完整文件，不再整条替换为失败提示
        streamError = getErrorDetail(streamFailure) || 'AI 生成失败，请稍后重试';
        if (!currentReply(projectId, assistantId).trim()) throw streamFailure;
        appendLog(projectId, `生成中途中断：${streamError}，已保留收到的内容`, 'error');
      }

      // 流提前结束、文件块未闭合：从断点续写并拼回同一条回复，避免半截文件被丢弃后旧版本一直留在预览里
      for (let round = 1; round <= MAX_CONTINUE_ROUNDS; round += 1) {
        const current = currentReply(projectId, assistantId);
        const open = hasOpenFileBlock(current) ? openFileBlockTail(current) : null;
        if (!open) break;
        appendLog(projectId, `${open.path} 输出中断，正在从断点续写（第 ${round}/${MAX_CONTINUE_ROUNDS} 次）…`);
        let next = '';
        try {
          await streamGenerate({
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `当前项目状态：\n${fileContext}` },
              {
                role: 'user',
                content: `【断点续写】你上次输出 ${open.path} 时中断，已输出内容如下：\n${open.content}\n\n请从最后一个字符之后紧接着继续输出剩余内容，不要重复已输出内容，不要输出说明文字或代码围栏，并在文件结束处输出 </atoms-file>。`,
              },
            ],
            model,
            projectId,
            onChunk: (chunk) => {
              next += chunk;
            },
          });
        } catch (continueError) {
          appendLog(projectId, `续写失败：${getErrorDetail(continueError) || '请稍后重试'}`, 'error');
          break;
        }
        if (!next.trim()) break;
        patchMessage(projectId, assistantId, { content: stitchContinuation(current, next) });
      }

      const full = currentReply(projectId, assistantId);
      const { files, truncated, unrecognized } = diagnoseReply(full, expectedMissing);
      const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      // 未闭合的文件：保留已收到部分为「不完整」草稿，不进入项目文件，不覆盖已有文件
      const partials = extractPartialFiles(full).filter((p) => !files.some((f) => sameFile(f.path, p.path)));
      if (partials.length > 0) {
        upsertDrafts(
          projectId,
          partials.map((p) => ({ ...p, createdAt: Date.now() })),
        );
      }
      if (truncated.length > 0) {
        const tip = `以下文件输出不完整（可能被截断或连接中断），未写入项目，已收到的部分保存为「不完整」草稿：${truncated.join('、')}。可在编辑器查看，或点击「让 AI 补全」。`;
        appendLog(projectId, tip, 'error');
        toast.error(tip);
      }
      if (files.length > 0) {
        writeFiles(projectId, files);
      } else if (partials.length > 0) {
        setSelectedIsDraft(true);
        setSelectedPath(partials[0].path);
      } else if (unrecognized) {
        const tip = '本次回复包含代码，但格式无法识别，未写入项目。请在预览区点击「让 AI 重新生成」。';
        appendLog(projectId, tip, 'error');
        toast.error(tip);
      } else if (truncated.length === 0) {
        appendLog(projectId, '本次回复未包含文件改动');
      }
      // 对账：说明文字提到的文件与实际写入不一致时明确提示，避免「说已生成、实际没有」
      const written = useProjectStore.getState().projects.find((p) => p.id === projectId)?.files ?? [];
      const lost = findMentionedFiles(full).filter(
        (m) =>
          !files.some((f) => sameFile(f.path, m)) &&
          !partials.some((p) => sameFile(p.path, m)) &&
          !written.some((f) => sameFile(f.path, m)),
      );
      const notes: string[] = [];
      if (streamError) notes.push(`生成中途中断（${streamError}），已保留收到的内容。`);
      if (partials.length > 0) {
        notes.push(
          `${partials.map((p) => p.path).join('、')} 输出不完整，已保存为「不完整」草稿（未写入项目，不参与预览、发布和分享），可在编辑器查看。`,
        );
      }
      if (lost.length > 0) {
        const tip = `回复中提到的 ${lost.join('、')} 未写入项目：回复里没有这些文件的完整内容。`;
        notes.push(tip);
        appendLog(projectId, tip, 'error');
        toast.error(tip);
      }
      if (notes.length > 0) {
        patchMessage(projectId, assistantId, {
          notice: notes.join(''),
          pendingPaths: [...partials.map((p) => p.path), ...lost],
        });
      }
      // 入口引用的本地文件仍缺失（模型漏输出或被截断）：自动续写补全一次，仍失败则在预览区提示
      const updated = useProjectStore.getState().projects.find((p) => p.id === projectId);
      const missing = updated ? findMissingAssets(updated.files) : [];
      if (missing.length > 0) {
        const tip = `index.html 引用的文件缺失：${missing.join('、')}，页面样式与脚本无法生效。`;
        appendLog(projectId, isContinuation ? `${tip}自动补全未成功，请在预览区点击「让 AI 补全缺失文件」。` : `${tip}正在自动补全…`, 'error');
        if (!isContinuation) continuation = completionPrompt(missing);
        else toast.error(`${tip}请在预览区点击「让 AI 补全缺失文件」。`);
      } else if (truncated.length > 0 && !isContinuation) {
        // 文件被截断且项目中仍无可用版本：自动要求精简后完整重新输出一次
        const lacking = truncated.filter((p) => !updated?.files.some((f) => f.path === p));
        if (lacking.length > 0) {
          appendLog(projectId, `${lacking.join('、')} 输出被截断，正在自动要求精简后重新完整输出…`, 'error');
          continuation = `【重新生成】上次回复中的 ${lacking.join('、')} 超出长度上限被截断。请精简实现（去掉注释、合并重复样式、控制在 400 行以内），重新完整输出 ${lacking.join('、')}，并以 </atoms-file> 闭合。`;
        }
      }
    } catch (e) {
      const detail = getErrorDetail(e) || 'AI 生成失败，请稍后重试';
      // 已收到内容时只追加提示，不覆盖（保留可恢复的文件内容）
      if (currentReply(projectId, assistantId).trim()) {
        patchMessage(projectId, assistantId, { notice: `生成失败：${detail}` });
      } else {
        patchMessage(projectId, assistantId, { content: `生成失败：${detail}`, error: true });
      }
      appendLog(projectId, `生成失败: ${detail}`, 'error');
      toast.error(`生成失败：${detail}`);
    } finally {
      setGenerating(false);
    }
    if (continuation) await handleSend(continuation, true);
  };

  // ---------- 素材上传（真实对象存储代理） ----------

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { url } = await uploadAsset({
        project_id: project.id,
        filename: file.name,
        content_type: file.type || 'image/png',
        file_base64: dataUrl,
      });
      setInput((prev) => (prev ? `${prev}\n${url}` : `请在应用中使用这张图片素材：${url}`));
      appendLog(project.id, `素材已上传: ${file.name}`, 'success');
      toast.success('素材已上传，链接已填入输入框');
    } catch (err) {
      toast.error(getErrorDetail(err) || '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  // ---------- 发布（真实接口） ----------

  const openPublish = () => {
    setSlug(project.publishedSlug || slugifyName(project.name));
    setPublishOpen(true);
  };

  const handlePublish = async () => {
    const target = slug.trim();
    if (!/^[a-z0-9-]{3,40}$/.test(target)) {
      toast.error('链接路径仅支持小写字母、数字和中划线，长度 3-40 位');
      return;
    }
    setPublishing(true);
    try {
      const available = await checkSlug(target);
      if (!available && target !== project.publishedSlug) {
        toast.error('该链接已被使用，请更换路径');
        return;
      }
      await publishProject({
        project_id: project.id,
        name: project.name,
        slug: target,
        files: filesToDict(project.files),
      });
      setPublishedSlug(project.id, target);
      appendLog(project.id, `应用已发布: /p/${target}`, 'success');
      toast.success('发布成功');
    } catch (err) {
      toast.error(getErrorDetail(err) || '发布失败，请重试');
    } finally {
      setPublishing(false);
    }
  };

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast.success('链接已复制');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* 顶部栏 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-sm">
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            工作台
          </Link>
        </Button>
        <div className="h-4 w-px bg-border" />
        <h1 className="min-w-0 truncate text-sm font-medium text-foreground">{project.name}</h1>
        {publishedSlugNow && (
          <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
            <Eye className="h-3 w-3" />
            已发布
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setBugOpen(true)}>
            <Bug className="h-3.5 w-3.5" />
            Bug 修复
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShareOpen(true)}>
            <Share2 className="h-3.5 w-3.5" />
            分享
          </Button>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={openPublish}>
            <Rocket className="h-3.5 w-3.5" />
            {publishedSlugNow ? '更新发布' : '发布'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧：对话区 */}
        <section className="flex w-[400px] shrink-0 flex-col border-r bg-card">
          <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {project.messages.length === 0 && (
              <div className="rounded-lg border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
                描述你想要的应用，例如：「做一个番茄钟计时器，有开始/暂停/重置和完成提示音」。
                AI 会生成可直接运行的完整代码，并自动刷新右侧预览。
              </div>
            )}
            {project.messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
                      {message.content}
                    </div>
                  </div>
                );
              }
              const visible = stripFileBlocks(message.content);
              const paths = extractFilePaths(message.content);
              return (
                <div key={message.id} className="flex justify-start">
                  <div
                    className={`max-w-[90%] rounded-lg rounded-bl-sm border px-3 py-2 text-sm leading-relaxed ${
                      message.error
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'bg-accent text-foreground'
                    }`}
                  >
                    {message.content === '' && !message.error ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在思考…
                      </span>
                    ) : (
                      <p className="whitespace-pre-wrap">{visible || message.content}</p>
                    )}
                    {paths.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {paths.map((p) => (
                          <span
                            key={p}
                            className="flex items-center gap-1 rounded bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            <FileCode2 className="h-3 w-3" />
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.notice && (
                      <div className="mt-2 flex flex-col gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-foreground">
                        <p className="flex gap-1.5">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          <span>{message.notice}</span>
                        </p>
                        {(message.pendingPaths ?? []).length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-fit px-2 text-xs"
                            disabled={generating}
                            onClick={() => void handleSend(completionPrompt(message.pendingPaths ?? []))}
                          >
                            让 AI 补全
                          </Button>
                        )}
                      </div>
                    )}
                    {message.model && (
                      <div className="mt-1.5 text-xs text-muted-foreground">{message.model}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t p-3">
            <div className="mb-2 flex items-center gap-2">
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-7 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_POOL.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void handleUploadFile(e)}
              />
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 gap-1 text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                上传素材
              </Button>
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const text = input;
                  setInput('');
                  void handleSend(text);
                }
              }}
              placeholder="描述需求或修改意见，Enter 发送，Shift+Enter 换行"
              className="min-h-[72px] resize-none text-sm"
              disabled={generating}
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                disabled={generating || !input.trim()}
                onClick={() => {
                  const text = input;
                  setInput('');
                  void handleSend(text);
                }}
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {generating ? '生成中' : '发送'}
              </Button>
            </div>
          </div>
        </section>

        {/* 右侧：编辑器 / 终端 / 预览 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 w-fit">
              <TabsTrigger value="editor" className="gap-1 text-xs">
                <FolderTree className="h-3.5 w-3.5" />
                编辑器
                {Object.keys(changeMarks).length + drafts.length > 0 && (
                  <span className="rounded bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                    {Object.keys(changeMarks).length + drafts.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="terminal" className="gap-1 text-xs">
                <SquareTerminal className="h-3.5 w-3.5" />
                终端
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1 text-xs">
                <Eye className="h-3.5 w-3.5" />
                预览
              </TabsTrigger>
            </TabsList>

            <TabsContent value="editor" className="min-h-0 flex-1 overflow-hidden">
              {project.files.length === 0 &&
              drafts.length === 0 &&
              recoverable.files.length + recoverable.drafts.length === 0 ? (
                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  暂无文件。在左侧对话中描述你的想法，AI 会生成 index.html 等文件，之后可在此直接编辑。
                </div>
              ) : (
                <div className="flex h-full flex-col border-t">
                  {(recoverable.files.length + recoverable.drafts.length > 0 || missingAssets.length > 0) && (
                    <div
                      data-testid="editor-notice"
                      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-accent px-3 py-2 text-xs text-foreground"
                    >
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                      <p className="min-w-0 flex-1 break-all">
                        {recoverable.files.length + recoverable.drafts.length > 0 &&
                          `对话中生成的 ${[...recoverable.files, ...recoverable.drafts]
                            .map((f) => f.path)
                            .join('、')} 尚未放入编辑器${
                            recoverable.drafts.length > 0
                              ? `（其中 ${recoverable.drafts.map((d) => d.path).join('、')} 输出不完整，将作为草稿恢复）`
                              : ''
                          }。恢复不会覆盖你之后修改过的文件。`}
                        {missingAssets.length > 0 && `index.html 引用的 ${missingAssets.join('、')} 不在项目中。`}
                      </p>
                      {recoverable.files.length + recoverable.drafts.length > 0 && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={handleRecover}>
                          从对话恢复文件
                        </Button>
                      )}
                      {missingAssets.length > 0 && (
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={generating}
                          onClick={() => void handleSend(completionPrompt(missingAssets))}
                        >
                          让 AI 补全缺失文件
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="flex min-h-0 flex-1">
                    <div data-testid="editor-file-list" className="w-44 shrink-0 overflow-y-auto border-r bg-card p-2">
                      {project.files.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => {
                            setSelectedIsDraft(false);
                            setSelectedPath(file.path);
                          }}
                          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                            !selectedIsDraft && selectedPath === file.path
                              ? 'bg-accent font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-accent/60'
                          }`}
                        >
                          <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{file.path}</span>
                          {changeMarks[file.path] && (
                            <span className="shrink-0 rounded bg-primary px-1 font-sans text-[10px] leading-4 text-primary-foreground">
                              {changeMarks[file.path] === 'new' ? '新增' : '已修改'}
                            </span>
                          )}
                        </button>
                      ))}
                      {drafts.length > 0 && (
                        <>
                          <p className="px-2 pb-1 pt-3 text-[11px] text-muted-foreground">不完整（未写入项目）</p>
                          {drafts.map((draft) => (
                            <button
                              key={`draft-${draft.path}`}
                              type="button"
                              onClick={() => {
                                setSelectedIsDraft(true);
                                setSelectedPath(draft.path);
                              }}
                              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                                selectedIsDraft && selectedPath === draft.path
                                  ? 'bg-accent font-medium text-foreground'
                                  : 'text-muted-foreground hover:bg-accent/60'
                              }`}
                            >
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                              <span className="min-w-0 flex-1 truncate">{draft.path}</span>
                              <span className="shrink-0 rounded bg-destructive px-1 font-sans text-[10px] leading-4 text-destructive-foreground">
                                不完整
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-3">
                        <span data-testid="editor-current-path" className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {selectedPath ?? '未选择文件'}
                        </span>
                        {selectedDraft ? (
                          <div className="ml-auto flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs"
                              disabled={generating}
                              onClick={() => void handleSend(completionPrompt([selectedDraft.path]))}
                            >
                              让 AI 补全
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => dismissDraft(project.id, selectedDraft.path)}
                            >
                              丢弃
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-6 px-2 text-xs"
                            disabled={!selectedFile}
                            onClick={() => {
                              if (!selectedPath) return;
                              updateFileContent(project.id, selectedPath, editorDraft);
                              setPreviewNonce((n) => n + 1);
                              toast.success('已保存并刷新预览');
                            }}
                          >
                            保存
                          </Button>
                        )}
                      </div>
                      {selectedDraft && (
                        <p className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 text-xs text-foreground">
                          AI 没有输出完整的 {selectedDraft.path}（共收到 {selectedDraft.content.length} 个字符）。以下内容不完整、只读，
                          不参与预览、发布和分享，也不会覆盖已有文件；点击「让 AI 补全」重新生成完整文件。
                        </p>
                      )}
                      <textarea
                        value={editorDraft}
                        readOnly={Boolean(selectedDraft)}
                        onChange={(e) => setEditorDraft(e.target.value)}
                        onBlur={() => {
                          if (selectedFile && selectedPath && editorDraft !== selectedFile.content) {
                            updateFileContent(project.id, selectedPath, editorDraft);
                          }
                        }}
                        spellCheck={false}
                        className="min-h-0 flex-1 resize-none bg-card p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden">
              <div
                ref={terminalScrollRef}
                className="h-full overflow-y-auto border-t bg-foreground/95 p-4 font-mono text-xs leading-relaxed text-background"
              >
                {project.logs.length === 0 ? (
                  <span className="opacity-60">终端日志为空，发送第一条对话后这里会显示执行过程。</span>
                ) : (
                  project.logs.map((log) => (
                    <div key={log.id} className="flex gap-3 py-0.5">
                      <span className="shrink-0 opacity-60">{formatTime(log.time)}</span>
                      <span
                        className={
                          log.kind === 'success'
                            ? 'text-emerald-300'
                            : log.kind === 'error'
                              ? 'text-red-300'
                              : ''
                        }
                      >
                        {log.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent
              value="preview"
              forceMount
              className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
            >
              <div className="flex h-full flex-col border-t">
                <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-card px-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {publishedSlugNow ? `/p/${publishedSlugNow}` : '本地预览'}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs"
                      onClick={() => setPreviewNonce((n) => n + 1)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      刷新
                    </Button>
                    {publishedSlugNow && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-xs"
                        onClick={() => window.open(`/p/${publishedSlugNow}`, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3" />
                        打开线上版
                      </Button>
                    )}
                  </div>
                </div>
                {writeFailure && (
                  <div className="flex shrink-0 items-start gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-foreground">
                    <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    <p className="min-w-0 flex-1 break-all">{writeFailure}</p>
                  </div>
                )}
                {previewErrors.length > 0 && (
                  <div className="flex shrink-0 items-start gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-foreground">
                    <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">预览运行出错，可能导致按钮无响应或页面异常：</p>
                      <p className="mt-0.5 break-all font-mono text-muted-foreground">
                        {previewErrors[previewErrors.length - 1]}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="h-6 shrink-0 px-2 text-xs"
                      disabled={generating}
                      onClick={() =>
                        void handleSend(`【Bug 修复】预览运行时报错：${previewErrors.join('；')}，请修复相关代码。`)
                      }
                    >
                      让 AI 修复
                    </Button>
                  </div>
                )}
                {previewUrl ? (
                  <iframe
                    ref={previewFrameRef}
                    key={previewUrl}
                    title="应用预览"
                    srcDoc={previewHtml ?? ''}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    className="min-h-0 w-full flex-1 bg-white"
                  />
                ) : (
                  <div
                    data-testid="preview-empty"
                    className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground"
                  >
                    {emptyDiagnosis.kind === 'none' && <p>暂无可预览内容，先在左侧对话生成 index.html。</p>}
                    {emptyDiagnosis.kind === 'missing-assets' && (
                      <>
                        <p className="text-foreground">
                          index.html 引用的以下文件{(emptyDiagnosis.truncated ?? []).length > 0 ? '缺失或输出被截断' : '缺失'}，
                          页面只剩无样式骨架、脚本无法运行，暂不展示预览：
                        </p>
                        <p className="break-all font-mono text-xs text-foreground">{emptyDiagnosis.paths.join('、')}</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {emptyDiagnosis.recoverable.length > 0 && (
                            <Button size="sm" variant="outline" onClick={handleRecover}>
                              从对话恢复文件
                            </Button>
                          )}
                          <Button size="sm" disabled={generating} onClick={() => void handleSend(regeneratePrompt)}>
                            让 AI 补全缺失文件
                          </Button>
                        </div>
                        {emptyDiagnosis.recoverable.length > 0 && (
                          <p className="text-xs">恢复只会补齐缺失的文件，不会覆盖你之后修改过的文件。</p>
                        )}
                      </>
                    )}
                    {emptyDiagnosis.kind === 'recoverable' && (
                      <>
                        <p className="text-foreground">
                          对话中已生成 {emptyDiagnosis.paths.join('、')}，但尚未写入项目文件（可能是写入失败或页面中途刷新）。
                        </p>
                        <p className="text-xs">恢复只会补齐缺失或较旧的文件，不会覆盖你之后修改过的文件。</p>
                        <Button size="sm" onClick={handleRecover}>
                          从对话恢复文件
                        </Button>
                      </>
                    )}
                    {(emptyDiagnosis.kind === 'truncated' || emptyDiagnosis.kind === 'unrecognized') && (
                      <>
                        <p className="text-foreground">
                          {emptyDiagnosis.kind === 'truncated'
                            ? `AI 输出的 ${emptyDiagnosis.paths.join('、')} 内容被截断（超出长度上限或连接中断），为避免运行半截代码未写入项目。`
                            : 'AI 回复中包含代码，但格式无法识别，未能写入项目文件。'}
                        </p>
                        <Button size="sm" disabled={generating} onClick={() => void handleSend(regeneratePrompt)}>
                          让 AI 重新生成
                        </Button>
                      </>
                    )}
                    {emptyDiagnosis.kind === 'no-entry' && (
                      <>
                        <p className="text-foreground">
                          项目中已有 {emptyDiagnosis.paths.slice(0, 5).join('、')}，但缺少入口文件 index.html（或内容为空）。
                        </p>
                        <Button
                          size="sm"
                          disabled={generating}
                          onClick={() =>
                            void handleSend('【Bug 修复】预览缺少入口文件 index.html，请生成完整的 index.html 并正确引用现有文件。')
                          }
                        >
                          让 AI 修复
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>

      {/* 发布弹窗 */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{publishedSlugNow ? '更新发布' : '发布应用'}</DialogTitle>
            <DialogDescription>
              发布后应用将保存到云端，任何人都可以通过固定链接访问；同一项目可重复发布更新。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">/p/</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="应用路径（小写字母、数字、中划线）"
                className="font-mono text-sm"
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              将上传 {project.files.length} 个文件（共约
              {' '}
              {Math.max(1, Math.round(JSON.stringify(filesToDict(project.files)).length / 1024))} KB），
              需先在对话中生成文件才能发布。
            </p>
            {publishedSlugNow && (
              <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs">
                <span className="font-mono text-muted-foreground">/p/{publishedSlugNow}</span>
                <button
                  type="button"
                  className="ml-auto flex items-center gap-1 text-foreground hover:underline"
                  onClick={() => void copyPath(`/p/${publishedSlugNow}`)}
                >
                  <Copy className="h-3 w-3" />
                  复制
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 text-foreground hover:underline"
                  onClick={() => window.open(`/p/${publishedSlugNow}`, '_blank')}
                >
                  <ExternalLink className="h-3 w-3" />
                  打开
                </button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              关闭
            </Button>
            <Button onClick={() => void handlePublish()} disabled={publishing || project.files.length === 0}>
              {publishing && <Loader2 className="h-4 w-4 animate-spin" />}
              {publishedSlugNow ? '更新发布' : '发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分享弹窗 */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>分享项目</DialogTitle>
            <DialogDescription>
              生成只读分享页，包含完整对话过程与代码文件，适合展示项目如何被一步步构建。
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {sharePreparing || !shareUrl ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在云端创建分享快照…
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {window.location.origin}
                  {shareUrl}
                </span>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 text-foreground hover:underline"
                  onClick={() => void copyPath(shareUrl)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 text-foreground hover:underline"
                  onClick={() => window.open(shareUrl, '_blank')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  打开
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bug 修复弹窗 */}
      <Dialog open={bugOpen} onOpenChange={setBugOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bug className="h-4 w-4" />
              一键修复
            </DialogTitle>
            <DialogDescription>
              描述看到的问题（例如「按钮点击没反应」「移动端样式错乱」），AI 会基于当前代码生成修复。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bugText}
            onChange={(e) => setBugText(e.target.value)}
            placeholder="例如：预览里点击「添加」按钮没有任何反应，控制台报错 undefined"
            className="min-h-[96px] text-sm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBugOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!bugText.trim() || generating}
              onClick={() => {
                const text = bugText.trim();
                setBugOpen(false);
                setBugText('');
                void handleSend(`【Bug 修复】${text}`);
              }}
            >
              提交修复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
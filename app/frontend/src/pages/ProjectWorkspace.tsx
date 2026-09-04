import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
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
  parseFileBlocks,
  streamGenerate,
  SYSTEM_PROMPT,
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

/** 去掉助手回复中的文件块，仅保留说明文字。 */
function stripFileBlocks(content: string): string {
  return content.replace(/<atoms-file path="[^"]+">[\s\S]*?<\/atoms-file>/g, '').trim();
}

function extractPaths(content: string): string[] {
  const paths: string[] = [];
  const pattern = /<atoms-file path="([^"]+)">/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) paths.push(match[1]);
  return paths;
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
  const setPublishedSlug = useProjectStore((s) => s.setPublishedSlug);

  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState('preview');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
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

  const previewHtml = project ? buildPreviewHtml(project.files, project.id) : null;
  const previewUrl = useMemo(() => {
    if (!previewHtml) return null;
    const blob = new Blob([previewHtml], { type: 'text/html' });
    return URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewHtml, previewNonce]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const lastMessage = project?.messages[project.messages.length - 1];
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [project?.messages.length, lastMessage?.content.length, lastMessage?.error]);

  useEffect(() => {
    terminalScrollRef.current?.scrollTo({ top: terminalScrollRef.current.scrollHeight });
  }, [project?.logs.length]);

  // 选中文件变化时同步编辑器草稿
  const selectedFile = project?.files.find((f) => f.path === selectedPath) ?? null;
  useEffect(() => {
    setEditorDraft(selectedFile?.content ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, selectedFile?.updatedAt]);

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

  // ---------- 核心：发送消息 → 真实模型流式生成 → 解析文件 → 更新预览 ----------

  const handleSend = async (raw: string) => {
    const text = raw.trim();
    if (!text || generating) return;
    const projectId = project.id;

    setGenerating(true);
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

      const after = useProjectStore.getState().projects.find((p) => p.id === projectId);
      const full = after?.messages.find((m) => m.id === assistantId)?.content ?? '';
      const files = parseFileBlocks(full);
      if (files.length > 0) {
        applyFiles(projectId, files);
        for (const f of files) appendLog(projectId, `文件已更新: ${f.path}`, 'success');
        appendLog(projectId, '构建完成，预览已刷新', 'success');
        setSelectedPath((prev) => prev ?? files[0]?.path ?? null);
        setTab('preview');
        setPreviewNonce((n) => n + 1);
      } else {
        appendLog(projectId, '本次回复未包含文件改动');
      }
    } catch (e) {
      const detail = getErrorDetail(e) || 'AI 生成失败，请稍后重试';
      patchMessage(projectId, assistantId, { content: `生成失败：${detail}`, error: true });
      appendLog(projectId, `生成失败: ${detail}`, 'error');
      toast.error(`生成失败：${detail}`);
    } finally {
      setGenerating(false);
    }
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
              const paths = extractPaths(message.content);
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
              {project.files.length === 0 ? (
                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  暂无文件。在左侧对话中描述你的想法，AI 会生成 index.html 等文件，之后可在此直接编辑。
                </div>
              ) : (
                <div className="flex h-full border-t">
                  <div className="w-44 shrink-0 overflow-y-auto border-r bg-card p-2">
                    {project.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => setSelectedPath(file.path)}
                        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                          selectedPath === file.path
                            ? 'bg-accent font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-accent/60'
                        }`}
                      >
                        <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{file.path}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-8 shrink-0 items-center justify-between border-b bg-card px-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {selectedPath ?? '未选择文件'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
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
                    </div>
                    <textarea
                      value={editorDraft}
                      onChange={(e) => setEditorDraft(e.target.value)}
                      onBlur={() => {
                        if (selectedPath && editorDraft !== selectedFile?.content) {
                          updateFileContent(project.id, selectedPath, editorDraft);
                        }
                      }}
                      spellCheck={false}
                      className="min-h-0 flex-1 resize-none bg-card p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
                    />
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

            <TabsContent value="preview" className="min-h-0 flex-1 overflow-hidden">
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
                {previewUrl ? (
                  <iframe
                    key={previewUrl}
                    title="应用预览"
                    src={previewUrl}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    className="min-h-0 w-full flex-1 bg-white"
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    暂无可预览内容，先在左侧对话生成 index.html。
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
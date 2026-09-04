import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Database, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AppSidebar } from '@/components/prototype/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteKbFile,
  getErrorDetail,
  listKbChunks,
  listKbFiles,
  uploadKbFile,
  type KbChunk,
  type KbFile,
} from '@/lib/platform';

const ACCEPT = '.txt,.md,.markdown,.pdf,.docx,.csv,.json,.yaml,.yml';
const MAX_BYTES = 10 * 1024 * 1024;

/** 浏览器侧文件转 base64（后端按 base64 解码解析）。 */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

/** 知识库页：上传解析 / 文件列表 / 条目浏览 / 删除（真实云端 API）。 */
export default function KnowledgeBase() {
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [chunksFile, setChunksFile] = useState<KbFile | null>(null);
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listKbFiles();
      setFiles(data.items);
    } catch (e) {
      toast.error(getErrorDetail(e) || '知识文件列表加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ACCEPT.split(',').some((ext) => lower.endsWith(ext))) {
      toast.error('仅支持 txt / md / pdf / docx / csv / json / yaml 知识文件');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('文件超过 10MB 限制，请拆分后上传');
      return;
    }
    setUploading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      const record = await uploadKbFile({ file_name: file.name, content_base64: contentBase64 });
      toast.success(`上传成功：${record.file_name}，已解析为 ${record.chunk_count} 条知识`);
      await loadFiles();
    } catch (err) {
      toast.error(getErrorDetail(err) || '上传失败，请稍后重试');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (file: KbFile) => {
    if (!window.confirm(`确定删除知识文件「${file.file_name}」及其全部 ${file.chunk_count} 条知识吗？`)) {
      return;
    }
    setDeletingId(file.id);
    try {
      await deleteKbFile(file.id);
      toast.success(`已删除：${file.file_name}`);
      await loadFiles();
    } catch (e) {
      toast.error(getErrorDetail(e) || '删除失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  const openChunks = async (file: KbFile) => {
    setChunksFile(file);
    setChunks([]);
    setChunksLoading(true);
    try {
      const data = await listKbChunks(file.id);
      setChunks(data.items);
    } catch (e) {
      toast.error(getErrorDetail(e) || '知识条目加载失败，请稍后重试');
    } finally {
      setChunksLoading(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar onOpenTemplates={() => {}} onOpenGuide={() => {}} onHelp={() => {}} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-sm font-semibold text-foreground">知识库</h1>
          <p className="ml-3 text-xs text-muted-foreground">
            上传知识文件后，AI 对话将自动检索相关内容作为参考上下文
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* 上传卡片 */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Upload className="h-4 w-4" />
                    上传知识文件
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    支持 txt / md / pdf / docx / csv / json / yaml，最大 10MB；上传后自动切块并向量化
                  </p>
                </div>
                <Button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      解析中…
                    </>
                  ) : (
                    '选择文件'
                  )}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => void handleUpload(e)}
                />
              </div>
            </div>

            {/* 文件列表 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Database className="h-4 w-4" />
                知识文件（{files.length}）
              </div>
              {loading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  暂无知识文件，上传后开始构建知识库
                </div>
              ) : (
                files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{file.file_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatSize(file.size_bytes)} · {file.chunk_count} 条知识 · {formatDate(file.created_at)}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 uppercase">
                      {file.file_type}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => void openChunks(file)}>
                      查看条目
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(file)}
                      disabled={deletingId === file.id}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 知识条目浏览弹窗 */}
      <Dialog open={chunksFile !== null} onOpenChange={(open) => !open && setChunksFile(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{chunksFile?.file_name ?? '知识条目'}</DialogTitle>
            <DialogDescription>
              共 {chunksFile?.chunk_count ?? 0} 条知识，每条为一段独立文本块，AI 对话按相关度自动检索
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {chunksLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : chunks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无知识条目</div>
            ) : (
              chunks.map((chunk) => (
                <div key={chunk.id} className="rounded-md border border-border bg-background p-3">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    条目 #{chunk.chunk_index + 1}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                    {chunk.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
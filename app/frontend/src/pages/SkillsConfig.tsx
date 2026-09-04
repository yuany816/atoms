import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Loader2, Puzzle, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { AppSidebar } from '@/components/prototype/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  deleteSkill,
  getErrorDetail,
  listSkills,
  toggleSkill,
  uploadSkillPackage,
  type SkillPackage,
} from '@/lib/platform';

const ACCEPT = '.zip,.md,.markdown,.yaml,.yml';
const MAX_BYTES = 5 * 1024 * 1024;

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

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

/** 技能配置页：技能包上传解析 / 列表 / 启用禁用 / 删除（真实云端 API）。 */
export default function SkillsConfig() {
  const [skills, setSkills] = useState<SkillPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSkills();
      setSkills(data.items);
    } catch (e) {
      toast.error(getErrorDetail(e) || '技能列表加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!ACCEPT.split(',').some((ext) => lower.endsWith(ext))) {
      toast.error('仅支持 zip / md / yaml 技能包');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('技能包超过 5MB 限制');
      return;
    }
    setUploading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      const record = await uploadSkillPackage({ file_name: file.name, content_base64: contentBase64 });
      toast.success(`技能已导入：${record.name}`);
      await loadSkills();
    } catch (err) {
      toast.error(getErrorDetail(err) || '上传失败，请稍后重试');
    } finally {
      setUploading(false);
    }
  };

  const handleToggle = async (skill: SkillPackage, enabled: boolean) => {
    setTogglingId(skill.id);
    try {
      const updated = await toggleSkill(skill.id, enabled);
      setSkills((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(enabled ? `已启用技能：${updated.name}` : `已禁用技能：${updated.name}`);
    } catch (e) {
      toast.error(getErrorDetail(e) || '操作失败，请稍后重试');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (skill: SkillPackage) => {
    if (!window.confirm(`确定删除技能「${skill.name}」吗？`)) return;
    setDeletingId(skill.id);
    try {
      await deleteSkill(skill.id);
      toast.success(`已删除技能：${skill.name}`);
      await loadSkills();
    } catch (e) {
      toast.error(getErrorDetail(e) || '删除失败，请稍后重试');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar onOpenTemplates={() => {}} onOpenGuide={() => {}} onHelp={() => {}} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-sm font-semibold text-foreground">技能配置</h1>
          <p className="ml-3 text-xs text-muted-foreground">
            启用中的技能会在 AI 对话中自动注入为参考能力说明
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
                    上传技能包
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    支持 zip / md / yaml，最大 5MB；自动解析技能名称、描述、适用场景与用法
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

            {/* 技能列表 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Puzzle className="h-4 w-4" />
                技能列表（{skills.length}）
              </div>
              {loading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : skills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  暂无技能包，上传后开始配置技能
                </div>
              ) : (
                skills.map((skill) => (
                  <div key={skill.id} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{skill.name}</span>
                          {skill.enabled ? (
                            <Badge variant="outline" className="shrink-0">
                              已启用
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="shrink-0">
                              已禁用
                            </Badge>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {skill.description || skill.file_name} · {formatDate(skill.created_at)}
                        </div>
                      </div>
                      <Switch
                        checked={skill.enabled}
                        disabled={togglingId === skill.id}
                        onCheckedChange={(checked) => void handleToggle(skill, checked)}
                        aria-label={`启用或禁用技能 ${skill.name}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDelete(skill)}
                        disabled={deletingId === skill.id}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {skill.scenes.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
                        {skill.scenes.map((scene) => (
                          <Badge key={scene} variant="secondary" className="text-xs font-normal">
                            {scene}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {skill.usage && (
                      <details className="mt-2 pl-7">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          用法说明
                        </summary>
                        <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2.5 text-xs leading-relaxed text-foreground">
                          {skill.usage}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
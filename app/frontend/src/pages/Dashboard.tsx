import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BookOpen,
  Copy,
  FileCode2,
  Globe,
  MessageSquare,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
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
import { AppSidebar } from '@/components/prototype/sidebar';
import { TEMPLATES, formatTime } from '@/lib/platform';
import { useProjectStore } from '@/store/projects';

/**
 * 工作台：真实项目列表（zustand + localStorage 持久化），
 * 支持创建（官方模板）、Remix 复制与删除。
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const remixProject = useProjectStore((s) => s.remixProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newTemplateId, setNewTemplateId] = useState(TEMPLATES[0].id);

  const deleteTarget = useMemo(
    () => projects.find((p) => p.id === deleteId) ?? null,
    [projects, deleteId],
  );

  const openProject = (id: string) => navigate(`/project/${id}`);

  const handleCreate = () => {
    const project = createProject(newName || '未命名项目', newTemplateId);
    setCreateOpen(false);
    setNewName('');
    toast.success('项目已创建');
    openProject(project.id);
  };

  const handleUseTemplate = (templateId: string, name: string) => {
    const project = createProject(name, templateId);
    setTemplatesOpen(false);
    toast.success(`已从模板「${name}」创建项目`);
    openProject(project.id);
  };

  const handleRemix = (id: string) => {
    const copy = remixProject(id);
    if (!copy) {
      toast.error('复制失败，请重试');
      return;
    }
    toast.success('已创建项目副本');
    openProject(copy.id);
  };

  const handleConfirmDelete = () => {
    if (!deleteId) return;
    deleteProject(deleteId);
    setDeleteId(null);
    toast.success('项目已删除');
  };

  const copyLink = async (path: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      toast.success('链接已复制');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
        onHelp={() => setGuideOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-10">
          {/* 标题区 */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">工作台</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                通过对话创建应用，预览、发布并分享，全部在浏览器中完成。
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          </div>

          {/* 项目列表 */}
          {projects.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-dashed bg-card px-8 py-20 text-center">
              <Sparkles className="mb-4 h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-medium text-foreground">还没有项目</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                从空白开始或使用官方模板创建你的第一个应用：描述想法，AI
                会生成可运行的单页应用，可实时预览并一键发布分享。
              </p>
              <div className="mt-6 flex gap-3">
                <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  新建项目
                </Button>
                <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
                  浏览模板
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openProject(project.id)}
                  onKeyDown={(e) => e.key === 'Enter' && openProject(project.id)}
                  className="group flex cursor-pointer flex-col rounded-lg border bg-card p-4 shadow-xs transition-all hover:border-foreground/25 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-medium text-foreground">
                      {project.name}
                    </h3>
                    {project.publishedSlug && (
                      <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                        <Globe className="h-3 w-3" />
                        已发布
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileCode2 className="h-3.5 w-3.5" />
                      {project.files.length} 个文件
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      {project.messages.length} 条对话
                    </span>
                  </div>

                  {project.publishedSlug && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyLink(`/p/${project.publishedSlug}`);
                      }}
                      className="mt-2 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                      复制发布链接
                    </button>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">
                      更新于 {formatTime(project.updatedAt)}
                    </span>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemix(project.id);
                        }}
                      >
                        复制
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(project.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 新建项目弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>选择一个起点，之后可在工作区中通过对话继续开发。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              placeholder="项目名称（可留空，默认「未命名项目」）"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setNewTemplateId(template.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    newTemplateId === template.id
                      ? 'border-foreground/40 bg-accent'
                      : 'bg-card hover:bg-accent/60'
                  }`}
                >
                  <div className="text-lg">{template.emoji}</div>
                  <div className="mt-1 text-sm font-medium text-foreground">{template.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {template.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate}>创建项目</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 模板库弹窗 */}
      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>官方模板</DialogTitle>
            <DialogDescription>使用模板快速创建项目，创建后可自由修改。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
            {TEMPLATES.map((template) => (
              <div key={template.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{template.emoji}</span>
                  <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                </div>
                <p className="mt-1.5 min-h-[32px] text-xs leading-relaxed text-muted-foreground">
                  {template.description}
                </p>
                <Button
                  size="sm"
                  className="mt-3 w-full gap-1"
                  onClick={() => handleUseTemplate(template.id, template.name)}
                >
                  <Rocket className="h-3.5 w-3.5" />
                  使用模板
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 使用指引弹窗 */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              使用指引
            </DialogTitle>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
            <li>创建项目：选择空白或官方模板作为起点。</li>
            <li>对话生成：用自然语言描述应用，AI 会流式生成完整代码文件。</li>
            <li>实时预览：生成完成后自动刷新预览，可随时切换到编辑器手动修改。</li>
            <li>发布与分享：发布后获得固定访问链接，也可将项目过程生成只读分享页。</li>
          </ol>
          <p className="mt-3 rounded-md bg-accent px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            说明：项目数据保存在当前浏览器中；发布与分享后的内容保存在云端，可通过链接公开访问。生成应用内可使用
            window.atoms.data 接口保存业务数据。
          </p>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.name}」吗？此操作不可撤销，已发布链接将不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
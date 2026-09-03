import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CopyPlus,
  FolderOpen,
  HelpCircle,
  LayoutTemplate,
  PenLine,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DeleteDialog,
  OnboardingDialog,
  RemixDialog,
  TemplateDialog,
  readOnboardingDone,
} from '@/components/prototype/dialogs';
import { mockProjects, type MockProject } from '@/data/mock';

type DialogKind = 'template' | 'remix' | 'delete' | null;

function StatusBadge({ status }: { status: MockProject['status'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
        status === 'published'
          ? 'bg-secondary text-secondary-foreground'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {status === 'published' ? '已发布' : '开发中'}
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<MockProject[]>(mockProjects);
  const [search, setSearch] = useState('');
  const [idea, setIdea] = useState('');
  const [activeDialog, setActiveDialog] = useState<DialogKind>(null);
  const [deleteTarget, setDeleteTarget] = useState<MockProject | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !readOnboardingDone());

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(keyword) ||
        p.description.toLowerCase().includes(keyword),
    );
  }, [projects, search]);

  const openProject = (id: string) => {
    navigate(`/project/${id}`);
  };

  const handleStartBuild = () => {
    if (!idea.trim()) return;
    toast('已收到你的想法，进入工作区演示');
    openProject('p1');
  };

  const handleUseTemplate = (templateName: string) => {
    setActiveDialog(null);
    toast(`已从「${templateName}」模板创建项目`);
    openProject('p1');
  };

  const handleRemix = (project: MockProject) => {
    setActiveDialog(null);
    toast(`已复制「${project.name}」为新项目`);
    openProject('p1');
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    toast('已删除');
    setDeleteTarget(null);
    setActiveDialog(null);
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* 顶部导航 */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-foreground">Atoms 克隆</span>
            <nav className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setActiveDialog('template')}
              >
                模板
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setOnboardingOpen(true)}
              >
                使用指引
              </Button>
            </nav>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => toast('帮助中心将在开发阶段接入')}
          >
            <HelpCircle className="h-4 w-4" />
            帮助
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* 欢迎区 */}
        <section className="mx-auto max-w-3xl pt-16 text-center">
          <h1 className="text-2xl font-semibold text-foreground">把想法变成产品</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            描述你的想法，AI 团队几分钟内完成构建
          </p>
          <div className="mt-6 rounded-lg border border-input bg-card p-3 text-left shadow-sm">
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleStartBuild();
                }
              }}
              placeholder="描述你想做的应用…"
              className="min-h-[60px] resize-none border-0 bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
            />
            <div className="flex justify-end p-1">
              <Button size="sm" disabled={!idea.trim()} onClick={handleStartBuild}>
                开始
              </Button>
            </div>
          </div>
        </section>

        {/* 快捷起点 */}
        <section className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveDialog('template')}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent"
          >
            <span className="rounded-md bg-muted p-2 text-foreground">
              <LayoutTemplate className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">内置模板</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                从官方模板快速起步
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveDialog('remix')}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent"
          >
            <span className="rounded-md bg-muted p-2 text-foreground">
              <CopyPlus className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">复制现有项目</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                基于已有项目继续开发
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => openProject('p1')}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-accent"
          >
            <span className="rounded-md bg-muted p-2 text-foreground">
              <PenLine className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">空白新建</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                从一次对话开始构建
              </span>
            </span>
          </button>
        </section>

        {/* 我的项目 */}
        <section className="mt-12 pb-16">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-foreground">我的项目</h2>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索项目"
                className="pl-8 text-sm"
              />
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => (
                <div
                  key={project.id}
                  className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {project.name}
                    </p>
                    <StatusBadge status={project.status} />
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {project.description}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      更新于 {project.updatedAt}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openProject(project.id)}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        打开
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => {
                          setDeleteTarget(project);
                          setActiveDialog('delete');
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 p-10 text-center">
              <span className="rounded-full bg-muted p-3 text-muted-foreground">
                <LayoutTemplate className="h-6 w-6" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">
                {projects.length === 0 ? '还没有项目' : '未找到匹配的项目'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {projects.length === 0
                  ? '从上方选择一种方式开始'
                  : '换个关键词试试，或清空搜索查看全部项目'}
              </p>
              {projects.length === 0 && (
                <Button size="sm" className="mt-4" onClick={() => setActiveDialog('template')}>
                  新建项目
                </Button>
              )}
            </div>
          )}
        </section>
      </main>

      {/* 弹窗 */}
      <TemplateDialog
        open={activeDialog === 'template'}
        onOpenChange={(open) => setActiveDialog(open ? 'template' : null)}
        onUse={handleUseTemplate}
      />
      <RemixDialog
        open={activeDialog === 'remix'}
        onOpenChange={(open) => setActiveDialog(open ? 'remix' : null)}
        onUse={handleRemix}
      />
      <DeleteDialog
        open={activeDialog === 'delete' && !!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setActiveDialog(null);
            setDeleteTarget(null);
          }
        }}
        projectName={deleteTarget?.name ?? ''}
        onConfirm={handleConfirmDelete}
      />
      <OnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </div>
  );
}
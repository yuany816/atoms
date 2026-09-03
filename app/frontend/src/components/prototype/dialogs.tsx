import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  Copy,
  Globe,
  LayoutTemplate,
  Loader2,
  MessageSquare,
  PenLine,
  Rocket,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  PLATFORM_DOMAIN,
  mockProjects,
  mockTemplates,
  type MockProject,
} from '@/data/mock';

// ---------- 通用小件 ----------

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className={className}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          已复制
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          复制
        </>
      )}
    </Button>
  );
}

// ---------- P3 发布弹窗（确认 / 发布中 / 成功 / 失败，可切换演示） ----------

type PublishStage = 'confirm' | 'publishing' | 'success' | 'error';

const TAKEN_SLUGS = ['saas-landing', 'my-blog'];

export function PublishDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: MockProject;
}) {
  const [stage, setStage] = useState<PublishStage>('confirm');
  const [slug, setSlug] = useState('demo-task-board');

  useEffect(() => {
    if (open) {
      setStage('confirm');
      setSlug(project.slug ?? 'demo-task-board');
    }
  }, [open, project]);

  const taken = TAKEN_SLUGS.includes(slug.trim());
  const fullUrl = `https://${PLATFORM_DOMAIN}/p/${slug.trim() || '…'}`;

  const handleConfirm = () => {
    if (taken) return;
    setStage('publishing');
    window.setTimeout(() => setStage('success'), 1800);
  };

  const handleRetry = () => {
    setStage('publishing');
    window.setTimeout(() => setStage('success'), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发布应用</DialogTitle>
          <DialogDescription>发布后将生成可直接访问的域名链接</DialogDescription>
        </DialogHeader>

        {stage === 'confirm' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">访问路径</label>
              <div
                className={`flex items-center gap-0 rounded-md border bg-card shadow-xs ${
                  taken ? 'border-destructive' : 'border-input'
                }`}
              >
                <span className="whitespace-nowrap border-r border-border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                  {PLATFORM_DOMAIN}/p/
                </span>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="rounded-none border-0 font-mono text-sm shadow-none focus-visible:ring-0"
                />
              </div>
              {taken ? (
                <p className="text-xs text-destructive">该链接已被使用，换一个试试</p>
              ) : (
                <p className="font-mono text-xs text-muted-foreground">{fullUrl}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button size="sm" disabled={taken} onClick={handleConfirm}>
                确认发布
              </Button>
            </div>
          </div>
        )}

        {stage === 'publishing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-foreground">正在发布…</p>
            <p className="text-xs text-muted-foreground">通常 1 分钟内完成</p>
          </div>
        )}

        {stage === 'success' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Check className="h-5 w-5" />
              <span className="text-sm font-medium text-foreground">发布成功</span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-3">
              <span className="truncate font-mono text-sm text-foreground">{fullUrl}</span>
              <CopyButton text={fullUrl} />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" asChild>
                <Link to={`/p/${slug.trim()}`} target="_blank">
                  打开应用
                </Link>
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                完成
              </Button>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-foreground">
                发布失败，服务暂时不可用。请稍后重试，若多次失败请联系平台支持。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button size="sm" onClick={handleRetry}>
                重试
              </Button>
            </div>
          </div>
        )}

        {/* 原型演示辅助：切换发布状态 */}
        <div className="flex items-center gap-1 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">演示状态：</span>
          {(
            [
              ['confirm', '确认'],
              ['publishing', '发布中'],
              ['success', '成功'],
              ['error', '失败'],
            ] as [PublishStage, string][]
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              size="sm"
              className={`h-6 px-2 text-xs ${
                stage === key ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
              }`}
              onClick={() => setStage(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- P4 分享弹窗 ----------

export function ShareDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: MockProject;
}) {
  const shareUrl = `https://${PLATFORM_DOMAIN}/share/${project.id}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享项目</DialogTitle>
          <DialogDescription>任何获得链接的人都可查看此项目的构建过程</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-3">
            <span className="truncate font-mono text-sm text-foreground">{shareUrl}</span>
            <CopyButton text={shareUrl} />
          </div>
          {project.status !== 'published' && (
            <p className="text-xs text-muted-foreground">
              提示：分享的是构建过程；如需交付可访问的应用，请先发布。
            </p>
          )}
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- 模板选择弹窗 ----------

export function TemplateDialog({
  open,
  onOpenChange,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (templateName: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>从模板开始</DialogTitle>
          <DialogDescription>选择一个官方内置模板，一键创建项目</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {mockTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="group rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
            >
              <div className="flex items-start gap-3">
                <span className="rounded-md bg-muted p-2 text-foreground">
                  <LayoutTemplate className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{tpl.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUse(tpl.name)}
                >
                  使用此模板
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Remix 复制弹窗 ----------

export function RemixDialog({
  open,
  onOpenChange,
  excludeId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  excludeId?: string;
  onCreate: (project: MockProject) => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const candidates = mockProjects.filter((p) => p.id !== excludeId);

  useEffect(() => {
    if (open) setSelected(candidates[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>复制现有项目</DialogTitle>
          <DialogDescription>选择一个项目，复制为新的项目继续开发</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p.id)}
              className={`flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors ${
                selected === p.id
                  ? 'border-border bg-accent'
                  : 'border-border bg-card hover:bg-accent'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {p.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.description}
                </span>
              </span>
              <span className="ml-3 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {p.status === 'published' ? '已发布' : '开发中'}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => {
              const target = candidates.find((p) => p.id === selected);
              if (target) onCreate(target);
            }}
          >
            创建副本
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- 删除确认弹窗 ----------

export function DeleteDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>删除项目</DialogTitle>
          <DialogDescription>
            删除后无法恢复，确定删除「{projectName}」吗？
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            确认删除
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- P7 新手引导浮层 ----------

const ONBOARDING_STEPS = [
  {
    icon: MessageSquare,
    title: '对话生成应用',
    desc: '描述你的想法，AI 团队几分钟内完成构建',
  },
  {
    icon: PenLine,
    title: '编辑与实时预览',
    desc: '在编辑器中修改代码，右侧实时查看双端效果',
  },
  {
    icon: Rocket,
    title: '一键发布获得域名',
    desc: '发布后获得可直接访问的域名，随时分享',
  },
];

const ONBOARDING_KEY = 'atoms_clone_onboarding_done';

export function readOnboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return false;
  }
}

export function OnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step];

  const finish = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // 忽略本地存储异常
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish();
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>三步把想法变成产品</DialogTitle>
          <DialogDescription>对话生成 → 编辑预览 → 发布获得域名</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex h-40 items-center justify-center rounded-lg bg-muted">
            <current.icon className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">
              {step + 1}. {current.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{current.desc}</p>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-4 bg-foreground' : 'w-1.5 bg-muted-foreground'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={finish}>
              跳过
            </Button>
            {step < ONBOARDING_STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                下一步
              </Button>
            ) : (
              <Button size="sm" onClick={finish}>
                开始使用
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- 平台域名标识（供页面角落展示） ----------

export function PlatformMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Globe className="h-3.5 w-3.5" />
      {PLATFORM_DOMAIN}
    </span>
  );
}

// ---------- 失败重试图标（导出复用） ----------

export function RetryIcon() {
  return <RotateCcw className="h-3.5 w-3.5" />;
}
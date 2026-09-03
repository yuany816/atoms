import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Monitor,
  RotateCcw,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  mockFileContents,
  mockFileTree,
  mockTerminalLogs,
  type FileNode,
} from '@/data/mock';

// ---------- 编辑器面板：文件树 + 代码区 ----------

function FileIcon({ node }: { node: FileNode }) {
  if (node.kind === 'dir') return <Folder className="h-3.5 w-3.5" />;
  if (node.name.endsWith('.json')) return <FileJson className="h-3.5 w-3.5" />;
  if (node.name.endsWith('.css')) return <FileText className="h-3.5 w-3.5" />;
  if (node.name.endsWith('.tsx')) return <FileCode className="h-3.5 w-3.5" />;
  return <File className="h-3.5 w-3.5" />;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: FileNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.kind === 'dir') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate font-mono">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const selected = selectedPath === node.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors ${
        selected
          ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent'
      }`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      <FileIcon node={node} />
      <span className="truncate font-mono">{node.name}</span>
    </button>
  );
}

export function EditorPanel() {
  const [selectedPath, setSelectedPath] = useState('src/App.tsx');
  const [draft, setDraft] = useState(mockFileContents[selectedPath] ?? '');
  const [dirty, setDirty] = useState(false);

  const selectFile = (path: string) => {
    setSelectedPath(path);
    setDraft(mockFileContents[path] ?? '');
    setDirty(false);
  };

  const save = () => {
    setDirty(false);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* 文件树 */}
      <div className="w-48 shrink-0 overflow-y-auto border-r border-sidebar-border p-2">
        {mockFileTree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelect={selectFile}
          />
        ))}
      </div>
      {/* 代码区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
          <span className="truncate font-mono text-xs text-muted-foreground">
            {selectedPath}
          </span>
          <Button
            size="sm"
            className={`h-6 px-2 text-xs ${dirty ? '' : 'opacity-50'}`}
            disabled={!dirty}
            onClick={save}
          >
            保存
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted p-3">
          <pre className="whitespace-pre font-mono text-xs leading-5 text-sidebar-foreground">
            {draft}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ---------- 终端面板：日志流 + 回到底部 ----------

export function TerminalPanel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setShowBack(!atBottom);
  };

  const backToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowBack(false);
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-muted p-3"
      >
        <div className="space-y-0.5">
          {mockTerminalLogs.map((line, i) => (
            <p
              key={i}
              className={`whitespace-pre-wrap font-mono text-xs leading-5 ${
                line.startsWith('✗') || line.startsWith('    at')
                  ? 'text-destructive'
                  : line.startsWith('✓') || line.startsWith('[Agent]')
                    ? 'text-sidebar-foreground'
                    : 'text-muted-foreground'
              }`}
            >
              {line || '\u00A0'}
            </p>
          ))}
        </div>
      </div>
      {showBack && (
        <button
          type="button"
          onClick={backToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground shadow-md"
        >
          回到底部
        </button>
      )}
    </div>
  );
}

// ---------- 预览面板：App Viewer 容器 + 桌面/移动切换 ----------

export function PreviewPanel() {
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 视图切换 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('desktop')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              view === 'desktop'
                ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent'
            }`}
          >
            <Monitor className="h-3.5 w-3.5" />
            桌面
          </button>
          <button
            type="button"
            onClick={() => setView('mobile')}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              view === 'mobile'
                ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            移动
          </button>
        </div>
        <span className="font-mono text-xs text-muted-foreground">localhost:5173</span>
      </div>
      {/* App Viewer 容器（模拟渲染的任务看板应用） */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted p-4">
        <div
          className={`w-full rounded-lg border border-border bg-card shadow-sm transition-all ${
            view === 'mobile' ? 'max-w-[375px]' : 'max-w-full'
          }`}
        >
          {/* 模拟应用：团队工作台 */}
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">团队工作台</p>
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                ['今日待办', '5'],
                ['进行中', '3'],
                ['已完成', '12'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border bg-card p-3">
                  <p className="text-lg font-semibold text-foreground">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['待办', ['设计登录页', '整理需求清单']],
                ['进行中', ['开发看板组件', '接入本地存储']],
                ['已完成', ['初始化项目', '搭建基础布局']],
              ].map(([title, items]) => (
                <div
                  key={title}
                  className={`rounded-md border border-border bg-card p-3 ${
                    view === 'mobile' ? 'space-y-2' : ''
                  }`}
                >
                  <p className="text-xs font-medium text-foreground">
                    {title as string}
                  </p>
                  <div className="mt-2 space-y-2">
                    {(items as string[]).map((item) => (
                      <div
                        key={item}
                        className="rounded-md bg-muted px-2 py-1.5 text-xs text-foreground"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 执行步骤折叠块 ----------

export function StepsCollapse({
  steps,
}: {
  steps: { label: string; status: 'done' | 'running' | 'failed' }[];
}) {
  const [open, setOpen] = useState(false);
  const doneCount = steps.filter((s) => s.status !== 'running').length;

  return (
    <div className="mt-2 rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 transition-transform" />
        ) : (
          <ChevronRight className="h-3 w-3 transition-transform" />
        )}
        {doneCount >= steps.length
          ? `已完成 ${steps.length} 个步骤`
          : `正在执行（${doneCount}/${steps.length}）…`}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2.5 py-2">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center gap-2 text-xs">
              {step.status === 'done' && <Check className="h-3.5 w-3.5 shrink-0" />}
              {step.status === 'running' && (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              )}
              {step.status === 'failed' && (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span
                className={
                  step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                }
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Bug Report 浮层 ----------

export function BugReportCard({
  onFix,
  fixing,
}: {
  onFix: () => void;
  fixing: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [fixed, setFixed] = useState(false);

  const handleFix = () => {
    onFix();
    window.setTimeout(() => setFixed(true), 1600);
  };

  if (fixed) {
    return (
      <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-md border border-border bg-card p-3 shadow-md">
        <Check className="h-4 w-4" />
        <span className="text-sm text-foreground">修复完成，预览已刷新</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 rounded-md border border-border bg-card p-3 shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">构建出现问题</p>
      </div>
      <p className="mt-1 truncate text-sm text-muted-foreground">
        ThemeProvider 未在组件树中注册，导致生成中断
      </p>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          查看详情
        </button>
        <Button size="sm" className="h-7 px-2 text-xs" disabled={fixing} onClick={handleFix}>
          {fixing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在修复…
            </>
          ) : (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              一键修复
            </>
          )}
        </Button>
      </div>
      {showDetail && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs leading-5 text-muted-foreground">
          {`Error: ThemeProvider 未在组件树中注册
    at src/main.tsx:12:3
    at renderWithHooks (react-dom.development.js)`}
        </pre>
      )}
    </div>
  );
}
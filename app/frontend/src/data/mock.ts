// 原型演示用静态模拟数据：仅前端硬编码，不接任何后端接口

export type ProjectStatus = 'developing' | 'published';

export interface MockProject {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  updatedAt: string;
  slug?: string;
}

export const PLATFORM_DOMAIN = 'clone.atoms.app';

export const mockProjects: MockProject[] = [
  {
    id: 'p1',
    name: '团队任务看板',
    description: '对话构建的任务管理应用，支持三列看板与统计卡片',
    status: 'developing',
    updatedAt: '2 分钟前',
  },
  {
    id: 'p2',
    name: 'SaaS 产品落地页',
    description: '从「SaaS 落地页」模板起步的官网首页',
    status: 'published',
    slug: 'saas-landing',
    updatedAt: '1 小时前',
  },
  {
    id: 'p3',
    name: '个人博客',
    description: '包含文章列表、详情页与归档的极简博客',
    status: 'published',
    slug: 'my-blog',
    updatedAt: '昨天',
  },
  {
    id: 'p4',
    name: '活动报名页',
    description: '包含议程、讲师与报名表单的单页活动站',
    status: 'developing',
    updatedAt: '3 天前',
  },
];

// 对话演示数据
export type StepStatus = 'done' | 'running' | 'failed';

export interface ChatStep {
  label: string;
  status: StepStatus;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  steps?: ChatStep[];
  error?: boolean;
}

export const mockMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: '帮我做一个团队任务看板应用，要有待办列表和状态分区',
  },
  {
    id: 'm2',
    role: 'agent',
    content:
      '收到！我将为你构建一个任务看板应用，包含以下能力：\n- **任务列表**：待办 / 进行中 / 已完成 三列分区\n- **统计卡片**：今日待办、进行中、已完成一目了然\n- **本地持久化**：刷新页面数据不丢失\n\n马上开始构建。',
    steps: [
      { label: '创建项目结构与基础文件', status: 'done' },
      { label: '编写看板与任务卡片组件', status: 'done' },
      { label: '接入本地存储并刷新预览', status: 'done' },
    ],
  },
  {
    id: 'm3',
    role: 'user',
    content: '很好，把顶部标题改成「团队工作台」，并在看板上方加一个统计卡片',
  },
  {
    id: 'm4',
    role: 'agent',
    content:
      '已完成修改：\n- 顶部标题更新为 `团队工作台`\n- 新增统计卡片组件，展示今日待办 / 进行中 / 已完成数量\n\n预览已同步刷新，你可以切换到「预览」面板查看效果。',
    steps: [
      { label: '修改标题文案', status: 'done' },
      { label: '新增统计卡片组件', status: 'done' },
      { label: '更新预览', status: 'done' },
    ],
  },
  {
    id: 'm5',
    role: 'user',
    content: '再加一个深色模式切换',
  },
  {
    id: 'm6',
    role: 'agent',
    content: '正在为看板添加深色模式切换，执行过程中遇到一个问题：',
    steps: [
      { label: '添加主题切换状态', status: 'done' },
      { label: '注册主题 Provider', status: 'failed' },
    ],
  },
  {
    id: 'm7',
    role: 'agent',
    error: true,
    content: '生成失败，请重试。注册主题 Provider 时检测到组件树中缺少 ThemeProvider，已定位到具体原因。',
  },
];

// 流式演示的 Agent 预设回复
export const STREAM_REPLY =
  '好的，我来为看板添加深色模式切换：\n- 在顶部栏增加切换按钮，默认跟随系统偏好\n- 调整看板卡片与统计卡片在深色下的配色\n- 更新预览验证双端效果\n\n开始执行修改。';

// 文件树演示数据
export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: FileNode[];
}

export const mockFileTree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    kind: 'dir',
    children: [
      {
        name: 'components',
        path: 'src/components',
        kind: 'dir',
        children: [
          { name: 'TaskBoard.tsx', path: 'src/components/TaskBoard.tsx', kind: 'file' },
          { name: 'StatsCard.tsx', path: 'src/components/StatsCard.tsx', kind: 'file' },
        ],
      },
      { name: 'App.tsx', path: 'src/App.tsx', kind: 'file' },
      { name: 'main.tsx', path: 'src/main.tsx', kind: 'file' },
      { name: 'index.css', path: 'src/index.css', kind: 'file' },
    ],
  },
  { name: 'package.json', path: 'package.json', kind: 'file' },
  { name: 'README.md', path: 'README.md', kind: 'file' },
];

export const mockFileContents: Record<string, string> = {
  'src/App.tsx': `import TaskBoard from './components/TaskBoard';
import StatsCard from './components/StatsCard';

export default function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">
          团队工作台
        </h1>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <StatsCard />
        <TaskBoard />
      </main>
    </div>
  );
}`,
  'src/components/TaskBoard.tsx': `const COLUMNS = [
  { key: 'todo', title: '待办' },
  { key: 'doing', title: '进行中' },
  { key: 'done', title: '已完成' },
];

export default function TaskBoard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {COLUMNS.map((col) => (
        <section key={col.key} className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">{col.title}</h2>
        </section>
      ))}
    </div>
  );
}`,
  'src/components/StatsCard.tsx': `const STATS = [
  { label: '今日待办', value: 5 },
  { label: '进行中', value: 3 },
  { label: '已完成', value: 12 },
];

export default function StatsCard() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {STATS.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-semibold text-foreground">{s.value}</p>
          <p className="text-xs text-muted-foreground">{s.label}</p>
        </div>
      ))}
    </div>
  );
}`,
  'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`,
  'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;`,
  'package.json': `{
  "name": "team-task-board",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}`,
  'README.md': `# 团队任务看板

由 AI 团队对话式构建的任务管理应用。`,
};

// 终端日志演示数据（含错误演示行）
export const mockTerminalLogs: string[] = [
  '$ pnpm install',
  'Lockfile is up to date, resolution step is skipped',
  'Done in 1.2s',
  '',
  '$ pnpm run dev',
  'VITE v5.4.21  ready in 428 ms',
  '➜  Local:   http://localhost:5173/',
  '',
  '[Agent] 创建 src/components/StatsCard.tsx',
  '[Agent] 更新 src/App.tsx（标题：团队工作台）',
  '✓ 构建完成，预览已刷新',
  '',
  '[Agent] 尝试添加深色模式切换…',
  '✗ Error: ThemeProvider 未在组件树中注册',
  '    at src/main.tsx:12:3',
];

// 模板演示数据（自研自拟）
export interface TemplateItem {
  id: string;
  name: string;
  description: string;
}

export const mockTemplates: TemplateItem[] = [
  { id: 't1', name: 'SaaS 产品落地页', description: '产品官网、功能介绍与定价展示' },
  { id: 't2', name: '个人博客', description: '文章列表、详情页与归档' },
  { id: 't3', name: '电商商店', description: '商品网格与购物车示意' },
  { id: 't4', name: '作品集', description: '项目展示与个人介绍' },
  { id: 't5', name: '任务看板', description: '三列看板与统计卡片' },
  { id: 't6', name: '活动报名页', description: '议程、讲师与报名表单' },
];
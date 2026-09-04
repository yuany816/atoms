import {
  BookOpen,
  CircleHelp,
  Database,
  House,
  LayoutTemplate,
  ClipboardCheck,
  Puzzle,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

// 全局左侧菜单栏（2026-09-02 用户要求增加，覆盖原顶部导航设计；
// 任务18 新增知识库 / 技能配置 / 评测三个路由入口）

interface SidebarNavItem {
  key: string;
  label: string;
  icon: typeof House;
  active?: boolean;
  onClick?: () => void;
}

export function AppSidebar({
  onOpenTemplates,
  onOpenGuide,
  onHelp,
}: {
  onOpenTemplates: () => void;
  onOpenGuide: () => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const navItems: SidebarNavItem[] = [
    {
      key: 'dashboard',
      label: '工作台',
      icon: House,
      active: path === '/dashboard' || path.startsWith('/project/'),
      onClick: () => navigate('/dashboard'),
    },
    { key: 'templates', label: '模板', icon: LayoutTemplate, onClick: onOpenTemplates },
    { key: 'knowledge', label: '知识库', icon: Database, active: path === '/knowledge', onClick: () => navigate('/knowledge') },
    { key: 'skills', label: '技能配置', icon: Puzzle, active: path === '/skills', onClick: () => navigate('/skills') },
    { key: 'evaluation', label: '评测', icon: ClipboardCheck, active: path === '/evaluation', onClick: () => navigate('/evaluation') },
    { key: 'guide', label: '使用指引', icon: BookOpen, onClick: onOpenGuide },
  ];

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo 区 */}
      <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
        <span className="text-sm font-semibold text-foreground">Atoms 克隆</span>
      </div>

      {/* 主导航 */}
      <nav className="flex flex-col gap-0.5 p-2">
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
              item.active
                ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent'
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* 底部：帮助 */}
      <div className="mt-auto p-2">
        <button
          type="button"
          onClick={onHelp}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent"
        >
          <CircleHelp className="h-4 w-4 shrink-0" />
          帮助
        </button>
      </div>
    </aside>
  );
}
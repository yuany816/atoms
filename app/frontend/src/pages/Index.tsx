// MODULE_IMPORTS_START
// MODULE_IMPORTS_END

export default function WelcomePage() {
  // MODULE_HOOKS_START
  // MODULE_HOOKS_END

  return (
    <div className="min-h-screen bg-background">
      {/* MODULE_HEADER_START */}
      {/* MODULE_HEADER_END */}

      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center">
        <div className="space-y-8 max-w-md animate-in fade-in slide-in-from-bottom-8 duration-700">
          <h1 className="text-4xl font-bold text-foreground">
            Atoms 平台复刻
          </h1>

          <p className="text-lg text-foreground/70 animate-in fade-in delay-300 duration-700">
            项目初始化完成 · Notion 主题已应用
          </p>

          <div className="rounded-lg border border-border bg-card p-6 text-left shadow-sm animate-in fade-in delay-500 duration-700">
            <h2 className="text-sm font-semibold text-card-foreground mb-3">
              初始化状态
            </h2>
            <ul className="space-y-2 text-sm text-foreground/70">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/60" />
                Web 脚手架就绪（React + shadcn/ui + Vite）
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/60" />
                Atoms Cloud 后端已激活（Auth / Database / 存储 / AI）
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-foreground/60" />
                Notion 主题设计系统已接入
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                功能开发待需求设计阶段（PRD）确认后启动
              </li>
            </ul>
          </div>

          {/* MODULE_CONTENT_START */}
          {/* MODULE_CONTENT_END */}
        </div>
      </div>
    </div>
  );
}
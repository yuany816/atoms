import { Link, useParams } from 'react-router-dom';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PLATFORM_DOMAIN, mockProjects } from '@/data/mock';

// P5 已发布应用访问页：仅渲染应用本体，无平台框架/顶栏

function BoardApp() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">团队工作台</h1>
      </div>
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="grid grid-cols-3 gap-4">
          {[
            ['今日待办', '5'],
            ['进行中', '3'],
            ['已完成', '12'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <p className="text-2xl font-semibold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            ['待办', ['设计登录页', '整理需求清单', '准备评审材料']],
            ['进行中', ['开发看板组件', '接入本地存储']],
            ['已完成', ['初始化项目', '搭建基础布局', '统一视觉风格']],
          ].map(([title, items]) => (
            <section
              key={title as string}
              className="rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <h2 className="text-sm font-medium text-foreground">{title as string}</h2>
              <div className="mt-3 space-y-2">
                {(items as string[]).map((item) => (
                  <div
                    key={item}
                    className="rounded-md bg-muted px-3 py-2 text-sm text-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function PublishedApp() {
  const { slug } = useParams();
  const exists = mockProjects.some((p) => p.slug === slug);

  if (!exists) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background font-sans">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Globe className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-base font-semibold text-foreground">
            链接不存在或已被删除
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            请确认链接是否正确，或联系分享者重新获取
          </p>
          <Button asChild className="mt-5">
            <Link to="/dashboard">访问平台</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <BoardApp />;
}

// 供路由演示的 slug 提示（开发注释，不渲染）
export const DEMO_SLUG_NOTE = `${PLATFORM_DOMAIN}/p/saas-landing 或 /p/my-blog`;
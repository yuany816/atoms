import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepsCollapse } from '@/components/prototype/panels';
import { mockMessages, mockProjects, type ChatMessage } from '@/data/mock';

function AgentAvatar() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

function ReadOnlyMessage({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="text-center text-xs text-muted-foreground">{message.content}</div>
    );
  }
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 leading-6 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`flex gap-2.5 rounded-md ${
        message.error ? 'border border-destructive/40 p-3' : ''
      }`}
    >
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="space-y-2 text-sm leading-6 text-foreground">
          {message.content.split('\n').filter(Boolean).map((line, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {line.replace(/^- /, '· ')}
            </p>
          ))}
        </div>
        {message.steps && message.steps.length > 0 && (
          <StepsCollapse steps={message.steps} />
        )}
      </div>
    </div>
  );
}

// P6 分享只读页：展示构建过程对话 + 查看已发布应用入口

export default function ShareView() {
  const { id } = useParams();
  const project = mockProjects.find((p) => p.id === id) ?? mockProjects[1];

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground"
              asChild
            >
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="truncate text-sm font-medium text-foreground">
              {project.name}
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              构建过程（只读）
            </span>
          </div>
          {project.status === 'published' && (
            <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" asChild>
              <Link to={`/p/${project.slug}`} target="_blank">
                <ExternalLink className="h-3.5 w-3.5" />
                查看已发布应用
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="space-y-4">
          {mockMessages.map((msg) => (
            <ReadOnlyMessage key={msg.id} message={msg} />
          ))}
        </div>
        <div className="mt-8 flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          此页面为只读分享视图，内容由项目拥有者生成
        </div>
      </main>
    </div>
  );
}
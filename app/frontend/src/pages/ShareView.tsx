import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { attachAtomsHost, buildPreviewHtml } from '@/lib/engine';
import { fetchShare, formatTime } from '@/lib/platform';

interface SharedMessage {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  createdAt?: number;
}

/** 去掉文件块，仅显示说明文字。 */
function stripFileBlocks(content: string): string {
  return content.replace(/<atoms-file path="[^"]+">[\s\S]*?<\/atoms-file>/g, '').trim();
}

function extractPaths(content: string): string[] {
  const paths: string[] = [];
  const pattern = /<atoms-file path="([^"]+)">/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) paths.push(match[1]);
  return paths;
}

/**
 * 分享只读页 /share/:token：从云端读取分享快照，
 * 左侧对话过程回放，右侧应用实时渲染（window.atoms 数据桥按原 project_id 隔离）。
 */
export default function ShareView() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [data, setData] = useState<{
    name: string;
    createdAt?: string;
    projectId: string;
    messages: SharedMessage[];
    files: Record<string, string>;
  } | null>(null);

  useEffect(() => attachAtomsHost(), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setStatus('loading');
    fetchShare(id)
      .then((res) => {
        if (cancelled) return;
        const snapshot = res.snapshot ?? {};
        setData({
          name: res.name,
          createdAt: res.created_at,
          projectId: res.project_id ?? '',
          messages: Array.isArray(snapshot.messages) ? (snapshot.messages as SharedMessage[]) : [],
          files: snapshot.files ?? {},
        });
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const html = useMemo(() => {
    if (!data) return null;
    return buildPreviewHtml(data.files, data.projectId);
  }, [data]);

  const blobUrl = useMemo(() => {
    if (!html) return null;
    return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }, [html]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">正在加载分享内容…</p>
      </div>
    );
  }

  if (status === 'missing' || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-lg font-medium text-foreground">分享链接不存在或已失效</p>
        <p className="text-sm text-muted-foreground">请向分享者确认链接是否正确。</p>
        <Button asChild variant="outline">
          <Link to="/dashboard">前往工作台</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4">
        <span className="text-sm font-semibold text-foreground">Atoms 克隆</span>
        <span className="text-xs text-muted-foreground">分享 · 只读</span>
        <h1 className="ml-2 min-w-0 truncate text-sm font-medium text-foreground">{data.name}</h1>
        {data.createdAt && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            创建于 {formatTime(new Date(data.createdAt).getTime())}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 对话回放 */}
        <section className="flex w-[400px] shrink-0 flex-col border-r bg-card">
          <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            对话过程（{data.messages.length} 条）
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {data.messages.map((message, index) => {
              if (message.role === 'user') {
                return (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
                      {message.content}
                    </div>
                  </div>
                );
              }
              const visible = stripFileBlocks(message.content);
              const paths = extractPaths(message.content);
              return (
                <div key={index} className="flex justify-start">
                  <div className="max-w-[90%] rounded-lg rounded-bl-sm border bg-accent px-3 py-2 text-sm leading-relaxed text-foreground">
                    <p className="whitespace-pre-wrap">{visible || message.content}</p>
                    {paths.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {paths.map((p) => (
                          <span
                            key={p}
                            className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.model && (
                      <div className="mt-1.5 text-xs text-muted-foreground">{message.model}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 应用渲染 */}
        <section className="min-w-0 flex-1">
          {blobUrl ? (
            <iframe
              title={data.name}
              src={blobUrl}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="h-full w-full bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              该分享未包含可运行文件。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
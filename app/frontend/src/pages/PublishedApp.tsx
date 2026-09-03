import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { attachAtomsHost, buildPreviewHtml } from '@/lib/engine';
import { fetchPublished } from '@/lib/platform';

/**
 * 已发布应用页 /p/:slug：从云端读取发布快照，
 * 以 iframe blob 渲染，并挂载 window.atoms 数据桥（按原 project_id 隔离）。
 */
export default function PublishedApp() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [snapshot, setSnapshot] = useState<{
    name: string;
    projectId: string;
    html: string;
  } | null>(null);

  useEffect(() => attachAtomsHost(), []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setStatus('loading');
    fetchPublished(slug)
      .then((data) => {
        if (cancelled) return;
        const html = buildPreviewHtml(data.files ?? {}, data.project_id);
        if (!html) {
          setStatus('missing');
          return;
        }
        setSnapshot({ name: data.name, projectId: data.project_id, html });
        setStatus('ready');
        if (data.name) document.title = `${data.name}`;
      })
      .catch(() => {
        if (!cancelled) setStatus('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const blobUrl = useMemo(() => {
    if (!snapshot) return null;
    return URL.createObjectURL(new Blob([snapshot.html], { type: 'text/html' }));
  }, [snapshot]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (status === 'loading') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">正在加载应用…</p>
      </div>
    );
  }

  if (status === 'missing' || !blobUrl) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <p className="text-lg font-medium text-foreground">应用不存在或已被删除</p>
        <p className="text-sm text-muted-foreground">请检查链接是否正确。</p>
        <Button asChild variant="outline">
          <Link to="/dashboard">前往工作台</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-10 shrink-0 items-center justify-between border-b bg-card px-4">
        <span className="truncate text-xs font-medium text-foreground">{snapshot?.name}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">/p/{slug}</span>
      </header>
      <iframe
        title={snapshot?.name || '已发布应用'}
        src={blobUrl}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  );
}
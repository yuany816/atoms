import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 页面级错误兜底：任何渲染期异常都展示可读中文提示与恢复操作，
 * 避免整树崩溃后出现白屏（预览环境抖动时用户侧最常见的观感问题）。
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] 页面渲染异常', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleBack = (): void => {
    this.setState({ error: null });
    window.location.assign('/dashboard');
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-base font-semibold text-foreground">页面加载出现问题</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            可能是网络临时波动或资源加载中断，已为你保留本地数据。可重新加载页面后继续操作。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={this.handleReload}>重新加载</Button>
            <Button variant="outline" onClick={this.handleBack}>
              返回工作台
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
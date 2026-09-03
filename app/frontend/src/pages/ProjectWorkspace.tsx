import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Paperclip,
  Send,
  Share2,
  Square,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BugReportCard,
  EditorPanel,
  PreviewPanel,
  StepsCollapse,
  TerminalPanel,
} from '@/components/prototype/panels';
import { PublishDialog, ShareDialog } from '@/components/prototype/dialogs';
import {
  STREAM_REPLY,
  mockMessages,
  mockProjects,
  type ChatMessage,
} from '@/data/mock';

function AgentAvatar() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
      <Bot className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

function MessageItem({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: () => void;
}) {
  if (message.role === 'system') {
    return (
      <div className="text-center text-xs text-muted-foreground">{message.content}</div>
    );
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-md rounded-br-md bg-primary px-3 py-2 leading-6 text-primary-foreground">
          <p className="whitespace-pre-wrap text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  // Agent 消息（错误消息带边框）
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
        {message.error && (
          <Button size="sm" variant="secondary" className="mt-2 h-7 px-2 text-xs" onClick={onRetry}>
            重试
          </Button>
        )}
        {message.steps && message.steps.length > 0 && (
          <StepsCollapse steps={message.steps} />
        )}
      </div>
    </div>
  );
}

export default function ProjectWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const project = mockProjects.find((p) => p.id === id) ?? mockProjects[0];

  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('editor');
  const [autoSwitched, setAutoSwitched] = useState(false);
  const [fixing, setFixing] = useState(false);

  const streamTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 生成中自动切到预览 Tab（仅一次）
  useEffect(() => {
    if (generating && !autoSwitched) {
      setActiveTab('preview');
      setAutoSwitched(true);
    }
  }, [generating, autoSwitched]);

  // 消息追加时滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamedText]);

  useEffect(() => {
    return () => {
      if (streamTimer.current) window.clearInterval(streamTimer.current);
    };
  }, []);

  const startGeneration = (userText: string) => {
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setGenerating(true);
    setStreamedText('');

    let i = 0;
    streamTimer.current = window.setInterval(() => {
      i += 1;
      setStreamedText(STREAM_REPLY.slice(0, i));
      if (i >= STREAM_REPLY.length) {
        if (streamTimer.current) window.clearInterval(streamTimer.current);
        streamTimer.current = null;
        setGenerating(false);
        setStreamedText('');
        setMessages((prev) => [
          ...prev,
          {
            id: `a${Date.now()}`,
            role: 'agent',
            content: STREAM_REPLY,
            steps: [
              { label: '添加主题切换状态', status: 'done' },
              { label: '注册主题 Provider（修复后重试）', status: 'done' },
              { label: '更新预览', status: 'done' },
            ],
          },
        ]);
      }
    }, 30);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || generating) return;
    setInput('');
    startGeneration(text);
  };

  const handleStop = () => {
    if (streamTimer.current) window.clearInterval(streamTimer.current);
    streamTimer.current = null;
    setGenerating(false);
    setStreamedText('');
    setMessages((prev) => [
      ...prev,
      { id: `a${Date.now()}`, role: 'agent', content: STREAM_REPLY.slice(0, 40) },
      { id: `s${Date.now()}`, role: 'system', content: '已停止生成' },
    ]);
  };

  const handleRetry = () => {
    setMessages((prev) => [
      ...prev,
      {
        id: `a${Date.now()}`,
        role: 'agent',
        content: '已重新执行修复步骤，ThemeProvider 注册成功，预览已刷新。',
        steps: [
          { label: '注册主题 Provider（重试）', status: 'done' },
          { label: '更新预览', status: 'done' },
        ],
      },
    ]);
  };

  const handleFix = () => {
    setFixing(true);
    window.setTimeout(() => setFixing(false), 2000);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans">
      {/* 顶部栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="truncate text-sm font-medium text-foreground">
            {project.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={generating}
            onClick={() => setPublishOpen(true)}
          >
            发布
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-3.5 w-3.5" />
            分享
          </Button>
        </div>
      </header>

      {/* 双栏主体 */}
      <div className="flex min-h-0 flex-1">
        {/* 左：对话区 */}
        <section className="flex min-w-0 flex-1 flex-col border-r border-border">
          {/* 消息滚动区 */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto max-w-2xl space-y-4">
              {messages.map((msg) => (
                <MessageItem key={msg.id} message={msg} onRetry={handleRetry} />
              ))}

              {/* 流式输出中的 Agent 消息 */}
              {generating && (
                <div className="flex gap-2.5">
                  <AgentAvatar />
                  <div className="min-w-0 flex-1 text-sm leading-6 text-foreground">
                    {streamedText.split('\n').filter(Boolean).map((line, i) => (
                      <p key={i} className="whitespace-pre-wrap">
                        {line.replace(/^- /, '· ')}
                      </p>
                    ))}
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-border p-3">
            <div className="mx-auto max-w-2xl">
              <div className="rounded-lg border border-input bg-card p-2 shadow-xs">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="描述你想做的应用…"
                  className="min-h-[44px] resize-none border-0 bg-transparent p-1.5 text-sm shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center justify-between p-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  {generating ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={handleStop}
                    >
                      <Square className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={!input.trim()}
                      onClick={handleSend}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 text-center text-xs text-muted-foreground">
                Enter 发送，Shift+Enter 换行
              </p>
            </div>
          </div>
        </section>

        {/* 右：工具面板 */}
        <aside className="flex w-1/2 min-w-[320px] max-w-[50%] flex-col bg-sidebar">
          <div className="shrink-0 border-b border-sidebar-border p-2">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 bg-transparent">
                <TabsTrigger value="editor" className="text-xs">编辑器</TabsTrigger>
                <TabsTrigger value="terminal" className="text-xs">终端</TabsTrigger>
                <TabsTrigger value="preview" className="relative text-xs">
                  预览
                  {generating && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="min-h-0 flex-1">
            {activeTab === 'editor' && <EditorPanel />}
            {activeTab === 'terminal' && <TerminalPanel />}
            {activeTab === 'preview' && <PreviewPanel />}
          </div>
        </aside>
      </div>

      {/* Bug Report 浮层（原型演示：固定展示） */}
      <BugReportCard onFix={handleFix} fixing={fixing} />

      {/* 弹窗 */}
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} project={project} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} project={project} />

      {/* 上传提示（附件按钮演示） */}
      <input type="file" className="hidden" aria-label="上传文件" />
      <span className="hidden">
        <Upload className="h-4 w-4" />
      </span>

      {/* 调试提示：已发布项目可访问 P5 演示页 */}
      <span className="hidden">
        <Link to={`/p/${project.slug ?? 'demo'}`}>打开应用</Link>
      </span>
    </div>
  );
}
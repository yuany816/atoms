import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { AppSidebar } from '@/components/prototype/sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  downloadDataset,
  fetchEvalLogs,
  fetchEvalStats,
  getErrorDetail,
  saveAnnotation,
  type EvalStats,
  type GenerationLog,
} from '@/lib/platform';

const PAGE_SIZE = 20;

type LabelKey = 'good' | 'bad' | 'pending';

const LABEL_META: Record<LabelKey, { text: string; badgeClass: string }> = {
  good: { text: '好', badgeClass: 'border-transparent bg-primary text-primary-foreground' },
  bad: { text: '坏', badgeClass: 'border-transparent bg-destructive text-destructive-foreground' },
  pending: { text: '待定', badgeClass: 'bg-muted text-muted-foreground' },
};

function cut(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function percent(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

/** 评测页：会话回流日志 / 人工标注 / RAG 质量统计 / 微调数据集导出（真实云端 API）。 */
export default function Evaluation() {
  const [stats, setStats] = useState<EvalStats | null>(null);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<number, string>>({});
  const [includeUnlabeled, setIncludeUnlabeled] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadAll = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const [statsData, logsData] = await Promise.all([fetchEvalStats(), fetchEvalLogs(offset, PAGE_SIZE)]);
        setStats(statsData);
        setLogs(logsData.items);
        setTotal(logsData.total);
        setNoteDrafts(
          Object.fromEntries(logsData.items.map((log) => [log.id, log.annotation?.note ?? ''])),
        );
      } catch (e) {
        toast.error(getErrorDetail(e) || '评测数据加载失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadAll(0);
  }, [loadAll]);

  const handleAnnotate = async (log: GenerationLog, label: LabelKey) => {
    setSavingId(log.id);
    try {
      await saveAnnotation({ log_id: log.id, label, note: noteDrafts[log.id] ?? '' });
      toast.success(`标注已保存：记录 #${log.id} → ${LABEL_META[label].text}`);
      await loadAll(skip);
    } catch (e) {
      toast.error(getErrorDetail(e) || '标注保存失败，请稍后重试');
    } finally {
      setSavingId(null);
    }
  };

  const handleExport = async (format: 'jsonl' | 'json' | 'csv') => {
    setExporting(true);
    try {
      await downloadDataset(format, includeUnlabeled);
      toast.success(`数据集已导出：finetune-dataset.${format}`);
    } catch (e) {
      toast.error(getErrorDetail(e) || '导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const page = Math.floor(skip / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar onOpenTemplates={() => {}} onOpenGuide={() => {}} onHelp={() => {}} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-sm font-semibold text-foreground">评测</h1>
          <p className="ml-3 text-xs text-muted-foreground">
            会话回流质量评估与标注数据集导出（数据集导出与流程管理，平台不提供在线微调）
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: '回流总数', value: stats ? String(stats.total_logs) : '-' },
                { label: '已标注', value: stats ? String(stats.annotated) : '-' },
                { label: '知识命中率', value: stats ? percent(stats.rag.hit_rate) : '-' },
                { label: '平均相关度', value: stats?.rag.avg_score ?? '-' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                  <div className="mt-1 text-xl font-semibold text-foreground">{item.value}</div>
                </div>
              ))}
            </div>

            {stats && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
                <span>
                  标注分布：好 {stats.labels.good} · 坏 {stats.labels.bad} · 待定 {stats.labels.pending}
                </span>
                <span>
                  命中知识片段 {stats.rag.score_count} 段（最高 {stats.rag.max_score ?? '-'} / 最低{' '}
                  {stats.rag.min_score ?? '-'}）
                </span>
              </div>
            )}

            {/* 数据集导出 */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="text-sm font-medium text-foreground">微调数据集导出</div>
              <p className="mt-1 text-xs text-muted-foreground">
                默认导出标注为「好」的样本（JSONL 为 messages 微调格式）；勾选后包含未标注样本
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Button variant="outline" size="sm" onClick={() => void handleExport('jsonl')} disabled={exporting}>
                  <Download className="h-4 w-4" />
                  JSONL
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExport('json')} disabled={exporting}>
                  <Download className="h-4 w-4" />
                  JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => void handleExport('csv')} disabled={exporting}>
                  <Download className="h-4 w-4" />
                  CSV
                </Button>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="include-unlabeled"
                    checked={includeUnlabeled}
                    onCheckedChange={(checked) => setIncludeUnlabeled(checked === true)}
                  />
                  <Label htmlFor="include-unlabeled" className="text-xs text-muted-foreground">
                    包含未标注样本
                  </Label>
                </div>
              </div>
            </div>

            {/* 回流日志列表 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ClipboardCheck className="h-4 w-4" />
                  会话回流（共 {total} 条）
                </div>
                <Button variant="ghost" size="sm" onClick={() => void loadAll(skip)} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
              </div>
              {loading && logs.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                  暂无回流记录，在项目工作区进行 AI 对话后自动沉淀
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">#{log.id}</span>
                      <Badge variant="outline" className="text-xs font-normal">
                        {log.model}
                      </Badge>
                      {log.annotation && (
                        <Badge className={`text-xs font-normal ${LABEL_META[log.annotation.label as LabelKey]?.badgeClass ?? ''}`}>
                          {LABEL_META[log.annotation.label as LabelKey]?.text ?? log.annotation.label}
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                    </div>
                    <div className="mt-2 space-y-1.5 text-sm">
                      <p className="text-foreground">
                        <span className="mr-1.5 text-xs text-muted-foreground">用户</span>
                        {cut(log.user_message, 160)}
                      </p>
                      <p className="text-muted-foreground">
                        <span className="mr-1.5 text-xs">助手</span>
                        {cut(log.assistant_message, 200)}
                      </p>
                    </div>
                    {(log.kb_sources.length > 0 || log.skill_names.length > 0) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {log.kb_sources.map((source, index) => (
                          <Badge key={`kb-${log.id}-${index}`} variant="secondary" className="text-xs font-normal">
                            知识：{source.file_name || '未知'}#{source.chunk_index ?? '-'}（{source.score ?? '-'}）
                          </Badge>
                        ))}
                        {log.skill_names.map((name) => (
                          <Badge key={`skill-${log.id}-${name}`} variant="secondary" className="text-xs font-normal">
                            技能：{name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <span className="text-xs text-muted-foreground">标注：</span>
                      {(['good', 'bad', 'pending'] as LabelKey[]).map((label) => (
                        <Button
                          key={label}
                          variant="outline"
                          size="sm"
                          disabled={savingId === log.id}
                          onClick={() => void handleAnnotate(log, label)}
                        >
                          {LABEL_META[label].text}
                        </Button>
                      ))}
                      <Input
                        value={noteDrafts[log.id] ?? ''}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({ ...prev, [log.id]: e.target.value.slice(0, 200) }))
                        }
                        placeholder="备注（可选，随标注保存）"
                        className="h-8 min-w-40 flex-1 text-xs"
                      />
                    </div>
                  </div>
                ))
              )}

              {/* 分页 */}
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-end gap-2 pt-1 text-xs text-muted-foreground">
                  <span>
                    第 {page} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={skip === 0 || loading}
                    onClick={() => {
                      const next = Math.max(0, skip - PAGE_SIZE);
                      setSkip(next);
                      void loadAll(next);
                    }}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={skip + PAGE_SIZE >= total || loading}
                    onClick={() => {
                      const next = skip + PAGE_SIZE;
                      setSkip(next);
                      void loadAll(next);
                    }}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
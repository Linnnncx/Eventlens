import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Settings2, Sparkles } from 'lucide-react';
import { analyzeRange, fetchPublicConfig } from '../../api/endpoints';
import type { RangeAnalysisReport, Timeframe } from '../../types/api';
import { AiSettingsPanel } from './AiSettingsPanel';
import { AiStatusBadge } from './AiStatusBadge';

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '1Min', label: '1Min' },
  { id: '5Min', label: '5Min' },
  { id: '15Min', label: '15Min' },
  { id: '1Hour', label: '1Hour' },
  { id: '4Hour', label: '4Hour' },
  { id: '1Day', label: '1Day' },
  { id: '1Month', label: '1Month' },
];

function needsClock(tf: Timeframe): boolean {
  return tf !== '1Day' && tf !== '1Month';
}

function todayDateInput(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoDateInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local date or datetime-local → ISO UTC. */
function localInputToIso(value: string, endOfDay: boolean, withClock: boolean): string {
  if (withClock) {
    // datetime-local: YYYY-MM-DDTHH:mm
    const d = new Date(value);
    return d.toISOString();
  }
  const [y, m, day] = value.split('-').map(Number);
  const d = new Date(y!, (m ?? 1) - 1, day ?? 1, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return d.toISOString();
}

function defaultDateTimeLocal(daysAgo: number, endOfDay: boolean): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  if (endOfDay) {
    d.setHours(23, 59, 0, 0);
  } else {
    d.setHours(9, 30, 0, 0);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

interface RangeAiAnalysisProps {
  symbol: string;
  /** Current workbench timeframe — used as the initial filter. */
  defaultTimeframe: Timeframe;
}

export function RangeAiAnalysis({ symbol, defaultTimeframe }: RangeAiAnalysisProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);
  const withClock = needsClock(timeframe);

  const [startDate, setStartDate] = useState(() => daysAgoDateInput(30));
  const [endDate, setEndDate] = useState(() => todayDateInput());
  const [startDateTime, setStartDateTime] = useState(() => defaultDateTimeLocal(5, false));
  const [endDateTime, setEndDateTime] = useState(() => defaultDateTimeLocal(0, true));
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setTimeframe(defaultTimeframe);
  }, [defaultTimeframe]);

  useEffect(() => {
    setStartDate(daysAgoDateInput(30));
    setEndDate(todayDateInput());
    setStartDateTime(defaultDateTimeLocal(5, false));
    setEndDateTime(defaultDateTimeLocal(0, true));
  }, [symbol]);

  const { data: config } = useQuery({
    queryKey: ['public-config'],
    queryFn: fetchPublicConfig,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const start = localInputToIso(withClock ? startDateTime : startDate, false, withClock);
      const end = localInputToIso(withClock ? endDateTime : endDate, true, withClock);
      return analyzeRange({ symbol, timeframe, start, end });
    },
  });

  const report: RangeAnalysisReport | undefined = mutation.data;
  const llmReady = Boolean(
    config?.deepseekConfigured && config.llmProvider && config.llmProvider !== 'rules',
  );

  return (
    <div className="rounded-xl border border-news/30 bg-news/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-news" />
        <h3 className="text-[13px] font-semibold text-gray-100">AI 区间分析</h3>
        <span className="text-[11px] text-muted">{symbol}</span>
        <div className="ml-auto flex items-center gap-2">
          <AiStatusBadge ready={llmReady} loading={!config} />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-surface-raised px-2 py-1 text-[11px] text-muted hover:text-gray-100"
          >
            <Settings2 className="h-3.5 w-3.5" />
            AI 设置
          </button>
        </div>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-muted">
        选择 K 线周期与时间区间，分析该窗口内的技术面与新闻，生成报告。
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          K 线周期
          <select
            className="input min-w-[6.5rem] py-1.5 text-[12px] text-gray-100"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf.id} value={tf.id}>
                {tf.label}
              </option>
            ))}
          </select>
        </label>

        {withClock ? (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              开始
              <input
                type="datetime-local"
                className="input py-1.5 text-[12px] text-gray-100"
                value={startDateTime}
                onChange={(e) => setStartDateTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              结束
              <input
                type="datetime-local"
                className="input py-1.5 text-[12px] text-gray-100"
                value={endDateTime}
                onChange={(e) => setEndDateTime(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              开始日期
              <input
                type="date"
                className="input py-1.5 text-[12px] text-gray-100"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              结束日期
              <input
                type="date"
                className="input py-1.5 text-[12px] text-gray-100"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </>
        )}

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="btn-primary m-tap px-3 py-1.5 text-[12px] disabled:opacity-50"
        >
          {mutation.isPending ? '分析中…' : '开始分析'}
        </button>
      </div>

      {mutation.isError && (
        <div className="mt-2 rounded-lg border border-down/30 bg-down/10 px-2.5 py-2 text-[12px] text-down">
          分析失败：{(mutation.error as Error)?.message || '请确认后端在运行后重试'}
        </div>
      )}

      {report && (
        <div className="mt-3 space-y-2 rounded-lg border border-border/70 bg-surface-card px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-gray-100">{report.title}</h4>
            <span className="text-[10px] text-muted">
              {report.usedLlm ? `模型 ${report.model}` : `规则引擎 · ${report.model}`} · K线{' '}
              {report.barCount} · 新闻 {report.newsCount}
            </span>
          </div>
          <p className="text-[12px] leading-relaxed text-gray-200">{report.summaryZh}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <Section title="技术面" body={report.technicalSummary} />
            <Section title="新闻面" body={report.newsSummary} />
          </div>
          <Section title="展望" body={report.outlook} />
          {report.keyPoints.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-gray-300">
              {report.keyPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {report.risks.length > 0 && (
            <div className="text-[11px] text-muted">
              风险提示：{report.risks.join('；')}
            </div>
          )}
          <div className="text-[10px] text-muted">{report.disclaimer}</div>
        </div>
      )}

      <AiSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-medium text-muted">{title}</div>
      <p className="text-[12px] leading-relaxed text-gray-300">{body}</p>
    </div>
  );
}

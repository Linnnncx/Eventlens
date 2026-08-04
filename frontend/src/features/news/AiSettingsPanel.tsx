import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2, X } from 'lucide-react';
import {
  fetchLlmConfig,
  saveLlmConfig,
  type LlmConfigView,
  type LlmProviderId,
} from '../../api/endpoints';

interface AiSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS: { id: LlmProviderId; label: string }[] = [
  { id: 'rules', label: '规则引擎（免费本地）' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: 'Qwen（通义）' },
];

const FALLBACK_DEFAULTS: Record<Exclude<LlmProviderId, 'rules'>, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
};

const PROVIDER_LABEL: Record<LlmProviderId, string> = {
  rules: '规则引擎',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
};

function presetFor(
  provider: LlmProviderId,
  defaults?: LlmConfigView['providerDefaults'],
): { baseUrl: string; model: string } | null {
  if (provider === 'rules') return null;
  const fromApi = defaults?.[provider];
  if (fromApi?.baseUrl && fromApi?.model) return fromApi;
  return FALLBACK_DEFAULTS[provider];
}

export function AiSettingsPanel({ open, onClose }: AiSettingsPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['llm-config'],
    queryFn: fetchLlmConfig,
    enabled: open,
  });

  const [provider, setProvider] = useState<LlmProviderId>('rules');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-v4-flash');
  const [timeoutSec, setTimeoutSec] = useState(60);
  const [clearKey, setClearKey] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!data) return;
    applyView(data);
  }, [data]);

  const applyView = (view: LlmConfigView) => {
    setProvider(view.llmProvider);
    setBaseUrl(view.deepseekBaseUrl || 'https://api.deepseek.com');
    setModel(view.deepseekModel || 'deepseek-v4-flash');
    setTimeoutSec(view.deepseekTimeoutSeconds || 60);
    setApiKey('');
    setClearKey(false);
    setSavedMsg('');
  };

  const onProviderChange = (next: LlmProviderId) => {
    setProvider(next);
    const preset = presetFor(next, data?.providerDefaults);
    if (preset) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  };

  const isCloud = provider !== 'rules';

  const save = useMutation({
    mutationFn: () =>
      saveLlmConfig({
        llmProvider: provider,
        deepseekBaseUrl: baseUrl,
        deepseekModel: model,
        deepseekTimeoutSeconds: timeoutSec,
        ...(clearKey ? { clearKey: true } : apiKey.trim() ? { deepseekApiKey: apiKey.trim() } : {}),
      }),
    onSuccess: async (view) => {
      applyView(view);
      await queryClient.invalidateQueries({ queryKey: ['public-config'] });
      await queryClient.invalidateQueries({ queryKey: ['llm-config'] });
      await queryClient.invalidateQueries({ queryKey: ['providers-status'] });
      const effective = view.effectiveProvider;
      const ok =
        effective !== 'rules'
          ? `已保存，${PROVIDER_LABEL[effective]} 已生效`
          : isCloud
            ? `已保存（请填写有效 API Key 后 ${PROVIDER_LABEL[provider]} 才会生效）`
            : '已保存（当前为规则引擎）';
      setSavedMsg(ok);
    },
  });

  if (!open) return null;

  const keyPlaceholder =
    provider === 'openai'
      ? 'sk-…'
      : provider === 'qwen'
        ? 'sk-…（DashScope API Key）'
        : 'sk-…';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="关闭" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-news" />
            <h3 className="text-[15px] font-semibold text-gray-50">AI 设置</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-hover"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted">加载配置…</div>
        ) : (
          <div className="space-y-3">
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              提供商
              <select
                className="input py-2 text-[13px] text-gray-100"
                value={provider}
                onChange={(e) => onProviderChange(e.target.value as LlmProviderId)}
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {isCloud ? (
              <>
                <label className="flex flex-col gap-1 text-[12px] text-muted">
                  API Key
                  <input
                    type="password"
                    className="input py-2 font-mono text-[13px] text-gray-100"
                    placeholder={
                      data?.deepseekHasKey
                        ? `已保存 ${data.deepseekApiKeyMasked}（留空保留）`
                        : keyPlaceholder
                    }
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setClearKey(false);
                    }}
                    autoComplete="off"
                  />
                </label>

                {data?.deepseekHasKey && (
                  <label className="flex items-center gap-2 text-[12px] text-muted">
                    <input
                      type="checkbox"
                      checked={clearKey}
                      onChange={(e) => {
                        setClearKey(e.target.checked);
                        if (e.target.checked) setApiKey('');
                      }}
                    />
                    清除已保存的 Key
                  </label>
                )}

                <label className="flex flex-col gap-1 text-[12px] text-muted">
                  Base URL
                  <input
                    className="input py-2 font-mono text-[13px] text-gray-100"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={presetFor(provider, data?.providerDefaults)?.baseUrl}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[12px] text-muted">
                  模型
                  <input
                    className="input py-2 font-mono text-[13px] text-gray-100"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={presetFor(provider, data?.providerDefaults)?.model}
                  />
                </label>

                <label className="flex flex-col gap-1 text-[12px] text-muted">
                  超时（秒）
                  <input
                    type="number"
                    min={10}
                    max={180}
                    className="input py-2 text-[13px] text-gray-100"
                    value={timeoutSec}
                    onChange={(e) => setTimeoutSec(Number(e.target.value) || 60)}
                  />
                </label>
              </>
            ) : (
              <div className="rounded-lg border border-border/70 bg-surface-raised px-2.5 py-2 text-[11px] text-muted">
                规则引擎不需要 API Key，将用本地规则生成摘要。
              </div>
            )}

            {data && (
              <div className="rounded-lg border border-border/70 bg-surface-raised px-2.5 py-2 text-[11px] text-muted">
                当前生效：
                <span className="ml-1 font-medium text-gray-200">
                  {PROVIDER_LABEL[data.effectiveProvider] || data.effectiveProvider}
                  {data.effectiveProvider !== 'rules' ? ' 真 AI' : ''}
                </span>
                {data.source === 'runtime' ? ' · 来自前端保存' : ' · 来自 .env'}
              </div>
            )}

            {save.isError && (
              <div className="text-[12px] text-down">
                保存失败：{(save.error as Error)?.message || '请重试'}
              </div>
            )}
            {savedMsg && <div className="text-[12px] text-up">{savedMsg}</div>}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-ghost flex-1 border border-border py-2.5">
                取消
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate()}
                className="btn-primary flex-[2] py-2.5 disabled:opacity-50"
              >
                {save.isPending ? '保存中…' : '保存并生效'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

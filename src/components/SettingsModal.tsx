import React, { useState, useEffect } from "react";
import { X, Check, AlertCircle, Key, Cpu, ExternalLink, Eye, EyeOff, Globe } from "lucide-react";
import { useLanguage } from "../hooks/useLanguage";
import { AIProvider } from "@/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS: { value: AIProvider; label: string; defaultModel: string; description: string }[] = [
  { value: 'gemini', label: 'Gemini', defaultModel: 'gemini-3.1-pro-preview', description: 'Auto caching (repeat prefix)' },
  { value: 'claude', label: 'Claude', defaultModel: 'claude-sonnet-4.6', description: 'Manual cache_control (ephemeral)' },
  { value: 'gpt', label: 'GPT', defaultModel: 'gpt-5.4', description: 'Auto caching (1024+ token prefix)' },
];

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<AIProvider>('gemini');
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (isOpen) {
      setSaveStatus(null);
      fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
          setProvider(data.provider || 'gemini');
          setApiKey(data.apiKey || '');
          setModelName(data.model || '');
          setBaseUrl(data.baseUrl || '');
        })
        .catch(() => {
          // Fallback defaults
          setProvider('gemini');
          setApiKey('');
          setModelName('');
          setBaseUrl('https://aihubmix.com');
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === provider)!;

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    // Clear model when switching providers so default is used
    setModelName("");
  };

  const handleSave = async () => {
    try {
      const settings = {
        provider,
        apiKey: apiKey.trim(),
        model: modelName.trim(),
        baseUrl: baseUrl.trim(),
      };
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#1c1c1e] border border-[#2e2e30] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#2e2e30]">
          <h2 className="text-xl font-bold text-white">{t('settings.title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">

          {/* Provider Selection */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Cpu size={14} /> Provider
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleProviderChange(opt.value)}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                    provider === opt.value
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-black/20 border-[#2e2e30] text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              {selectedProvider.description}
            </p>
          </section>

          {/* API Configuration */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Key size={14} /> API Configuration
            </h3>

            {/* Base URL */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 flex items-center gap-2">
                <Globe size={14} /> Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full bg-black/30 border border-[#2e2e30] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="https://your-api-proxy.com"
              />
              <p className="text-xs text-gray-500">
                API proxy endpoint (e.g. https://aihubmix.com)
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-black/30 border border-[#2e2e30] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors pr-10"
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <a
                href="https://aihubmix.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Get an API key from AiHubMix <ExternalLink size={10} />
              </a>
            </div>

            {/* Model Name */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 flex items-center gap-2">
                <Cpu size={14} /> Model Name
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full bg-black/30 border border-[#2e2e30] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={selectedProvider.defaultModel}
              />
              <p className="text-xs text-gray-500">
                Leave empty to use default: {selectedProvider.defaultModel}
              </p>
            </div>
          </section>

          <hr className="border-[#2e2e30]" />

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {t('common.save')}
          </button>

          {saveStatus === 'success' && (
            <p className="text-green-500 text-sm flex items-center gap-1 justify-center">
              <Check size={14}/> Settings saved successfully
            </p>
          )}
          {saveStatus === 'error' && (
            <p className="text-red-500 text-sm flex items-center gap-1 justify-center">
              <AlertCircle size={14}/> Failed to save settings
            </p>
          )}

          {/* Caching Info */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <p className="text-xs text-blue-300 font-medium">Prompt Caching</p>
            <p className="text-xs text-blue-300/80 leading-relaxed">
              {provider === 'claude'
                ? 'Claude uses explicit cache_control annotations. The system prompt is automatically cached with ephemeral TTL (5 min). Cache reads cost 0.1x input price.'
                : provider === 'gemini'
                ? 'Gemini caches automatically when the same prefix is repeated. Cached tokens cost 25% of standard input price.'
                : 'GPT caches automatically for prompts with 1024+ token prefixes. Cache reads cost 0.25-0.5x the original price.'
              }
            </p>
          </div>


        </div>
      </div>
    </div>
  );
}

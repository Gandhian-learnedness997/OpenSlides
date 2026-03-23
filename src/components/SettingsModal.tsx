import React, { useState, useEffect } from "react";
import { X, Check, AlertCircle, Key, Cpu, Eye, EyeOff, Globe } from "lucide-react";
import { useLanguage } from "../hooks/useLanguage";
import { AIProvider } from "@/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROVIDER_OPTIONS: { value: AIProvider; label: string; defaultModel: string; defaultBaseUrl: string; descKey: string }[] = [
  { value: 'gemini', label: 'Gemini', defaultModel: 'gemini-3.1-pro-preview', defaultBaseUrl: 'https://generativelanguage.googleapis.com', descKey: 'settings.descGemini' },
  { value: 'claude', label: 'Claude', defaultModel: 'claude-sonnet-4.6', defaultBaseUrl: 'https://api.anthropic.com', descKey: 'settings.descClaude' },
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-5.4', defaultBaseUrl: 'https://api.openai.com/v1', descKey: 'settings.descOpenai' },
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
          setProvider('gemini');
          setApiKey('');
          setModelName('');
          setBaseUrl('');
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedProvider = PROVIDER_OPTIONS.find(p => p.value === provider)!;

  const handleProviderChange = (newProvider: AIProvider) => {
    setProvider(newProvider);
    setModelName("");
    setBaseUrl("");
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
              <Cpu size={14} /> {t('settings.provider')}
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
              {t(selectedProvider.descKey as any)}
            </p>
          </section>

          {/* API Configuration */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Key size={14} /> {t('settings.apiConfiguration')}
            </h3>

            {/* Base URL */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 flex items-center gap-2">
                <Globe size={14} /> {t('settings.baseUrl')}
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full bg-black/30 border border-[#2e2e30] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={selectedProvider.defaultBaseUrl}
              />
              <p className="text-xs text-gray-500">
                {t('settings.modelNameHint')} {selectedProvider.defaultBaseUrl}
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300">{t('settings.apiKey')}</label>
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
            </div>

            {/* Model Name */}
            <div className="space-y-2">
              <label className="block text-sm text-gray-300 flex items-center gap-2">
                <Cpu size={14} /> {t('settings.modelName')}
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full bg-black/30 border border-[#2e2e30] rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={selectedProvider.defaultModel}
              />
              <p className="text-xs text-gray-500">
                {t('settings.modelNameHint')} {selectedProvider.defaultModel}
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
              <Check size={14}/> {t('settings.savedSuccess')}
            </p>
          )}
          {saveStatus === 'error' && (
            <p className="text-red-500 text-sm flex items-center gap-1 justify-center">
              <AlertCircle size={14}/> {t('settings.savedError')}
            </p>
          )}

          {/* Caching Info */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <p className="text-xs text-blue-300 font-medium">{t('settings.promptCaching')}</p>
            <p className="text-xs text-blue-300/80 leading-relaxed">
              {provider === 'claude'
                ? t('settings.cachingClaude')
                : provider === 'gemini'
                ? t('settings.cachingGemini')
                : t('settings.cachingOpenai')
              }
            </p>
          </div>


        </div>
      </div>
    </div>
  );
}

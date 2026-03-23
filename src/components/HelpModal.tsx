import React from 'react';
import { X, BookOpen, FileText, MessageSquare, Edit, Download } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

interface HelpModalProps {
  onClose: () => void;
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const { t } = useLanguage();

  const steps: Array<{ icon: React.ReactNode; title: string; description: string }> = [
    {
      icon: <FileText className="text-blue-400" size={24} />,
      title: t('help.step1Title'),
      description: t('help.step1Desc')
    },
    {
      icon: <MessageSquare className="text-green-400" size={24} />,
      title: t('help.step2Title'),
      description: t('help.step2Desc')
    },
    {
      icon: <Edit className="text-purple-400" size={24} />,
      title: t('help.step3Title'),
      description: t('help.step3Desc')
    },
    {
      icon: <Download className="text-orange-400" size={24} />,
      title: t('help.step4Title'),
      description: t('help.step4Desc')
    }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-panel w-full max-w-2xl rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <BookOpen className="text-blue-500" size={24} />
            {t('help.title')}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar">
          <div className="grid gap-6">
            {steps.map((step, index) => (
              <div key={index} className="flex gap-4 p-4 rounded-xl bg-gray-800/50 border border-gray-700/50 hover:border-gray-600 transition-colors">
                <div className="shrink-0 mt-1">
                  <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center border border-gray-700">
                    {step.icon}
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-medium text-white mb-1">{step.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* <div className="mt-8 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <h4 className="text-blue-400 font-medium mb-2 flex items-center gap-2">
              {t('help.proTipTitle')}
            </h4>
            <p className="text-sm text-gray-300">
              {t('help.proTipDesc')}
            </p>
          </div> */}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border bg-gray-900/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors"
          >
            {t('help.gotIt')}
          </button>
        </div>

      </div>
    </div>
  );
}

import React from "react";
import { X, AlertTriangle } from "lucide-react";

interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-panel border border-border w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-fadeIn transform scale-100 transition-all">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-gray-900/50">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle size={20} className="text-yellow-500" />
            Confirm Action
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 text-gray-300">
          <p className="font-medium text-white mb-2">{title}</p>
          <p className="text-sm leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-gray-900/30 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white shadow-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

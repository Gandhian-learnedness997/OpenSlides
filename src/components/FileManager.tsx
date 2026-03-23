import React, { useState, useEffect } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { useLanguage } from "../hooks/useLanguage";
import { LocalFile } from "@/types";

interface FileManagerProps {
  projectId: string;
  onFilesChange: (files: LocalFile[]) => void;
}

export default function FileManager({ projectId, onFilesChange }: FileManagerProps) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const { t } = useLanguage();

  // Load files from server on mount
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/files`);
        if (res.ok) {
          const parsed: LocalFile[] = await res.json();
          setFiles(parsed);
          onFilesChange(parsed);
        }
      } catch (error) {
        console.error('Failed to load files:', error);
      }
    };
    loadFiles();
  }, [projectId]);

  const saveFiles = async (updatedFiles: LocalFile[]) => {
    setFiles(updatedFiles);
    onFilesChange(updatedFiles);
    try {
      await fetch(`/api/projects/${projectId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFiles),
      });
    } catch (error) {
      console.error('Failed to save files:', error);
    }
  };

  const ALLOWED_EXTENSIONS = [
    "png", "jpeg", "jpg", "svg", "pdf",
    "txt", "text", "csv", "md", "py", "sh",
  ];

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    e.target.value = "";

    const validFiles = selectedFiles.filter((file) => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      return ALLOWED_EXTENSIONS.includes(extension);
    });

    if (validFiles.length !== selectedFiles.length) {
      alert(`Some files were skipped. Only ${ALLOWED_EXTENSIONS.join(", ")} files are allowed.`);
    }

    if (validFiles.length === 0) return;

    // Check for duplicates
    const existingNames = new Set(files.map((f) => f.name));
    const duplicates = validFiles.filter((file) => existingNames.has(file.name));

    if (duplicates.length > 0) {
      setDuplicateFiles(duplicates.map((f) => f.name));
      setPendingUploadFiles(validFiles);
      setShowOverwriteConfirm(true);
    } else {
      processUpload(validFiles);
    }
  };

  const processUpload = async (filesToUpload: File[]) => {
    setUploading(true);
    setUploadProgress(0);

    const newFiles: LocalFile[] = [];
    const totalFiles = filesToUpload.length;

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const dataUrl = await readFileAsDataUrl(file);
      newFiles.push({
        name: file.name,
        dataUrl,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      });
      setUploadProgress(Math.round(((i + 1) / totalFiles) * 100));
    }

    // Merge with existing (overwrite duplicates)
    const merged = [...files];
    for (const newFile of newFiles) {
      const existingIdx = merged.findIndex(f => f.name === newFile.name);
      if (existingIdx >= 0) {
        merged[existingIdx] = newFile;
      } else {
        merged.push(newFile);
      }
    }

    saveFiles(merged);
    setUploading(false);
    setUploadProgress(0);
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const confirmUpload = () => {
    setShowOverwriteConfirm(false);
    processUpload(pendingUploadFiles);
    setPendingUploadFiles([]);
    setDuplicateFiles([]);
  };

  const cancelUpload = () => {
    setShowOverwriteConfirm(false);
    setPendingUploadFiles([]);
    setDuplicateFiles([]);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const updated = files.filter(f => f.name !== deleteTarget);
    saveFiles(updated);
    setDeleteTarget(null);
  };

  const handleDeleteRequest = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(fileName);
  };

  const openFile = (fileName: string) => {
    const file = files.find(f => f.name === fileName);
    if (file) {
      const win = window.open();
      if (win) {
        if (file.mimeType.startsWith('image/')) {
          win.document.write(`<img src="${file.dataUrl}" style="max-width:100%;"/>`);
        } else {
          win.document.write(`<iframe src="${file.dataUrl}" style="width:100%;height:100%;border:none;"></iframe>`);
        }
      }
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-background text-gray-200 relative">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="h-10 flex items-center">
          <h2 className="font-semibold text-lg">{t('fileManager.sources')}</h2>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
        <label
          className={`flex items-center justify-center gap-2 w-full py-2.5 border border-border rounded-full text-sm font-medium cursor-pointer hover:bg-panel transition-colors ${
            uploading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <Plus size={16} />
          <span>{uploading ? t('fileManager.uploading') : t('fileManager.addSources')}</span>
          <input
            type="file"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
            multiple
            accept=".png,.jpeg,.jpg,.svg,.pdf,.txt,.text,.csv,.md,.py,.sh"
          />
        </label>

        {uploading && (
          <div className="w-full bg-gray-700 rounded-full h-2.5 mb-2">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            ></div>
            <p className="text-xs text-center mt-1 text-gray-400">
              {uploadProgress}%
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {files.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {t('fileManager.noSources')}
            </div>
          ) : (
            files.map((file) => (
              <div
                key={file.name}
                onClick={() => openFile(file.name)}
                onMouseLeave={() => {
                  if (deleteTarget === file.name) setDeleteTarget(null);
                }}
                className="group flex items-center gap-3 p-3 rounded-xl hover:bg-panel cursor-pointer transition-colors"
              >
                <div className="p-2 bg-red-900/20 rounded-lg text-red-400">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium truncate text-gray-300 group-hover:text-white">
                    {file.name}
                  </h4>
                  <p className="text-xs text-gray-500 truncate">
                    {file.mimeType.split("/")[1]?.toUpperCase() || t('fileManager.fileType')}{" "}
                    • {formatSize(file.size)}
                  </p>
                </div>
                {deleteTarget === file.name ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        confirmDelete();
                      }}
                      className="p-1.5 text-green-400 hover:bg-green-900/20 rounded-lg transition-colors"
                      title={t('common.confirm')}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setDeleteTarget(null);
                      }}
                      className="p-1.5 text-gray-400 hover:bg-gray-700 rounded-lg transition-colors"
                      title={t('common.cancel')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e: React.MouseEvent) => handleDeleteRequest(file.name, e)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title={t('fileManager.deleteFile')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Overwrite Confirmation Modal */}
      {showOverwriteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-panel border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="mx-auto w-12 h-12 bg-yellow-500/10 text-yellow-500 rounded-full flex items-center justify-center mb-4">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-xl font-bold text-white">{t('fileManager.overwriteConfirmTitle')}</h3>
              <p className="text-gray-400 text-sm">
                {t('fileManager.overwriteConfirmMessage').replace('{fileNames}', duplicateFiles.join(', '))}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={cancelUpload}
                className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmUpload}
                className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-medium transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

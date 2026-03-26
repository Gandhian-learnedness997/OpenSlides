import React, { useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PiFileCodeDuotone,
  PiFileCsvDuotone,
  PiFileImageDuotone,
  PiFilePdfDuotone,
  PiFileTextDuotone,
  PiMarkdownLogoDuotone,
  PiTerminalDuotone,
} from "react-icons/pi";
import {
  ArrowUpDown,
  FileText,
  Plus,
  Trash2,
  Check,
  X,
  AlertCircle,
  ZoomIn,
  ChevronDown,
  Globe,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useLanguage } from "../hooks/useLanguage";
import { LocalFile, UrlSource } from "@/types";
import { fetchJson, fetchOk } from "@/lib/http";

interface FileManagerProps {
  projectId: string;
  onFilesChange: (files: LocalFile[]) => void;
  onUrlsChange?: (urls: UrlSource[]) => void;
}

interface PendingUploadItem {
  file: File;
  name: string;
}

type SortOption = "extension" | "uploadTime" | "name";
const SOURCE_SORT_STORAGE_KEY = "openslides:file-sort-option";
const DEFAULT_SORT_OPTION: SortOption = "uploadTime";
const SORT_OPTIONS: SortOption[] = ["extension", "uploadTime", "name"];

const isSortOption = (value: string | null): value is SortOption =>
  value !== null && SORT_OPTIONS.includes(value as SortOption);

export default function FileManager({ projectId, onFilesChange, onUrlsChange }: FileManagerProps) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // URL sources state
  const [urls, setUrls] = useState<UrlSource[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [refreshingUrlId, setRefreshingUrlId] = useState<string | null>(null);
  const [deleteUrlTarget, setDeleteUrlTarget] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [previewUrlTarget, setPreviewUrlTarget] = useState<UrlSource | null>(null);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);
  const [duplicateFiles, setDuplicateFiles] = useState<string[]>([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [hoveredFileName, setHoveredFileName] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LocalFile | null>(null);
  const [previewTextContent, setPreviewTextContent] = useState<string>("");
  const [previewTextLoading, setPreviewTextLoading] = useState<boolean>(false);
  const [previewTextError, setPreviewTextError] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    if (typeof window === "undefined") return DEFAULT_SORT_OPTION;

    const stored = window.localStorage.getItem(SOURCE_SORT_STORAGE_KEY);
    return isSortOption(stored) ? stored : DEFAULT_SORT_OPTION;
  });
  const [showSortMenu, setShowSortMenu] = useState<boolean>(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (!previewTarget) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewTarget(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewTarget]);

  useEffect(() => {
    if (!showSortMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setShowSortMenu(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [showSortMenu]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SOURCE_SORT_STORAGE_KEY, sortOption);
  }, [sortOption]);

  // Load files from server on mount
  useEffect(() => {
    const loadFiles = async () => {
      try {
        const parsed = await fetchJson<LocalFile[]>(`/api/projects/${encodeURIComponent(projectId)}/files`, undefined, 'Failed to load files');
        setFiles(parsed);
        onFilesChange(parsed);
      } catch (error) {
        console.error('Failed to load files:', error);
      }
    };
    loadFiles();
  }, [projectId, onFilesChange]);

  // Load URL sources on mount
  useEffect(() => {
    const loadUrls = async () => {
      try {
        const parsed = await fetchJson<UrlSource[]>(`/api/projects/${encodeURIComponent(projectId)}/urls`, undefined, 'Failed to load URLs');
        setUrls(parsed);
        onUrlsChange?.(parsed);
      } catch (error) {
        console.error('Failed to load URLs:', error);
      }
    };
    loadUrls();
  }, [projectId]);

  // URL CRUD handlers
  const handleAddUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    try { new URL(url); } catch {
      setUrlError(t('fileManager.invalidUrl'));
      setTimeout(() => setUrlError(null), 3000);
      return;
    }
    setIsAddingUrl(true);
    setUrlError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t('fileManager.fetchFailed') }));
        setUrlError(err.error === 'This URL has already been added' ? t('fileManager.urlDuplicate') : (err.error || t('fileManager.fetchFailed')));
        setTimeout(() => setUrlError(null), 3000);
        return;
      }
      const updated: UrlSource[] = await res.json();
      setUrls(updated);
      onUrlsChange?.(updated);
      setUrlInput('');
    } catch {
      setUrlError(t('fileManager.fetchFailed'));
      setTimeout(() => setUrlError(null), 3000);
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleDeleteUrl = async (urlId: string) => {
    try {
      const updated = await fetchJson<UrlSource[]>(
        `/api/projects/${encodeURIComponent(projectId)}/urls/${urlId}`,
        { method: 'DELETE' },
        'Failed to delete URL'
      );
      setUrls(updated);
      onUrlsChange?.(updated);
    } catch (error) {
      console.error('Failed to delete URL:', error);
    }
    setDeleteUrlTarget(null);
  };

  const handleRefreshUrl = async (urlId: string) => {
    setRefreshingUrlId(urlId);
    try {
      const updated = await fetchJson<UrlSource[]>(
        `/api/projects/${encodeURIComponent(projectId)}/urls/${urlId}/refresh`,
        { method: 'POST' },
        'Failed to refresh URL'
      );
      setUrls(updated);
      onUrlsChange?.(updated);
    } catch (error) {
      console.error('Failed to refresh URL:', error);
    } finally {
      setRefreshingUrlId(null);
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
      void processUpload(validFiles.map((file) => ({ file, name: file.name }))).catch((error) => {
        console.error('Failed to upload files:', error);
        alert(error instanceof Error ? error.message : 'Failed to save files');
      });
    }
  };

  const buildRenamedUploadItems = (filesToUpload: File[]): PendingUploadItem[] => {
    const usedNames = new Set(files.map((file) => file.name));
    const uploadItems: PendingUploadItem[] = [];

    const getUniqueName = (originalName: string): string => {
      const extensionIndex = originalName.lastIndexOf(".");
      const hasExtension = extensionIndex > 0;
      const baseName = hasExtension ? originalName.slice(0, extensionIndex) : originalName;
      const extension = hasExtension ? originalName.slice(extensionIndex) : "";

      let candidate = originalName;
      let suffix = 2;
      while (usedNames.has(candidate)) {
        candidate = `${baseName} (${suffix})${extension}`;
        suffix += 1;
      }
      return candidate;
    };

    for (const file of filesToUpload) {
      const nextName = getUniqueName(file.name);
      usedNames.add(nextName);
      uploadItems.push({ file, name: nextName });
    }

    return uploadItems;
  };

  const processUpload = async (filesToUpload: PendingUploadItem[]) => {
    const uploadPayload: Array<{ name: string; dataUrl: string; mimeType: string; size: number }> = [];

    for (const file of filesToUpload) {
      const dataUrl = await readFileAsDataUrl(file.file);
      uploadPayload.push({
        name: file.name,
        dataUrl,
        mimeType: file.file.type || 'application/octet-stream',
        size: file.file.size,
      });
    }

    const nextFiles = await fetchJson<LocalFile[]>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: uploadPayload }),
      },
      'Failed to save files'
    );

    setFiles(nextFiles);
    onFilesChange(nextFiles);
  };

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const confirmOverwriteUpload = () => {
    setShowOverwriteConfirm(false);
    void processUpload(pendingUploadFiles.map((file) => ({ file, name: file.name }))).catch((error) => {
      console.error('Failed to upload files:', error);
      alert(error instanceof Error ? error.message : 'Failed to save files');
    });
    setPendingUploadFiles([]);
    setDuplicateFiles([]);
  };

  const confirmRenameUpload = () => {
    setShowOverwriteConfirm(false);
    void processUpload(buildRenamedUploadItems(pendingUploadFiles)).catch((error) => {
      console.error('Failed to upload files:', error);
      alert(error instanceof Error ? error.message : 'Failed to save files');
    });
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
    void (async () => {
      try {
        await fetchOk(
          `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(deleteTarget)}`,
          { method: 'DELETE' },
          'Failed to delete file'
        );
        const updated = files.filter((file) => file.name !== deleteTarget);
        setFiles(updated);
        onFilesChange(updated);
      } catch (error) {
        console.error('Failed to delete file:', error);
        alert(error instanceof Error ? error.message : 'Failed to delete file');
      }
    })();
    setDeleteTarget(null);
  };

  const handleDeleteRequest = (fileName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(fileName);
  };

  const getFileExtension = (fileName: string): string =>
    fileName.split(".").pop()?.toLowerCase() || "";

  const isCsvFile = (file: LocalFile): boolean =>
    file.mimeType === "text/csv" || getFileExtension(file.name) === "csv";

  const isCodeFile = (file: LocalFile): boolean => ["py", "sh"].includes(getFileExtension(file.name));

  const isMarkdownFile = (file: LocalFile): boolean =>
    file.mimeType === "text/markdown" || file.mimeType === "text/x-markdown" || getFileExtension(file.name) === "md";

  const isPlainTextFile = (file: LocalFile): boolean =>
    file.mimeType === "text/plain" || ["txt", "text"].includes(getFileExtension(file.name));

  const isTextPreviewFile = (file: LocalFile): boolean =>
    isPlainTextFile(file) || isMarkdownFile(file) || isCsvFile(file) || isCodeFile(file);

  const isPreviewableFile = (file: LocalFile): boolean =>
    file.mimeType.startsWith("image/") || file.mimeType === "application/pdf" || isTextPreviewFile(file);

  const getFileIconConfig = (file: LocalFile): {
    icon: React.ReactNode;
    buttonClassName: string;
  } => {
    if (file.mimeType.startsWith("image/")) {
      return {
        icon: <PiFileImageDuotone size={20} />,
        buttonClassName: "text-emerald-300 hover:bg-emerald-500/10",
      };
    }

    if (file.mimeType === "application/pdf") {
      return {
        icon: <PiFilePdfDuotone size={20} />,
        buttonClassName: "text-rose-300 hover:bg-rose-500/10",
      };
    }

    if (isCsvFile(file)) {
      return {
        icon: <PiFileCsvDuotone size={20} />,
        buttonClassName: "text-amber-300 hover:bg-amber-500/10",
      };
    }

    if (isMarkdownFile(file)) {
      return {
        icon: <PiMarkdownLogoDuotone size={20} />,
        buttonClassName: "text-sky-300 hover:bg-sky-500/10",
      };
    }

    if (isCodeFile(file)) {
      return {
        icon: getFileExtension(file.name) === "sh" ? <PiTerminalDuotone size={20} /> : <PiFileCodeDuotone size={20} />,
        buttonClassName: "text-violet-300 hover:bg-violet-500/10",
      };
    }

    return {
      icon: <PiFileTextDuotone size={20} />,
      buttonClassName: "text-slate-300 hover:bg-white/6",
    };
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const parseCsv = (content: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;

    const normalized = content.replace(/^\uFEFF/, "");

    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      const nextChar = normalized[index + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            cell += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ",") {
        row.push(cell);
        cell = "";
        continue;
      }

      if (char === "\n" || char === "\r") {
        row.push(cell);
        cell = "";

        if (row.some((value) => value.length > 0)) {
          rows.push(row);
        }

        row = [];

        if (char === "\r" && nextChar === "\n") {
          index += 1;
        }
        continue;
      }

      cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
    }

    return rows;
  };

  const escapeHtml = (value: string): string =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const getCodeLanguage = (file: LocalFile): "python" | "bash" | null => {
    const extension = getFileExtension(file.name);

    if (extension === "py") return "python";
    if (extension === "sh") return "bash";
    return null;
  };

  const csvRows = previewTarget && isCsvFile(previewTarget) ? parseCsv(previewTextContent) : [];
  const csvHeader = csvRows[0] ?? [];
  const csvBody = csvRows.slice(1);
  const csvColumnCount = csvRows.reduce((max, row) => Math.max(max, row.length), 0);
  const codeLanguage = previewTarget && isCodeFile(previewTarget) ? getCodeLanguage(previewTarget) : null;
  const highlightedCodeLines =
    previewTarget && isCodeFile(previewTarget)
      ? (() => {
          const normalized = previewTextContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const highlighted =
            codeLanguage && Prism.languages[codeLanguage]
              ? Prism.highlight(normalized, Prism.languages[codeLanguage], codeLanguage)
              : escapeHtml(normalized);

          return highlighted.split("\n");
        })()
      : [];
  const isWidePreviewFile = previewTarget
    ? isMarkdownFile(previewTarget) || isCsvFile(previewTarget) || isCodeFile(previewTarget)
    : false;
  const sortedFiles = useMemo(() => {
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const sorted = [...files];

    sorted.sort((left, right) => {
      if (sortOption === "name") {
        return collator.compare(left.name, right.name);
      }

      if (sortOption === "extension") {
        const extensionCompare = collator.compare(getFileExtension(left.name), getFileExtension(right.name));
        if (extensionCompare !== 0) return extensionCompare;
        return collator.compare(left.name, right.name);
      }

      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return collator.compare(left.name, right.name);
    });

    return sorted;
  }, [files, sortOption]);

  const sortOptions: Array<{ value: SortOption; label: string }> = [
    { value: "extension", label: t("fileManager.sortByExtension") },
    { value: "uploadTime", label: t("fileManager.sortByUploadTime") },
    { value: "name", label: t("fileManager.sortByName") },
  ];

  const markdownComponents = {
    h1: ({ children }: React.PropsWithChildren) => <h1 className="text-3xl font-semibold text-white mb-4">{children}</h1>,
    h2: ({ children }: React.PropsWithChildren) => <h2 className="text-2xl font-semibold text-white mb-3 mt-6">{children}</h2>,
    h3: ({ children }: React.PropsWithChildren) => <h3 className="text-xl font-semibold text-white mb-3 mt-5">{children}</h3>,
    p: ({ children }: React.PropsWithChildren) => <p className="text-sm leading-7 text-gray-200 mb-4">{children}</p>,
    ul: ({ children }: React.PropsWithChildren) => <ul className="list-disc pl-6 mb-4 space-y-2 text-gray-200">{children}</ul>,
    ol: ({ children }: React.PropsWithChildren) => <ol className="list-decimal pl-6 mb-4 space-y-2 text-gray-200">{children}</ol>,
    li: ({ children }: React.PropsWithChildren) => <li className="text-sm leading-7">{children}</li>,
    blockquote: ({ children }: React.PropsWithChildren) => (
      <blockquote className="border-l-4 border-blue-400/60 pl-4 italic text-gray-300 mb-4">{children}</blockquote>
    ),
    a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline underline-offset-2 hover:text-blue-200">
        {children}
      </a>
    ),
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const codeText = React.Children.toArray(children).join("");
      const isBlockCode = Boolean(className?.includes("language-")) || codeText.includes("\n");

      return isBlockCode ? (
        <code className={`font-mono text-sm text-gray-100 ${className ?? ""}`.trim()}>{children}</code>
      ) : (
        <code className="px-1.5 py-0.5 rounded bg-white/8 text-emerald-300 font-mono text-[0.9em]">{children}</code>
      );
    },
    pre: ({ children }: React.PropsWithChildren) => (
      <pre className="mb-4 overflow-x-auto rounded-lg bg-[#0b0d12] p-4">{children}</pre>
    ),
    hr: () => <hr className="my-6 border-border" />,
    table: ({ children }: React.PropsWithChildren) => (
      <div className="mb-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm text-gray-200">{children}</table>
      </div>
    ),
    thead: ({ children }: React.PropsWithChildren) => <thead className="bg-white/5">{children}</thead>,
    th: ({ children }: React.PropsWithChildren) => <th className="border border-border px-3 py-2 text-left font-semibold text-white">{children}</th>,
    td: ({ children }: React.PropsWithChildren) => <td className="border border-border px-3 py-2 align-top">{children}</td>,
  };

  useEffect(() => {
    if (!previewTarget || !isTextPreviewFile(previewTarget)) {
      setPreviewTextContent("");
      setPreviewTextError(null);
      setPreviewTextLoading(false);
      return;
    }

    const controller = new AbortController();

    setPreviewTextLoading(true);
    setPreviewTextError(null);
    setPreviewTextContent("");

    void (async () => {
      try {
        const response = await fetchOk(
          previewTarget.url,
          { signal: controller.signal },
          "Failed to load text preview"
        );
        const text = await response.text();

        if (!controller.signal.aborted) {
          setPreviewTextContent(text);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreviewTextError(error instanceof Error ? error.message : "Failed to load text preview");
      } finally {
        if (!controller.signal.aborted) {
          setPreviewTextLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [previewTarget]);

  return (
    <div className="flex flex-col h-full bg-background text-gray-200 relative">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="h-10 flex items-center">
          <h2 className="font-semibold text-lg">{t('fileManager.sources')}</h2>
        </div>
        <div className="relative" ref={sortMenuRef}>
          <button
            type="button"
            onClick={() => setShowSortMenu((open) => !open)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-gray-300 hover:text-white hover:bg-panel transition-colors"
            title={t('fileManager.sortFiles')}
          >
            <ArrowUpDown size={16} />
            <ChevronDown size={14} className={`transition-transform ${showSortMenu ? "rotate-180" : ""}`} />
          </button>

          {showSortMenu && (
            <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-border bg-panel shadow-2xl overflow-hidden z-20">
              <div className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-gray-500 border-b border-border">
                {t('fileManager.sortFiles')}
              </div>
              <div className="p-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSortOption(option.value);
                      setShowSortMenu(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      sortOption === option.value
                        ? "bg-blue-600/15 text-blue-300"
                        : "text-gray-300 hover:bg-white/6 hover:text-white"
                    }`}
                  >
                    <span>{option.label}</span>
                    {sortOption === option.value ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
        <label
          className="flex items-center justify-center gap-2 w-full py-2.5 border border-border rounded-full text-sm font-medium cursor-pointer hover:bg-panel transition-colors"
        >
          <Plus size={16} />
          <span>{t('fileManager.addSources')}</span>
          <input
            type="file"
            className="hidden"
            onChange={handleUpload}
            multiple
            accept=".png,.jpeg,.jpg,.svg,.pdf,.txt,.text,.csv,.md,.py,.sh"
          />
        </label>

        {/* URL Source Input */}
        <div className="space-y-2">
          <div className="flex gap-1.5">
            <input
              type="url"
              placeholder={t('fileManager.urlPlaceholder')}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isAddingUrl) { e.preventDefault(); handleAddUrl(); } }}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors min-w-0"
              disabled={isAddingUrl}
            />
            <button
              onClick={handleAddUrl}
              disabled={isAddingUrl || !urlInput.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
            >
              {isAddingUrl ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
              <span>{isAddingUrl ? t('fileManager.fetchingUrl') : t('fileManager.addUrl')}</span>
            </button>
          </div>
          {urlError && (
            <p className="text-xs text-red-400 px-1">{urlError}</p>
          )}
        </div>

        {/* URL Sources List */}
        {urls.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1">{t('fileManager.urlSources')}</p>
            {urls.map((u) => (
              <div
                key={u.id}
                className="group flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-panel transition-colors cursor-pointer"
                onClick={() => setPreviewUrlTarget(u)}
              >
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Globe size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate" title={u.title}>{u.title}</p>
                  <p className="text-[10px] text-gray-500 truncate" title={u.url}>{new URL(u.url).hostname}</p>
                  <p className="text-[10px] text-gray-600">{u.charCount.toLocaleString()} {t('fileManager.urlChars')}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {deleteUrlTarget === u.id ? (
                    <>
                      <button onClick={() => handleDeleteUrl(u.id)} className="p-1.5 text-green-400 hover:bg-green-900/20 rounded-lg transition-colors" title={t('common.confirm')}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => setDeleteUrlTarget(null)} className="p-1.5 text-gray-400 hover:bg-gray-700 rounded-lg transition-colors" title={t('common.cancel')}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleRefreshUrl(u.id)}
                        disabled={refreshingUrlId === u.id}
                        className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Refresh"
                      >
                        <RefreshCw size={14} className={refreshingUrlId === u.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => setDeleteUrlTarget(u.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title={t('fileManager.deleteFile')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {files.length === 0 && urls.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              {t('fileManager.noSources')}
            </div>
          ) : (<>
            {files.length > 0 && (
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-1">{t('fileManager.fileSources')}</p>
            )}
            {sortedFiles.map((file) => (
              (() => {
                const iconConfig = getFileIconConfig(file);

                return (
                  <div
                    key={file.name}
                    onMouseEnter={() => setHoveredFileName(file.name)}
                    onMouseLeave={() => {
                      if (hoveredFileName === file.name) setHoveredFileName(null);
                      if (deleteTarget === file.name) setDeleteTarget(null);
                    }}
                    className="group flex items-center gap-3 p-3 rounded-xl hover:bg-panel transition-colors"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewTarget(file);
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        hoveredFileName === file.name
                          ? "bg-blue-600/15 text-blue-400 hover:bg-blue-600/25"
                          : iconConfig.buttonClassName
                      }`}
                      title={t('fileManager.previewFile')}
                    >
                      {hoveredFileName === file.name ? <ZoomIn size={16} /> : iconConfig.icon}
                    </button>
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
                );
              })()
            ))}
          </>)}
        </div>
      </div>

      {/* Overwrite Confirmation Modal */}
      {showOverwriteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
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
                onClick={confirmRenameUpload}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-colors"
              >
                {t('fileManager.keepBoth')}
              </button>
              <button
                onClick={confirmOverwriteUpload}
                className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-medium transition-colors"
              >
                {t('fileManager.overwrite')}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPreviewTarget(null)}
        >
          <div
            className={`w-full bg-panel border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col ${
              isWidePreviewFile ? "max-w-[96rem] h-[88vh]" : "max-w-5xl h-[80vh]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border bg-black/20">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white truncate">{previewTarget.name}</h3>
                <p className="text-xs text-gray-400">
                  {previewTarget.mimeType} • {formatSize(previewTarget.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTarget(null)}
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                title={t('common.cancel')}
              >
                <X size={18} />
              </button>
            </div>

            <div
              className={`flex-1 bg-[#0b0d12] p-4 overflow-hidden ${
                isWidePreviewFile ? "min-h-0" : "flex items-center justify-center"
              }`}
            >
              {previewTarget.mimeType.startsWith("image/") ? (
                <img
                  src={previewTarget.url}
                  alt={previewTarget.name}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                />
              ) : previewTarget.mimeType === "application/pdf" ? (
                <iframe
                  title={previewTarget.name}
                  src={previewTarget.url}
                  className="w-full h-full rounded-lg bg-white"
                />
              ) : isCsvFile(previewTarget) ? (
                <div className="w-full h-full min-h-0 rounded-lg border border-border bg-[#10141c] overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border text-xs uppercase tracking-[0.18em] text-gray-400">
                    <span>{t('fileManager.tableView')}</span>
                    {!previewTextLoading && !previewTextError && csvRows.length > 0 ? (
                      <span>{csvBody.length} {t('fileManager.rowsLabel')} • {csvColumnCount} {t('fileManager.columnsLabel')}</span>
                    ) : null}
                  </div>
                  {previewTextLoading ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                      {t('common.loading')}
                    </div>
                  ) : previewTextError ? (
                    <div className="flex-1 flex items-center justify-center px-6 text-sm text-red-300 text-center">
                      {previewTextError}
                    </div>
                  ) : csvRows.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center px-6 text-sm text-gray-400 text-center">
                      {t('fileManager.emptyCsvPreview')}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto custom-scrollbar">
                      <table className="min-w-full border-collapse text-sm text-gray-200">
                        <thead className="sticky top-0 z-10 bg-[#141922]">
                          <tr>
                            {Array.from({ length: csvColumnCount }, (_, index) => (
                              <th
                                key={`header-${index}`}
                                className="border-b border-r border-border px-4 py-3 text-left font-semibold text-white whitespace-pre-wrap break-words min-w-40"
                              >
                                {csvHeader[index] || `Column ${index + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvBody.map((row, rowIndex) => (
                            <tr key={`row-${rowIndex}`} className="odd:bg-white/[0.02]">
                              {Array.from({ length: csvColumnCount }, (_, columnIndex) => (
                                <td
                                  key={`cell-${rowIndex}-${columnIndex}`}
                                  className="align-top border-b border-r border-border px-4 py-3 whitespace-pre-wrap break-words min-w-40"
                                >
                                  {row[columnIndex] || ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : isCodeFile(previewTarget) ? (
                <div className="w-full h-full min-h-0 rounded-lg border border-border bg-[#10141c] overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border text-xs uppercase tracking-[0.18em] text-gray-400">
                    <span>{t('fileManager.codeView')}</span>
                    {!previewTextLoading && !previewTextError && codeLanguage ? (
                      <span>{codeLanguage.toUpperCase()}</span>
                    ) : null}
                  </div>
                  {previewTextLoading ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                      {t('common.loading')}
                    </div>
                  ) : previewTextError ? (
                    <div className="flex-1 flex items-center justify-center px-6 text-sm text-red-300 text-center">
                      {previewTextError}
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto custom-scrollbar bg-[#0b0d12]">
                      <div className="min-w-max text-sm leading-6">
                        {highlightedCodeLines.map((lineHtml, index) => (
                          <div
                            key={`code-line-${index}`}
                            className="grid grid-cols-[4rem_minmax(0,1fr)] border-b border-white/[0.04] last:border-b-0"
                          >
                            <div className="sticky left-0 z-10 bg-[#0f131b] px-3 py-0.5 text-right text-xs text-gray-500 select-none border-r border-border">
                              {index + 1}
                            </div>
                            <div
                              className="px-4 py-0.5 whitespace-pre font-mono text-gray-100"
                              dangerouslySetInnerHTML={{ __html: lineHtml || "&nbsp;" }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : isMarkdownFile(previewTarget) ? (
                <div className="w-full h-full min-h-0 grid grid-cols-2 gap-4">
                  <div className="min-h-0 rounded-lg border border-border bg-[#10141c] overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-border text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                      {t('fileManager.rawView')}
                    </div>
                    {previewTextLoading ? (
                      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        {t('common.loading')}
                      </div>
                    ) : previewTextError ? (
                      <div className="flex-1 flex items-center justify-center px-6 text-sm text-red-300 text-center">
                        {previewTextError}
                      </div>
                    ) : (
                      <pre className="flex-1 overflow-auto custom-scrollbar p-5 text-sm leading-6 text-gray-200 whitespace-pre-wrap break-words font-mono">
                        {previewTextContent}
                      </pre>
                    )}
                  </div>

                  <div className="min-h-0 rounded-lg border border-border bg-[#10141c] overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-border text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                      {t('fileManager.renderedView')}
                    </div>
                    {previewTextLoading ? (
                      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                        {t('common.loading')}
                      </div>
                    ) : previewTextError ? (
                      <div className="flex-1 flex items-center justify-center px-6 text-sm text-red-300 text-center">
                        {previewTextError}
                      </div>
                    ) : (
                      <div className="flex-1 overflow-auto custom-scrollbar px-6 py-5 text-gray-100">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {previewTextContent}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ) : isPlainTextFile(previewTarget) ? (
                <div className="w-full h-full rounded-lg border border-border bg-[#10141c] overflow-hidden">
                  {previewTextLoading ? (
                    <div className="h-full flex items-center justify-center text-sm text-gray-400">
                      {t('common.loading')}
                    </div>
                  ) : previewTextError ? (
                    <div className="h-full flex items-center justify-center px-6 text-sm text-red-300 text-center">
                      {previewTextError}
                    </div>
                  ) : (
                    <pre className="w-full h-full overflow-auto custom-scrollbar p-5 text-sm leading-6 text-gray-200 whitespace-pre-wrap break-words font-mono">
                      {previewTextContent}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="text-center text-gray-400 space-y-2">
                  <div className="mx-auto w-14 h-14 rounded-full bg-white/5 flex items-center justify-center text-gray-500">
                    <FileText size={24} />
                  </div>
                  <p className="text-sm font-medium">{t('fileManager.previewUnavailableTitle')}</p>
                  <p className="text-xs text-gray-500">{t('fileManager.previewUnavailableMessage')}</p>
                  {!isPreviewableFile(previewTarget) && (
                    <button
                      type="button"
                      onClick={() => window.open(previewTarget.url, '_blank', 'noopener,noreferrer')}
                      className="mt-2 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm transition-colors"
                    >
                      {t('fileManager.openInNewTab')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* URL Source Preview Modal */}
      {previewUrlTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setPreviewUrlTarget(null)}
        >
          <div
            className="w-full max-w-5xl h-[80vh] bg-panel border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border bg-black/20">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-white truncate">{previewUrlTarget.title}</h3>
                <p className="text-xs text-gray-400 truncate">
                  <a
                    href={previewUrlTarget.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-400 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {previewUrlTarget.url}
                  </a>
                  {' '}• {previewUrlTarget.charCount.toLocaleString()} {t('fileManager.urlChars')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewUrlTarget(null)}
                className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar bg-[#0b0d12]">
              <pre className="p-5 text-sm leading-6 text-gray-200 whitespace-pre-wrap break-words font-mono">
                {previewUrlTarget.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

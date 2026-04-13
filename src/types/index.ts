// ============================================================
// Core Domain Types
// ============================================================

export type AIProvider = 'gemini' | 'claude' | 'openai' | 'kimi' | 'zhipu' | 'qwen';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  hasStoredApiKey: boolean;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  last_accessed_at: string;
}

// ============================================================
// Chat & AI Types
// ============================================================

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimatedPrice: string;
}

export interface ChatAttachment {
  name: string;
  dataUrl: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  usage?: ChatUsage;
  attachments?: ChatAttachment[];
}

export interface GenerateSlidesResponse {
  content: string;
  chatText: string;
  usage: ChatUsage;
}

export interface FileSnapshot {
  name: string;
  mimeType: string;
  size: number;
}

export interface ConversationContext {
  summary: string;
  fileSnapshot: FileSnapshot[];
}

// ============================================================
// Search & Analytics Agent Types
// ============================================================

export interface SearchPlanResult {
  needsSearch: boolean;
  needsContext: boolean;
  needsAnalysis: boolean;
  queries: string[];
  reasoning: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    thinkingTokens: number;
  };
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchResult {
  results: SearchResultItem[];
  answer?: string;
  error?: string;
}

export interface DataFileSchema {
  fileName: string;
  columns: string[];
  rowCount: number;
  sampleRows: Record<string, any>[];
  fileSize: number;
}

export interface AnalysisResult {
  tables: Array<{
    title: string;
    headers: string[];
    rows: (string | number)[][];
  }>;
  charts: Array<{
    title: string;
    type: 'bar' | 'line' | 'pie' | 'doughnut' | 'radar';
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
    }>;
  }>;
  insights: string[];
  error?: string;
}

// ============================================================
// Version Control Types
// ============================================================

export interface VersionState {
  id: string;
  name: string;
  path: string;
  chat_path: string;
  save_time: string;
  is_auto: boolean;
}

export interface SlideInfo {
  states: VersionState[];
  auto_states: VersionState[];
  current_state: string;
  selectedProvider?: AIProvider;
}

export interface LoadedContent {
  html: string;
  chat: ChatMessage[];
  context: ConversationContext | null;
}

// ============================================================
// Storage / File Types
// ============================================================

export interface StorageFile {
  id: string;
  name: string;
  created_at: string;
  metadata: {
    mimetype: string;
    size: number;
  };
}

export interface LocalFile {
  name: string;
  mimeType: string;
  size: number;
  url: string;
  created_at?: string;
}

export interface UrlSource {
  id: string;
  url: string;
  title: string;
  content: string;
  snippet: string;
  charCount: number;
  fetchedAt: string;
}

// ============================================================
// UI State Types
// ============================================================

export interface Toast {
  show: boolean;
  message: string;
  type: 'success' | 'error';
}

export type ViewMode = 'preview' | 'editor' | 'code' | 'history';
export type CurrentView = 'dashboard' | 'project';
export type Language = 'en' | 'zh';

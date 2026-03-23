// ============================================================
// Core Domain Types
// ============================================================

export type AIProvider = 'gemini' | 'claude' | 'gpt';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
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
  totalTokens: number;
  estimatedPrice: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  usage?: ChatUsage;
}

export interface GenerateSlidesResponse {
  content: string;
  usage: ChatUsage;
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
}

export interface LoadedContent {
  html: string;
  chat: ChatMessage[];
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
  dataUrl: string;
  mimeType: string;
  size: number;
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

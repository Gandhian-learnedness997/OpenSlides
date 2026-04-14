import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PDFParse } from 'pdf-parse';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const ROOT_DIR = path.join(__dirname, '..');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');
const PROJECTS_META_PATH = path.join(PROJECTS_DIR, '_projects.json');
const SETTINGS_PATH = path.join(ROOT_DIR, 'config', 'settings.json');
const PRICING_PATH = path.join(ROOT_DIR, 'config', 'pricing.json');
const SAFE_PROJECT_ID_REGEX = /^[a-z0-9][a-z0-9-]{2,63}$/;
const STATE_ID_REGEX = /^(?:state|auto)_\d+$/;
const ASSETS_DIRNAME = 'assets';
const PDF_IMAGE_RENDER_SCALE = Number(process.env.PDF_IMAGE_RENDER_SCALE || 1.5);
const PDF_IMAGE_RENDER_LIMIT = Number(process.env.PDF_IMAGE_RENDER_LIMIT || 24);
const execFileAsync = promisify(execFile);


// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));

// ============================================================
// AI Generation Proxy
// ============================================================

const DEFAULT_BASE_URLS = {
  gemini: 'https://generativelanguage.googleapis.com',
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  kimi: 'https://api.kimi.com/coding/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  minimax: 'https://api.minimax.chat/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

const FILE_INTRO_TEXT = 'Here are the uploaded reference files. Use their content to create the presentation:';
const FILE_ACK_TEXT = 'I have received and reviewed all uploaded files. I will use their content for the presentation. Please provide your instructions.';
const GEMINI_CACHE_TTL_SECONDS = 14400; // 4 hours
const GEMINI_FILE_POLL_INTERVAL_MS = 1500;
const GEMINI_FILE_POLL_TIMEOUT_MS = 60000;
const GEMINI_GENERATE_TIMEOUT_MS = 300000;
const GEMINI_RETRY_DELAY_MS = 1200;
const GEMINI_MAX_RETRIES = 3;
const OPENAI_COMPATIBLE_TIMEOUT_MS = Number(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || 600000);
const SUPPORTED_PROVIDERS = new Set(Object.keys(DEFAULT_BASE_URLS));

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readJsonFile(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function isSafeProjectId(projectId) {
  return typeof projectId === 'string' && SAFE_PROJECT_ID_REGEX.test(projectId);
}

function assertSafeProjectId(projectId) {
  if (!isSafeProjectId(projectId)) {
    throw createHttpError(400, 'Invalid project id');
  }
  return projectId;
}

function normalizeProjectName(name, fallback = 'Untitled Project') {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || fallback;
}

function validateProjectName(name) {
  const normalized = normalizeProjectName(name, '');
  if (!normalized) {
    throw createHttpError(400, 'Project name is required');
  }
  if (normalized.length > 120) {
    throw createHttpError(400, 'Project name is too long');
  }
  return normalized;
}

function slugifyProjectName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'project').slice(0, 48);
}

function createProjectId(name, usedIds = new Set()) {
  const base = slugifyProjectName(name);
  if (SAFE_PROJECT_ID_REGEX.test(base) && !usedIds.has(base)) {
    return base;
  }

  let candidate = '';
  do {
    const suffix = crypto.randomBytes(3).toString('hex');
    candidate = `${base.slice(0, 57)}-${suffix}`;
  } while (usedIds.has(candidate) || !SAFE_PROJECT_ID_REGEX.test(candidate));

  return candidate;
}

function loadProjectsMeta() {
  const projects = readJsonFile(PROJECTS_META_PATH, []);
  return Array.isArray(projects) ? projects : [];
}

function saveProjectsMeta(projects) {
  writeJsonFile(PROJECTS_META_PATH, projects);
}

function getLegacyProjectDir(projectId) {
  if (typeof projectId !== 'string' || !projectId) return null;
  const resolved = path.resolve(PROJECTS_DIR, projectId);
  return resolved.startsWith(`${PROJECTS_DIR}${path.sep}`) ? resolved : null;
}

function getProject(projectId) {
  const safeProjectId = assertSafeProjectId(projectId);
  return loadProjectsMeta().find((project) => project.id === safeProjectId) || null;
}

function requireProject(projectId) {
  const project = getProject(projectId);
  if (!project) {
    throw createHttpError(404, 'Project not found');
  }
  return project;
}

function validateStateId(stateId) {
  if (typeof stateId !== 'string' || !STATE_ID_REGEX.test(stateId)) {
    throw createHttpError(400, 'Invalid state id');
  }
  return stateId;
}

function sanitizeDisplayFileName(name) {
  const normalized = path.basename(normalizeProjectName(name, ''));
  const safeName = normalized.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim();
  if (!safeName) {
    throw createHttpError(400, 'Invalid file name');
  }
  return safeName.slice(0, 200);
}

function getProjectFilesPath(projectId) {
  return path.join(getProjectDir(projectId), 'files.json');
}

function getProjectAssetsDir(projectId) {
  return path.join(getProjectDir(projectId), ASSETS_DIRNAME);
}

function getProjectAssetPath(projectId, assetName) {
  const safeAssetName = path.basename(assetName || '');
  const assetPath = path.resolve(getProjectAssetsDir(projectId), safeAssetName);
  const assetsDir = path.resolve(getProjectAssetsDir(projectId));
  if (!assetPath.startsWith(`${assetsDir}${path.sep}`)) {
    throw createHttpError(400, 'Invalid asset path');
  }
  return assetPath;
}

function createStoredAssetName(fileName) {
  const extension = path.extname(fileName || '').toLowerCase().replace(/[^.\w-]/g, '').slice(0, 20);
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
}

function parseDataUrl(dataUrl) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:([^;]+);base64,(.+)$/) : null;
  if (!match) {
    throw createHttpError(400, 'Invalid file data');
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function sanitizeIncomingUploadFiles(files) {
  if (!Array.isArray(files)) {
    throw createHttpError(400, 'Files payload must be an array');
  }

  return files.map((file, index) => {
    const name = sanitizeDisplayFileName(file?.name);
    if (!name) {
      throw createHttpError(400, `File ${index + 1} is missing a name`);
    }

    const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl : '';
    if (!/^data:[^;]+;base64,/.test(dataUrl)) {
      throw createHttpError(400, `File ${name} has invalid data`);
    }

    return {
      name,
      dataUrl,
      mimeType: typeof file?.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
      size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
    };
  });
}

function isLegacyStoredFile(file) {
  return typeof file?.dataUrl === 'string';
}

function normalizeStoredFileEntry(file) {
  if (!file || typeof file !== 'object') return null;
  const name = sanitizeDisplayFileName(file.name);
  const assetPath = path.basename(typeof file.assetPath === 'string' ? file.assetPath : '');
  if (!assetPath) {
    throw createHttpError(500, `Stored asset is missing for ${name}`);
  }
  return {
    name,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
    size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
    created_at: typeof file.created_at === 'string' && file.created_at ? file.created_at : new Date().toISOString(),
    assetPath,
  };
}

function buildPublicFileRecord(projectId, file) {
  return {
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    created_at: file.created_at,
    url: `/api/projects/${encodeURIComponent(projectId)}/file/${encodeURIComponent(file.name)}`,
  };
}

function removeAssetIfPresent(projectId, assetName) {
  if (!assetName) return;
  const assetPath = getProjectAssetPath(projectId, assetName);
  if (fs.existsSync(assetPath)) {
    fs.unlinkSync(assetPath);
  }
}

function loadStoredProjectFiles(projectId) {
  const filesPath = getProjectFilesPath(projectId);
  if (!fs.existsSync(filesPath)) return [];

  const rawFiles = readJsonFile(filesPath, []);
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];

  let migrated = false;
  const normalizedFiles = rawFiles.map((file) => {
    if (isLegacyStoredFile(file)) {
      const legacyName = sanitizeDisplayFileName(file.name);
      const { mimeType, buffer } = parseDataUrl(file.dataUrl);
      const assetName = createStoredAssetName(legacyName);
      const assetPath = getProjectAssetPath(projectId, assetName);
      fs.writeFileSync(assetPath, buffer);
      migrated = true;
      return {
        name: legacyName,
        mimeType: typeof file.mimeType === 'string' ? file.mimeType : mimeType,
        size: Number.isFinite(Number(file.size)) && Number(file.size) > 0 ? Number(file.size) : buffer.length,
        created_at: typeof file.created_at === 'string' && file.created_at ? file.created_at : new Date().toISOString(),
        assetPath: assetName,
      };
    }

    return normalizeStoredFileEntry(file);
  }).filter(Boolean);

  if (migrated) {
    writeJsonFile(filesPath, normalizedFiles);
  }

  return normalizedFiles;
}

function saveStoredProjectFiles(projectId, files) {
  writeJsonFile(getProjectFilesPath(projectId), files);
}

function upsertProjectFiles(projectId, incomingFiles) {
  const sanitizedFiles = sanitizeIncomingUploadFiles(incomingFiles);
  const existingFiles = loadStoredProjectFiles(projectId);
  const nextFiles = [...existingFiles];

  for (const incomingFile of sanitizedFiles) {
    const { mimeType, buffer } = parseDataUrl(incomingFile.dataUrl);
    const assetName = createStoredAssetName(incomingFile.name);
    const assetPath = getProjectAssetPath(projectId, assetName);
    fs.writeFileSync(assetPath, buffer);

    const nextEntry = {
      name: incomingFile.name,
      mimeType: incomingFile.mimeType || mimeType,
      size: incomingFile.size > 0 ? incomingFile.size : buffer.length,
      created_at: new Date().toISOString(),
      assetPath: assetName,
    };

    const existingIndex = nextFiles.findIndex((file) => file.name === incomingFile.name);
    if (existingIndex >= 0) {
      removeAssetIfPresent(projectId, nextFiles[existingIndex].assetPath);
      nextFiles[existingIndex] = nextEntry;
    } else {
      nextFiles.push(nextEntry);
    }
  }

  saveStoredProjectFiles(projectId, nextFiles);
  return nextFiles;
}

function deleteStoredProjectFile(projectId, fileName) {
  const normalizedName = sanitizeDisplayFileName(fileName);
  const existingFiles = loadStoredProjectFiles(projectId);
  const target = existingFiles.find((file) => file.name === normalizedName);
  if (!target) {
    throw createHttpError(404, 'File not found');
  }

  removeAssetIfPresent(projectId, target.assetPath);
  saveStoredProjectFiles(projectId, existingFiles.filter((file) => file.name !== normalizedName));
}

function loadProjectFilesForAI(projectId) {
  if (!getProject(projectId)) return [];

  return loadStoredProjectFiles(projectId).filter(shouldAttachFileToGeneration).map((file) => {
    const buffer = fs.readFileSync(getProjectAssetPath(projectId, file.assetPath));
    return {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      dataUrl: `data:${file.mimeType};base64,${buffer.toString('base64')}`,
    };
  });
}

// ============================================================
// Data Analytics Agent — Schema Extraction
// ============================================================

function isDataFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ['.csv', '.xlsx', '.xls'].includes(ext);
}

function shouldAttachFileToGeneration(file) {
  return !isDataFile(file.name);
}

function getDataFileSchemas(projectId) {
  const files = loadStoredProjectFiles(projectId);
  const dataFiles = files.filter(f => isDataFile(f.name));
  const schemas = [];

  for (const file of dataFiles) {
    try {
      const filePath = getProjectAssetPath(projectId, file.assetPath);
      const buffer = fs.readFileSync(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet);

      if (jsonData.length === 0) continue;

      schemas.push({
        fileName: file.name,
        assetPath: file.assetPath,
        columns: Object.keys(jsonData[0]),
        rowCount: jsonData.length,
        sampleRows: jsonData.slice(0, 5),
        fileSize: file.size,
      });
    } catch (err) {
      console.warn(`  [schema] Failed to parse ${file.name}: ${err.message}`);
    }
  }

  return schemas;
}

function getDataFileSummaries(projectId) {
  return loadStoredProjectFiles(projectId)
    .filter((file) => isDataFile(file.name))
    .map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
    }));
}

function loadSettings() {
  const settings = readJsonFile(SETTINGS_PATH, {});
  // Migrate legacy flat format to per-provider format
  if (settings.apiKey && !settings.providers) {
    const legacyProvider = SUPPORTED_PROVIDERS.has(settings.provider) ? settings.provider : 'gemini';
    settings.providers = {
      [legacyProvider]: {
        apiKey: settings.apiKey,
        model: settings.model || '',
        baseUrl: settings.baseUrl || '',
      },
    };
    settings.activeProvider = legacyProvider;
    delete settings.apiKey;
    delete settings.model;
    delete settings.baseUrl;
    writeJsonFile(SETTINGS_PATH, settings);
  }
  return {
    activeProvider: SUPPORTED_PROVIDERS.has(settings.activeProvider) ? settings.activeProvider : 'gemini',
    providers: settings.providers || {},
    tavilyApiKey: settings.tavilyApiKey || '',
  };
}

function getDefaultModel(provider) {
  const defaults = {
    gemini: 'gemini-3.1-pro-preview',
    claude: 'claude-sonnet-4.6',
    openai: 'gpt-5.4',
    kimi: 'kimi-k2.5',
    zhipu: 'GLM-5',
    qwen: 'qwen3.5-plus',
  };
  return defaults[provider] || 'gpt-5.4';
}

function getProviderConfig(settings, provider) {
  const cfg = settings.providers?.[provider] || {};
  return {
    apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
    model: typeof cfg.model === 'string' ? cfg.model.trim() : '',
    baseUrl: typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '',
  };
}

function sanitizeBaseUrl(baseUrl, provider) {
  const normalized = (baseUrl || DEFAULT_BASE_URLS[provider] || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw createHttpError(400, 'Base URL is required');
  }

  try {
    new URL(normalized);
  } catch {
    throw createHttpError(400, 'Invalid base URL');
  }

  return normalized;
}

function migrateLegacyProjects() {
  const projects = loadProjectsMeta();
  if (projects.length === 0) return;

  let changed = false;
  const usedIds = new Set();
  const now = new Date().toISOString();
  const migratedProjects = projects.map((project) => {
    const name = normalizeProjectName(project?.name, normalizeProjectName(project?.id, 'Untitled Project'));
    const createdAt = typeof project?.created_at === 'string' && project.created_at ? project.created_at : now;
    const lastAccessedAt = typeof project?.last_accessed_at === 'string' && project.last_accessed_at ? project.last_accessed_at : createdAt;
    const nextId = isSafeProjectId(project?.id) && !usedIds.has(project.id)
      ? project.id
      : createProjectId(name, usedIds);

    usedIds.add(nextId);

    if (project?.id !== nextId || project?.name !== name || project?.created_at !== createdAt || project?.last_accessed_at !== lastAccessedAt) {
      changed = true;
    }

    const legacyDir = getLegacyProjectDir(project?.id);
    const nextDir = path.join(PROJECTS_DIR, nextId);
    if (legacyDir && legacyDir !== nextDir && fs.existsSync(legacyDir) && !fs.existsSync(nextDir)) {
      fs.renameSync(legacyDir, nextDir);
    }
    ensureProjectDir(nextId);

    return {
      id: nextId,
      name,
      created_at: createdAt,
      last_accessed_at: lastAccessedAt,
    };
  });

  if (changed) {
    saveProjectsMeta(migratedProjects);
  }
}

function isNativeOpenAIBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl || DEFAULT_BASE_URLS.openai);
    return url.hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function shouldConvertPdfToImagesForOpenAICompatible(provider, baseUrl) {
  if (provider === 'claude' || provider === 'gemini') return false;
  if (provider === 'openai' && isNativeOpenAIBaseUrl(baseUrl)) return false;
  return true;
}

function getBase64FromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
}

async function renderPdfBase64ToPngFiles(base64Data, namePrefix = 'document') {
  if (!base64Data) return [];

  const parser = new PDFParse({ data: Buffer.from(base64Data, 'base64') });
  try {
    const screenshot = await parser.getScreenshot({
      scale: PDF_IMAGE_RENDER_SCALE,
      first: 1,
      last: PDF_IMAGE_RENDER_LIMIT,
    });

    return (screenshot.pages || [])
      .filter((page) => page?.data)
      .map((page, index) => {
        const buffer = Buffer.from(page.data);
        return {
          name: `${namePrefix} page ${index + 1}.png`,
          mimeType: 'image/png',
          size: buffer.length,
          dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
          data: buffer.toString('base64'),
        };
      });
  } finally {
    parser.destroy();
  }
}

async function convertProjectPdfsToImagesForOpenAICompatible(files) {
  if (!Array.isArray(files) || files.length === 0) return files;

  const converted = [];
  for (const file of files) {
    if (file.mimeType !== 'application/pdf') {
      converted.push(file);
      continue;
    }

    try {
      const pageImages = await renderPdfBase64ToPngFiles(getBase64FromDataUrl(file.dataUrl), file.name || 'document');
      converted.push(...pageImages);
      console.log(`  [pdf-image] ${file.name || 'PDF'}: rendered ${pageImages.length} page image(s)`);
    } catch (error) {
      console.warn(`  [pdf-image] Failed to render ${file.name || 'PDF'}: ${error.message}`);
    }
  }

  return converted;
}

async function convertInlinePdfsToImagesForOpenAICompatible(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const convertedMessages = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.files) || msg.files.length === 0) {
      convertedMessages.push(msg);
      continue;
    }

    const convertedFiles = [];
    for (const file of msg.files) {
      if (file.mimeType !== 'application/pdf') {
        convertedFiles.push(file);
        continue;
      }

      try {
        const pageImages = await renderPdfBase64ToPngFiles(file.data, file.name || 'attached PDF');
        convertedFiles.push(...pageImages.map((page) => ({
          name: page.name,
          mimeType: page.mimeType,
          data: page.data,
        })));
        console.log(`  [pdf-image] inline ${file.name || 'PDF'}: rendered ${pageImages.length} page image(s)`);
      } catch (error) {
        console.warn(`  [pdf-image] Failed to render inline ${file.name || 'PDF'}: ${error.message}`);
      }
    }

    convertedMessages.push({ ...msg, files: convertedFiles });
  }

  return convertedMessages;
}

app.post('/api/generate', async (req, res) => {
  const settings = loadSettings();
  const provider = typeof req.body.provider === 'string' && SUPPORTED_PROVIDERS.has(req.body.provider)
    ? req.body.provider
    : settings.activeProvider;
  const providerCfg = getProviderConfig(settings, provider);
  const model = typeof req.body.model === 'string' && req.body.model.trim()
    ? req.body.model.trim()
    : (providerCfg.model || getDefaultModel(provider));
  const projectId = typeof req.body.projectId === 'string' && isSafeProjectId(req.body.projectId)
    ? req.body.projectId
    : 'default-project';
  const apiKey = providerCfg.apiKey;
  const system = typeof req.body.system === 'string' ? req.body.system : '';
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const temperature = Number.isFinite(Number(req.body.temperature)) ? Number(req.body.temperature) : 0.7;
  const files = loadProjectFilesForAI(projectId);

  const msgSummary = messages.map(m => `${m.role}(${(m.content || '').length} chars)`).join(', ');
  console.log(`\n\x1b[36m━━━ [Generation Agent] ━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
  console.log(`  Provider:    ${provider}`);
  console.log(`  Model:       ${model}`);
  console.log(`  Project:     ${projectId}`);
  console.log(`  Temperature: ${temperature}`);
  console.log(`  Messages:    ${messages.length} [${msgSummary}]`);
  console.log(`  Files:       ${files.length} project file(s)`);

  if (!SUPPORTED_PROVIDERS.has(provider)) {
    console.log(`  \x1b[31m✗ Unsupported provider\x1b[0m`);
    return res.status(400).json({ error: 'Unsupported provider' });
  }

  if (!apiKey) {
    console.log(`  \x1b[31m✗ No API key for ${provider}\x1b[0m`);
    return res.status(400).json({ error: `No API key configured for ${provider}. Please set it in Settings.` });
  }

  let base;
  try {
    base = sanitizeBaseUrl(providerCfg.baseUrl || (typeof req.body.baseUrl === 'string' ? req.body.baseUrl : ''), provider);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Invalid base URL' });
  }

  const startTime = Date.now();
  try {
    let result;
    if (provider === 'claude') {
      result = await callClaude(base, apiKey, model, system, messages, temperature, files);
    } else if (provider === 'gemini') {
      result = await callGemini(base, apiKey, model, projectId, system, messages, temperature, files);
    } else if (provider === 'openai' && isNativeOpenAIBaseUrl(base)) {
      result = await callOpenAINative(base, apiKey, model, projectId, system, messages, temperature, files);
    } else {
      const compatibleFiles = shouldConvertPdfToImagesForOpenAICompatible(provider, base)
        ? await convertProjectPdfsToImagesForOpenAICompatible(files)
        : files;
      const compatibleMessages = shouldConvertPdfToImagesForOpenAICompatible(provider, base)
        ? await convertInlinePdfsToImagesForOpenAICompatible(messages)
        : messages;
      result = await callOpenAICompatible(base, apiKey, model, system, compatibleMessages, temperature, compatibleFiles, provider);
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const usage = result.usage || {};
    console.log(`  \x1b[32m✓ Generated in ${elapsed}s\x1b[0m`);
    console.log(`  Tokens:      input=${usage.inputTokens || 0} cached=${usage.cachedTokens || 0} output=${usage.outputTokens || 0}`);
    console.log(`  Response:    ${(result.text || '').length} chars`);
    res.json(result);
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  \x1b[31m✗ Failed after ${elapsed}s: ${error.message}\x1b[0m`);
    res.status(500).json({ error: error.message || 'AI generation failed' });
  }
});

async function callClaude(baseUrl, apiKey, model, systemText, messages, temperature, files) {
  // Claude native Anthropic format with cache_control
  const systemBlocks = [];

  if (systemText) {
    systemBlocks.push({
      type: 'text',
      text: systemText,
      // cache_control goes here only if there are no file messages to cache
    });
  }

  // Build project-level file content blocks to inject into the first user message
  const projectFileBlocks = [];
  if (Array.isArray(files) && files.length > 0) {
    for (const f of files) {
      const base64Data = (f.dataUrl || '').includes(',') ? f.dataUrl.split(',')[1] : '';
      if (!base64Data) continue;

      if (f.mimeType.startsWith('image/')) {
        projectFileBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: f.mimeType, data: base64Data },
        });
      } else if (f.mimeType === 'application/pdf') {
        projectFileBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
        });
      } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
        const text = Buffer.from(base64Data, 'base64').toString('utf-8');
        projectFileBlocks.push({
          type: 'text',
          text: `[Content from ${f.name || 'file'}]\n${text}`,
        });
      }
    }
  }
  let projectFilesInjected = false;

  // Convert messages to Claude format
  const claudeMessages = [];
  let hasFiles = projectFileBlocks.length > 0;

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const content = [];
    const role = msg.role === 'model' ? 'assistant' : msg.role;

    // Inject project-level files into the first user message
    if (!projectFilesInjected && role === 'user' && projectFileBlocks.length > 0) {
      content.push(...projectFileBlocks);
      projectFilesInjected = true;
    }

    // Handle inline file attachments (images, PDFs, text files)
    if (msg.files && msg.files.length > 0) {
      hasFiles = true;
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/')) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: f.mimeType, data: f.data },
          });
        } else if (f.mimeType === 'application/pdf') {
          content.push({
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: f.data },
          });
        } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
          const text = Buffer.from(f.data, 'base64').toString('utf-8');
          content.push({
            type: 'text',
            text: `[Content from ${f.name || 'file'}]\n${text}`,
          });
        }
      }
    }

    content.push({ type: 'text', text: msg.content });

    claudeMessages.push({ role, content });
  }

  // Place cache_control on the last stable block:
  // - If files exist: on the first user message (file attachments) so files are cached
  // - If no files: on the system prompt
  if (hasFiles && claudeMessages.length > 0) {
    // Put cache breakpoint on the last content block of the first message (the file message)
    const firstMsg = claudeMessages[0];
    const lastBlock = firstMsg.content[firstMsg.content.length - 1];
    lastBlock.cache_control = { type: 'ephemeral' };
    // System prompt is before files, so it's cached too (prefix caching)
  }
  if (systemBlocks.length > 0) {
    // Always mark system for caching (acts as first breakpoint)
    systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
  }

  // Ensure messages alternate user/assistant and start with user
  const sanitized = sanitizeMessages(claudeMessages);

  const body = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    temperature,
    cache_control: { type: 'ephemeral' },
    system: systemBlocks,
    messages: sanitized,
  };

  const requestBody = JSON.stringify(body);
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: requestBody,
  };

  let data;
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1200;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[claude] retry ${attempt}/${MAX_RETRIES} after ${delay} ms`);
        await new Promise(r => setTimeout(r, delay));
      }
      const response = await fetch(`${baseUrl}/v1/messages`, requestOptions);
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API error ${response.status}: ${errText}`);
      }
      data = await response.json();
      break;
    } catch (error) {
      const isSocketError = /socket|ECONNRESET|other side closed|UND_ERR/i.test(String(error?.message || '') + String(error?.cause?.message || ''));
      if (!isSocketError || attempt >= MAX_RETRIES) {
        throw error;
      }
      console.warn(`[claude] attempt ${attempt + 1} failed: ${error.message}`);
    }
  }

  // Extract text from response
  const text = data.content
    ?.filter(b => b.type === 'text')
    .map(b => b.text)
    .join('') || '';

  // Extract usage
  const usage = data.usage || {};
  return {
    text,
    usage: {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cachedTokens: usage.cache_read_input_tokens || 0,
      thinkingTokens: 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    },
  };
}

function getGeminiArtifactsPath(projectId) {
  const safeProjectId = projectId || '__default__';
  return path.join(ensureProjectDir(safeProjectId), 'gemini-artifacts.json');
}

function loadGeminiArtifacts(projectId) {
  const artifactsPath = getGeminiArtifactsPath(projectId);
  if (!fs.existsSync(artifactsPath)) {
    return { files: {}, caches: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(artifactsPath, 'utf-8'));
    return {
      files: parsed.files || {},
      caches: parsed.caches || {},
    };
  } catch {
    return { files: {}, caches: {} };
  }
}

function saveGeminiArtifacts(projectId, artifacts) {
  const artifactsPath = getGeminiArtifactsPath(projectId);
  fs.writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2));
}

function getFileBase64(file) {
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl : '';
  return dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
}

function hashString(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getGeminiFileKey(file) {
  return hashString(`${normalizeGeminiMimeType(file)}:${getFileBase64(file)}`);
}

function getGeminiCacheKey(model, systemText, files) {
  const orderedFileKeys = (files || []).map(getGeminiFileKey);
  return hashString(JSON.stringify({
    model,
    systemText,
    orderedFileKeys,
  }));
}

function normalizeGeminiMimeType(file) {
  const currentMime = file?.mimeType || '';
  if (currentMime && currentMime !== 'application/octet-stream') return currentMime;

  const extension = (file?.name || '').split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'txt':
    case 'text':
    case 'md':
    case 'py':
    case 'sh':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    default:
      return currentMime || 'application/octet-stream';
  }
}

function isFutureTimestamp(value) {
  return Boolean(value) && Date.parse(value) > Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiSocketCloseError(error) {
  return error?.cause?.code === 'UND_ERR_SOCKET' || error?.code === 'UND_ERR_SOCKET';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function getGeminiRequestStats(messages, files, bodyString) {
  const uploadedFiles = Array.isArray(files) ? files : [];
  return {
    messageCount: Array.isArray(messages) ? messages.length : 0,
    fileCount: uploadedFiles.length,
    bodyBytes: Buffer.byteLength(bodyString, 'utf8'),
    fileNames: uploadedFiles.map((file) => file.name),
  };
}

async function fetchGeminiJson(url, options, label) {
  const response = await fetch(url, { ...options, keepalive: false, headers: { ...options.headers, Connection: 'close' } });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`${label} ${response.status}: ${raw}`);
  }

  return raw ? JSON.parse(raw) : {};
}

async function fetchGeminiJsonWithTimeout(url, options, label, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);

  try {
    return await fetchGeminiJson(
      url,
      {
        ...options,
        signal: controller.signal,
      },
      label
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadGeminiFile(baseUrl, apiKey, file) {
  const mimeType = normalizeGeminiMimeType(file);
  const bytes = Buffer.from(getFileBase64(file), 'base64');
  const startResponse = await fetch(`${baseUrl}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({
      file: {
        displayName: file.name || 'upload',
      },
    }),
  });

  const uploadUrl = startResponse.headers.get('x-goog-upload-url');
  const startError = await startResponse.text();
  if (!startResponse.ok || !uploadUrl) {
    throw new Error(`Gemini file upload start failed ${startResponse.status}: ${startError}`);
  }

  const finalizeResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });

  const finalizeRaw = await finalizeResponse.text();
  if (!finalizeResponse.ok) {
    throw new Error(`Gemini file upload finalize failed ${finalizeResponse.status}: ${finalizeRaw}`);
  }

  const parsed = finalizeRaw ? JSON.parse(finalizeRaw) : {};
  return parsed.file || parsed;
}

async function getGeminiFile(baseUrl, apiKey, fileName) {
  return fetchGeminiJson(
    `${baseUrl}/v1beta/${fileName}`,
    { method: 'GET', headers: { 'x-goog-api-key': apiKey } },
    'Gemini file get failed'
  );
}

async function waitForGeminiFileReady(baseUrl, apiKey, uploadedFile) {
  const startedAt = Date.now();
  let current = uploadedFile;

  while (current?.state === 'PROCESSING') {
    if (Date.now() - startedAt > GEMINI_FILE_POLL_TIMEOUT_MS) {
      throw new Error(`Gemini file processing timed out for ${uploadedFile?.name || uploadedFile?.displayName || 'uploaded file'}`);
    }
    await sleep(GEMINI_FILE_POLL_INTERVAL_MS);
    current = await getGeminiFile(baseUrl, apiKey, uploadedFile.name);
  }

  if (current?.state === 'FAILED') {
    throw new Error(`Gemini file processing failed: ${JSON.stringify(current.error || {})}`);
  }

  return current;
}

async function ensureGeminiUploadedFile(baseUrl, apiKey, projectId, file, artifacts) {
  const fileKey = getGeminiFileKey(file);
  const cached = artifacts.files[fileKey];

  if (cached && cached.name && cached.uri && isFutureTimestamp(cached.expirationTime) && cached.apiKeyPrefix === apiKey.slice(0, 8)) {
    return cached;
  }

  const uploaded = await uploadGeminiFile(baseUrl, apiKey, file);
  console.log(`[gemini] file uploaded: name=${uploaded.name} uri=${uploaded.uri} state=${uploaded.state}`);
  const ready = await waitForGeminiFileReady(baseUrl, apiKey, uploaded);
  console.log(`[gemini] file ready: name=${ready.name} uri=${ready.uri} state=${ready.state}`);
  const stored = {
    key: fileKey,
    name: ready.name,
    uri: ready.uri,
    mimeType: ready.mimeType || normalizeGeminiMimeType(file),
    displayName: ready.displayName || file.name,
    expirationTime: ready.expirationTime || null,
    apiKeyPrefix: apiKey.slice(0, 8),
    sizeBytes: ready.sizeBytes || String(file.size || 0),
  };

  artifacts.files[fileKey] = stored;
  saveGeminiArtifacts(projectId, artifacts);
  return stored;
}

async function createGeminiExplicitCache(baseUrl, apiKey, model, systemText, uploadedFiles) {
  const body = {
    model: `models/${model}`,
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Project source files for this presentation task.' },
          ...uploadedFiles.map((file) => ({
            file_data: {
              mime_type: file.mimeType,
              file_uri: file.uri,
            },
          })),
        ],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemText }],
    },
    ttl: `${GEMINI_CACHE_TTL_SECONDS}s`,
  };

  return fetchGeminiJson(
    `${baseUrl}/v1beta/cachedContents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    },
    'Gemini cache create failed'
  );
}

async function ensureGeminiFilesAndCache(baseUrl, apiKey, projectId, model, systemText, files) {
  if (!Array.isArray(files) || files.length === 0) return { cache: null, uploadedFiles: [] };

  const artifacts = loadGeminiArtifacts(projectId);
  const cacheKey = getGeminiCacheKey(model, systemText, files);
  const existingCache = artifacts.caches[cacheKey];

  if (existingCache?.name && isFutureTimestamp(existingCache.expireTime) && existingCache.apiKeyPrefix === apiKey.slice(0, 8)) {
    return { cache: existingCache, uploadedFiles: [] };
  }

  // Upload files via File API (works on both native Google and proxies like aihubmix)
  const uploadedFiles = [];
  for (const file of files) {
    uploadedFiles.push(await ensureGeminiUploadedFile(baseUrl, apiKey, projectId, file, artifacts));
  }

  // Try explicit cachedContents (only on native Google — skip on proxies to avoid wasted 404)
  const isNativeGoogle = new URL(baseUrl).hostname === 'generativelanguage.googleapis.com';
  if (isNativeGoogle) {
    try {
      const cache = await createGeminiExplicitCache(baseUrl, apiKey, model, systemText, uploadedFiles);
      const stored = {
        key: cacheKey,
        name: cache.name,
        expireTime: cache.expireTime || new Date(Date.now() + GEMINI_CACHE_TTL_SECONDS * 1000).toISOString(),
        model,
        apiKeyPrefix: apiKey.slice(0, 8),
        fileKeys: files.map(getGeminiFileKey),
      };
      artifacts.caches[cacheKey] = stored;
      saveGeminiArtifacts(projectId, artifacts);
      return { cache: stored, uploadedFiles: [] };
    } catch (err) {
      console.warn(`[gemini] explicit cache creation failed, using fileData references: ${err.message}`);
    }
  }
  return { cache: null, uploadedFiles };
}

async function callGemini(baseUrl, apiKey, model, projectId, systemText, messages, temperature, files) {
  // Native Gemini using the Files API plus explicit cachedContents for stable project files.
  const geminiModel = model || 'gemini-2.5-flash';
  const requestStartedAt = Date.now();
  const { cache: explicitCache, uploadedFiles: fallbackFiles } = await ensureGeminiFilesAndCache(baseUrl, apiKey, projectId, geminiModel, systemText, files || []);

  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const parts = [];

    if (msg.files && msg.files.length > 0) {
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf') {
          parts.push({
            inline_data: { mime_type: f.mimeType, data: f.data },
          });
        } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
          const text = Buffer.from(f.data, 'base64').toString('utf-8');
          parts.push({ text: `[Content from ${f.name || 'file'}]\n${text}` });
        }
      }
    }

    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (parts.length === 0) continue;
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  const sanitized = [];
  let lastRole = null;
  for (const content of contents) {
    if (content.role === lastRole) {
      sanitized[sanitized.length - 1].parts.push(...content.parts);
      continue;
    }
    sanitized.push(content);
    lastRole = content.role;
  }
  while (sanitized.length > 0 && sanitized[0].role !== 'user') {
    sanitized.shift();
  }

  // Set thinking level based on model: "minimal" for flash/lite, "low" for pro/others
  const modelLower = geminiModel.toLowerCase();
  const thinkingLevel = (modelLower.includes('flash') || modelLower.includes('lite')) ? 'minimal' : 'low';

  const body = {
    contents: sanitized,
    generationConfig: {
      temperature,
      maxOutputTokens: 16384,
      thinkingConfig: {
        thinkingLevel,
      },
    },
  };

  if (explicitCache?.name) {
    body.cachedContent = explicitCache.name;
  } else {
    if (systemText) {
      body.system_instruction = { parts: [{ text: systemText }] };
    }
    // Fallback: reference uploaded files via fileData URIs (camelCase for proxy compatibility)
    if (fallbackFiles.length > 0 && sanitized.length > 0) {
      const fileParts = fallbackFiles.map((f) => ({
        fileData: { fileUri: f.uri, mimeType: f.mimeType },
      }));
      sanitized[0].parts = [
        ...fileParts,
        { text: 'Project source files for this presentation task.' },
        ...sanitized[0].parts,
      ];
    }
  }
  const requestBody = JSON.stringify(body);
  const stats = getGeminiRequestStats(messages, files, requestBody);
  console.log(
    `[gemini] request start model=${geminiModel} project=${projectId || 'default'} messages=${stats.messageCount} files=${stats.fileCount} body=${formatBytes(stats.bodyBytes)} cache=${explicitCache?.name || 'none'}`
  );
  if (stats.fileNames.length > 0) {
    console.log(`[gemini] files: ${stats.fileNames.join(', ')}`);
  }

  let data;
  const requestUrl = `${baseUrl}/v1beta/models/${geminiModel}:generateContent`;
  const requestOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: requestBody,
  };

  // Retry loop for socket close errors (common with large inline payloads on proxies)
  let lastError;
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = GEMINI_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[gemini] retry ${attempt}/${GEMINI_MAX_RETRIES} after ${delay} ms`);
        await sleep(delay);
      }
      data = await fetchGeminiJsonWithTimeout(
        requestUrl,
        requestOptions,
        'Gemini API error',
        GEMINI_GENERATE_TIMEOUT_MS
      );
      if (attempt > 0) {
        console.log(`[gemini] retry ${attempt} succeeded after ${Date.now() - requestStartedAt} ms total`);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const elapsed = Date.now() - requestStartedAt;
      console.warn(
        `[gemini] attempt ${attempt + 1} failed after ${elapsed} ms (body=${formatBytes(stats.bodyBytes)} cache=${explicitCache?.name || 'none'})`,
        error.message || error
      );

      const errMsg = String(error?.message || '');
      if (attempt === 0 && explicitCache?.name && (errMsg.includes('CachedContent not found') || errMsg.includes('403'))) {
        // Cache is stale — invalidate and rebuild request body
        console.warn(`[gemini] stale cache detected, invalidating ${explicitCache.name} and re-creating`);
        const artifacts = loadGeminiArtifacts(projectId);
        const cacheKey = getGeminiCacheKey(geminiModel, systemText, files || []);
        delete artifacts.caches[cacheKey];
        artifacts.files = {};
        saveGeminiArtifacts(projectId, artifacts);

        const { cache: newCache, uploadedFiles: retryFiles } = await ensureGeminiFilesAndCache(baseUrl, apiKey, projectId, geminiModel, systemText, files || []);
        delete body.cachedContent;
        delete body.system_instruction;
        if (newCache?.name) {
          body.cachedContent = newCache.name;
        } else {
          if (systemText) {
            body.system_instruction = { parts: [{ text: systemText }] };
          }
          if (retryFiles.length > 0 && sanitized.length > 0) {
            const fileParts = retryFiles.map((f) => ({
              fileData: { fileUri: f.uri, mimeType: f.mimeType },
            }));
            sanitized[0].parts = [
              ...fileParts,
              { text: 'Project source files for this presentation task.' },
              ...sanitized[0].parts,
            ];
            body.contents = sanitized;
          }
        }
        requestOptions.body = JSON.stringify(body);
        // Continue to next retry iteration
      } else if (isGeminiSocketCloseError(error)) {
        // Socket close — continue to next retry iteration
      } else {
        // Non-retryable error — bail out
        throw error;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.filter((part) => part.text)
    .map((part) => part.text)
    .join('') || '';
  const totalElapsed = Date.now() - requestStartedAt;
  console.log(
    `[gemini] request success in ${totalElapsed} ms prompt=${data.usageMetadata?.promptTokenCount || 0} output=${data.usageMetadata?.candidatesTokenCount || 0} cached=${data.usageMetadata?.cachedContentTokenCount || 0}`
  );

  const usageMeta = data.usageMetadata || {};
  return {
    text,
    usage: {
      inputTokens: usageMeta.promptTokenCount || 0,
      outputTokens: usageMeta.candidatesTokenCount || 0,
      cachedTokens: usageMeta.cachedContentTokenCount || 0,
      thinkingTokens: usageMeta.thoughtsTokenCount || 0,
      cacheCreationTokens: 0,
    },
  };
}

function stripSyntheticFilePrelude(messages) {
  const remaining = [...(messages || [])];

  if (remaining[0]?.role === 'user' && Array.isArray(remaining[0].files) && remaining[0].files.length > 0) {
    remaining.shift();
  }
  if (remaining[0]?.role === 'model' && remaining[0].content === FILE_ACK_TEXT) {
    remaining.shift();
  }

  return remaining;
}

function buildOpenAINativeFileMessage(files) {
  if (!Array.isArray(files) || files.length === 0) return null;

  const content = [];

  for (const file of files) {
    const dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl : '';
    const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
    if (!base64Data || !file.mimeType) continue;

    if (file.mimeType.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${file.mimeType};base64,${base64Data}` },
      });
      continue;
    }

    content.push({
      type: 'file',
      file: {
        filename: file.name || 'upload',
        file_data: `data:${file.mimeType};base64,${base64Data}`,
      },
    });
  }

  if (content.length === 0) return null;

  content.push({ type: 'text', text: FILE_INTRO_TEXT });
  return { role: 'user', content };
}

function buildOpenAIPromptCacheKey(projectId, model) {
  const safeProjectId = projectId || 'default-project';
  const safeModel = model || 'default-model';
  return `openslides:${safeProjectId}:${safeModel}`;
}

async function callOpenAINative(baseUrl, apiKey, model, projectId, systemText, messages, temperature, files) {
  // Native OpenAI Chat Completions with file-aware content items.
  const oaiMessages = [];

  if (systemText) {
    oaiMessages.push({ role: 'system', content: systemText });
  }

  const nativeFileMessage = buildOpenAINativeFileMessage(files);
  if (nativeFileMessage) {
    oaiMessages.push(nativeFileMessage);
  }

  for (const msg of stripSyntheticFilePrelude(messages)) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'model' ? 'assistant' : msg.role;

    if (msg.files && msg.files.length > 0) {
      const content = [];
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
          });
        } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
          const text = Buffer.from(f.data, 'base64').toString('utf-8');
          content.push({ type: 'text', text: `[Content from ${f.name || 'file'}]\n${text}` });
        } else {
          content.push({
            type: 'file',
            file: {
              filename: f.name || 'upload',
              file_data: `data:${f.mimeType};base64,${f.data}`,
            },
          });
        }
      }
      content.push({ type: 'text', text: msg.content });
      oaiMessages.push({ role, content });
    } else {
      oaiMessages.push({ role, content: msg.content });
    }
  }

  const body = {
    model: model || 'gpt-4o',
    messages: oaiMessages,
    temperature,
    max_tokens: 16384,
    prompt_cache_key: buildOpenAIPromptCacheKey(projectId, model || 'gpt-4o'),
  };

  const url = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};

  return {
    text,
    usage: {
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens || usage.cached_tokens || 0,
      thinkingTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      cacheCreationTokens: 0,
    },
  };
}

async function callOpenAICompatible(baseUrl, apiKey, model, systemText, messages, temperature, files, provider) {
  // OpenAI-compatible format (GPT, proxies like aihubmix, etc.)
  const oaiMessages = [];

  if (systemText) {
    oaiMessages.push({ role: 'system', content: systemText });
  }

  // Prepare project-level file content to inject into the first user message
  const projectFileContent = [];
  if (Array.isArray(files) && files.length > 0) {
    for (const f of files) {
      if (f.mimeType.startsWith('image/')) {
        projectFileContent.push({
          type: 'image_url',
          image_url: { url: f.dataUrl },
        });
      } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
        // Plain text files — decode base64 and inject as text
        const base64 = f.dataUrl.replace(/^data:[^;]+;base64,/, '');
        const text = Buffer.from(base64, 'base64').toString('utf-8');
        projectFileContent.push({
          type: 'text',
          text: `[Content from ${f.name}]\n${text}`,
        });
      }
    }
  }
  let projectFilesInjected = false;

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'model' ? 'assistant' : msg.role;

    // Handle file attachments (images as vision content)
    if (msg.files && msg.files.length > 0) {
      const content = [];
      // Inject project files into the first user message
      if (!projectFilesInjected && role === 'user' && projectFileContent.length > 0) {
        content.push(...projectFileContent);
        projectFilesInjected = true;
      }
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
          });
        } else if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json' || f.mimeType === 'application/xml') {
          const text = Buffer.from(f.data, 'base64').toString('utf-8');
          content.push({ type: 'text', text: `[Content from ${f.name || 'file'}]\n${text}` });
        }
      }
      content.push({ type: 'text', text: msg.content });
      oaiMessages.push({ role, content });
    } else if (!projectFilesInjected && role === 'user' && projectFileContent.length > 0) {
      // Inject project files into this first user message
      const content = [...projectFileContent];
      content.push({ type: 'text', text: msg.content });
      oaiMessages.push({ role, content });
      projectFilesInjected = true;
    } else {
      oaiMessages.push({ role, content: msg.content });
    }
  }

  const body = {
    model: model || 'gpt-4o',
    messages: oaiMessages,
    temperature,
    max_tokens: 16384,
  };

  // Base URL should include any path prefix (e.g. /v1 for OpenAI, /v1beta/openai for Gemini)
  const url = baseUrl.replace(/\/+$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  if (provider === 'kimi') {
    headers['User-Agent'] = 'claude-code/0.1.0';
  }
  const requestBody = JSON.stringify(body);
  console.log(`[openai-compat] provider=${provider} url=${url}/chat/completions model=${body.model} msgCount=${oaiMessages.length} bodySize=${requestBody.length} UA=${headers['User-Agent'] || 'default'}`);

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1200;
  let lastError;
  let data;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[openai-compat] retry ${attempt}/${MAX_RETRIES} after ${delay} ms`);
        await new Promise(r => setTimeout(r, delay));
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error(`OpenAI-compatible request timed out after ${OPENAI_COMPATIBLE_TIMEOUT_MS} ms`)),
        OPENAI_COMPATIBLE_TIMEOUT_MS
      );
      try {
        const response = await fetch(`${url}/chat/completions`, {
          method: 'POST',
          headers,
          body: requestBody,
          signal: controller.signal,
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API error ${response.status}: ${errText}`);
        }
        data = await response.json();
      } finally {
        clearTimeout(timeout);
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const isSocketError = /socket|ECONNRESET|other side closed|UND_ERR/i.test(String(error?.message || '') + String(error?.cause?.message || ''));
      if (!isSocketError || attempt >= MAX_RETRIES) {
        throw error;
      }
      console.warn(`[openai-compat] attempt ${attempt + 1} failed: ${error.message}`);
    }
  }
  if (lastError) throw lastError;
  const text = data.choices?.[0]?.message?.content || '';
  const usageCompat = data.usage || {};

  return {
    text,
    usage: {
      inputTokens: usageCompat.prompt_tokens || 0,
      outputTokens: usageCompat.completion_tokens || 0,
      cachedTokens: usageCompat.prompt_tokens_details?.cached_tokens || usageCompat.cached_tokens || 0,
      thinkingTokens: usageCompat.completion_tokens_details?.reasoning_tokens || 0,
      cacheCreationTokens: 0,
    },
  };
}

function sanitizeMessages(messages) {
  // Ensure messages alternate roles and start with user
  const result = [];
  let lastRole = null;
  for (const msg of messages) {
    if (msg.role === lastRole) {
      const previous = result[result.length - 1];
      if (Array.isArray(previous.content) && Array.isArray(msg.content)) {
        previous.content.push(...msg.content);
      } else if (typeof previous.content === 'string' && typeof msg.content === 'string') {
        previous.content += `\n\n${msg.content}`;
      } else if (Array.isArray(previous.content) && typeof msg.content === 'string') {
        previous.content.push({ type: 'text', text: msg.content });
      } else if (typeof previous.content === 'string' && Array.isArray(msg.content)) {
        previous.content = [{ type: 'text', text: previous.content }, ...msg.content];
      }
      continue;
    }
    result.push(msg);
    lastRole = msg.role;
  }
  // Ensure starts with user
  while (result.length > 0 && result[0].role !== 'user') {
    result.shift();
  }
  return result;
}

// ============================================================
// Project Storage API
// ============================================================

function getProjectDir(projectId) {
  return path.join(PROJECTS_DIR, assertSafeProjectId(projectId));
}

function ensureProjectDir(projectId) {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const statesDir = path.join(dir, 'states');
  if (!fs.existsSync(statesDir)) fs.mkdirSync(statesDir, { recursive: true });
  const assetsDir = path.join(dir, ASSETS_DIRNAME);
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  return dir;
}

// List all projects
app.get('/api/projects', (req, res) => {
  const projects = loadProjectsMeta();
  projects.sort((a, b) => new Date(b.last_accessed_at || b.created_at) - new Date(a.last_accessed_at || a.created_at));
  res.json(projects);
});

// Create project
app.post('/api/projects', (req, res) => {
  try {
    const name = validateProjectName(req.body?.name);
    const projects = loadProjectsMeta();

    if (projects.some((project) => project.name === name)) {
      return res.status(409).json({ error: 'A project with this name already exists' });
    }

    const project = {
      id: createProjectId(name, new Set(projects.map((existing) => existing.id))),
      name,
      created_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
    };

    projects.push(project);
    saveProjectsMeta(projects);
    ensureProjectDir(project.id);
    res.json(project);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to create project' });
  }
});

// Update project access time
app.patch('/api/projects/:id', (req, res) => {
  try {
    const projectId = assertSafeProjectId(req.params.id);
    const projects = loadProjectsMeta();
    const idx = projects.findIndex((project) => project.id === projectId);
    if (idx < 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const nextProject = { ...projects[idx] };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) {
      const nextName = validateProjectName(req.body.name);
      if (projects.some((project) => project.id !== projectId && project.name === nextName)) {
        return res.status(409).json({ error: 'A project with this name already exists' });
      }
      nextProject.name = nextName;

      // Generate new ID from the new name and rename the project folder
      const usedIds = new Set(projects.filter((p) => p.id !== projectId).map((p) => p.id));
      const newId = createProjectId(nextName, usedIds);
      if (newId !== projectId) {
        const oldDir = getProjectDir(projectId);
        const newDir = path.join(PROJECTS_DIR, newId);
        if (fs.existsSync(oldDir)) {
          fs.renameSync(oldDir, newDir);
        }
        nextProject.id = newId;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'last_accessed_at')) {
      const timestamp = typeof req.body.last_accessed_at === 'string' ? req.body.last_accessed_at : '';
      if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
        return res.status(400).json({ error: 'Invalid last_accessed_at value' });
      }
      nextProject.last_accessed_at = timestamp;
    }

    projects[idx] = nextProject;
    saveProjectsMeta(projects);
    res.json(nextProject);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to update project' });
  }
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  try {
    const projectId = assertSafeProjectId(req.params.id);
    const remaining = loadProjectsMeta().filter((project) => project.id !== projectId);
    saveProjectsMeta(remaining);
    const dir = getProjectDir(projectId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete project' });
  }
});

// Slide info
app.get('/api/projects/:id/info', (req, res) => {
  try {
    requireProject(req.params.id);
    const infoPath = path.join(getProjectDir(req.params.id), 'info.json');
    if (!fs.existsSync(infoPath)) return res.json(null);
    res.json(readJsonFile(infoPath, null));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load project info' });
  }
});

app.put('/api/projects/:id/info', (req, res) => {
  try {
    requireProject(req.params.id);
    ensureProjectDir(req.params.id);
    const infoPath = path.join(getProjectDir(req.params.id), 'info.json');
    writeJsonFile(infoPath, req.body || null);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save project info' });
  }
});

// States
app.post('/api/projects/:id/states', (req, res) => {
  try {
    requireProject(req.params.id);
    const stateId = validateStateId(req.body?.stateId);
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    const chat = Array.isArray(req.body?.chat) ? req.body.chat : [];
    const context = req.body?.context || null;
    ensureProjectDir(req.params.id);
    const statePath = path.join(getProjectDir(req.params.id), 'states', `${stateId}.json`);
    writeJsonFile(statePath, { html, chat, context });
    res.json({ path: statePath, stateId });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save state' });
  }
});

app.get('/api/projects/:id/states/:stateId', (req, res) => {
  try {
    requireProject(req.params.id);
    const stateId = validateStateId(req.params.stateId);
    const statePath = path.join(getProjectDir(req.params.id), 'states', `${stateId}.json`);
    if (!fs.existsSync(statePath)) return res.status(404).json({ error: 'State not found' });
    res.json(readJsonFile(statePath, null));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load state' });
  }
});

app.delete('/api/projects/:id/states/:stateId', (req, res) => {
  try {
    requireProject(req.params.id);
    const stateId = validateStateId(req.params.stateId);
    const statePath = path.join(getProjectDir(req.params.id), 'states', `${stateId}.json`);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete state' });
  }
});

// Files
app.get('/api/projects/:id/files', (req, res) => {
  try {
    requireProject(req.params.id);
    const files = loadStoredProjectFiles(req.params.id).map((file) => buildPublicFileRecord(req.params.id, file));
    res.json(files);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load files' });
  }
});

app.post('/api/projects/:id/files', (req, res) => {
  try {
    requireProject(req.params.id);
    ensureProjectDir(req.params.id);
    const files = upsertProjectFiles(req.params.id, req.body?.files || []).map((file) => buildPublicFileRecord(req.params.id, file));
    res.json(files);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save files' });
  }
});

app.delete('/api/projects/:id/files/:filename', (req, res) => {
  try {
    requireProject(req.params.id);
    deleteStoredProjectFile(req.params.id, req.params.filename);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete file' });
  }
});

// Serve individual file by name (images/PDFs for use in slides)
app.get('/api/projects/:id/file/:filename', (req, res) => {
  try {
    requireProject(req.params.id);
    const files = loadStoredProjectFiles(req.params.id);
    const file = files.find((entry) => entry.name === req.params.filename);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const mimeType = file.mimeType;
    const buffer = fs.readFileSync(getProjectAssetPath(req.params.id, file.assetPath));

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load file' });
  }
});

// ============================================================
// Project Context (hidden .context.json for search results, data summaries, etc.)
// ============================================================

function getProjectContextPath(projectId) {
  return path.join(getProjectDir(projectId), '.context.json');
}

app.get('/api/projects/:id/context', (req, res) => {
  try {
    requireProject(req.params.id);
    const ctxPath = getProjectContextPath(req.params.id);
    const data = readJsonFile(ctxPath, { searchResults: [], dataSummaries: [] });
    const searchCount = (data.searchResults || []).length;
    const dataCount = (data.dataSummaries || []).length;
    if (searchCount > 0 || dataCount > 0) {
      console.log(`\n\x1b[90m━━━ [Context Load] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
      console.log(`  Project:     ${req.params.id}`);
      console.log(`  Search:      ${searchCount} cached result(s)`);
      console.log(`  Data:        ${dataCount} summary(ies)`);
    }
    res.json(data);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load context' });
  }
});

app.put('/api/projects/:id/context', (req, res) => {
  try {
    requireProject(req.params.id);
    ensureProjectDir(req.params.id);
    const ctxPath = getProjectContextPath(req.params.id);
    const existing = readJsonFile(ctxPath, { searchResults: [], dataSummaries: [] });

    const newSearchCount = Array.isArray(req.body?.searchResults) ? req.body.searchResults.length : 0;
    const newDataCount = Array.isArray(req.body?.dataSummaries) ? req.body.dataSummaries.length : 0;

    // Merge search results by URL. Keep accumulated data summaries so the planner
    // and generator can reuse previous analysis without re-running scripts.
    let addedSearch = 0;
    if (Array.isArray(req.body?.searchResults)) {
      const existingUrls = new Set((existing.searchResults || []).map(r => r.url));
      for (const r of req.body.searchResults) {
        if (r.url && !existingUrls.has(r.url)) {
          existing.searchResults.push(r);
          existingUrls.add(r.url);
          addedSearch++;
        }
      }
    }
    if (Array.isArray(req.body?.dataSummaries)) {
      const existingData = Array.isArray(existing.dataSummaries) ? existing.dataSummaries : [];
      const seen = new Set(existingData.map((entry) => `${entry.label}\n${entry.data}`));
      for (const entry of req.body.dataSummaries) {
        const label = typeof entry?.label === 'string' ? entry.label : '';
        const data = typeof entry?.data === 'string' ? entry.data : '';
        const key = `${label}\n${data}`;
        if (label && data && !seen.has(key)) {
          existingData.push({ label, data });
          seen.add(key);
        }
      }
      existing.dataSummaries = existingData.slice(-30);
    }

    writeJsonFile(ctxPath, existing);

    console.log(`\n\x1b[90m━━━ [Context Save] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
    console.log(`  Project:     ${req.params.id}`);
    console.log(`  Added:       ${addedSearch} search result(s), ${newDataCount} data summary(ies)`);
    console.log(`  Total:       ${existing.searchResults.length} search, ${existing.dataSummaries.length} data`);

    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save context' });
  }
});

// ============================================================
// URL Sources
// ============================================================

function getProjectUrlsPath(projectId) {
  return path.join(getProjectDir(projectId), 'urls.json');
}

function loadProjectUrls(projectId) {
  return readJsonFile(getProjectUrlsPath(projectId), []);
}

function saveProjectUrls(projectId, urls) {
  writeJsonFile(getProjectUrlsPath(projectId), urls);
}

function extractTextFromHtml(html) {
  let text = html;
  // Remove script, style, nav, footer, header, aside blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
  // Truncate to 15K chars
  if (text.length > 15000) text = text.slice(0, 15000) + '\n[... truncated]';
  return text;
}

function extractTitleFromHtml(html, url) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 200) || new URL(url).hostname;
  }
  // Try og:title
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1].trim().slice(0, 200);
  return new URL(url).hostname;
}

async function fetchAndExtractUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OpenSlides/1.0; +https://github.com/openslides)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const title = extractTitleFromHtml(html, url);
    const content = extractTextFromHtml(html);
    return {
      title,
      content,
      snippet: content.slice(0, 200),
      charCount: content.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// List URL sources
app.get('/api/projects/:id/urls', (req, res) => {
  try {
    requireProject(req.params.id);
    res.json(loadProjectUrls(req.params.id));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to load URLs' });
  }
});

// Add a URL source
app.post('/api/projects/:id/urls', async (req, res) => {
  try {
    requireProject(req.params.id);
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Validate URL format
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL format' }); }

    const urls = loadProjectUrls(req.params.id);

    // Check for duplicate URL
    if (urls.some(u => u.url === url)) {
      return res.status(409).json({ error: 'This URL has already been added' });
    }

    console.log(`\n\x1b[36m━━━ [URL Fetch] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
    console.log(`  Project: ${req.params.id}`);
    console.log(`  URL:     ${url}`);

    const startTime = Date.now();
    const extracted = await fetchAndExtractUrl(url);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  \x1b[32m✓ Fetched in ${elapsed}s\x1b[0m`);
    console.log(`  Title:   ${extracted.title}`);
    console.log(`  Content: ${extracted.charCount} chars`);

    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      url,
      title: extracted.title,
      content: extracted.content,
      snippet: extracted.snippet,
      charCount: extracted.charCount,
      fetchedAt: new Date().toISOString(),
    };

    urls.push(entry);
    saveProjectUrls(req.params.id, urls);
    res.json(urls);
  } catch (error) {
    console.error(`  \x1b[31m✗ URL fetch failed: ${error.message}\x1b[0m`);
    res.status(error.status || 500).json({ error: error.message || 'Failed to fetch URL' });
  }
});

// Delete a URL source
app.delete('/api/projects/:id/urls/:urlId', (req, res) => {
  try {
    requireProject(req.params.id);
    const urls = loadProjectUrls(req.params.id);
    const filtered = urls.filter(u => u.id !== req.params.urlId);
    saveProjectUrls(req.params.id, filtered);
    res.json(filtered);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to delete URL' });
  }
});

// Refresh a URL source
app.post('/api/projects/:id/urls/:urlId/refresh', async (req, res) => {
  try {
    requireProject(req.params.id);
    const urls = loadProjectUrls(req.params.id);
    const idx = urls.findIndex(u => u.id === req.params.urlId);
    if (idx < 0) return res.status(404).json({ error: 'URL source not found' });

    console.log(`\n\x1b[36m━━━ [URL Refresh] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
    console.log(`  URL: ${urls[idx].url}`);

    const startTime = Date.now();
    const extracted = await fetchAndExtractUrl(urls[idx].url);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  \x1b[32m✓ Refreshed in ${elapsed}s\x1b[0m`);
    console.log(`  Content: ${extracted.charCount} chars`);

    urls[idx] = {
      ...urls[idx],
      title: extracted.title,
      content: extracted.content,
      snippet: extracted.snippet,
      charCount: extracted.charCount,
      fetchedAt: new Date().toISOString(),
    };

    saveProjectUrls(req.params.id, urls);
    res.json(urls);
  } catch (error) {
    console.error(`  \x1b[31m✗ URL refresh failed: ${error.message}\x1b[0m`);
    res.status(error.status || 500).json({ error: error.message || 'Failed to refresh URL' });
  }
});

// ============================================================
// Search Agent (Tavily)
// ============================================================

app.post('/api/search', async (req, res) => {
  const settings = loadSettings();
  const tavilyApiKey = settings.tavilyApiKey || '';

  console.log(`\n\x1b[33m━━━ [Search Agent] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);

  if (!tavilyApiKey) {
    console.log(`  \x1b[31m✗ No Tavily API key configured — skipping\x1b[0m`);
    return res.json({ results: [], error: 'No Tavily API key configured' });
  }

  const queries = Array.isArray(req.body.queries) ? req.body.queries.slice(0, 3) : [];
  if (queries.length === 0) {
    console.log(`  \x1b[31m✗ No queries provided\x1b[0m`);
    return res.json({ results: [] });
  }

  console.log(`  Queries:     ${queries.length}`);
  queries.forEach((q, i) => console.log(`    ${i + 1}. "${q}"`));

  const startTime = Date.now();
  try {
    const allResults = [];
    const seenUrls = new Set();
    let answer = '';

    for (const query of queries) {
      const qStart = Date.now();
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: String(query),
          search_depth: 'advanced',
          include_answer: true,
          max_results: 5,
        }),
      });

      if (!resp.ok) {
        console.log(`    \x1b[31m✗ "${query}" failed (${resp.status}) in ${((Date.now() - qStart) / 1000).toFixed(1)}s\x1b[0m`);
        continue;
      }

      const data = await resp.json();
      const qElapsed = ((Date.now() - qStart) / 1000).toFixed(1);
      const newResults = (data.results || []).filter(r => !seenUrls.has(r.url));
      console.log(`    \x1b[32m✓\x1b[0m "${query}" → ${newResults.length} new results in ${qElapsed}s`);

      if (data.answer && !answer) answer = data.answer;

      for (const r of data.results || []) {
        if (!seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          allResults.push({
            title: r.title || '',
            url: r.url || '',
            content: r.content || '',
            score: r.score || 0,
          });
        }
      }
    }

    // Sort by relevance score and keep top 10
    allResults.sort((a, b) => b.score - a.score);
    const finalResults = allResults.slice(0, 10);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  \x1b[32m✓ Search complete in ${elapsed}s — ${finalResults.length} results\x1b[0m`);
    if (answer) console.log(`  Answer:      "${answer.slice(0, 120)}${answer.length > 120 ? '...' : ''}"`);
    finalResults.forEach((r, i) => console.log(`    ${i + 1}. [${r.score.toFixed(2)}] ${r.title}`));

    res.json({ results: finalResults, answer });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  \x1b[31m✗ Search failed after ${elapsed}s: ${error.message}\x1b[0m`);
    res.json({ results: [], error: error.message || 'Search failed' });
  }
});

// ============================================================
// Planner Agent (decides if search is needed)
// ============================================================

const PLANNER_SYSTEM_PROMPT = `You are a planning assistant. Given a user's request to generate or edit a presentation, decide three things:
1. Whether web search is needed to gather new information
2. Whether existing project context (previous research, data summaries) should be included
3. Whether data analysis is needed on uploaded data files (csv, xlsx)

Return JSON only, no other text:
{
  "needsSearch": true/false,
  "needsContext": true/false,
  "needsAnalysis": true/false,
  "queries": ["query1", "query2"],
  "reasoning": "brief explanation"
}

needsSearch = true when the prompt requires:
- Current facts, statistics, prices, or data the LLM may not know
- Recent events, news, product launches, or trends
- Specific company/product/person/project information that needs accuracy
- Technical details that benefit from authoritative sources
- Any topic you are not confident you have accurate knowledge about

needsSearch = false when:
- The prompt is about generic/evergreen topics (e.g., "make a presentation about teamwork")
- The user is editing/modifying existing slides visually (e.g., "change the color", "fix the layout", "make the title bigger")
- The user provides all the content themselves via uploaded files
- The topic is well-known and unlikely to have changed recently

needsContext = true when:
- The user is adding new content slides that relate to previously researched topics
- The user asks to expand, elaborate, or add details on a topic that was previously searched
- The generation would benefit from the factual accuracy provided by prior research

needsContext = false when:
- The user's request is purely visual (styling, layout, colors, font sizes, animations)
- The user is doing simple text edits that don't need factual backing
- There is no existing context available

needsAnalysis = true when:
- The project has uploaded data files (csv, xlsx) AND
- The user wants data-driven content: charts, statistics, trends, comparisons, summaries from the data
- The user mentions analyzing, visualizing, or presenting their data

needsAnalysis = false when:
- There are no data files in the project
- The user is doing visual/style edits only
- The data has already been analyzed (existing context contains data summaries)
- The user provides all content themselves and doesn't reference data files

The user message may include "[Existing project context topics: ...]" listing topics already researched. Do NOT search for topics already covered unless the user explicitly asks for updated information. Only search for NEW topics not yet in the context.

Generate 1-3 simple, direct search queries. When the topic is unfamiliar or unknown to you, use straightforward queries like "What is [topic]?" or "[topic] introduction" — do NOT infer, guess, or expand the topic into something else. Never add year numbers, assumed project names, or speculative details to queries. Keep queries short and factual.`;

app.post('/api/plan', async (req, res) => {
  const settings = loadSettings();

  console.log(`\n\x1b[35m━━━ [Planner Agent] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
  const canSearchWeb = Boolean(settings.tavilyApiKey);
  if (!canSearchWeb) {
    console.log(`  \x1b[33m⊘ No Tavily API key — planning without web search\x1b[0m`);
  }

  const userPrompt = typeof req.body.prompt === 'string' ? req.body.prompt : '';
  if (!userPrompt.trim()) {
    console.log(`  \x1b[33m⊘ Empty prompt — skipping\x1b[0m`);
    return res.json({ needsSearch: false, needsContext: false, needsAnalysis: false, queries: [], reasoning: 'Empty prompt' });
  }

  const projectId = typeof req.body.projectId === 'string' && isSafeProjectId(req.body.projectId)
    ? req.body.projectId
    : null;
  const dataFiles = projectId ? getDataFileSummaries(projectId) : [];
  const planningPrompt = dataFiles.length > 0
    ? `${userPrompt}\n\n[Uploaded data files in this project]\n${dataFiles.map((file) => `- ${file.name} (${file.mimeType}, ${file.size} bytes)`).join('\n')}\n\nIf the user asks for data analysis, charts, statistics, trends, comparisons, summaries, or a data-driven presentation, set needsAnalysis=true.`
    : userPrompt;

  // Show prompt (truncated) and whether it has existing context info
  const hasExistingContext = planningPrompt.includes('[Existing project context topics:');
  const promptPreview = userPrompt.replace(/\n\n\[Existing project context topics:[\s\S]*$/, '').slice(0, 150);
  console.log(`  Prompt:      "${promptPreview}${promptPreview.length >= 150 ? '...' : ''}"`);
  console.log(`  Has context: ${hasExistingContext ? 'yes' : 'no'}`);
  if (dataFiles.length > 0) {
    console.log(`  Data files:  ${dataFiles.map((file) => file.name).join(', ')}`);
  }

  const provider = typeof req.body.provider === 'string' && SUPPORTED_PROVIDERS.has(req.body.provider)
    ? req.body.provider
    : settings.activeProvider;
  const providerCfg = getProviderConfig(settings, provider);
  const apiKey = providerCfg.apiKey;

  if (!apiKey) {
    console.log(`  \x1b[31m✗ No API key for ${provider}\x1b[0m`);
    return res.json({ needsSearch: false, needsContext: false, needsAnalysis: false, queries: [], reasoning: 'No LLM API key for planning' });
  }

  let base;
  try {
    base = sanitizeBaseUrl(providerCfg.baseUrl || '', provider);
  } catch {
    return res.json({ needsSearch: false, needsContext: false, needsAnalysis: false, queries: [], reasoning: 'Invalid base URL' });
  }

  const model = (typeof req.body.model === 'string' && req.body.model.trim())
    ? req.body.model.trim()
    : (providerCfg.model || getDefaultModel(provider));
  console.log(`  Provider:    ${provider} (${model})`);

  const messages = [{ role: 'user', content: planningPrompt }];
  const startTime = Date.now();

  try {
    let result;
    if (provider === 'claude') {
      result = await callClaude(base, apiKey, model, PLANNER_SYSTEM_PROMPT, messages, 0.1, []);
    } else if (provider === 'gemini') {
      result = await callGemini(base, apiKey, model, 'planner', PLANNER_SYSTEM_PROMPT, messages, 0.1, []);
    } else if (provider === 'openai' && isNativeOpenAIBaseUrl(base)) {
      result = await callOpenAINative(base, apiKey, model, 'planner', PLANNER_SYSTEM_PROMPT, messages, 0.1, []);
    } else {
      result = await callOpenAICompatible(base, apiKey, model, PLANNER_SYSTEM_PROMPT, messages, 0.1, [], provider);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Parse JSON from the LLM response
    const text = result.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const plannerUsage = result.usage || {};
      const plannerWantedSearch = !!parsed.needsSearch;
      const plan = {
        needsSearch: canSearchWeb && plannerWantedSearch,
        needsContext: parsed.needsContext !== false,
        needsAnalysis: !!parsed.needsAnalysis,
        queries: canSearchWeb && Array.isArray(parsed.queries) ? parsed.queries.map(String).slice(0, 3) : [],
        reasoning: !canSearchWeb && plannerWantedSearch
          ? `${String(parsed.reasoning || '')} Web search was requested by the planner, but Tavily is not configured, so search was skipped.`
          : String(parsed.reasoning || ''),
        usage: {
          inputTokens: plannerUsage.inputTokens || 0,
          outputTokens: plannerUsage.outputTokens || 0,
          cachedTokens: plannerUsage.cachedTokens || 0,
          thinkingTokens: plannerUsage.thinkingTokens || 0,
        },
      };

      console.log(`  \x1b[32m✓ Planned in ${elapsed}s\x1b[0m`);
      console.log(`  Decision:`);
      console.log(`    needsSearch:   ${plan.needsSearch ? '\x1b[33myes\x1b[0m' : '\x1b[90mno\x1b[0m'}`);
      console.log(`    needsContext:  ${plan.needsContext ? '\x1b[33myes\x1b[0m' : '\x1b[90mno\x1b[0m'}`);
      console.log(`    needsAnalysis: ${plan.needsAnalysis ? '\x1b[34myes\x1b[0m' : '\x1b[90mno\x1b[0m'}`);
      if (plan.queries.length > 0) {
        console.log(`    queries:`);
        plan.queries.forEach((q, i) => console.log(`      ${i + 1}. "${q}"`));
      }
      console.log(`    reasoning:    "${plan.reasoning}"`);
      console.log(`    tokens:       in=${plan.usage.inputTokens} out=${plan.usage.outputTokens}`);

      res.json(plan);
    } else {
      console.log(`  \x1b[31m✗ Could not parse planner response (${elapsed}s)\x1b[0m`);
      console.log(`  Raw response:  "${text.slice(0, 200)}"`);
      res.json({ needsSearch: false, needsContext: true, needsAnalysis: false, queries: [], reasoning: 'Could not parse planner response' });
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`  \x1b[31m✗ Planner failed after ${elapsed}s: ${error.message}\x1b[0m`);
    res.json({ needsSearch: false, needsContext: true, needsAnalysis: false, queries: [], reasoning: error.message || 'Planning failed' });
  }
});

// ============================================================
// Data Analytics Agent
// ============================================================

const ANALYST_SYSTEM_PROMPT = `You are a data analyst. You will receive:
1. Schema information about data files (column names, row count, sample rows)
2. The user's request for what kind of presentation/analysis they want

Your job: write a self-contained Python script that reads the data file(s) and outputs a JSON analysis result to stdout.

RULES:
- The script receives the file path as the first command-line argument (sys.argv[1]).
- For .xlsx/.xls files, use openpyxl. For .csv files, use the csv module from stdlib.
- The script MUST print ONLY a single JSON object to stdout. No other output.
- The JSON output MUST follow this exact structure:

{
  "tables": [
    {
      "title": "Table Title",
      "headers": ["Col1", "Col2", "Col3"],
      "rows": [["val1", 2, "val3"], ...]
    }
  ],
  "charts": [
    {
      "title": "Chart Title",
      "type": "bar|line|pie|doughnut|radar",
      "labels": ["Label1", "Label2", ...],
      "datasets": [
        {"label": "Series Name", "data": [1, 2, 3, ...]}
      ]
    }
  ],
  "insights": [
    "Key finding 1",
    "Key finding 2"
  ]
}

GUIDELINES:
- Produce 2-4 charts that best visualize the data for a presentation.
- Produce 1-2 tables with the most important summary data (max 8 rows each).
- Produce 3-5 key insights as short bullet-point strings.
- For large datasets, aggregate and summarize — do NOT output all rows.
- Choose chart types that match the data: bar for comparisons, line for trends over time, pie for proportions.
- Keep labels short (truncate to ~20 chars if needed).
- Limit chart data points to 12 max per dataset — group/aggregate if more.
- Handle missing values gracefully (skip or fill with 0).
- The script must be self-contained. Only use: openpyxl (for xlsx), csv (stdlib), json (stdlib), sys (stdlib), collections (stdlib), statistics (stdlib), datetime (stdlib).
- Do NOT use pandas, numpy, matplotlib, or any other heavy library.
- Output ONLY the JSON. No print statements for debugging. No stderr output.

Output ONLY a python code block with the script. No explanation before or after.`;

function extractPythonScriptFromResponse(text) {
  const fencedMatch = String(text || '').match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (fencedMatch) return fencedMatch[1].trim();

  const trimmed = String(text || '').trim();
  if (/^(import|from)\s+/m.test(trimmed) || trimmed.includes('def ')) {
    return trimmed;
  }

  return '';
}

function writeAnalyticsArtifact(runDir, name, value) {
  const output = typeof value === 'string'
    ? value
    : JSON.stringify(value, null, 2);
  fs.writeFileSync(path.join(runDir, name), output, 'utf-8');
}

const MAX_ANALYSIS_SCRIPT_ATTEMPTS = Number(process.env.MAX_ANALYSIS_SCRIPT_ATTEMPTS || 3);

async function callAnalystModel(providerName, base, apiKey, model, messages, temperature = 0.2) {
  if (providerName === 'claude') {
    return callClaude(base, apiKey, model, ANALYST_SYSTEM_PROMPT, messages, temperature, []);
  }
  if (providerName === 'gemini') {
    return callGemini(base, apiKey, model, 'analyst', ANALYST_SYSTEM_PROMPT, messages, temperature, []);
  }
  if (providerName === 'openai' && isNativeOpenAIBaseUrl(base)) {
    return callOpenAINative(base, apiKey, model, 'analyst', ANALYST_SYSTEM_PROMPT, messages, temperature, []);
  }
  return callOpenAICompatible(base, apiKey, model, ANALYST_SYSTEM_PROMPT, messages, temperature, [], providerName);
}

function getUvInlineMetadata(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const needsOpenpyxl = ['.xlsx', '.xls'].includes(ext);
  return needsOpenpyxl
    ? `# /// script\n# requires-python = ">=3.10"\n# dependencies = ["openpyxl"]\n# ///\n\n`
    : `# /// script\n# requires-python = ">=3.10"\n# dependencies = []\n# ///\n\n`;
}

function summarizeAnalyticsStderr(stderr) {
  if (!stderr || !stderr.trim()) return '';
  return stderr.split('\n').filter(l =>
    !l.trim().startsWith('Resolved') && !l.trim().startsWith('Prepared') &&
    !l.trim().startsWith('Installed') && !l.trim().startsWith('Audited') &&
    !l.trim().startsWith('Updated') && !l.trim().startsWith('Using') &&
    !l.trim().startsWith('Creating') && !l.trim().startsWith('reading') &&
    l.trim()
  ).join('\n');
}

function parseAnalysisStdout(stdout) {
  const jsonMatch = String(stdout || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { ok: false, stage: 'parse-output', error: 'Analysis script produced no JSON output' };
  }
  try {
    return { ok: true, result: JSON.parse(jsonMatch[0]) };
  } catch (parseError) {
    return { ok: false, stage: 'parse-json', error: parseError.message };
  }
}

async function runAnalysisScriptAttempt({ runDir, attempt, script, inlineMetadata, dataFilePath }) {
  const scriptContent = inlineMetadata + script;
  const scriptPath = path.join(runDir, `analysis_attempt_${attempt}.py`);
  fs.writeFileSync(scriptPath, scriptContent);
  fs.writeFileSync(path.join(runDir, 'analysis.py'), scriptContent);

  const execStart = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('uv', ['run', '--script', scriptPath, dataFilePath], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const execElapsed = ((Date.now() - execStart) / 1000).toFixed(1);
    writeAnalyticsArtifact(runDir, `attempt_${attempt}_stdout.txt`, stdout || '');
    writeAnalyticsArtifact(runDir, `attempt_${attempt}_stderr.txt`, stderr || '');
    writeAnalyticsArtifact(runDir, 'stdout.txt', stdout || '');
    writeAnalyticsArtifact(runDir, 'stderr.txt', stderr || '');

    const realErrors = summarizeAnalyticsStderr(stderr);
    if (realErrors) {
      console.warn(`  [attempt ${attempt} stderr] ${realErrors.slice(0, 300)}`);
    }

    const parsed = parseAnalysisStdout(stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        stage: parsed.stage,
        error: parsed.error,
        stdout: stdout || '',
        stderr: stderr || '',
        script,
        scriptPath,
        execElapsed,
      };
    }

    return {
      ok: true,
      result: parsed.result,
      stdout: stdout || '',
      stderr: stderr || '',
      script,
      scriptPath,
      execElapsed,
    };
  } catch (execErr) {
    const execElapsed = ((Date.now() - execStart) / 1000).toFixed(1);
    const stdout = execErr.stdout || '';
    const stderr = execErr.stderr || '';
    writeAnalyticsArtifact(runDir, `attempt_${attempt}_stdout.txt`, stdout);
    writeAnalyticsArtifact(runDir, `attempt_${attempt}_stderr.txt`, stderr);
    writeAnalyticsArtifact(runDir, 'stdout.txt', stdout);
    writeAnalyticsArtifact(runDir, 'stderr.txt', stderr);

    return {
      ok: false,
      stage: 'execute',
      error: execErr.message,
      stdout,
      stderr,
      script,
      scriptPath,
      execElapsed,
    };
  }
}

function buildAnalysisRepairMessages({ userPrompt, schemaDescription, previousScript, failure, attempt, maxAttempts }) {
  return [{
    role: 'user',
    content: `The previous analytics Python script failed. Repair it.

User's presentation request:
"${userPrompt}"

Data files available for analysis:

${schemaDescription}

Failed attempt: ${attempt - 1} of ${maxAttempts}
Failure stage: ${failure.stage}
Error:
${failure.error || '(none)'}

stderr:
${failure.stderr || '(empty)'}

stdout:
${failure.stdout || '(empty)'}

Previous Python script:
\`\`\`python
${previousScript}
\`\`\`

Return a corrected Python script only.
Requirements:
- Preserve the user's analysis goal.
- Fix the exact syntax/runtime/JSON-output problem shown above.
- The script receives the data file path as sys.argv[1].
- Print ONLY one JSON object to stdout.
- The JSON object must contain "tables", "charts", and "insights" arrays.
- Do not print debugging text, markdown, or explanations.
- Use only the allowed libraries from the original instructions.`,
  }];
}

app.post('/api/analyze', async (req, res) => {
  const settings = loadSettings();

  console.log(`\n\x1b[34m━━━ [Analytics Agent] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);

  const projectId = typeof req.body.projectId === 'string' && isSafeProjectId(req.body.projectId)
    ? req.body.projectId : null;
  const userPrompt = typeof req.body.prompt === 'string' ? req.body.prompt : '';
  const providerName = typeof req.body.provider === 'string' && SUPPORTED_PROVIDERS.has(req.body.provider)
    ? req.body.provider : settings.activeProvider;

  if (!projectId) {
    console.log(`  \x1b[31m✗ No valid project ID\x1b[0m`);
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  // Step A: Extract schemas from data files
  const schemas = getDataFileSchemas(projectId);
  if (schemas.length === 0) {
    console.log(`  \x1b[33m⊘ No data files found in project\x1b[0m`);
    return res.json({ tables: [], charts: [], insights: [], error: 'No data files found' });
  }

  console.log(`  Project:     ${projectId}`);
  console.log(`  Data files:  ${schemas.map(s => `${s.fileName} (${s.rowCount} rows, ${s.columns.length} cols)`).join(', ')}`);

  const analyticsRoot = path.join(getProjectDir(projectId), '_analytics');
  fs.mkdirSync(analyticsRoot, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(analyticsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeAnalyticsArtifact(runDir, 'request.txt', userPrompt);
  writeAnalyticsArtifact(runDir, 'schemas.json', schemas);
  console.log(`  Run dir:     ${runDir}`);

  const providerCfg = getProviderConfig(settings, providerName);
  const apiKey = providerCfg.apiKey;
  if (!apiKey) {
    console.log(`  \x1b[31m✗ No API key for ${providerName}\x1b[0m`);
    writeAnalyticsArtifact(runDir, 'error.json', { stage: 'config', error: `No API key for ${providerName}` });
    return res.status(400).json({ error: `No API key for ${providerName}` });
  }

  let base;
  try {
    base = sanitizeBaseUrl(providerCfg.baseUrl || '', providerName);
  } catch {
    writeAnalyticsArtifact(runDir, 'error.json', { stage: 'config', error: 'Invalid base URL' });
    return res.status(400).json({ error: 'Invalid base URL' });
  }

  const model = (typeof req.body.model === 'string' && req.body.model.trim())
    ? req.body.model.trim()
    : (providerCfg.model || getDefaultModel(providerName));

  // Step B: Build prompt with schema info — LLM only sees structure, not full data
  const schemaDescription = schemas.map(s => {
    const sampleStr = JSON.stringify(s.sampleRows, null, 2);
    return `File: "${s.fileName}"
Columns: ${s.columns.join(', ')}
Row count: ${s.rowCount}
File size: ${s.fileSize} bytes
Sample rows (first 5):
${sampleStr}`;
  }).join('\n\n');

  const messages = [{
    role: 'user',
    content: `User's presentation request: "${userPrompt}"

Data files available for analysis:

${schemaDescription}

Write a Python script to analyze this data and produce charts, tables, and insights suitable for a presentation about this topic. The script will receive the file path as sys.argv[1].${schemas.length === 1 ? '' : ' Process the primary/most relevant file for the user\'s request.'}`,
  }];

  console.log(`  Provider:    ${providerName} (${model})`);

  const targetSchema = schemas[0];
  const dataFilePath = getProjectAssetPath(projectId, targetSchema.assetPath);
  const inlineMetadata = getUvInlineMetadata(targetSchema.fileName);
  console.log(`  Data file:   ${dataFilePath}`);

  let currentMessages = messages;
  let previousScript = '';
  let lastFailure = null;
  const attempts = [];
  const totalUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    thinkingTokens: 0,
  };

  for (let attempt = 1; attempt <= MAX_ANALYSIS_SCRIPT_ATTEMPTS; attempt++) {
    const llmStart = Date.now();
    let result;
    try {
      result = await callAnalystModel(providerName, base, apiKey, model, currentMessages, attempt === 1 ? 0.2 : 0.1);
    } catch (err) {
      console.error(`  \x1b[31m✗ LLM ${attempt === 1 ? 'generation' : 'repair'} failed: ${err.message}\x1b[0m`);
      writeAnalyticsArtifact(runDir, 'error.json', {
        stage: attempt === 1 ? 'llm' : 'llm-repair',
        attempt,
        error: err.message,
        attempts,
      });
      return res.status(500).json({ error: `LLM failed: ${err.message}` });
    }

    const usage = result.usage || {};
    totalUsage.inputTokens += usage.inputTokens || 0;
    totalUsage.outputTokens += usage.outputTokens || 0;
    totalUsage.cachedTokens += usage.cachedTokens || 0;
    totalUsage.thinkingTokens += usage.thinkingTokens || 0;

    const llmElapsed = ((Date.now() - llmStart) / 1000).toFixed(1);
    console.log(`  LLM script:  ${attempt === 1 ? 'generated' : `repaired attempt ${attempt}`} in ${llmElapsed}s`);
    writeAnalyticsArtifact(runDir, attempt === 1 ? 'model-response.txt' : `attempt_${attempt}_model-response.txt`, result.text || '');
    writeAnalyticsArtifact(runDir, `attempt_${attempt}_model-response.txt`, result.text || '');

    const pythonScript = extractPythonScriptFromResponse(result.text || '');
    if (!pythonScript) {
      previousScript = result.text || '';
      lastFailure = {
        stage: attempt === 1 ? 'extract-script' : 'extract-repair-script',
        error: 'LLM did not produce a Python script',
        stdout: '',
        stderr: '',
      };
      attempts.push({ attempt, stage: lastFailure.stage, error: lastFailure.error });
      writeAnalyticsArtifact(runDir, `attempt_${attempt}_error.json`, lastFailure);
    } else {
      previousScript = pythonScript;
      const runResult = await runAnalysisScriptAttempt({
        runDir,
        attempt,
        script: pythonScript,
        inlineMetadata,
        dataFilePath,
      });
      console.log(`  Script:      ${runResult.scriptPath}`);

      if (runResult.ok) {
        const analysisResult = runResult.result;
        writeAnalyticsArtifact(runDir, 'result.json', analysisResult);
        const tables = Array.isArray(analysisResult.tables) ? analysisResult.tables : [];
        const charts = Array.isArray(analysisResult.charts) ? analysisResult.charts : [];
        const insights = Array.isArray(analysisResult.insights) ? analysisResult.insights : [];

        console.log(`  \x1b[32m✓ Analysis complete in ${runResult.execElapsed}s on attempt ${attempt}\x1b[0m`);
        console.log(`  Output:      ${tables.length} table(s), ${charts.length} chart(s), ${insights.length} insight(s)`);

        return res.json({
          tables,
          charts,
          insights,
          artifactPath: path.relative(getProjectDir(projectId), runDir),
          usage: totalUsage,
        });
      }

      lastFailure = {
        stage: runResult.stage,
        error: runResult.error,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        execElapsed: runResult.execElapsed,
      };
      attempts.push({
        attempt,
        stage: runResult.stage,
        error: runResult.error,
        execElapsed: runResult.execElapsed,
      });
      writeAnalyticsArtifact(runDir, `attempt_${attempt}_error.json`, lastFailure);
      console.error(`  \x1b[31m✗ Attempt ${attempt} failed at ${runResult.stage} after ${runResult.execElapsed}s\x1b[0m`);
      console.error(`  Error:       ${String(runResult.error || '').slice(0, 500)}`);
      if (runResult.stderr) console.error(`  [stderr]     ${runResult.stderr.slice(0, 500)}`);
      if (runResult.stdout) console.error(`  [stdout]     ${runResult.stdout.slice(0, 500)}`);
    }

    if (attempt < MAX_ANALYSIS_SCRIPT_ATTEMPTS) {
      console.log(`  Repair:      requesting corrected script (attempt ${attempt + 1}/${MAX_ANALYSIS_SCRIPT_ATTEMPTS})`);
      currentMessages = buildAnalysisRepairMessages({
        userPrompt,
        schemaDescription,
        previousScript,
        failure: lastFailure,
        attempt: attempt + 1,
        maxAttempts: MAX_ANALYSIS_SCRIPT_ATTEMPTS,
      });
    }
  }

  const finalError = lastFailure?.error || 'Analysis script failed';
  writeAnalyticsArtifact(runDir, 'error.json', {
    stage: lastFailure?.stage || 'analysis-failed',
    error: finalError,
    attempts,
  });
  return res.status(500).json({ error: `Script failed after ${MAX_ANALYSIS_SCRIPT_ATTEMPTS} attempts: ${finalError}` });
});

// ============================================================
// Settings (persisted to settings.json)
// ============================================================

app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  res.setHeader('Cache-Control', 'no-store');
  // Return active provider and all per-provider configs
  const configuredProviders = {};
  for (const [key, cfg] of Object.entries(settings.providers || {})) {
    configuredProviders[key] = {
      apiKey: cfg.apiKey || '',
      model: cfg.model || '',
      baseUrl: cfg.baseUrl || '',
    };
  }
  res.json({
    activeProvider: settings.activeProvider,
    providers: configuredProviders,
    tavilyApiKey: settings.tavilyApiKey || '',
  });
});

app.put('/api/settings', (req, res) => {
  try {
    const existing = loadSettings();
    const activeProvider = typeof req.body?.activeProvider === 'string' && SUPPORTED_PROVIDERS.has(req.body.activeProvider)
      ? req.body.activeProvider
      : existing.activeProvider;

    // Update a specific provider's config
    const targetProvider = typeof req.body?.provider === 'string' ? req.body.provider : activeProvider;
    if (!SUPPORTED_PROVIDERS.has(targetProvider)) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }

    const providers = { ...existing.providers };
    const existingCfg = providers[targetProvider] || {};

    providers[targetProvider] = {
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : (existingCfg.apiKey || ''),
      model: typeof req.body?.model === 'string' ? req.body.model.trim() : (existingCfg.model || ''),
      baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : (existingCfg.baseUrl || ''),
    };

    // Handle Tavily API key (stored at root level, not under providers)
    const tavilyApiKey = typeof req.body?.tavilyApiKey === 'string'
      ? req.body.tavilyApiKey.trim()
      : (existing.tavilyApiKey || '');

    const nextSettings = { activeProvider, providers, tavilyApiKey };
    writeJsonFile(SETTINGS_PATH, nextSettings);
    res.json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to save settings' });
  }
});

// Pricing
app.get('/api/pricing', (req, res) => {
  if (!fs.existsSync(PRICING_PATH)) return res.json({ models: {}, custom: {} });
  res.json(readJsonFile(PRICING_PATH, { models: {}, custom: {} }));
});

app.put('/api/pricing/custom', (req, res) => {
  const { model, input, cached, output } = req.body;
  if (!model) return res.status(400).json({ error: 'Model name is required' });
  const pricing = fs.existsSync(PRICING_PATH)
    ? readJsonFile(PRICING_PATH, { models: {}, custom: {} })
    : { models: {}, custom: {} };
  if (!pricing.custom) pricing.custom = {};
  pricing.custom[model] = { input: Number(input), cached: Number(cached), output: Number(output) };
  writeJsonFile(PRICING_PATH, pricing);
  res.json({ success: true });
});

// ============================================================
// Static file serving (production)
// ============================================================

const distPath = path.join(ROOT_DIR, 'dist');
migrateLegacyProjects();
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

const server = app.listen(PORT, () => {
  console.log(`OpenSlides server running on http://localhost:${PORT}`);
});
server.requestTimeout = OPENAI_COMPATIBLE_TIMEOUT_MS + 60000;
server.headersTimeout = OPENAI_COMPATIBLE_TIMEOUT_MS + 65000;
server.keepAliveTimeout = 65000;

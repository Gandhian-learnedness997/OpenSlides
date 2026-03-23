import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const PROJECTS_DIR = path.join(__dirname, 'projects');

// Ensure projects directory exists
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

app.use(express.json({ limit: '50mb' }));

// ============================================================
// AI Generation Proxy
// ============================================================

app.post('/api/generate', async (req, res) => {
  const { provider, model, apiKey, baseUrl, system, messages, temperature = 0.7, files } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }

  if (!baseUrl) {
    return res.status(400).json({ error: 'No base URL configured' });
  }

  const base = baseUrl.replace(/\/$/, '');

  try {
    let result;
    if (provider === 'claude') {
      result = await callClaude(base, apiKey, model, system, messages, temperature, files);
    } else {
      // Gemini and GPT both use OpenAI-compatible format
      result = await callOpenAICompatible(base, apiKey, model, system, messages, temperature, files);
    }
    res.json(result);
  } catch (error) {
    console.error('AI generation error:', error);
    res.status(500).json({ error: error.message || 'AI generation failed' });
  }
});

async function callClaude(baseUrl, apiKey, model, systemText, messages, temperature, files) {
  // Claude native Anthropic format with cache_control
  const systemBlocks = [];

  // System instruction with cache_control for caching
  if (systemText) {
    systemBlocks.push({
      type: 'text',
      text: systemText,
      cache_control: { type: 'ephemeral' },
    });
  }

  // Convert messages to Claude format
  const claudeMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue; // handled above

    const content = [];

    // Handle file attachments (images) in the message
    if (msg.files && msg.files.length > 0) {
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/')) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: f.mimeType,
              data: f.data,
            },
          });
        }
      }
    }

    content.push({ type: 'text', text: msg.content });

    claudeMessages.push({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content,
    });
  }

  // Ensure messages alternate user/assistant and start with user
  const sanitized = sanitizeMessages(claudeMessages);

  const body = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    temperature,
    system: systemBlocks,
    messages: sanitized,
  };

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

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
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
    },
  };
}

async function callOpenAICompatible(baseUrl, apiKey, model, systemText, messages, temperature, files) {
  // OpenAI-compatible format (works for Gemini and GPT via aihubmix)
  const oaiMessages = [];

  if (systemText) {
    oaiMessages.push({ role: 'system', content: systemText });
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'model' ? 'assistant' : msg.role;

    // Handle file attachments (images as vision content)
    if (msg.files && msg.files.length > 0) {
      const content = [];
      for (const f of msg.files) {
        if (f.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:${f.mimeType};base64,${f.data}` },
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
    model: model || 'gemini-2.5-flash',
    messages: oaiMessages,
    temperature,
    max_tokens: 16384,
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
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
      // Merge with previous
      if (typeof result[result.length - 1].content === 'string') {
        result[result.length - 1].content += '\n\n' + (typeof msg.content === 'string' ? msg.content : msg.content.filter(b => b.type === 'text').map(b => b.text).join(''));
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
  return path.join(PROJECTS_DIR, projectId);
}

function ensureProjectDir(projectId) {
  const dir = getProjectDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const statesDir = path.join(dir, 'states');
  if (!fs.existsSync(statesDir)) fs.mkdirSync(statesDir, { recursive: true });
  return dir;
}

// List all projects
app.get('/api/projects', (req, res) => {
  const metaPath = path.join(PROJECTS_DIR, '_projects.json');
  if (!fs.existsSync(metaPath)) return res.json([]);
  const projects = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  projects.sort((a, b) => new Date(b.last_accessed_at || b.created_at) - new Date(a.last_accessed_at || a.created_at));
  res.json(projects);
});

// Create project
app.post('/api/projects', (req, res) => {
  const { id, name } = req.body;
  const metaPath = path.join(PROJECTS_DIR, '_projects.json');
  const projects = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : [];

  const project = {
    id,
    name,
    created_at: new Date().toISOString(),
    last_accessed_at: new Date().toISOString(),
  };
  projects.push(project);
  fs.writeFileSync(metaPath, JSON.stringify(projects, null, 2));
  ensureProjectDir(id);
  res.json(project);
});

// Update project access time
app.patch('/api/projects/:id', (req, res) => {
  const metaPath = path.join(PROJECTS_DIR, '_projects.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Not found' });
  const projects = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const idx = projects.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  projects[idx] = { ...projects[idx], ...req.body, id: req.params.id };
  fs.writeFileSync(metaPath, JSON.stringify(projects, null, 2));
  res.json(projects[idx]);
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const metaPath = path.join(PROJECTS_DIR, '_projects.json');
  if (fs.existsSync(metaPath)) {
    const projects = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const remaining = projects.filter(p => p.id !== req.params.id);
    fs.writeFileSync(metaPath, JSON.stringify(remaining, null, 2));
  }
  const dir = getProjectDir(req.params.id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.json({ success: true });
});

// Slide info
app.get('/api/projects/:id/info', (req, res) => {
  const infoPath = path.join(getProjectDir(req.params.id), 'info.json');
  if (!fs.existsSync(infoPath)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(infoPath, 'utf-8')));
});

app.put('/api/projects/:id/info', (req, res) => {
  ensureProjectDir(req.params.id);
  const infoPath = path.join(getProjectDir(req.params.id), 'info.json');
  fs.writeFileSync(infoPath, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// States
app.post('/api/projects/:id/states', (req, res) => {
  const { stateId, html, chat } = req.body;
  ensureProjectDir(req.params.id);
  const statePath = path.join(getProjectDir(req.params.id), 'states', `${stateId}.json`);
  fs.writeFileSync(statePath, JSON.stringify({ html, chat }, null, 2));
  res.json({ path: statePath });
});

app.get('/api/projects/:id/states/:stateId', (req, res) => {
  const statePath = path.join(getProjectDir(req.params.id), 'states', `${req.params.stateId}.json`);
  if (!fs.existsSync(statePath)) return res.status(404).json({ error: 'State not found' });
  res.json(JSON.parse(fs.readFileSync(statePath, 'utf-8')));
});

app.delete('/api/projects/:id/states/:stateId', (req, res) => {
  const statePath = path.join(getProjectDir(req.params.id), 'states', `${req.params.stateId}.json`);
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  res.json({ success: true });
});

// Files
app.get('/api/projects/:id/files', (req, res) => {
  const filesPath = path.join(getProjectDir(req.params.id), 'files.json');
  if (!fs.existsSync(filesPath)) return res.json([]);
  res.json(JSON.parse(fs.readFileSync(filesPath, 'utf-8')));
});

app.put('/api/projects/:id/files', (req, res) => {
  ensureProjectDir(req.params.id);
  const filesPath = path.join(getProjectDir(req.params.id), 'files.json');
  fs.writeFileSync(filesPath, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// ============================================================
// Settings (persisted to settings.json)
// ============================================================

const SETTINGS_PATH = path.join(__dirname, 'settings.json');

app.get('/api/settings', (req, res) => {
  if (!fs.existsSync(SETTINGS_PATH)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')));
});

app.put('/api/settings', (req, res) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// ============================================================
// Static file serving (production)
// ============================================================

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`OpenSlides server running on http://localhost:${PORT}`);
});

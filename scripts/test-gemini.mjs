import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let [, key, value] = match;
    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return '';
}

function maskKey(key) {
  if (!key) return '(missing)';
  if (key.length <= 8) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function main() {
  const localEnv = {
    ...parseDotEnv(path.join(projectRoot, '.env')),
    ...parseDotEnv(path.join(process.cwd(), '.env')),
  };

  const apiKey =
    getArgValue('--api-key') ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    localEnv.GEMINI_API_KEY ||
    localEnv.GOOGLE_API_KEY;

  const model =
    getArgValue('--model') ||
    process.env.GEMINI_MODEL ||
    localEnv.GEMINI_MODEL ||
    'gemini-2.5-flash';

  const baseUrl =
    getArgValue('--base-url') ||
    process.env.GEMINI_BASE_URL ||
    localEnv.GEMINI_BASE_URL ||
    'https://generativelanguage.googleapis.com';

  const prompt =
    getArgValue('--prompt') ||
    'Reply with exactly: GEMINI_OK';

  if (!apiKey) {
    console.error('Missing Gemini API key.');
    console.error('Set `GEMINI_API_KEY` or `GOOGLE_API_KEY`, or pass `--api-key`.');
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 64,
    },
  };

  console.log('Testing Gemini connection...');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Model: ${model}`);
  console.log(`API Key: ${maskKey(apiKey)}`);

  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const elapsedMs = Date.now() - startedAt;
    const textBody = await response.text();

    if (!response.ok) {
      console.error(`Request failed with HTTP ${response.status} in ${elapsedMs} ms.`);
      console.error(textBody);
      process.exit(1);
    }

    const data = JSON.parse(textBody);
    const output =
      data.candidates?.[0]?.content?.parts
        ?.filter((part) => part.text)
        .map((part) => part.text)
        .join('') || '';

    console.log(`Success in ${elapsedMs} ms.`);
    console.log(`Output: ${output || '(empty response)'}`);

    if (data.usageMetadata) {
      console.log(
        `Usage: prompt=${data.usageMetadata.promptTokenCount || 0}, output=${data.usageMetadata.candidatesTokenCount || 0}, cached=${data.usageMetadata.cachedContentTokenCount || 0}`
      );
    }
  } catch (error) {
    console.error('Connection test failed before receiving an HTTP response.');
    console.error(error);
    process.exit(1);
  }
}

main();

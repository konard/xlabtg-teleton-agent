// Built-in prompt templates — imported as raw text at build time via Vite's ?raw suffix.
import helpfulAssistantRaw from './helpful-assistant.md?raw';
import codingExpertRaw from './coding-expert.md?raw';
import tradingBotRaw from './trading-bot.md?raw';
import customerSupportRaw from './customer-support.md?raw';
import knowledgeWorkerRaw from './knowledge-worker.md?raw';

// Per-file examples — one per Soul file type.
import exampleSoulRaw from './examples/SOUL.md?raw';
import exampleSecurityRaw from './examples/SECURITY.md?raw';
import exampleStrategyRaw from './examples/STRATEGY.md?raw';
import exampleMemoryRaw from './examples/MEMORY.md?raw';
import exampleHeartbeatRaw from './examples/HEARTBEAT.md?raw';

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
}

/** Strip YAML frontmatter (--- ... ---) from a markdown string. */
function stripFrontmatter(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return match ? raw.slice(match[0].length) : raw;
}

/** Parse the `name` and `description` fields from YAML frontmatter. */
function parseMeta(raw: string): { name: string; description: string; category: string } {
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? '';
  const get = (key: string) =>
    new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm').exec(fm)?.[1]?.trim() ?? '';
  return { name: get('name'), description: get('description'), category: get('category') };
}

function makeTemplate(id: string, raw: string): Template {
  const meta = parseMeta(raw);
  return { id, ...meta, content: stripFrontmatter(raw) };
}

/** All built-in prompt templates. */
export const TEMPLATES: Template[] = [
  makeTemplate('helpful-assistant', helpfulAssistantRaw),
  makeTemplate('coding-expert', codingExpertRaw),
  makeTemplate('trading-bot', tradingBotRaw),
  makeTemplate('customer-support', customerSupportRaw),
  makeTemplate('knowledge-worker', knowledgeWorkerRaw),
];

/** Per-file examples keyed by Soul filename. */
export const FILE_EXAMPLES: Record<string, Template> = {
  'SOUL.md': makeTemplate('example-soul', exampleSoulRaw),
  'SECURITY.md': makeTemplate('example-security', exampleSecurityRaw),
  'STRATEGY.md': makeTemplate('example-strategy', exampleStrategyRaw),
  'MEMORY.md': makeTemplate('example-memory', exampleMemoryRaw),
  'HEARTBEAT.md': makeTemplate('example-heartbeat', exampleHeartbeatRaw),
};

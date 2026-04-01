import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const pluginsDir = path.join(rootDir, 'src', 'plugins');
const outputPath = path.join(rootDir, 'docs', 'COMMANDS.md');

function titleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeCategory(value) {
  return titleCase(value || 'Uncategorized');
}

function extractString(body, key) {
  const match = body.match(new RegExp(`${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match ? match[2].trim() : '';
}

function extractAliases(body) {
  const match = body.match(/aliases\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return [];

  return Array.from(match[1].matchAll(/(['"`])([\s\S]*?)\1/g))
    .map((entry) => entry[2].trim())
    .filter(Boolean);
}

function extractCommandsArray(source) {
  const marker = 'commands';
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return '';

  const bracketStart = source.indexOf('[', markerIndex);
  if (bracketStart === -1) return '';

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let index = bracketStart; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bracketStart + 1, index);
      }
    }
  }

  return '';
}

function extractCommandBlocks(commandsSource) {
  const blocks = [];
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let index = 0; index < commandsSource.length; index += 1) {
    const char = commandsSource[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) startIndex = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && startIndex !== -1) {
        blocks.push(commandsSource.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return blocks;
}

function parsePlugin(fileName) {
  const filePath = path.join(pluginsDir, fileName);
  const source = fs.readFileSync(filePath, 'utf8');
  const commandsSource = extractCommandsArray(source);
  const commandBlocks = extractCommandBlocks(commandsSource);
  const pluginPath = `src/plugins/${fileName}`;

  return commandBlocks
    .map((block) => {
      const name = extractString(block, 'name');
      if (!name) return null;

      return {
        name,
        aliases: extractAliases(block),
        usage: extractString(block, 'usage'),
        description: extractString(block, 'description'),
        category: normalizeCategory(extractString(block, 'category')),
        pluginPath
      };
    })
    .filter(Boolean);
}

function collectCommands() {
  const files = fs.readdirSync(pluginsDir)
    .filter((file) => file.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b));

  return files.flatMap((file) => parsePlugin(file))
    .sort((a, b) => (
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name)
    ));
}

function renderMarkdown(commands) {
  const grouped = new Map();

  for (const command of commands) {
    const list = grouped.get(command.category) || [];
    list.push(command);
    grouped.set(command.category, list);
  }

  const lines = [
    '# Commands Overview',
    '',
    '> This file is generated from plugin metadata in `src/plugins`. Run `npm run docs:commands` after adding or changing commands.',
    '',
    'For live command help inside WhatsApp, use:',
    '',
    '- `.menu`',
    '- `.help`',
    '- `.help <command>`'
  ];

  for (const [category, categoryCommands] of grouped.entries()) {
    lines.push('', `## ${category}`, '');

    for (const command of categoryCommands) {
      lines.push(`### \`${command.name}\``, '');
      lines.push(command.description || 'No description provided.', '');
      lines.push(`- Usage: ${command.usage ? `\`${command.usage}\`` : 'not specified'}`);
      lines.push(`- Aliases: ${command.aliases.length ? command.aliases.map((alias) => `\`${alias}\``).join(', ') : 'none'}`);
      lines.push(`- Plugin: \`${command.pluginPath}\``);
      lines.push('');
    }
  }

  lines.push('## Notes', '');
  lines.push('- Keep `README.md`, architecture docs, and plugin guides hand-written and stable.');
  lines.push('- Treat this command reference as generated output from the source of truth in plugin metadata.');

  return `${lines.join('\n').trim()}\n`;
}

const commands = collectCommands();
fs.writeFileSync(outputPath, renderMarkdown(commands), 'utf8');
console.log(`Generated ${commands.length} commands into ${outputPath}.`);

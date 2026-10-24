/**
 * Reading and writing the OpenCode configuration through the host file API.
 *
 * The panel only ever rewrites `providers.<id>` (and removes the V1
 * `provider.<id>` twin), using `jsonc-parser`'s surgical edits: comments,
 * trailing commas, key order, indentation, line endings and every unrelated
 * setting stay byte for byte. Nothing here talks to the network.
 */
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { isObject, type JsonObject } from './json';
import { collectProviders, type ProviderEntry } from './provider';

export type ConfigFile = {
  path: string;
  /** File text, or null when the file does not exist. */
  text: string | null;
  config: JsonObject;
};

export type Snapshot = {
  /** Files that exist, lowest precedence first. */
  files: ConfigFile[];
  /** Every provider, keyed by ID; a later file replaces an earlier one. */
  providers: ProviderEntry[];
  /** Where new providers are written. */
  target: string;
};

export type FileHost = {
  stat: (path: string) => Promise<{ kind: string }>;
  readFile: (path: string) => Promise<{ content: string }>;
  writeFile: (path: string, content: string) => Promise<unknown>;
};

/** `opencode.json` and `opencode.jsonc`, lower precedence first: jsonc wins. */
export const CONFIG_PATHS = [
  '~/.config/opencode/opencode.json',
  '~/.config/opencode/opencode.jsonc',
] as const;

export const NEW_FILE_PATH = CONFIG_PATHS[1];

const isMissing = (kind: string): boolean => kind === 'missing';

/** Parses JSONC, turning a syntax error into a message naming the offset. */
export const parseConfig = (text: string, path: string): JsonObject => {
  // Editors on Windows may save a UTF-8 BOM; jsonc-parser rejects it as an
  // invalid symbol, which would make a perfectly readable file unopenable.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  const first = errors[0];
  if (first) {
    const line = source.slice(0, first.offset).split('\n');
    throw new Error(`${path}: ${printParseErrorCode(first.error)} at line ${line.length}, column ${(line[line.length - 1]?.length ?? 0) + 1}`);
  }
  if (!isObject(value)) throw new Error(`${path}: the root must be a JSON object.`);
  return value;
};

export const readSnapshot = async (host: FileHost): Promise<Snapshot> => {
  const files: ConfigFile[] = [];
  for (const path of CONFIG_PATHS) {
    const stat = await host.stat(path);
    if (isMissing(stat.kind)) continue;
    if (stat.kind !== 'file') throw new Error(`${path} is a ${stat.kind}, not a file.`);
    const { content } = await host.readFile(path);
    files.push({ path, text: content, config: parseConfig(content, path) });
  }

  const merged = new Map<string, ProviderEntry>();
  for (const file of files) {
    for (const entry of collectProviders(file.config, file.path)) merged.set(entry.id, entry);
  }

  return {
    files,
    providers: [...merged.values()].sort((left, right) => left.id.localeCompare(right.id)),
    target: files.some((file) => file.path === NEW_FILE_PATH) || files.length === 0
      ? NEW_FILE_PATH
      : files[files.length - 1]!.path,
  };
};

const indentOf = (text: string): { insertSpaces: boolean; tabSize: number } => {
  const match = /^([ \t]+)"/m.exec(text);
  if (!match) return { insertSpaces: true, tabSize: 2 };
  const indent = match[1]!;
  return indent.startsWith('\t')
    ? { insertSpaces: false, tabSize: 1 }
    : { insertSpaces: true, tabSize: indent.length };
};

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

const formattingOf = (text: string) => ({
  insertSpaces: indentOf(text).insertSpaces,
  tabSize: indentOf(text).tabSize,
  eol: eolOf(text),
  insertFinalNewline: text.endsWith('\n'),
});

/** Removes a now-empty `providers` / `provider` block so the file stays clean. */
const dropEmptyBlocks = (text: string): string => {
  let current = text;
  for (const key of ['providers', 'provider'] as const) {
    let config: JsonObject;
    try {
      config = parse(current) as JsonObject;
    } catch {
      return current;
    }
    const block = config[key];
    if (!isObject(block) || Object.keys(block).length > 0) continue;
    current = applyEdits(current, modify(current, [key], undefined, { formattingOptions: formattingOf(current) }));
  }
  return current;
};

/**
 * Sets `providers.<id>` to `block` in `text`, preserving everything else. A
 * V1 `provider.<id>` twin is removed when the key is updated too. Returns the
 * patched text.
 */
export const writeProvider = (
  text: string | null,
  id: string,
  block: JsonObject,
  removeLegacy = true,
): string => {
  const source = text ?? '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const formattingOptions = formattingOf(source);

  let next = applyEdits(source, modify(source, ['providers', id], block, { formattingOptions }));
  if (removeLegacy) {
    // V1 kept the same blocks under `provider`; leaving them behind makes a
    // deleted provider reappear on the next read.
    try {
      const legacy = parse(next) as JsonObject;
      if (isObject(legacy.provider) && id in legacy.provider) {
        next = applyEdits(next, modify(next, ['provider', id], undefined, { formattingOptions }));
      }
    } catch {
      // Unparseable text cannot have a legacy block this panel wrote.
    }
  }
  return dropEmptyBlocks(next);
};

/** Removes `providers.<id>` (and its V1 twin) from `text`. Returns null when nothing matched. */
export const removeProvider = (text: string, id: string): string | null => {
  const config = parseConfig(text, 'configuration');
  const inV2 = isObject(config.providers) && id in config.providers;
  const inV1 = isObject(config.provider) && id in config.provider;
  if (!inV2 && !inV1) return null;

  const formattingOptions = formattingOf(text);
  let next = text;
  if (inV2) next = applyEdits(next, modify(next, ['providers', id], undefined, { formattingOptions }));
  if (inV1) next = applyEdits(next, modify(next, ['provider', id], undefined, { formattingOptions }));
  return dropEmptyBlocks(next);
};

/** True when the file still holds a provider after an edit (used to confirm a delete). */
export const hasProvider = (text: string, id: string): boolean => {
  const config = parseConfig(text, 'configuration');
  return (isObject(config.providers) && id in config.providers)
    || (isObject(config.provider) && id in config.provider);
};

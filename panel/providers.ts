/**
 * Provider drafts ↔ opencode.json provider blocks. Pure data code — no DOM,
 * no host — so it stays unit-testable.
 *
 * `buildProvider` merges what the form collected with the block already on
 * disk, so saving from OpenChamber Providers keeps the fields it does not manage (provider
 * headers/env, per-model cost/status/options/...). `draftFrom` and
 * `collectProviders` read both the v2 spelling (`package`, `settings`,
 * `modelID`) and the legacy v1 one (`npm`, `options`, `id`), and a v1 entry
 * is rewritten in the v2 spelling on save.
 */
import { isObject, type Json, type JsonObject } from './jsonc';

export const PROTOCOLS = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions', package: 'aisdk:@ai-sdk/openai-compatible' },
  { id: 'openai-responses', label: 'OpenAI Responses', package: 'aisdk:@ai-sdk/openai' },
  { id: 'anthropic-messages', label: 'Anthropic Messages', package: 'aisdk:@ai-sdk/anthropic' },
] as const;

export type ProtocolId = (typeof PROTOCOLS)[number]['id'];

/** Reasoning levels offered as cards, in the order they are shown. */
export const REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Levels a model declares when nobody has chosen yet. */
export const DEFAULT_REASONING_LEVELS: string[] = ['low', 'medium', 'high'];

export type ModelDraft = {
  key: string;
  id: string;
  sourceID?: string;
  name: string;
  context: string;
  output: string;
  /** Variant ids the model declares, in the order they are written. */
  levels: string[];
  /** Whether the model accepts image input (``capabilities.input``). */
  image: boolean;
  /** Whether the model can call tools (``capabilities.tools``). */
  tools: boolean;
};

export type ProviderDraft = {
  providerID: string;
  name: string;
  protocol: ProtocolId;
  /** Package already on disk; carried over when the protocol still matches it. */
  package?: string;
  baseURL: string;
  apiKey: string;
  models: ModelDraft[];
};

export const settingsOf = (provider: JsonObject): JsonObject => (
  isObject(provider.settings) ? provider.settings : isObject(provider.options) ? provider.options : {}
);

export const packageOf = (provider: JsonObject): string => {
  const withPrefix = (value: string): string => `aisdk:${value.replace(/^aisdk:/, '')}`;
  if (typeof provider.package === 'string' && provider.package) return provider.package;
  if (typeof provider.npm === 'string' && provider.npm) return withPrefix(provider.npm);
  if (isObject(provider.api) && typeof provider.api.npm === 'string' && provider.api.npm) {
    return withPrefix(provider.api.npm);
  }
  return '';
};

export const protocolFromPackage = (pkg: string): ProtocolId => {
  if (pkg.includes('anthropic')) return 'anthropic-messages';
  if (pkg.includes('openai-compatible') || pkg.includes('/chat')) return 'openai-chat';
  if (pkg.includes('openai')) return 'openai-responses';
  return 'openai-chat';
};

/**
 * Image input support. Reads the v2 `capabilities.input` list and falls back
 * to the v1 `attachment` flag, then to OpenCode's own default (enabled).
 */
const imageInputOf = (model: JsonObject): boolean => {
  const capabilities = isObject(model.capabilities) ? model.capabilities : null;
  if (capabilities && Array.isArray(capabilities.input)) {
    return capabilities.input.includes('image');
  }
  return typeof model.attachment === 'boolean' ? model.attachment : true;
};

/**
 * Tool support. Reads the v2 `capabilities.tools` flag and falls back to the
 * v1 `tool_call` flag, then to OpenCode's own default (enabled).
 */
const toolCallOf = (model: JsonObject): boolean => {
  const capabilities = isObject(model.capabilities) ? model.capabilities : null;
  if (capabilities && typeof capabilities.tools === 'boolean') return capabilities.tools;
  return typeof model.tool_call === 'boolean' ? model.tool_call : true;
};

let modelKeySeq = 0;

/**
 * Fallbacks for a blank context length / max output field, in tokens. These
 * are shown as input placeholders and written to the config when the field is
 * left empty, so the form starts blank but still produces working limits.
 */
export const DEFAULT_CONTEXT = '272000';
export const DEFAULT_OUTPUT = '128000';

export const emptyModel = (): ModelDraft => ({
  key: `m${modelKeySeq += 1}`,
  id: '',
  name: '',
  context: '',
  output: '',
  levels: [...DEFAULT_REASONING_LEVELS],
  image: true,
  tools: true,
});

export const emptyDraft = (): ProviderDraft => ({
  providerID: '',
  name: '',
  protocol: 'openai-chat',
  baseURL: '',
  apiKey: '',
  models: [emptyModel()],
});

/** Variant ids from either the v2 array or the v1 record spelling. */
const variantLevels = (source: Json): string[] => {
  if (Array.isArray(source)) {
    return source
      .map((variant) => (isObject(variant) && typeof variant.id === 'string' ? variant.id : ''))
      .filter((id) => id.length > 0);
  }
  if (isObject(source)) {
    return Object.entries(source)
      .filter(([, value]) => !(isObject(value) && value.disabled === true))
      .map(([id]) => id);
  }
  return [];
};

export const readModels = (provider: JsonObject): ModelDraft[] => {
  const models = provider.models;
  const pairs: Array<[string, Json]> = Array.isArray(models)
    ? models.map((item, index) => {
        const entry = isObject(item) ? item : {};
        const id = typeof entry.modelID === 'string' ? entry.modelID : typeof entry.id === 'string' ? entry.id : String(index);
        return [id, item] as [string, Json];
      })
    : isObject(models)
      ? Object.entries(models)
      : [];

  const drafts = pairs.map(([key, value]) => {
    const entry = isObject(value) ? value : {};
    const id = typeof entry.modelID === 'string' && entry.modelID
      ? entry.modelID
      : typeof entry.id === 'string' && entry.id
        ? entry.id
        : key;
    const limit = isObject(entry.limit) ? entry.limit : {};
    return {
      key: `m${modelKeySeq += 1}`,
      id,
      sourceID: id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : id,
      context: typeof limit.context === 'number' ? String(limit.context) : '',
      output: typeof limit.output === 'number' ? String(limit.output) : '',
      levels: variantLevels(entry.variants),
      image: imageInputOf(entry),
      tools: toolCallOf(entry),
    };
  });

  return drafts.length > 0 ? drafts : [emptyModel()];
};

export const draftFrom = (id: string, provider: JsonObject): ProviderDraft => {
  const settings = settingsOf(provider);
  const pkg = packageOf(provider);
  return {
    providerID: id,
    name: typeof provider.name === 'string' && provider.name ? provider.name : id,
    protocol: protocolFromPackage(pkg),
    package: pkg || undefined,
    baseURL: typeof settings.baseURL === 'string' ? settings.baseURL : '',
    apiKey: typeof settings.apiKey === 'string' ? settings.apiKey : '',
    models: readModels(provider),
  };
};

const variantOverlay = (protocol: ProtocolId, effort: string): JsonObject => {
  if (protocol === 'anthropic-messages') {
    return { thinking: { type: 'adaptive', display: 'summarized' }, effort };
  }
  if (protocol === 'openai-responses') {
    return { reasoningEffort: effort, reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] };
  }
  return { reasoningEffort: effort };
};

export const positiveInt = (text: string): number | undefined => {
  const normalized = text.trim();
  const value = Number(normalized);
  return /^[0-9]+$/.test(normalized) && Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

const variantsOf = (model: JsonObject): JsonObject[] => {
  if (Array.isArray(model.variants)) return model.variants.filter(isObject);
  if (isObject(model.variants)) {
    return Object.entries(model.variants)
      .filter(([, value]) => isObject(value))
      .map(([id, value]) => ({ id, settings: value }));
  }
  return [];
};

const variantFor = (model: JsonObject, level: string, protocol: ProtocolId): JsonObject => {
  const previous = variantsOf(model).find((variant) => variant.id === level) ?? {};
  const settings = isObject(previous.settings) ? previous.settings : {};
  return { ...previous, id: level, settings: { ...settings, ...variantOverlay(protocol, level) } };
};

export const buildProvider = (draft: ProviderDraft, existing?: JsonObject): JsonObject => {
  const previous = existing ?? {};
  const previousModels = isObject(previous.models) ? previous.models : {};

  const models: JsonObject = {};
  for (const model of draft.models) {
    const id = model.id.trim();
    if (!id) continue;
    const sourceID = model.sourceID && isObject(previousModels[model.sourceID]) ? model.sourceID : id;
    const previousModel = isObject(previousModels[sourceID]) ? previousModels[sourceID] : {};
    // `id` and `provider` are the v1 model spellings of what we write below.
    const carried: JsonObject = { ...previousModel };
    delete carried.id;
    delete carried.provider;
    const entry: JsonObject = { ...carried, modelID: id, name: model.name.trim() || id };

    const previousLimit = isObject(previousModel.limit) ? previousModel.limit : {};
    const limit: JsonObject = { ...previousLimit };
    // A blank field falls back to the default so the form can stay empty while
    // the saved config still carries usable limits.
    const context = positiveInt(model.context) ?? positiveInt(DEFAULT_CONTEXT);
    const output = positiveInt(model.output) ?? positiveInt(DEFAULT_OUTPUT);
    if (context !== undefined) limit.context = context;
    else delete limit.context;
    if (output !== undefined) limit.output = output;
    else delete limit.output;
    if (Object.keys(limit).length > 0) entry.limit = limit;
    else delete entry.limit;

    const levels: string[] = [];
    for (const level of model.levels) {
      const trimmed = level.trim();
      if (trimmed && !levels.includes(trimmed)) levels.push(trimmed);
    }
    if (levels.length > 0) {
      entry.variants = levels.map((level) => variantFor(previousModel, level, draft.protocol));
    } else {
      delete entry.variants;
    }

    // Declare capabilities explicitly so clients do not have to rely on
    // OpenCode's custom-model fallbacks. Extra input modalities (video, pdf,
    // audio) set outside OpenChamber Providers are preserved; the v1 `attachment` and
    // `tool_call` flags are folded into the v2 `capabilities` block.
    const previousCapabilities = isObject(previousModel.capabilities) ? previousModel.capabilities : {};
    const extraInput = Array.isArray(previousCapabilities.input)
      ? previousCapabilities.input.filter(
        (media): media is string => typeof media === 'string' && media !== 'text' && media !== 'image',
      )
      : [];
    const previousOutput = Array.isArray(previousCapabilities.output)
      ? previousCapabilities.output.filter((media): media is string => typeof media === 'string')
      : [];
    entry.capabilities = {
      ...previousCapabilities,
      tools: model.tools,
      input: ['text', ...(model.image ? ['image'] : []), ...extraInput],
      output: previousOutput.length > 0 ? previousOutput : ['text'],
    };
    delete entry.attachment;
    delete entry.tool_call;

    models[id] = entry;
  }

  const settings: JsonObject = { ...settingsOf(previous), baseURL: draft.baseURL.trim() };
  const apiKey = draft.apiKey.trim();
  if (apiKey) settings.apiKey = apiKey;
  else delete settings.apiKey;

  // `npm`, `options` and `api` are the v1 provider spellings of what we write
  // below; dropping them keeps a single spelling on disk.
  const carried: JsonObject = { ...previous };
  delete carried.npm;
  delete carried.options;
  delete carried.api;

  const fallbackPackage = PROTOCOLS.find((protocol) => protocol.id === draft.protocol)!.package;
  const pkg = draft.package && protocolFromPackage(draft.package) === draft.protocol
    ? draft.package
    : fallbackPackage;

  return {
    ...carried,
    name: draft.name.trim() || draft.providerID.trim(),
    package: pkg,
    settings,
    models,
  };
};

export const collectProviders = (config: JsonObject): Array<{ id: string; config: JsonObject }> => {
  const found = new Map<string, JsonObject>();
  for (const key of ['provider', 'providers'] as const) {
    const block = config[key];
    if (!isObject(block)) continue;
    for (const [id, value] of Object.entries(block)) {
      if (isObject(value)) found.set(id, value);
    }
  }
  return [...found.entries()]
    .map(([id, value]) => ({ id, config: value }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

/**
 * Provider drafts ↔ `providers` entries in opencode.json.
 *
 * Pure data code: no DOM, no host, no file system. `buildProvider` merges the
 * form with the block already on disk so fields this panel does not manage —
 * request headers, body overlays, cost, disabled models, custom variants —
 * survive a save. `draftFrom` reads both the V2 spelling (`package`,
 * `settings`, `modelID`, array `variants`) and the V1 one (`npm`, `options`,
 * `variants` record).
 */
import {
  isObject,
  positiveInt,
  stringList,
  stringOf,
  withoutUndefined,
  type Json,
  type JsonObject,
} from './json';
import {
  DEFAULT_PROTOCOL,
  packageFrom,
  packageOfProtocol,
  protocolOfPackage,
  type ProtocolId,
} from './protocols';

/** Reasoning levels offered as cards, in display order. */
export const REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Levels written for a new model. */
export const DEFAULT_REASONING_LEVELS: string[] = ['low', 'medium', 'high'];

export type ModelDraft = {
  /** Stable key for this row, independent of the model ID. */
  key: string;
  /** Catalog ID: the key under `providers.<id>.models`. */
  id: string;
  /** Upstream ID sent to the endpoint. Empty means "same as `id`". */
  modelID: string;
  /** Model ID the row was read from, used to carry preserved fields across a rename. */
  sourceID?: string;
  name: string;
  context: string;
  output: string;
  levels: string[];
  image: boolean;
  tools: boolean;
};

export type ProviderDraft = {
  providerID: string;
  name: string;
  protocol: ProtocolId;
  /** Only used when `protocol` is `custom`. */
  customPackage: string;
  baseURL: string;
  apiKey: string;
  models: ModelDraft[];
};

export type ProviderEntry = {
  id: string;
  block: JsonObject;
  /** Which config file the block came from. */
  file: string;
  /** A provider with no package only overrides defaults of a built-in one. */
  overlay: boolean;
};

let modelKeySeq = 0;
const nextKey = (): string => `m${(modelKeySeq += 1)}`;

export const emptyModel = (): ModelDraft => ({
  key: nextKey(),
  id: '',
  modelID: '',
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
  protocol: DEFAULT_PROTOCOL,
  customPackage: '',
  baseURL: '',
  apiKey: '',
  models: [emptyModel()],
});

export const settingsOf = (provider: JsonObject): JsonObject => {
  if (isObject(provider.settings)) return provider.settings;
  if (isObject(provider.options)) return provider.options;
  return {};
};

const headersOf = (provider: JsonObject): JsonObject | undefined => {
  if (isObject(provider.headers)) return provider.headers;
  const options = isObject(provider.options) ? provider.options : undefined;
  return options && isObject(options.headers) ? options.headers : undefined;
};

const bodyOf = (provider: JsonObject): JsonObject | undefined => {
  if (isObject(provider.body)) return provider.body;
  const options = isObject(provider.options) ? provider.options : undefined;
  return options && isObject(options.body) ? options.body : undefined;
};

/** Names of the keys the previous version wrote into generated variants. */
const LEGACY_VARIANT_KEYS = new Set(['reasoningEffort', 'reasoningSummary', 'include', 'thinking', 'effort']);

/**
 * A variant this panel generated in an earlier version: a standard level ID,
 * an overlay of nothing but the old reasoning keys, and no headers or body.
 * Anything carrying a field of its own is treated as hand-written and kept.
 */
const isLegacyVariant = (variant: JsonObject): boolean => {
  const extra = Object.keys(variant).filter((key) => key !== 'id' && key !== 'settings');
  if (extra.length > 0) return false;
  const settings = isObject(variant.settings) ? variant.settings : {};
  const keys = Object.keys(settings);
  return keys.length > 0 && keys.every((key) => LEGACY_VARIANT_KEYS.has(key));
};

type VariantParts = { id: string; overlay: JsonObject };

/** Variants from the V2 array or the V1 record spelling. */
const variantsOf = (model: JsonObject): VariantParts[] => {
  const source = model.variants;
  if (Array.isArray(source)) {
    return source.flatMap((item) => (
      isObject(item) && typeof item.id === 'string' && item.id.trim()
        ? [{ id: item.id, overlay: item as JsonObject }]
        : []
    ));
  }
  if (isObject(source)) {
    return Object.entries(source).flatMap(([id, value]) => (
      isObject(value) && value.disabled !== true ? [{ id, overlay: value }] : []
    ));
  }
  return [];
};

/** Levels the config declares, as shown on the cards. */
const levelsOf = (model: JsonObject): string[] => {
  const capabilities = isObject(model.capabilities) ? model.capabilities : undefined;
  const reasoning = capabilities && isObject(capabilities.reasoning) ? capabilities.reasoning : undefined;
  if (reasoning) {
    if (reasoning.supported === false) return [];
    if (Array.isArray(reasoning.effort)) return stringList(reasoning.effort);
    // Supported without `effort`: the package decides the variants, so there
    // is no level list to edit. The cards start off rather than guessing.
    if (reasoning.supported === true) return [];
  }
  // Old entries carry their levels as variants instead.
  const ids = variantsOf(model)
    .map((variant) => variant.id)
    .filter((id) => (REASONING_LEVELS as readonly string[]).includes(id));
  return [...new Set(ids)];
};

const imageInputOf = (model: JsonObject): boolean => {
  const capabilities = isObject(model.capabilities) ? model.capabilities : undefined;
  if (capabilities && Array.isArray(capabilities.input)) {
    return stringList(capabilities.input).includes('image');
  }
  if (typeof model.attachment === 'boolean') return model.attachment;
  return true;
};

const toolCallOf = (model: JsonObject): boolean => {
  const capabilities = isObject(model.capabilities) ? model.capabilities : undefined;
  if (capabilities && typeof capabilities.tools === 'boolean') return capabilities.tools;
  if (typeof model.tool_call === 'boolean') return model.tool_call;
  return true;
};

export const readModels = (provider: JsonObject): ModelDraft[] => {
  const models = provider.models;
  const pairs: Array<[string, Json]> = Array.isArray(models)
    ? models.map((item, index) => {
      const entry = isObject(item) ? item : {};
      const id = stringOf(entry.modelID) || stringOf(entry.id) || String(index);
      return [id, item];
    })
    : isObject(models)
      ? Object.entries(models)
      : [];

  const drafts = pairs.map(([key, value]) => {
    const entry = isObject(value) ? value : {};
    const id = key;
    const upstream = stringOf(entry.modelID) || stringOf(entry.id);
    const limit = isObject(entry.limit) ? entry.limit : {};
    const levels = levelsOf(entry);
    const context = typeof limit.context === 'number' ? String(limit.context) : '';
    const output = typeof limit.output === 'number' ? String(limit.output) : '';
    return {
      key: nextKey(),
      id,
      modelID: upstream && upstream !== id ? upstream : '',
      sourceID: id,
      name: stringOf(entry.name) || id,
      context,
      output,
      // The config is the source of truth: a model with no reasoning record
      // shows every card off, so saving does not invent reasoning for it.
      levels,
      image: imageInputOf(entry),
      tools: toolCallOf(entry),
    };
  });

  return drafts.length > 0 ? drafts : [emptyModel()];
};

export const draftFrom = (entry: ProviderEntry): ProviderDraft => {
  const provider = entry.block;
  const settings = settingsOf(provider);
  const pkg = packageFrom(provider);
  const protocol = protocolOfPackage(pkg);
  return {
    providerID: entry.id,
    name: stringOf(provider.name) || entry.id,
    protocol,
    customPackage: protocol === 'custom' ? pkg : '',
    baseURL: stringOf(settings.baseURL),
    apiKey: stringOf(settings.apiKey),
    models: readModels(provider),
  };
};

/** Capabilities block for a model, preserving modalities the form does not edit. */
const capabilitiesFor = (previous: JsonObject, model: ModelDraft): JsonObject => {
  const carried = isObject(previous.capabilities) ? previous.capabilities : {};
  const extraInput = stringList(carried.input).filter((media) => media !== 'text' && media !== 'image');
  const output = stringList(carried.output);
  const reasoning = reasoningFor(carried, model.levels);
  const next: JsonObject = {
    ...carried,
    tools: model.tools,
    input: ['text', ...(model.image ? ['image'] : []), ...extraInput],
    output: output.length > 0 ? output : ['text'],
  };
  if (reasoning === undefined) delete next.reasoning;
  else next.reasoning = reasoning;
  return next;
};

/**
 * `capabilities.reasoning` in OpenCode's V2 shape. OpenCode builds the
 * protocol-correct variants from it, so switching protocols cannot leave a
 * stale `thinking` / `reasoningEffort` behind.
 */
const reasoningFor = (capabilities: JsonObject, levels: readonly string[]): JsonObject | undefined => {
  const previous = isObject(capabilities.reasoning) ? capabilities.reasoning : undefined;
  const unique = [...new Set(levels.map((level) => level.trim()).filter(Boolean))];
  if (unique.length === 0) {
    // Nothing to reason with. Keep the explicit "off" only when the previous
    // block declared reasoning; otherwise leave the key absent.
    return previous === undefined ? undefined : { supported: false };
  }
  return {
    // `toggle` and `budget` are hand-written extras the form does not edit.
    ...(previous && previous.toggle !== undefined ? { toggle: previous.toggle } : {}),
    supported: true,
    effort: unique,
    ...(previous && previous.budget !== undefined ? { budget: previous.budget } : {}),
  };
};

/** Removes variants the previous version generated, keeps anything hand-written. */
const cleanVariants = (previous: JsonObject): JsonObject[] => {
  const kept = variantsOf(previous).filter((variant) => (
    (REASONING_LEVELS as readonly string[]).includes(variant.id) ? !isLegacyVariant(variant.overlay) : true
  ));
  return kept.map((variant) => variant.overlay);
};

const limitFor = (previous: JsonObject, model: ModelDraft): JsonObject | undefined => {
  const kept = isObject(previous.limit) ? { ...previous.limit } : {};
  const context = positiveInt(model.context);
  const output = positiveInt(model.output);
  if (context === undefined) delete kept.context;
  else kept.context = context;
  if (output === undefined) delete kept.output;
  else kept.output = output;
  return Object.keys(kept).length > 0 ? kept : undefined;
};

const modelFor = (model: ModelDraft, previous: JsonObject): JsonObject => {
  const id = model.id.trim();
  const upstream = model.modelID.trim() || id;
  // V1 spellings of what we write below.
  const carried: JsonObject = { ...previous };
  delete carried.id;
  delete carried.provider;
  delete carried.attachment;
  delete carried.tool_call;

  const entry: JsonObject = {
    ...carried,
    modelID: upstream,
    name: model.name.trim() || id,
  };

  const limit = limitFor(previous, model);
  if (limit) entry.limit = limit;
  else delete entry.limit;

  entry.capabilities = capabilitiesFor(previous, model);

  // V2 replaces generated variants from `capabilities.reasoning`. Keep the
  // hand-written ones and drop what an older build of this panel wrote.
  const variants = cleanVariants(previous);
  if (variants.length > 0) entry.variants = variants;
  else delete entry.variants;

  return entry;
};

export const buildProvider = (draft: ProviderDraft, existing?: JsonObject): JsonObject => {
  const previous = existing ?? {};
  const previousModels = isObject(previous.models) ? previous.models : {};

  const models: JsonObject = {};
  for (const model of draft.models) {
    const id = model.id.trim();
    if (!id) continue;
    const candidate = model.sourceID ? previousModels[model.sourceID] : previousModels[id];
    const fallback = previousModels[id];
    const source = isObject(candidate) ? candidate : isObject(fallback) ? fallback : undefined;
    models[id] = modelFor(model, source ? { ...source } : {});
  }

  const settings: JsonObject = {
    ...settingsOf(previous),
    baseURL: draft.baseURL.trim(),
  };
  const apiKey = draft.apiKey.trim();
  if (apiKey) settings.apiKey = apiKey;
  else delete settings.apiKey;

  // `npm`, `options` and `api` are the V1 spellings of `package`, `settings`
  // and the header/body overlays. Writing one spelling keeps the file clean.
  const carried: JsonObject = { ...previous };
  delete carried.npm;
  delete carried.options;
  delete carried.api;
  delete carried.id;

  const pkg = draft.protocol === 'custom'
    ? draft.customPackage.trim() || packageOfProtocol(DEFAULT_PROTOCOL)
    : packageOfProtocol(draft.protocol);

  const headers = headersOf(previous);
  const body = bodyOf(previous);

  return withoutUndefined({
    ...carried,
    name: draft.name.trim() || draft.providerID.trim(),
    package: pkg,
    settings,
    ...(headers ? { headers } : {}),
    ...(body ? { body } : {}),
    models,
  });
};

/**
 * Every provider block in one config file, in file order. `file` records where
 * it came from so a save writes back to the same place.
 */
export const collectProviders = (config: JsonObject, file: string): ProviderEntry[] => {
  const found = new Map<string, JsonObject>();
  // Read the deprecated `provider` block first so `providers` (V2) wins.
  for (const key of ['provider', 'providers'] as const) {
    const block = config[key];
    if (!isObject(block)) continue;
    for (const [id, value] of Object.entries(block)) {
      if (isObject(value)) found.set(id, value);
    }
  }
  return [...found.entries()].map(([id, block]) => ({
    id,
    block,
    file,
    overlay: packageFrom(block) === '',
  }));
};

export const protocolLabelKey = (protocol: ProtocolId): string => `protocol.${protocol}`;

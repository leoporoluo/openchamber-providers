/**
 * OpenChamber Providers — manage custom OpenAI-compatible providers for OpenCode.
 *
 * It writes the `providers` block of ~/.config/opencode/opencode.json (or
 * opencode.jsonc) directly. OpenCode watches that file and rebuilds its
 * catalog on its own, so the provider shows up in OpenChamber's
 * Settings → Providers without going through the integration credential API.
 *
 * Everything the user fills in — provider name, base URL, API key, models,
 * context length and reasoning levels — is written as plain provider config.
 * Saving merges with what is already on disk (see providers.ts) and edits the
 * file in place (see jsonc.ts), so fields OpenChamber Providers does not manage, comments
 * and unrelated settings all survive.
 */
import { connectHost, HostRequestError } from '@openchamber/sdk';
import {
  applyHostReady,
  mountBanner,
  mountButton,
  mountEmpty,
  mountList,
  mountSelect,
  mountSeparator,
  mountSpinner,
  mountSwitch,
  mountTextField,
} from '@openchamber/sdk/ui';
import {
  applyTopLevelEdits,
  isObject,
  parseConfig,
  type JsonObject,
  type TopLevelEdit,
} from './jsonc';
import { mountLevelField } from './levels';
import {
  DEFAULT_CONTEXT,
  DEFAULT_OUTPUT,
  DEFAULT_REASONING_LEVELS,
  positiveInt,
  PROTOCOLS,
  REASONING_LEVELS,
  buildProvider,
  collectProviders,
  draftFrom,
  emptyDraft,
  emptyModel,
  settingsOf,
  type ProtocolId,
  type ProviderDraft,
} from './providers';

/* ----------------------------------------------------------------- config */

// opencode.jsonc first, matching OpenCode's own precedence: it merges
// config.json < opencode.json < opencode.jsonc, so the jsonc file wins.
const CONFIG_PATHS = [
  '~/.config/opencode/opencode.jsonc',
  '~/.config/opencode/opencode.json',
] as const;

const DEFAULT_CONFIG: JsonObject = { $schema: 'https://opencode.ai/config.json' };

type Disposable = { dispose: () => void };

/* ------------------------------------------------------------------- i18n */

const STRINGS = {
  en: {
    title: 'OpenChamber Providers',
    tagline: 'Custom providers for OpenCode',
    add: 'Add provider',
    refresh: 'Refresh',
    loading: 'Reading opencode.json…',
    readFailed: 'Could not read opencode.json',
    retry: 'Try again',
    emptyTitle: 'No custom providers yet',
    emptyBody: 'Add an OpenAI-compatible endpoint. OpenChamber Providers writes it into ~/.config/opencode/opencode.json, so it appears under Settings → Providers.',
    newTitle: 'New provider',
    editTitle: 'Edit provider',
    back: 'Back',
    fieldID: 'Provider ID',
    fieldIDHelp: 'Lowercase letters, numbers, hyphens, and underscores. Used as the OpenCode provider id.',
    placeholderID: 'my-provider',
    fieldName: 'Display name',
    fieldNameHelp: 'Editable display name shown in the provider and model pickers.',
    placeholderName: 'My Provider',
    fieldProtocol: 'API protocol',
    fieldBaseURL: 'Base URL',
    fieldBaseURLHelp: 'OpenAI-compatible API base URL. Must start with http:// or https://.',
    placeholderBaseURL: 'https://api.example.com/v1',
    fieldAPIKey: 'API key',
    fieldAPIKeyHelp: 'Written to opencode.json as settings.apiKey. Use {env:VAR_NAME} to read a key from the environment instead.',
    placeholderAPIKey: 'sk-... or {env:VAR_NAME}',
    modelsTitle: 'Models',
    modelID: 'Model ID',
    placeholderModelID: 'gpt-4o',
    modelName: 'Model name',
    placeholderModelName: 'GPT-4o',
    modelContext: 'Context length',
    placeholderContext: DEFAULT_CONTEXT,
    modelOutput: 'Max output',
    placeholderOutput: DEFAULT_OUTPUT,
    advancedOptions: 'Advanced options',
    modelReasoning: 'Reasoning levels',
    modelReasoningHelp: 'Click a level to enable it; click again to turn it off.',
    modelReasoningHintLow: 'Fastest, least reasoning',
    modelReasoningHintMedium: 'Balanced speed and reasoning',
    modelReasoningHintHigh: 'Deeper reasoning for harder work',
    modelReasoningHintXHigh: 'Very high reasoning depth',
    modelReasoningHintMax: 'Maximum reasoning depth',
    modelReasoningEmpty: 'No level on: this model declares no reasoning levels.',
    modelImage: 'Image input',
    modelTools: 'Tool calling',
    addModel: 'Add model',
    removeModel: 'Remove model',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    delete: 'Delete provider',
    confirmDelete: 'Delete this provider?',
    confirmDeleteBody: '{name} will be removed from opencode.json.',
    deleteConfirm: 'Delete',
    deleteCancel: 'Keep',
    saved: 'Saved {name}',
    deleted: 'Deleted {name}',
    errID: 'Use lowercase letters, digits, - and _ only.',
    errIDExists: 'A provider with this ID already exists.',
    errName: 'Enter a display name.',
    errURL: 'Enter a valid http:// or https:// URL.',
    errLimits: 'Context length and max output must be positive whole numbers.',
    errModel: 'Add at least one model with an ID.',
    errModelDuplicate: 'Two models have the same ID.',
    errModelIncomplete: 'Every model needs an ID; remove the rows you do not want.',
    modelCount: '{count} models',
  },
  zh: {
    title: 'OpenChamber Providers',
    tagline: 'OpenCode 自定义供应商',
    add: '新增供应商',
    refresh: '刷新',
    loading: '正在读取 opencode.json…',
    readFailed: '无法读取 opencode.json',
    retry: '重试',
    emptyTitle: '还没有自定义供应商',
    emptyBody: '添加一个 OpenAI 兼容的中转站。OpenChamber Providers 会把它写进 ~/.config/opencode/opencode.json，保存后就会出现在「设置 → 提供商」里。',
    newTitle: '新增供应商',
    editTitle: '编辑供应商',
    back: '返回',
    fieldID: '提供商 ID',
    fieldIDHelp: '小写字母、数字、连字符和下划线。用作 OpenCode 提供商 ID。',
    placeholderID: 'my-provider',
    fieldName: '显示名称',
    fieldNameHelp: '可编辑，显示在提供商和模型选择器中。',
    placeholderName: '我的提供商',
    fieldProtocol: 'API 协议',
    fieldBaseURL: '基础 URL',
    fieldBaseURLHelp: '兼容 OpenAI 的 API 基础 URL。必须以 http:// 或 https:// 开头。',
    placeholderBaseURL: 'https://api.example.com/v1',
    fieldAPIKey: 'API 密钥',
    fieldAPIKeyHelp: '会写进 opencode.json 的 settings.apiKey；填 {env:VAR_NAME} 则从环境变量读取。',
    placeholderAPIKey: 'sk-... 或 {env:VAR_NAME}',
    modelsTitle: '模型',
    modelID: '模型 ID',
    placeholderModelID: 'gpt-4o',
    modelName: '模型名称',
    placeholderModelName: 'GPT-4o',
    modelContext: '上下文长度',
    placeholderContext: DEFAULT_CONTEXT,
    modelOutput: '最大输出',
    placeholderOutput: DEFAULT_OUTPUT,
    advancedOptions: '高级选项',
    modelReasoning: '推理等级',
    modelReasoningHelp: '点击开启该等级，再点一次关闭。',
    modelReasoningHintLow: '最快，推理最少',
    modelReasoningHintMedium: '速度与推理均衡',
    modelReasoningHintHigh: '推理更充分，适合较难任务',
    modelReasoningHintXHigh: '推理强度很高',
    modelReasoningHintMax: '推理强度拉满',
    modelReasoningEmpty: '全部关闭：该模型不声明推理等级。',
    modelImage: '图片输入',
    modelTools: '工具调用',
    addModel: '添加模型',
    removeModel: '移除模型',
    save: '保存',
    saving: '保存中…',
    cancel: '取消',
    delete: '删除供应商',
    confirmDelete: '确认删除？',
    confirmDeleteBody: '{name} 将从 opencode.json 中移除。',
    deleteConfirm: '删除',
    deleteCancel: '保留',
    saved: '已保存 {name}',
    deleted: '已删除 {name}',
    errID: '只能使用小写字母、数字、- 和 _。',
    errIDExists: '该 ID 已存在。',
    errName: '请填写供应商名称。',
    errURL: '请输入有效的 http:// 或 https:// 地址。',
    errLimits: '上下文长度和最大输出必须是正整数。',
    errModel: '至少填写一个模型 ID。',
    errModelDuplicate: '存在重复的模型 ID。',
    errModelIncomplete: '每个模型都要填写 ID；不需要的行请删除。',
    modelCount: '{count} 个模型',
  },
} as const;

type Strings = (typeof STRINGS)[keyof typeof STRINGS];

const errorText = (error: unknown): string => (
  error instanceof HostRequestError
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error)
);

/* ------------------------------------------------------------------- state */

const host = connectHost();
const root = document.querySelector('#root');
if (!root) throw new Error('#root is missing');

let t: Strings = STRINGS.en;
let view: 'list' | 'form' = 'list';
let editingId: string | null = null;
let entries: Array<{ id: string; config: JsonObject }> = [];
let loading = true;
let fatal: string | null = null;
let draft: ProviderDraft | null = null;
let fieldErrors: Record<string, string | undefined> = {};
let confirmingDelete = false;
let busy = false;
let mounted: Disposable[] = [];

/* ------------------------------------------------------------------ layout */

const clearMounted = (): void => {
  for (const item of mounted.splice(0)) item.dispose();
  while (root.firstChild) root.removeChild(root.firstChild);
};

const column = (parent: Element, gap = '10px'): HTMLElement => {
  const box = document.createElement('div');
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = gap;
  box.style.minWidth = '0';
  parent.append(box);
  return box;
};

const row = (parent: Element, gap = '8px'): HTMLElement => {
  const box = document.createElement('div');
  box.style.display = 'flex';
  box.style.alignItems = 'center';
  box.style.gap = gap;
  box.style.flexWrap = 'wrap';
  box.style.minWidth = '0';
  parent.append(box);
  return box;
};

const muted = (parent: Element, text: string, size = '11px'): HTMLElement => {
  const node = document.createElement('div');
  node.textContent = text;
  node.style.fontSize = size;
  node.style.lineHeight = '1.5';
  node.style.opacity = '0.65';
  parent.append(node);
  return node;
};

const heading = (parent: Element, text: string, size = '14px'): HTMLElement => {
  const node = document.createElement('div');
  node.textContent = text;
  node.style.fontSize = size;
  node.style.fontWeight = '600';
  node.style.lineHeight = '1.3';
  parent.append(node);
  return node;
};

const flexColumn = (parent: Element, basis = '120px'): HTMLElement => {
  const box = column(parent, '0');
  box.style.flex = `1 1 ${basis}`;
  return box;
};

/* --------------------------------------------------------------- file i/o */

const readConfig = async (): Promise<{ config: JsonObject; path: string; text: string | null }> => {
  for (const path of CONFIG_PATHS) {
    const stat = await host.stat(path);
    if (stat.kind === 'file') {
      const { content } = await host.readFile(path);
      return { config: parseConfig(content), path, text: content };
    }
    if (stat.kind !== 'missing') {
      throw new Error(`${path} is a ${stat.kind}, not a file.`);
    }
  }
  return { config: { ...DEFAULT_CONFIG }, path: CONFIG_PATHS[0], text: null };
};

/**
 * Patches the top-level keys named by `edits` in place when the file text is
 * available — keeping comments, trailing commas and unrelated settings — and
 * falls back to rewriting the whole file when it is not.
 */
const writeConfig = async (
  path: string,
  text: string | null,
  edits: TopLevelEdit[],
  config: JsonObject,
): Promise<void> => {
  const patched = text === null ? null : applyTopLevelEdits(text, edits);
  await host.writeFile(path, patched ?? `${JSON.stringify(config, null, 2)}\n`);
};

const load = async (): Promise<void> => {
  loading = true;
  fatal = null;
  render();
  try {
    const { config } = await readConfig();
    entries = collectProviders(config);
  } catch (error) {
    fatal = errorText(error);
    entries = [];
  } finally {
    loading = false;
    render();
  }
};

/* ----------------------------------------------------------------- actions */

const validate = (current: ProviderDraft): Record<string, string | undefined> => {
  const errors: Record<string, string | undefined> = {};
  const id = current.providerID.trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
    errors.providerID = t.errID;
  } else if (editingId === null && entries.some((entry) => entry.id === id)) {
    errors.providerID = t.errIDExists;
  }
  if (!current.name.trim()) errors.name = t.errName;
  try {
    const url = new URL(current.baseURL.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch {
    errors.baseURL = t.errURL;
  }
  if (current.models.some((model) => (
    (model.context.trim() !== '' && positiveInt(model.context) === undefined)
      || (model.output.trim() !== '' && positiveInt(model.output) === undefined)
  ))) errors.models = t.errLimits;
  const ids = current.models.map((model) => model.id.trim()).filter(Boolean);
  const levelsTouched = (levels: string[]): boolean => (
    levels.length !== DEFAULT_REASONING_LEVELS.length
    || levels.some((level, index) => level !== DEFAULT_REASONING_LEVELS[index])
  );
  if (ids.length === 0) {
    errors.models = t.errModel;
  } else if (new Set(ids).size !== ids.length) {
    errors.models = t.errModelDuplicate;
  } else if (current.models.some(
    (model) => !model.id.trim()
      && (model.name.trim() || model.context.trim() || model.output.trim() || levelsTouched(model.levels)),
  )) {
    errors.models = t.errModelIncomplete;
  }
  return errors;
};

const saveDraft = async (): Promise<void> => {
  if (!draft) return;
  fieldErrors = validate(draft);
  if (Object.keys(fieldErrors).length > 0) {
    render();
    return;
  }
  const current = draft;
  busy = true;
  render();
  try {
    const { config, path, text } = await readConfig();
    const id = current.providerID.trim();
    const providers = isObject(config.providers) ? { ...config.providers } : {};
    const legacy = isObject(config.provider) ? { ...config.provider } : null;
    const existing = isObject(providers[id])
      ? providers[id]
      : legacy !== null && isObject(legacy[id])
        ? legacy[id]
        : undefined;
    providers[id] = buildProvider(current, existing);
    config.providers = providers;
    const edits: TopLevelEdit[] = [{ key: 'providers', value: providers }];
    if (legacy !== null && id in legacy) {
      delete legacy[id];
      config.provider = legacy;
      edits.push({ key: 'provider', value: legacy });
    }
    await writeConfig(path, text, edits, config);
    await host.toast({ kind: 'success', message: t.saved.replace('{name}', current.name.trim() || id) });
    busy = false;
    view = 'list';
    editingId = null;
    draft = null;
    fieldErrors = {};
    confirmingDelete = false;
    await load();
  } catch (error) {
    fatal = errorText(error);
    busy = false;
    render();
  }
};

const deleteProvider = async (): Promise<void> => {
  const id = editingId;
  if (!id) return;
  busy = true;
  render();
  try {
    const { config, path, text } = await readConfig();
    const edits: TopLevelEdit[] = [];
    let removed = false;
    if (isObject(config.providers) && id in config.providers) {
      const providers = { ...config.providers };
      delete providers[id];
      if (Object.keys(providers).length > 0) {
        config.providers = providers;
        edits.push({ key: 'providers', value: providers });
      } else {
        delete config.providers;
        edits.push({ key: 'providers', value: undefined });
      }
      removed = true;
    }
    if (isObject(config.provider) && id in config.provider) {
      const legacy = { ...config.provider };
      delete legacy[id];
      config.provider = legacy;
      edits.push({ key: 'provider', value: legacy });
      removed = true;
    }
    if (removed) await writeConfig(path, text, edits, config);
    await host.toast({ kind: 'success', message: t.deleted.replace('{name}', id) });
    busy = false;
    view = 'list';
    editingId = null;
    draft = null;
    fieldErrors = {};
    confirmingDelete = false;
    await load();
  } catch (error) {
    fatal = errorText(error);
    busy = false;
    render();
  }
};

/* ------------------------------------------------------------------ render */

const openCreate = (): void => {
  view = 'form';
  editingId = null;
  draft = emptyDraft();
  fieldErrors = {};
  confirmingDelete = false;
  fatal = null;
  render();
};

const renderList = (body: HTMLElement): void => {
  const header = row(body);
  header.style.justifyContent = 'space-between';
  const titles = column(header, '2px');
  heading(titles, t.title, '15px');
  muted(titles, t.tagline);

  const actions = row(header, '6px');
  mounted.push(mountButton(actions, { label: t.add, size: 'sm', onClick: openCreate }));
  mounted.push(mountButton(actions, {
    label: t.refresh,
    variant: 'ghost',
    size: 'sm',
    disabled: loading,
    onClick: () => void load(),
  }));

  if (loading) {
    mounted.push(mountSpinner(body, { label: t.loading }));
    return;
  }

  if (fatal) {
    mounted.push(mountBanner(body, {
      tone: 'error',
      title: t.readFailed,
      body: fatal,
      action: { label: t.retry, onClick: () => void load() },
    }));
    return;
  }

  if (entries.length === 0) {
    mounted.push(mountEmpty(body, { title: t.emptyTitle, body: t.emptyBody, action: { label: t.add, onClick: openCreate } }));
    return;
  }

  mounted.push(mountList(body, {
    ariaLabel: t.title,
    items: entries.map((entry) => {
      const name = typeof entry.config.name === 'string' && entry.config.name ? entry.config.name : entry.id;
      const settings = settingsOf(entry.config);
      const baseURL = typeof settings.baseURL === 'string' ? settings.baseURL : '';
      const models = entry.config.models;
      const count = isObject(models) ? Object.keys(models).length : Array.isArray(models) ? models.length : 0;
      return {
        id: entry.id,
        leading: entry.id,
        title: name,
        subtitle: baseURL || undefined,
        badge: { label: t.modelCount.replace('{count}', String(count)), tone: count > 0 ? 'info' : 'warning' },
      };
    }),
    onSelect: (id) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      view = 'form';
      editingId = id;
      draft = draftFrom(id, entry.config);
      fieldErrors = {};
      confirmingDelete = false;
      fatal = null;
      render();
    },
  }));
};

const renderForm = (body: HTMLElement): void => {
  const current = draft;
  if (!current) return;
  const isNew = editingId === null;

  const header = row(body);
  header.style.justifyContent = 'space-between';
  mounted.push(mountButton(header, {
    label: `← ${t.back}`,
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      view = 'list';
      draft = null;
      fieldErrors = {};
      confirmingDelete = false;
      fatal = null;
      render();
    },
  }));
  heading(header, isNew ? t.newTitle : t.editTitle, '13px');

  if (fieldErrors.models) {
    mounted.push(mountBanner(body, { tone: 'warning', title: t.modelsTitle, body: fieldErrors.models }));
  }
  if (fatal) {
    mounted.push(mountBanner(body, { tone: 'error', title: t.readFailed, body: fatal }));
  }

  const idField = mountTextField(body, {
    label: t.fieldID,
    value: current.providerID,
    mono: true,
    disabled: !isNew,
    error: fieldErrors.providerID,
    helper: t.fieldIDHelp,
    placeholder: t.placeholderID,
    onChange: (value) => {
      current.providerID = value;
      if (fieldErrors.providerID !== undefined) {
        fieldErrors.providerID = undefined;
        idField.update({ error: undefined });
      }
    },
  });
  mounted.push(idField);
  const nameField = mountTextField(body, {
    label: t.fieldName,
    value: current.name,
    error: fieldErrors.name,
    helper: t.fieldNameHelp,
    placeholder: t.placeholderName,
    onChange: (value) => {
      current.name = value;
      if (fieldErrors.name !== undefined) {
        fieldErrors.name = undefined;
        nameField.update({ error: undefined });
      }
    },
  });
  mounted.push(nameField);
  const protocolField = mountSelect(body, {
    label: t.fieldProtocol,
    value: current.protocol,
    options: PROTOCOLS.map((protocol) => ({ id: protocol.id, label: protocol.label })),
    onChange: (id) => {
      current.protocol = id as ProtocolId;
      // mountSelect keeps its own copy of `value`; without this the trigger
      // keeps showing the protocol the form opened with.
      protocolField.update({ value: id });
    },
  });
  mounted.push(protocolField);
  const urlField = mountTextField(body, {
    label: t.fieldBaseURL,
    value: current.baseURL,
    mono: true,
    error: fieldErrors.baseURL,
    helper: t.fieldBaseURLHelp,
    placeholder: t.placeholderBaseURL,
    onChange: (value) => {
      current.baseURL = value;
      if (fieldErrors.baseURL !== undefined) {
        fieldErrors.baseURL = undefined;
        urlField.update({ error: undefined });
      }
    },
  });
  mounted.push(urlField);
  mounted.push(mountTextField(body, {
    label: t.fieldAPIKey,
    value: current.apiKey,
    password: true,
    mono: true,
    helper: t.fieldAPIKeyHelp,
    placeholder: t.placeholderAPIKey,
    onChange: (value) => { current.apiKey = value; },
  }));

  mounted.push(mountSeparator(body, { label: t.modelsTitle }));

  current.models.forEach((model, index) => {
    const block = column(body, '8px');
    block.style.border = '1px solid var(--oc-border, rgba(127, 127, 127, 0.25))';
    block.style.borderRadius = 'var(--oc-radius, 8px)';
    block.style.padding = '10px';

    const head = row(block);
    head.style.justifyContent = 'space-between';
    muted(head, `#${index + 1}`);
    mounted.push(mountButton(head, {
      label: t.removeModel,
      variant: 'ghost',
      size: 'xs',
      disabled: current.models.length <= 1,
      onClick: () => {
        current.models.splice(index, 1);
        render();
      },
    }));

    mounted.push(mountTextField(block, {
      label: t.modelID,
      value: model.id,
      mono: true,
      placeholder: t.placeholderModelID,
      onChange: (value) => { model.id = value; },
    }));
    mounted.push(mountTextField(block, {
      label: t.modelName,
      value: model.name,
      placeholder: t.placeholderModelName,
      onChange: (value) => { model.name = value; },
    }));

    const advanced = document.createElement('details');
    advanced.className = 'openchamber-providers-advanced';
    const advancedSummary = document.createElement('summary');
    advancedSummary.textContent = t.advancedOptions;
    advanced.append(advancedSummary);
    block.append(advanced);

    const levelHints: Record<string, string | undefined> = {
      low: t.modelReasoningHintLow,
      medium: t.modelReasoningHintMedium,
      high: t.modelReasoningHintHigh,
      xhigh: t.modelReasoningHintXHigh,
      max: t.modelReasoningHintMax,
    };
    // Levels the config already declares that are not part of the standard
    // set (a gateway's own names) stay clickable instead of being dropped.
    const extras = model.levels.filter((level) => !REASONING_LEVELS.some((known) => known === level));
    mounted.push(mountLevelField(advanced, {
      label: t.modelReasoning,
      help: t.modelReasoningHelp,
      emptyHint: t.modelReasoningEmpty,
      levels: [...REASONING_LEVELS, ...extras],
      selected: model.levels,
      hints: levelHints,
      onChange: (levels) => { model.levels = levels; },
    }));

    const sizes = row(advanced);
    mounted.push(mountTextField(flexColumn(sizes), {
      label: t.modelContext,
      value: model.context,
      placeholder: t.placeholderContext,
      onChange: (value) => { model.context = value; },
    }));
    mounted.push(mountTextField(flexColumn(sizes), {
      label: t.modelOutput,
      value: model.output,
      placeholder: t.placeholderOutput,
      onChange: (value) => { model.output = value; },
    }));

    const capabilities = row(advanced, '16px');
    mounted.push(mountSwitch(flexColumn(capabilities, '120px'), {
      label: t.modelImage,
      checked: model.image,
      onChange: (checked) => { model.image = checked; },
    }));
    mounted.push(mountSwitch(flexColumn(capabilities, '120px'), {
      label: t.modelTools,
      checked: model.tools,
      onChange: (checked) => { model.tools = checked; },
    }));
  });

  mounted.push(mountButton(body, {
    label: t.addModel,
    variant: 'outline',
    size: 'sm',
    onClick: () => {
      current.models.push(emptyModel());
      render();
    },
  }));

  mounted.push(mountSeparator(body));

  const actions = row(body);
  actions.style.justifyContent = 'flex-end';
  mounted.push(mountButton(actions, {
    label: t.cancel,
    variant: 'ghost',
    disabled: busy,
    onClick: () => {
      view = 'list';
      draft = null;
      fieldErrors = {};
      confirmingDelete = false;
      fatal = null;
      render();
    },
  }));
  mounted.push(mountButton(actions, {
    label: busy ? t.saving : t.save,
    loading: busy,
    onClick: () => void saveDraft(),
  }));

  if (!isNew) {
    mounted.push(mountSeparator(body));
    if (confirmingDelete) {
      mounted.push(mountBanner(body, {
        tone: 'warning',
        title: t.confirmDelete,
        body: t.confirmDeleteBody.replace('{name}', current.name.trim() || current.providerID.trim()),
        action: { label: t.deleteConfirm, onClick: () => void deleteProvider() },
      }));
      mounted.push(mountButton(body, {
        label: t.deleteCancel,
        variant: 'ghost',
        size: 'sm',
        disabled: busy,
        onClick: () => { confirmingDelete = false; render(); },
      }));
    } else {
      mounted.push(mountButton(body, {
        label: t.delete,
        variant: 'destructive',
        size: 'sm',
        disabled: busy,
        onClick: () => { confirmingDelete = true; render(); },
      }));
    }
  }
};

const render = (): void => {
  clearMounted();
  const shell = document.createElement('div');
  shell.className = 'openchamber-providers-shell';
  root.append(shell);
  const body = column(shell, '12px');
  if (view === 'form') renderForm(body);
  else renderList(body);
};

/* ------------------------------------------------------------------- start */

let didMount = false;
let lastLocale = '';
host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  document.documentElement.dataset.surface = ctx.surface;
  const locale = ctx.locale ?? '';
  const localeChanged = locale !== lastLocale;
  lastLocale = locale;
  t = locale.toLowerCase().startsWith('zh') ? STRINGS.zh : STRINGS.en;
  if (didMount) {
    if (localeChanged) render();
    return;
  }
  didMount = true;
  void load();
});

/**
 * Reasoning-level cards.
 *
 * A model's reasoning levels are a small set of names (`low`, `medium`,
 * `high`, …). Instead of typing them into a text field, the panel shows one
 * small card per level: click a card to switch that level on, click it again
 * to switch it off. Switching every card off is allowed and means the model
 * declares no reasoning levels at all (the same as leaving the old text field
 * empty); the hint under the cards says so.
 *
 * The markup lives here and is styled from panel/index.html; the state lives
 * in the caller, which receives the new list through `onChange`.
 */

export type LevelFieldProps = {
  label: string;
  /** Quiet hint under the cards. */
  help?: string;
  /** Hint shown instead of `help` while no level is on. */
  emptyHint?: string;
  /** Every card to show, in order. */
  levels: readonly string[];
  /** Levels currently on. */
  selected: readonly string[];
  /** Tooltip per level, keyed by level id. */
  hints?: Record<string, string | undefined>;
  onChange: (levels: string[]) => void;
};

export type LevelFieldHandle = {
  /** Repaints the cards from a new selection. */
  update: (selected: readonly string[]) => void;
  dispose: () => void;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

export const mountLevelField = (parent: Element, initial: LevelFieldProps): LevelFieldHandle => {
  let props = initial;
  let selected = new Set(props.selected);

  const field = el('div', 'openchamber-providers-field');
  const caption = el('span', 'openchamber-providers-field-label');
  const row = el('div', 'openchamber-providers-levels');
  const note = el('span', 'openchamber-providers-field-note');
  row.setAttribute('role', 'group');
  field.append(caption, row, note);
  parent.append(field);

  const cards = new Map<string, HTMLButtonElement>();
  const listeners: Array<() => void> = [];

  const paintNote = (): void => {
    const empty = selected.size === 0;
    field.dataset.empty = empty ? 'true' : 'false';
    note.textContent = (empty && props.emptyHint) || props.help || '';
  };

  const paint = (): void => {
    caption.textContent = props.label;
    caption.hidden = !props.label;
    for (const level of props.levels) {
      const card = cards.get(level);
      if (!card) continue;
      const on = selected.has(level);
      card.dataset.on = on ? 'true' : 'false';
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    paintNote();
  };

  const toggle = (level: string): void => {
    if (selected.has(level)) selected.delete(level);
    else selected.add(level);
    paint();
    props.onChange(props.levels.filter((candidate) => selected.has(candidate)));
  };

  for (const level of props.levels) {
    const card = el('button', 'openchamber-providers-level');
    card.type = 'button';
    card.textContent = level;
    const hint = props.hints?.[level];
    if (hint) card.title = hint;
    const onClick = (): void => toggle(level);
    card.addEventListener('click', onClick);
    listeners.push(() => card.removeEventListener('click', onClick));
    cards.set(level, card);
    row.append(card);
  }

  paint();

  return {
    update: (next) => {
      props = { ...props, selected: next };
      selected = new Set(next);
      paint();
    },
    dispose: () => {
      for (const off of listeners) off();
      field.remove();
    },
  };
};

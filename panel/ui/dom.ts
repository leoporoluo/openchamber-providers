/** Tiny DOM helpers. No framework, no virtual DOM. */

type Attrs = Record<string, string | number | boolean | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Attrs,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  return node;
};

export const clear = (node: Element): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const span = (parent: Element, content: string, className?: string): HTMLElement => {
  const node = el('span', className);
  node.textContent = content;
  parent.append(node);
  return node;
};

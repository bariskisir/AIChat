/** Safe Markdown rendering helpers for assistant messages. */

interface TableBlock {
  headers: string[];
  rows: string[][];
  nextIndex: number;
}

// Renders Markdown text into a container without allowing raw HTML execution.
export function renderInto(container: HTMLElement, text: string): void {
  container.classList.add("ch-md");
  container.replaceChildren(...blockNodes(text));
}

// Converts Markdown block syntax into DOM nodes.
function blockNodes(text: string): Node[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: Node[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (isCodeFence(line)) {
      const block = readCodeBlock(lines, index);
      nodes.push(codeBlockNode(block.code, block.language));
      index = block.nextIndex;
      continue;
    }
    const table = readTable(lines, index);
    if (table) {
      nodes.push(tableNode(table));
      index = table.nextIndex;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      nodes.push(headingNode(heading[1].length, heading[2].trim()));
      index += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const block = readPrefixedBlock(lines, index, /^\s*>\s?(.*)$/);
      nodes.push(blockquoteNode(block.text));
      index = block.nextIndex;
      continue;
    }
    if (isListLine(line)) {
      const block = readList(lines, index);
      nodes.push(listNode(block.items, block.ordered));
      index = block.nextIndex;
      continue;
    }
    const paragraph = readParagraph(lines, index);
    nodes.push(paragraphNode(paragraph.text));
    index = paragraph.nextIndex;
  }
  return nodes;
}

// Reports whether a line starts a fenced code block.
function isCodeFence(line: string): boolean {
  return /^\s*```/.test(line);
}

// Reads a fenced code block, including unclosed blocks while streaming.
function readCodeBlock(lines: string[], startIndex: number): { code: string; language: string; nextIndex: number } {
  const language = lines[startIndex].replace(/^\s*```/, "").trim();
  const code: string[] = [];
  let index = startIndex + 1;
  while (index < lines.length && !isCodeFence(lines[index])) {
    code.push(lines[index]);
    index += 1;
  }
  return {
    code: code.join("\n"),
    language,
    nextIndex: index < lines.length ? index + 1 : index,
  };
}

// Builds a code block node.
function codeBlockNode(code: string, language: string): HTMLElement {
  const pre = document.createElement("pre");
  const codeNode = document.createElement("code");
  if (language) {
    codeNode.dataset.language = language;
  }
  codeNode.textContent = code;
  pre.appendChild(codeNode);
  return pre;
}

// Reads a simple pipe table if the current line starts one.
function readTable(lines: string[], startIndex: number): TableBlock | null {
  if (startIndex + 1 >= lines.length || !lineLooksLikeTable(lines[startIndex])) {
    return null;
  }
  const headers = splitTableRow(lines[startIndex]);
  const separator = splitTableRow(lines[startIndex + 1]);
  if (!headers.length || separator.length !== headers.length || !separator.every(isTableSeparator)) {
    return null;
  }
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length && lineLooksLikeTable(lines[index])) {
    const cells = splitTableRow(lines[index]);
    if (cells.length) {
      rows.push(cells);
    }
    index += 1;
  }
  return { headers, rows, nextIndex: index };
}

// Reports whether a line has pipe-table shape.
function lineLooksLikeTable(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

// Splits one pipe table row into trimmed cells.
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Reports whether a table separator cell is valid Markdown.
function isTableSeparator(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}

// Builds a table node from parsed table data.
function tableNode(table: TableBlock): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "ch-md__table";
  const tableNodeElement = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of table.headers) {
    const th = document.createElement("th");
    appendInline(th, header);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  tableNodeElement.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const row of table.rows) {
    const tr = document.createElement("tr");
    for (let index = 0; index < table.headers.length; index += 1) {
      const td = document.createElement("td");
      appendInline(td, row[index] || "");
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableNodeElement.appendChild(tbody);
  wrapper.appendChild(tableNodeElement);
  return wrapper;
}

// Reads consecutive lines that share a Markdown prefix.
function readPrefixedBlock(lines: string[], startIndex: number, pattern: RegExp): { text: string; nextIndex: number } {
  const values: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) {
      break;
    }
    values.push(match[1]);
    index += 1;
  }
  return { text: values.join("\n"), nextIndex: index };
}

// Builds a blockquote node.
function blockquoteNode(text: string): HTMLElement {
  const quote = document.createElement("blockquote");
  appendInline(quote, text);
  return quote;
}

// Reports whether a line starts a supported list item.
function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

// Reads consecutive list items with the same ordered/unordered style.
function readList(lines: string[], startIndex: number): { items: string[]; ordered: boolean; nextIndex: number } {
  const ordered = /^\s*\d+[.)]\s+/.test(lines[startIndex]);
  const items: string[] = [];
  let index = startIndex;
  while (index < lines.length && isListLine(lines[index]) && /^\s*\d+[.)]\s+/.test(lines[index]) === ordered) {
    items.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""));
    index += 1;
  }
  return { items, ordered, nextIndex: index };
}

// Builds an ordered or unordered list node.
function listNode(items: string[], ordered: boolean): HTMLElement {
  const list = document.createElement(ordered ? "ol" : "ul");
  for (const item of items) {
    const li = document.createElement("li");
    appendInline(li, item);
    list.appendChild(li);
  }
  return list;
}

// Reads a paragraph until the next block boundary.
function readParagraph(lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const values: string[] = [];
  let index = startIndex;
  while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
    values.push(lines[index]);
    index += 1;
  }
  if (!values.length) {
    values.push(lines[startIndex]);
    index = startIndex + 1;
  }
  return { text: values.join("\n"), nextIndex: index };
}

// Reports whether a line begins a non-paragraph block.
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    isCodeFence(line) ||
    Boolean(line.match(/^(#{1,4})\s+(.+)$/)) ||
    /^\s*>\s?/.test(line) ||
    isListLine(line) ||
    readTable(lines, index) !== null
  );
}

// Builds a heading node with constrained message-level hierarchy.
function headingNode(level: number, text: string): HTMLElement {
  const heading = document.createElement(`h${Math.min(level + 2, 6)}`);
  appendInline(heading, text);
  return heading;
}

// Builds a paragraph node.
function paragraphNode(text: string): HTMLElement {
  const paragraph = document.createElement("p");
  appendInline(paragraph, text);
  return paragraph;
}

// Appends inline Markdown content to a parent node.
function appendInline(parent: Node, text: string): void {
  for (const node of inlineNodes(text)) {
    parent.appendChild(node);
  }
}

// Converts inline Markdown syntax into safe DOM nodes.
function inlineNodes(text: string): Node[] {
  const nodes: Node[] = [];
  let remaining = text;
  while (remaining) {
    const token = nextInlineToken(remaining);
    if (!token) {
      nodes.push(document.createTextNode(remaining));
      break;
    }
    if (token.index > 0) {
      nodes.push(document.createTextNode(remaining.slice(0, token.index)));
    }
    nodes.push(tokenNode(token));
    remaining = remaining.slice(token.index + token.raw.length);
  }
  return nodes;
}

interface InlineToken {
  kind: "code" | "link" | "bold" | "italic";
  index: number;
  raw: string;
  text: string;
  href?: string;
}

// Finds the next supported inline Markdown token.
function nextInlineToken(text: string): InlineToken | null {
  const candidates = [
    matchToken(text, /`([^`]+)`/, "code"),
    matchLinkToken(text),
    matchToken(text, /(\*\*|__)(.+?)\1/, "bold", 2),
    matchToken(text, /(\*|_)([^*_]+?)\1/, "italic", 2),
  ].filter((token): token is InlineToken => Boolean(token));
  candidates.sort((left, right) => left.index - right.index);
  return candidates[0] || null;
}

// Matches one regex-backed inline token.
function matchToken(text: string, pattern: RegExp, kind: InlineToken["kind"], textGroup = 1): InlineToken | null {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return null;
  }
  return {
    kind,
    index: match.index,
    raw: match[0],
    text: match[textGroup] || "",
  };
}

// Matches one Markdown link token.
function matchLinkToken(text: string): InlineToken | null {
  const match = text.match(/\[([^\]]+)]\(([^)\s]+)\)/);
  if (!match || match.index === undefined) {
    return null;
  }
  return {
    kind: "link",
    index: match.index,
    raw: match[0],
    text: match[1],
    href: match[2],
  };
}

// Builds a DOM node for one inline token.
function tokenNode(token: InlineToken): Node {
  if (token.kind === "code") {
    const code = document.createElement("code");
    code.textContent = token.text;
    return code;
  }
  if (token.kind === "link" && token.href && safeHref(token.href)) {
    const link = document.createElement("a");
    link.href = token.href;
    link.target = "_blank";
    link.rel = "noreferrer";
    appendInline(link, token.text);
    return link;
  }
  if (token.kind === "bold") {
    const strong = document.createElement("strong");
    appendInline(strong, token.text);
    return strong;
  }
  if (token.kind === "italic") {
    const emphasis = document.createElement("em");
    appendInline(emphasis, token.text);
    return emphasis;
  }
  return document.createTextNode(token.raw);
}

// Allows only normal web and email link protocols.
function safeHref(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value);
}

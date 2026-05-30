/** Shared searchable dropdown keyboard and open/close behavior. */

export interface BindOptions {
  button: HTMLButtonElement;
  panel: HTMLElement;
  searchInput: HTMLInputElement;
  optionList: HTMLElement;
  optionSelector: string;
  valueDatasetKey: string;
  onOpen: () => void;
  onSearch: () => void;
  onSelect: (value: string) => void | Promise<void>;
}

// Wires a searchable dropdown to common click, keyboard, and outside-close behavior.
export function bind(options: BindOptions): void {
  options.button.addEventListener("click", (event) => toggle(options, event));
  options.searchInput.addEventListener("input", options.onSearch);
  options.searchInput.addEventListener("keydown", (event) => handleSearchKeydown(options, event));
  options.optionList.addEventListener("click", (event) => selectFromEvent(options, event));
  options.optionList.addEventListener("keydown", (event) => handleOptionKeydown(options, event));
  document.addEventListener("click", (event) => closeFromOutside(options, event));
}

// Hides the dropdown panel and updates expanded state.
export function close(options: BindOptions): void {
  closePanel(options.button, options.panel);
}

// Hides any dropdown panel paired with a trigger button.
export function closePanel(button: HTMLButtonElement, panel: HTMLElement): void {
  panel.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

// Opens or closes the dropdown panel.
function toggle(options: BindOptions, event: MouseEvent): void {
  event.stopPropagation();
  const willOpen = options.panel.hidden;
  options.panel.hidden = !willOpen;
  options.button.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    options.onOpen();
    options.searchInput.focus();
    options.searchInput.select();
  }
}

// Selects an option from mouse interaction.
function selectFromEvent(options: BindOptions, event: MouseEvent): void {
  const option = (event.target as HTMLElement).closest<HTMLButtonElement>(options.optionSelector);
  const value = option?.dataset[options.valueDatasetKey];
  if (value !== undefined) {
    void options.onSelect(value);
  }
}

// Handles Enter and arrow keys while focus is in the search box.
function handleSearchKeydown(options: BindOptions, event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focusOption(options, event.key === "ArrowDown" ? 0 : optionButtons(options).length - 1);
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const option = activeOrFirstOption(options);
    const value = option?.dataset[options.valueDatasetKey];
    if (value !== undefined) {
      void options.onSelect(value);
    }
  }
}

// Handles keyboard movement and selection once an option has focus.
function handleOptionKeydown(options: BindOptions, event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    const value = (document.activeElement as HTMLElement | null)?.dataset[options.valueDatasetKey];
    if (value !== undefined) {
      void options.onSelect(value);
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
    return;
  }
  event.preventDefault();
  const buttons = optionButtons(options);
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const offset = event.key === "ArrowDown" ? 1 : -1;
  focusOption(options, (current + offset + buttons.length) % buttons.length);
}

// Closes the dropdown when a click lands outside its button and panel.
function closeFromOutside(options: BindOptions, event: MouseEvent): void {
  const target = event.target as Node;
  if (!options.panel.contains(target) && !options.button.contains(target)) {
    close(options);
  }
}

// Returns visible option buttons for keyboard navigation.
function optionButtons(options: BindOptions): HTMLButtonElement[] {
  return Array.from(options.optionList.querySelectorAll<HTMLButtonElement>(options.optionSelector));
}

// Returns the selected visible option or falls back to the first option.
function activeOrFirstOption(options: BindOptions): HTMLButtonElement | null {
  return options.optionList.querySelector<HTMLButtonElement>(`${options.optionSelector}.is-active`)
    || optionButtons(options)[0]
    || null;
}

// Moves focus to one option and keeps it visible in the scroll panel.
function focusOption(options: BindOptions, index: number): void {
  const buttons = optionButtons(options);
  if (!buttons.length) {
    return;
  }
  const button = buttons[Math.max(0, Math.min(index, buttons.length - 1))];
  button.focus();
  button.scrollIntoView({ block: "nearest" });
}

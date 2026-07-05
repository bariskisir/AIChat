/** Shared searchable dropdown keyboard and open/close behavior. */
// Wires a searchable dropdown to common click, keyboard, and outside-close behavior.
export function bind(options) {
    options.button.addEventListener("click", (event) => toggle(options, event));
    options.searchInput.addEventListener("input", options.onSearch);
    options.searchInput.addEventListener("keydown", (event) => handleSearchKeydown(options, event));
    options.optionList.addEventListener("click", (event) => selectFromEvent(options, event));
    options.optionList.addEventListener("keydown", (event) => handleOptionKeydown(options, event));
    document.addEventListener("click", (event) => closeFromOutside(options, event));
}
// Hides the dropdown panel and updates expanded state.
export function close(options) {
    closePanel(options.button, options.panel);
}
// Hides any dropdown panel paired with a trigger button.
export function closePanel(button, panel) {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
}
// Opens or closes the dropdown panel.
function toggle(options, event) {
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
function selectFromEvent(options, event) {
    const option = event.target.closest(options.optionSelector);
    const value = option?.dataset[options.valueDatasetKey];
    if (value !== undefined) {
        void options.onSelect(value);
    }
}
// Handles Enter and arrow keys while focus is in the search box.
function handleSearchKeydown(options, event) {
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
function handleOptionKeydown(options, event) {
    if (event.key === "Enter") {
        event.preventDefault();
        const value = document.activeElement?.dataset[options.valueDatasetKey];
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
    const current = buttons.indexOf(document.activeElement);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    focusOption(options, (current + offset + buttons.length) % buttons.length);
}
// Closes the dropdown when a click lands outside its button and panel.
function closeFromOutside(options, event) {
    const target = event.target;
    if (!options.panel.contains(target) && !options.button.contains(target)) {
        close(options);
    }
}
// Returns visible option buttons for keyboard navigation.
function optionButtons(options) {
    return Array.from(options.optionList.querySelectorAll(options.optionSelector));
}
// Returns the selected visible option or falls back to the first option.
function activeOrFirstOption(options) {
    return options.optionList.querySelector(`${options.optionSelector}.is-active`)
        || optionButtons(options)[0]
        || null;
}
// Moves focus to one option and keeps it visible in the scroll panel.
function focusOption(options, index) {
    const buttons = optionButtons(options);
    if (!buttons.length) {
        return;
    }
    const button = buttons[Math.max(0, Math.min(index, buttons.length - 1))];
    button.focus();
    button.scrollIntoView({ block: "nearest" });
}

/** DOM reference collection for AI Chat. */

// Single source of truth: every HTML element id the app references.
// Adding a new element is a one-line change here — getRefs() and
// the Refs type are generated from this list automatically.
const ELEMENT_IDS = [
  "appShell",
  "statusRow",
  "statusText",
  "btnRefresh",
  "btnProviders",
  "modelDropdownButton",
  "modelDropdown",
  "modelSearchInput",
  "modelOptionList",
  "modelSelect",
  "reasoningField",
  "reasoningSelect",
  "thinkingField",
  "thinkingSelect",
  "verbosityField",
  "verbositySelect",
  "claudeExtendedThinkingField",
  "claudeExtendedThinking",
  "claudeEffortField",
  "claudeEffortSelect",
  "providerDialog",
  "providerStatusRow",
  "providerStatusText",
  "providerList",
  "btnAddProvider",
  "btnCloseProviders",
  "providerForm",
  "providerTemplateField",
  "providerTemplate",
  "providerTemplateButton",
  "providerTemplateDropdown",
  "providerTemplateSearchInput",
  "providerTemplateOptionList",
  "providerId",
  "providerNameField",
  "providerName",
  "providerApiUrlField",
  "providerApiUrl",
  "providerApiKeyField",
  "providerApiKey",
  "providerCustomHeadersField",
  "providerCustomHeaders",
  "codexLoginRow",
  "btnCodexLogin",
  "codexAccountPanel",
  "codexAccountEmail",
  "codexAccountPlan",
  "codexAccountLimit",
  "codexAccountReset",
  "codexAccountModels",
  "btnCodexRefresh",
  "btnCodexSignOut",
  "claudeLoginRow",
  "btnClaudeLogin",
  "claudeAccountPanel",
  "claudeAccountEmail",
  "claudeAccountPlan",
  "claudeAccountModels",
  "btnClaudeRefresh",
  "btnClaudeSignOut",
  "providerEditorTitle",
  "providerActions",
  "btnCancelProvider",
  "btnNewSession",
  "navSessions",
  "resizerSidebar",
  "btnCompact",
  "btnAlwaysOnTop",
  "chatMessages",
  "resizerComposer",
  "formComposer",
  "inputComposer",
  "composerPreview",
  "btnSend",
  "btnCopyChat",
  "btnDeveloper",
  "btnSource",
  "btnSettings",
  "settingsDialog",
  "btnCloseSettings",
  "settingsShowFooter",
  "settingsShowInfoBar",
  "settingsTitleGenDropdownButton",
  "settingsTitleGenDropdown",
  "settingsTitleGenSearchInput",
  "settingsTitleGenOptionList",
  "settingsTitleGenSelect",
] as const;

type ElementId = typeof ELEMENT_IDS[number];

// Maps each element id to its HTML element type via suffix/prefix
// heuristics, with explicit overrides for ids that don't follow the
// pattern.
type ElementTypeFor<T extends string> =
  T extends `btn${string}` ? HTMLButtonElement :
  T extends `${string}Button` ? HTMLButtonElement :
  T extends `${string}Input` ? HTMLInputElement :
  T extends `${string}Select` ? HTMLSelectElement :
  T extends `${string}Dialog` ? HTMLDialogElement :
  T extends `${string}Form` ? HTMLFormElement :
  T extends `${string}TextArea` ? HTMLTextAreaElement :
  T extends "formComposer" ? HTMLFormElement :
  T extends "inputComposer" ? HTMLTextAreaElement :
  T extends "claudeExtendedThinking" ? HTMLInputElement :
  T extends "providerTemplate" ? HTMLSelectElement :
  T extends "providerId" ? HTMLInputElement :
  T extends "providerName" ? HTMLInputElement :
  T extends "providerApiUrl" ? HTMLInputElement :
  T extends "providerApiKey" ? HTMLInputElement :
  T extends "providerCustomHeaders" ? HTMLInputElement :
  T extends "settingsShowFooter" ? HTMLInputElement :
  T extends "settingsShowInfoBar" ? HTMLInputElement :
  HTMLElement;

// Typed map of every DOM node the app touches, generated from the
// ELEMENT_IDS list.
export type Refs = {
  [K in ElementId]: ElementTypeFor<K>;
};

// Resolves all static DOM nodes used by the app.
export function getRefs(): Refs {
  const refs = {} as Record<string, HTMLElement>;
  for (const id of ELEMENT_IDS) {
    refs[id] = get(id);
  }
  return refs as Refs;
}

// Returns a typed element reference or fails fast during startup.
function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

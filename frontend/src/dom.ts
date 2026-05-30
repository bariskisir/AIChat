/** DOM reference collection for AI Chat. */

namespace DomRefs {
  export interface Refs {
    appShell: HTMLElement;
    statusRow: HTMLElement;
    statusText: HTMLElement;
    btnRefresh: HTMLButtonElement;
    btnProviders: HTMLButtonElement;
    modelDropdownButton: HTMLButtonElement;
    modelDropdown: HTMLElement;
    modelSearchInput: HTMLInputElement;
    modelOptionList: HTMLElement;
    modelSelect: HTMLSelectElement;
    reasoningField: HTMLElement;
    reasoningSelect: HTMLSelectElement;
    thinkingField: HTMLElement;
    thinkingSelect: HTMLSelectElement;
    verbosityField: HTMLElement;
    verbositySelect: HTMLSelectElement;
    claudeExtendedThinkingField: HTMLElement;
    claudeExtendedThinking: HTMLInputElement;
    claudeEffortField: HTMLElement;
    claudeEffortSelect: HTMLSelectElement;
    providerDialog: HTMLDialogElement;
    providerStatusRow: HTMLElement;
    providerStatusText: HTMLElement;
    providerList: HTMLElement;
    btnAddProvider: HTMLButtonElement;
    btnCloseProviders: HTMLButtonElement;
    providerForm: HTMLFormElement;
    providerTemplateField: HTMLElement;
    providerTemplate: HTMLSelectElement;
    providerTemplateButton: HTMLButtonElement;
    providerTemplateDropdown: HTMLElement;
    providerTemplateSearchInput: HTMLInputElement;
    providerTemplateOptionList: HTMLElement;
    providerId: HTMLInputElement;
    providerNameField: HTMLElement;
    providerName: HTMLInputElement;
    providerApiUrlField: HTMLElement;
    providerApiUrl: HTMLInputElement;
    providerApiKeyField: HTMLElement;
    providerApiKey: HTMLInputElement;
    providerCustomHeadersField: HTMLElement;
    providerCustomHeaders: HTMLInputElement;
    codexLoginRow: HTMLElement;
    btnCodexLogin: HTMLButtonElement;
    codexAccountPanel: HTMLElement;
    codexAccountEmail: HTMLElement;
    codexAccountPlan: HTMLElement;
    codexAccountLimit: HTMLElement;
    codexAccountReset: HTMLElement;
    codexAccountModels: HTMLElement;
    btnCodexRefresh: HTMLButtonElement;
    btnCodexSignOut: HTMLButtonElement;
    claudeLoginRow: HTMLElement;
    btnClaudeLogin: HTMLButtonElement;
    claudeAccountPanel: HTMLElement;
    claudeAccountEmail: HTMLElement;
    claudeAccountPlan: HTMLElement;
    claudeAccountModels: HTMLElement;
    btnClaudeRefresh: HTMLButtonElement;
    btnClaudeSignOut: HTMLButtonElement;
    providerEditorTitle: HTMLElement;
    providerActions: HTMLElement;
    btnCancelProvider: HTMLButtonElement;
    btnNewSession: HTMLButtonElement;
    navSessions: HTMLElement;
    resizerSidebar: HTMLElement;
    btnCompact: HTMLButtonElement;
    btnAlwaysOnTop: HTMLButtonElement;
    chatMessages: HTMLElement;
    resizerComposer: HTMLElement;
    formComposer: HTMLFormElement;
    inputComposer: HTMLTextAreaElement;
    composerPreview: HTMLElement;
    btnSend: HTMLButtonElement;
    btnCopyChat: HTMLButtonElement;
    btnDeveloper: HTMLButtonElement;
    btnSource: HTMLButtonElement;
    btnSettings: HTMLButtonElement;
    settingsDialog: HTMLDialogElement;
    btnCloseSettings: HTMLButtonElement;
    settingsShowFooter: HTMLInputElement;
    settingsShowInfoBar: HTMLInputElement;
    settingsTitleGenDropdownButton: HTMLButtonElement;
    settingsTitleGenDropdown: HTMLElement;
    settingsTitleGenSearchInput: HTMLInputElement;
    settingsTitleGenOptionList: HTMLElement;
    settingsTitleGenSelect: HTMLSelectElement;
  }

  // Resolves all static DOM nodes used by the app.
  export function getRefs(): Refs {
    return {
      appShell: get("appShell"),
      statusRow: get("statusRow"),
      statusText: get("statusText"),
      btnRefresh: get("btnRefresh"),
      btnProviders: get("btnProviders"),
      modelDropdownButton: get("modelDropdownButton"),
      modelDropdown: get("modelDropdown"),
      modelSearchInput: get("modelSearchInput"),
      modelOptionList: get("modelOptionList"),
      modelSelect: get("modelSelect"),
      reasoningField: get("reasoningField"),
      reasoningSelect: get("reasoningSelect"),
      thinkingField: get("thinkingField"),
      thinkingSelect: get("thinkingSelect"),
      verbosityField: get("verbosityField"),
      verbositySelect: get("verbositySelect"),
      claudeExtendedThinkingField: get("claudeExtendedThinkingField"),
      claudeExtendedThinking: get("claudeExtendedThinking"),
      claudeEffortField: get("claudeEffortField"),
      claudeEffortSelect: get("claudeEffortSelect"),
      providerDialog: get("providerDialog"),
      providerStatusRow: get("providerStatusRow"),
      providerStatusText: get("providerStatusText"),
      providerList: get("providerList"),
      btnAddProvider: get("btnAddProvider"),
      btnCloseProviders: get("btnCloseProviders"),
      providerForm: get("providerForm"),
      providerTemplateField: get("providerTemplateField"),
      providerTemplate: get("providerTemplate"),
      providerTemplateButton: get("providerTemplateButton"),
      providerTemplateDropdown: get("providerTemplateDropdown"),
      providerTemplateSearchInput: get("providerTemplateSearchInput"),
      providerTemplateOptionList: get("providerTemplateOptionList"),
      providerId: get("providerId"),
      providerNameField: get("providerNameField"),
      providerName: get("providerName"),
      providerApiUrlField: get("providerApiUrlField"),
      providerApiUrl: get("providerApiUrl"),
      providerApiKeyField: get("providerApiKeyField"),
      providerApiKey: get("providerApiKey"),
      providerCustomHeadersField: get("providerCustomHeadersField"),
      providerCustomHeaders: get("providerCustomHeaders"),
      codexLoginRow: get("codexLoginRow"),
      btnCodexLogin: get("btnCodexLogin"),
      codexAccountPanel: get("codexAccountPanel"),
      codexAccountEmail: get("codexAccountEmail"),
      codexAccountPlan: get("codexAccountPlan"),
      codexAccountLimit: get("codexAccountLimit"),
      codexAccountReset: get("codexAccountReset"),
      codexAccountModels: get("codexAccountModels"),
      btnCodexRefresh: get("btnCodexRefresh"),
      btnCodexSignOut: get("btnCodexSignOut"),
      claudeLoginRow: get("claudeLoginRow"),
      btnClaudeLogin: get("btnClaudeLogin"),
      claudeAccountPanel: get("claudeAccountPanel"),
      claudeAccountEmail: get("claudeAccountEmail"),
      claudeAccountPlan: get("claudeAccountPlan"),
      claudeAccountModels: get("claudeAccountModels"),
      btnClaudeRefresh: get("btnClaudeRefresh"),
      btnClaudeSignOut: get("btnClaudeSignOut"),
      providerEditorTitle: get("providerEditorTitle"),
      providerActions: get("providerActions"),
      btnCancelProvider: get("btnCancelProvider"),
      btnNewSession: get("btnNewSession"),
      navSessions: get("navSessions"),
      resizerSidebar: get("resizerSidebar"),
      btnCompact: get("btnCompact"),
      btnAlwaysOnTop: get("btnAlwaysOnTop"),
      chatMessages: get("chatMessages"),
      resizerComposer: get("resizerComposer"),
      formComposer: get("formComposer"),
      inputComposer: get("inputComposer"),
      composerPreview: get("composerPreview"),
      btnSend: get("btnSend"),
      btnCopyChat: get("btnCopyChat"),
      btnDeveloper: get("btnDeveloper"),
      btnSource: get("btnSource"),
      btnSettings: get("btnSettings"),
      settingsDialog: get("settingsDialog"),
      btnCloseSettings: get("btnCloseSettings"),
      settingsShowFooter: get("settingsShowFooter"),
      settingsShowInfoBar: get("settingsShowInfoBar"),
      settingsTitleGenDropdownButton: get("settingsTitleGenDropdownButton"),
      settingsTitleGenDropdown: get("settingsTitleGenDropdown"),
      settingsTitleGenSearchInput: get("settingsTitleGenSearchInput"),
      settingsTitleGenOptionList: get("settingsTitleGenOptionList"),
      settingsTitleGenSelect: get("settingsTitleGenSelect"),
    };
  }

  // Returns a typed element reference or fails fast during startup.
  function get<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element as T;
  }
}

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
    reasoningSelect: HTMLSelectElement;
    providerDialog: HTMLDialogElement;
    providerList: HTMLElement;
    btnAddProvider: HTMLButtonElement;
    btnCloseProviders: HTMLButtonElement;
    providerEditorDialog: HTMLDialogElement;
    providerForm: HTMLFormElement;
    providerTemplate: HTMLSelectElement;
    providerTemplateButton: HTMLButtonElement;
    providerTemplateDropdown: HTMLElement;
    providerTemplateSearchInput: HTMLInputElement;
    providerTemplateOptionList: HTMLElement;
    providerId: HTMLInputElement;
    providerName: HTMLInputElement;
    providerApiUrl: HTMLInputElement;
    providerApiKey: HTMLInputElement;
    providerCustomHeaders: HTMLTextAreaElement;
    providerEditorTitle: HTMLElement;
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
      reasoningSelect: get("reasoningSelect"),
      providerDialog: get("providerDialog"),
      providerList: get("providerList"),
      btnAddProvider: get("btnAddProvider"),
      btnCloseProviders: get("btnCloseProviders"),
      providerEditorDialog: get("providerEditorDialog"),
      providerForm: get("providerForm"),
      providerTemplate: get("providerTemplate"),
      providerTemplateButton: get("providerTemplateButton"),
      providerTemplateDropdown: get("providerTemplateDropdown"),
      providerTemplateSearchInput: get("providerTemplateSearchInput"),
      providerTemplateOptionList: get("providerTemplateOptionList"),
      providerId: get("providerId"),
      providerName: get("providerName"),
      providerApiUrl: get("providerApiUrl"),
      providerApiKey: get("providerApiKey"),
      providerCustomHeaders: get("providerCustomHeaders"),
      providerEditorTitle: get("providerEditorTitle"),
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

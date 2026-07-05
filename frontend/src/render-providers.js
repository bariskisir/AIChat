import * as Constants from "./constants.js";
// Renders the provider manager list.
export function renderProviders(refs, state) {
    refs.providerList.innerHTML = "";
    if (!state) {
        return;
    }
    for (const provider of state.providers.providers) {
        refs.providerList.appendChild(providerItemNode(provider, refs.providerId.value));
    }
}
// Builds one provider row for the provider dialog.
function providerItemNode(provider, selectedProviderId) {
    const item = document.createElement("div");
    item.className = Constants.CSS.CH_SIDEBAR_ITEM;
    item.dataset.providerId = provider.id;
    item.classList.toggle(Constants.CSS.IS_ACTIVE, provider.id === selectedProviderId);
    item.classList.toggle(Constants.CSS.IS_ERROR, provider.enabled && Boolean(provider.error));
    const title = document.createElement("button");
    title.type = "button";
    title.className = Constants.CSS.CH_SIDEBAR_TITLE;
    title.dataset.providerId = provider.id;
    title.textContent = provider.name || "Provider";
    title.title = provider.error || provider.apiUrl;
    item.appendChild(title);
    if (!provider.builtIn && !provider.isEnv) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = Constants.CSS.CH_SIDEBAR_DELETE;
        deleteButton.dataset.deleteProviderId = provider.id;
        deleteButton.title = "Delete provider";
        deleteButton.setAttribute("aria-label", `Delete ${provider.name || "provider"}`);
        item.appendChild(deleteButton);
    }
    return item;
}

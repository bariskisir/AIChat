// Shared frontend data types exchanged with the Tauri backend.
type ChatRole = "user" | "assistant";

interface AppSettings {
  model: string;
  activeSessionId: string;
  compactMode: boolean;
  reasoningEffort: string;
  thinkingVariant: string;
  verbosity: string;
  extendedThinking: boolean;
  claudeEffort: string;
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
  windowX?: number;
  windowY?: number;
  showFooter: boolean;
  showInfoBar: boolean;
  titleGenModel: string;
}

interface AvailableModel {
  providerId: string;
  providerName: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  inputModalities: string[];
  defaultThinkingVariant: string;
  thinkingVariants: ThinkingVariantOption[];
  supportVerbosity: boolean;
  defaultVerbosity: string;
}

interface ThinkingVariantOption {
  value: string;
  description: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  customHeaders: CustomHeader[];
  builtIn: boolean;
  enabled: boolean;
  models: AvailableModel[];
  error: string;
}

interface CustomHeader {
  name: string;
  value: string;
}

interface ProviderSnapshot {
  configured: boolean;
  providers: ProviderConfig[];
  activeProviderId: string;
  error: string;
}

interface AccountSnapshot {
  loggedIn: boolean;
  email: string;
  error: string;
}

interface ClaudeAccountSnapshot {
  loggedIn: boolean;
  email: string;
  plan: string;
  error: string;
}

interface CatalogSnapshot {
  models: AvailableModel[];
  thinkingVariants: ThinkingVariantOption[];
  verbositySupported: boolean;
  defaultVerbosity: string;
  limitLabel: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  imageDataUrls: string[];
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  model: string;
  reasoningEffort: string;
  extendedThinking: boolean;
  claudeEffort: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface AppSnapshot {
  settings: AppSettings;
  status: string;
  account: AccountSnapshot;
  claudeAccount: ClaudeAccountSnapshot;
  providers: ProviderSnapshot;
  catalog: CatalogSnapshot;
  sessions: ChatSession[];
  activeSession: ChatSession;
  isGenerating: boolean;
}

interface FrontendSettings {
  model: string;
  compactMode: boolean;
  reasoningEffort: string;
  thinkingVariant: string;
  verbosity: string;
  extendedThinking: boolean;
  claudeEffort: string;
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
  showFooter: boolean;
  showInfoBar: boolean;
  titleGenModel: string;
}

interface UiEventPayload {
  type: "snapshot" | "assistantDelta" | "sessionTitleUpdated" | "error";
  snapshot?: AppSnapshot;
  sessionId?: string;
  messageId?: string;
  title?: string;
  text?: string;
  message?: string;
}

interface SendMessageRequest {
  text: string;
  imageDataUrls: string[];
}

interface ProviderInput {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  customHeaders: string;
}

type LinkTarget = "developer" | "source";

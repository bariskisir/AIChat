// Shared frontend data types exchanged with the Tauri backend.
type ChatRole = "user" | "assistant";

interface AppSettings {
  model: string;
  activeSessionId: string;
  compactMode: boolean;
  reasoningEffort: string;
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
  windowX?: number;
  windowY?: number;
}

interface AvailableModel {
  providerId: string;
  providerName: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
}

interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  customHeaders: CustomHeader[];
  builtIn: boolean;
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

interface CatalogSnapshot {
  models: AvailableModel[];
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
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface AppSnapshot {
  settings: AppSettings;
  status: string;
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
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
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

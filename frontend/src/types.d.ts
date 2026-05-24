// Shared frontend data types exchanged with the Tauri backend.
type ChatRole = "user" | "assistant";

interface AppSettings {
  model: string;
  thinkingVariant: string;
  activeSessionId: string;
  compactMode: boolean;
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
  windowX?: number;
  windowY?: number;
}

interface ThinkingVariantOption {
  value: string;
  description: string;
}

interface AvailableModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  inputModalities: string[];
  defaultThinkingVariant: string;
  thinkingVariants: ThinkingVariantOption[];
}

interface AccountSnapshot {
  loggedIn: boolean;
  email: string;
  error: string;
}

interface CatalogSnapshot {
  models: AvailableModel[];
  thinkingVariants: ThinkingVariantOption[];
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
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface AppSnapshot {
  settings: AppSettings;
  status: string;
  account: AccountSnapshot;
  catalog: CatalogSnapshot;
  sessions: ChatSession[];
  activeSession: ChatSession;
  isGenerating: boolean;
}

interface FrontendSettings {
  model: string;
  thinkingVariant: string;
  compactMode: boolean;
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

type LinkTarget = "developer" | "source";

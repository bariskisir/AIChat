// Shared frontend data types exchanged with the Tauri backend.
type ChatRole = "user" | "assistant";

interface AppSettings {
  model: string;
  activeSessionId: string;
  compactMode: boolean;
  extendedThinking: boolean;
  alwaysOnTop: boolean;
  windowWidth: number;
  windowHeight: number;
  sidebarWidth: number;
  windowX?: number;
  windowY?: number;
}

interface AvailableModel {
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
}

interface AccountSnapshot {
  loggedIn: boolean;
  email: string;
  plan: string;
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
  extendedThinking: boolean;
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
  compactMode: boolean;
  extendedThinking: boolean;
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

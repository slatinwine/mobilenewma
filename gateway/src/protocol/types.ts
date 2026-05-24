// Protocol Types for Gateway Communication

export interface Frame {
  type: 'req' | 'res' | 'event';
  id?: string;
  method?: string;
  event?: string;
  params?: any;
  payload?: any;
  ok?: boolean;
  error?: ErrorShape;
}

export interface ErrorShape {
  code: string;
  message: string;
  details?: any;
}

export interface ClientInfo {
  id: string;
  version: string;
  platform: string;
  mode: 'operator' | 'node';
}

export interface ConnectParams {
  minProtocol?: number;
  maxProtocol?: number;
  client: ClientInfo;
  role?: 'operator' | 'node';
  auth?: {
    token?: string;
  };
  device?: {
    id: string;
    publicKey?: string;
    signature?: string;
    signedAt?: number;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  id?: string;
}

export interface ChatSendParams {
  message: string;
  sessionKey?: string;
  idempotencyKey?: string;
}

export interface ChatHistoryParams {
  sessionKey?: string;
  limit?: number;
  before?: number;
}

export interface ChatSearchParams {
  query?: string;
  tag?: string;
  limit?: number;
}

export interface ChatSessionHistoryParams {
  sessionId: string;
}

export interface FileAttachment {
  type: 'image' | 'text' | 'code';
  filename: string;
  mimeType?: string;
  language?: string;
  size: number;
}

export interface AgentParams {
  message: string;
  sessionKey?: string;
  idempotencyKey?: string;
  model?: string;
  thinkLevel?: 'brief' | 'normal' | 'detailed';
  image?: string;
  attachments?: FileAttachment[];
}

// Binary frame header for protocol
export interface BinaryFrameHeader {
  type: 'attachment';
  fileType: 'image' | 'text' | 'code';
  filename: string;
  mimeType?: string;
  language?: string;
  size: number;
  messageId: string;
}

export interface AgentCancelParams {
  runId: string;
  sessionKey?: string;
}

export interface AgentEvent {
  runId: string;
  sessionKey: string;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: {
    role: 'assistant';
    content: string;
  };
  delta?: string;
  errorMessage?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface RegisterParams {
  username: string;
  password: string;
  email?: string;
}

export interface LoginParams {
  emailOrUsername: string;
  password: string;
  deviceInfo?: DeviceInfo;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'mobile' | 'web' | 'desktop';
  userAgent?: string;
}

export interface RefreshTokenParams {
  refreshToken: string;
}

export interface LogoutParams {
  refreshToken: string;
}

export interface AuthResponse {
  user: {
    id: string;
    username: string;
    email?: string;
    created_at: number;
    last_login?: number;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface ConfigCreateParams {
  name: string;
  provider: 'openai' | 'claude' | 'newma' | 'newmaweb';
  apiKey: string;
  baseUrl?: string;
  model?: string;
  newmaPath?: string;
  workspaceDir?: string;
}

export interface ConfigUpdateParams {
  id: string;
  name?: string;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  newmaPath?: string;
  workspaceDir?: string;
}

export interface ConfigGetParams {
  configName?: string;
}

export interface ConfigListParams {
  // No params needed - lists all user configs
}

export interface ConfigDeleteParams {
  configName: string;
}

export interface AIConfigResponse {
  id: string;
  provider: string;
  configName: string;
  baseUrl?: string;
  model?: string;
  newmaPath?: string;
  workspaceDir?: string;
  created_at: number;
  updated_at: number;
  // Note: apiKey is NOT returned for security
}

export interface GatewayMethods {
  // Existing methods
  'connect': () => void;
  'chat.send': (params: ChatSendParams) => Promise<void>;
  'chat.history': (params: ChatHistoryParams) => Promise<ChatMessage[]>;
  'chat.search': (params: ChatSearchParams) => Promise<any[]>;
  'chat.sessionHistory': (params: ChatSessionHistoryParams) => Promise<ChatMessage[]>;
  'agent': (params: AgentParams) => Promise<void>;
  'agent.cancel': (params: AgentCancelParams) => Promise<void>;
  'health': () => Promise<{ status: string; uptime: number }>;
  'ping': () => Promise<{ pong: number }>;

  // NEW: Authentication methods
  'auth.register': (params: RegisterParams) => Promise<AuthResponse>;
  'auth.login': (params: LoginParams) => Promise<AuthResponse>;
  'auth.refresh': (params: RefreshTokenParams) => Promise<AuthResponse>;
  'auth.logout': (params: LogoutParams) => Promise<void>;

  // NEW: Configuration methods
  'config.create': (params: ConfigCreateParams) => Promise<AIConfigResponse>;
  'config.update': (params: ConfigUpdateParams) => Promise<AIConfigResponse>;
  'config.get': (params: ConfigGetParams) => Promise<AIConfigResponse>;
  'config.list': (params: ConfigListParams) => Promise<AIConfigResponse[]>;
  'config.delete': (params: ConfigDeleteParams) => Promise<void>;
}

export interface GatewayEvents {
  'connected': () => void;
  'disconnected': (reason?: string) => void;
  'agent': (data: AgentEvent) => void;
  'chat': (data: any) => void;
  'error': (error: ErrorShape) => void;
  'tick': () => void;
}

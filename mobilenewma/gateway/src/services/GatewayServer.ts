// Gateway Server - Main WebSocket server implementation

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createEvent, createRequest, createResponse, createErrorResponse } from '../protocol/codec.js';
import { Frame, ConnectParams, ChatSendParams, ChatHistoryParams, ChatSearchParams, ChatSessionHistoryParams, AgentParams, BinaryFrameHeader, RegisterParams, LoginParams, RefreshTokenParams, LogoutParams, ConfigCreateParams, ConfigUpdateParams, ConfigGetParams, ConfigListParams, ConfigDeleteParams } from '../protocol/types.js';
import { AIService } from './AIService.js';
import { NewmaService } from './NewmaService.js';
import { NewmaWebService } from './NewmaWebService.js';
import { MockAIService } from './MockAIService.js';
import { ChatManager } from './ChatManager.js';
import { MemoService } from './MemoService.js';
import { ChatMessage } from '../protocol/types.js';
import { AuthService } from './AuthService.js';
import { DatabaseService } from './Database.js';
import { ConfigService } from './ConfigService.js';
import { ExplorationScheduler } from './ExplorationScheduler.js';

interface ClientConnection {
  id: string;
  socket: WebSocket;
  info: any;
  connectedAt: number;
  sessionKey: string; // Each client has its own session for isolation
  userId?: string; // Authenticated user ID
  username?: string; // Authenticated username
}

interface AgentRequest {
  socket: WebSocket;
  requestId: string;
  sessionKey: string;
  message: string;
  runId: string;
}

interface PendingBinaryData {
  messageId: string;
  attachmentCount: number;
  receivedCount: number;
  attachments: Array<{ header: any; data: Buffer }>;
}

export class GatewayServer {
  private wss: WebSocketServer;
  private port: number;
  private clients: Map<WebSocket, ClientConnection> = new Map();
  private aiService: AIService | NewmaService | NewmaWebService | MockAIService;
  private chatManager: ChatManager;
  private memoService: MemoService;
  private authService: AuthService;
  private database: DatabaseService;
  private configService: ConfigService;
  private explorationScheduler: ExplorationScheduler;
  private startTime: number;
  // Session-based queues: each session has its own queue for concurrent processing
  private sessionQueues: Map<string, AgentRequest[]> = new Map();
  private sessionProcessing: Map<string, boolean> = new Map();
  private pendingBinaryData: Map<string, PendingBinaryData> = new Map();

  constructor(
    port: number,
    aiService: AIService | NewmaService | NewmaWebService | MockAIService,
    authService: AuthService,
    database: DatabaseService,
    configService: ConfigService,
    explorationScheduler: ExplorationScheduler
  ) {
    this.port = port;
    this.aiService = aiService;
    this.authService = authService;
    this.database = database;
    this.configService = configService;
    this.explorationScheduler = explorationScheduler;
    this.chatManager = new ChatManager();
    this.memoService = new MemoService();
    this.startTime = Date.now();

    this.wss = new WebSocketServer({
      port: this.port,
      host: '0.0.0.0', // Listen on all network interfaces
      clientTracking: true
    });
    this.setupServer();
  }

  private setupServer(): void {
    console.log('[GatewayServer] Setting up server handlers...');

    this.wss.on('listening', () => {
      console.log('[GatewayServer] WebSocket server is listening');
    });

    this.wss.on('error', (error) => {
      console.error('[GatewayServer] WebSocket server error:', error);
    });

    // Log all incoming connections (even before WebSocket upgrade)
    this.wss.on('headers', (headers, req) => {
      console.log('[GatewayServer] Incoming WebSocket request:');
      console.log('  URL:', req.url);
      console.log('  Method:', req.method);
      console.log('  Headers:', req.headers);
    });

    this.wss.on('connection', (socket: WebSocket, req) => {
      const clientId = uuidv4();
      console.log(`[${new Date().toISOString()}] Client connecting: ${clientId}`);
      console.log('[GatewayServer] Request URL:', req.url);
      console.log('[GatewayServer] Request headers:', req.headers);

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        this.handleMessage(socket, data, isBinary);
      });

      socket.on('close', () => {
        const client = this.clients.get(socket);
        if (client) {
          console.log(`[${new Date().toISOString()}] Client disconnected: ${client.id}`);
          this.clients.delete(socket);
        }
      });

      socket.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
      });

      // Send challenge event
      const challengeFrame = createEvent('challenge', {
        nonce: uuidv4(),
        timestamp: Date.now()
      });
      socket.send(JSON.stringify(challengeFrame));
      console.log('[GatewayServer] Challenge sent to client');
    });

    console.log(`[${new Date().toISOString()}] Gateway server listening on port ${this.port}`);

    // Start tick interval
    setInterval(() => {
      this.broadcast(createEvent('tick'));
    }, 15000);
  }

  private async handleMessage(socket: WebSocket, data: Buffer, isBinary: boolean): Promise<void> {
    try {
      if (isBinary) {
        // Handle binary frame
        console.log('[Gateway] Received binary frame, size:', data.length);
        await this.handleBinaryFrame(socket, data);
      } else {
        // Handle JSON text frame
        const frame: Frame = JSON.parse(data.toString());
        console.log('[Gateway] Received frame:', frame.type, frame.method);

        if (frame.type === 'req') {
          await this.handleRequest(socket, frame);
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  private async handleBinaryFrame(socket: WebSocket, data: Buffer): Promise<void> {
    // Binary frames come in pairs: JSON header + binary data
    // Try to parse as JSON first (header)
    try {
      const text = data.toString();
      const header = JSON.parse(text) as BinaryFrameHeader;

      if (header.type === 'attachment') {
        console.log('[Gateway] Received binary attachment header:', header);

        // Store header and wait for binary data
        const pending = this.pendingBinaryData.get(header.messageId);
        if (pending) {
          // This shouldn't happen - header should always precede data
          console.warn('[Gateway] Received header but expected binary data');
        }
        // Next frame will be the binary data
        return;
      }
    } catch (e) {
      // Not JSON, must be binary data
      console.log('[Gateway] Received binary data buffer:', data.length, 'bytes');
    }

    // At this point, we have binary data but need to know which request it belongs to
    // The client sends: JSON header -> binary data
    // We need to track this state per socket
    console.log('[Gateway] Binary frame received (implementation pending)');
  }

  private async handleRequest(socket: WebSocket, frame: Frame): Promise<void> {
    const { id, method, params } = frame;

    if (!id) {
      console.error('Request missing id');
      return;
    }

    try {
      switch (method) {
        case 'connect':
          await this.handleConnect(socket, id, params as ConnectParams);
          break;

        // NEW: Authentication methods
        case 'auth.register':
          await this.handleAuthRegister(socket, id, params as RegisterParams);
          break;

        case 'auth.login':
          await this.handleAuthLogin(socket, id, params as LoginParams);
          break;

        case 'auth.refresh':
          await this.handleAuthRefresh(socket, id, params as RefreshTokenParams);
          break;

        case 'auth.logout':
          await this.handleAuthLogout(socket, id, params as LogoutParams);
          break;

        // NEW: Configuration methods
        case 'config.create':
          await this.handleConfigCreate(socket, id, params as ConfigCreateParams);
          break;

        case 'config.update':
          await this.handleConfigUpdate(socket, id, params as ConfigUpdateParams);
          break;

        case 'config.get':
          await this.handleConfigGet(socket, id, params as ConfigGetParams);
          break;

        case 'config.list':
          await this.handleConfigList(socket, id, params as ConfigListParams);
          break;

        case 'config.delete':
          await this.handleConfigDelete(socket, id, params as ConfigDeleteParams);
          break;

        case 'chat.send':
          await this.handleChatSend(socket, id, params as ChatSendParams);
          break;

        case 'chat.history':
          await this.handleChatHistory(socket, id, params as ChatHistoryParams);
          break;

        case 'chat.search':
          await this.handleChatSearch(socket, id, params as ChatSearchParams);
          break;

        case 'chat.sessionHistory':
          await this.handleChatSessionHistory(socket, id, params as ChatSessionHistoryParams);
          break;

        case 'agent':
          await this.handleAgent(socket, id, params as AgentParams);
          break;

        case 'health':
          this.sendResponse(socket, id, {
            status: 'ok',
            uptime: Date.now() - this.startTime
          });
          break;

        case 'ping':
          this.sendResponse(socket, id, { pong: Date.now() });
          break;

        // NEW: Exploration methods
        case 'exploration.status':
          await this.handleExplorationStatus(socket, id);
          break;

        case 'exploration.history':
          await this.handleExplorationHistory(socket, id, params as any);
          break;

        case 'exploration.get':
          await this.handleExplorationGet(socket, id, params as any);
          break;

        case 'exploration.stats':
          await this.handleExplorationStats(socket, id);
          break;

        default:
          this.sendError(socket, id, 'UNKNOWN_METHOD', `Unknown method: ${method}`);
      }
    } catch (error: any) {
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleConnect(socket: WebSocket, id: string, params: ConnectParams): Promise<void> {
    // NEW: Validate JWT token if provided
    let userId: string | undefined;
    let username: string | undefined;

    if (params.auth?.token) {
      const payload = this.authService.verifyAccessToken(params.auth.token);
      if (payload) {
        userId = payload.userId;
        username = payload.username;
        console.log(`[${new Date().toISOString()}] User authenticated: ${username}`);
      } else {
        // Invalid token - reject connection
        this.sendError(socket, id, 'UNAUTHORIZED', 'Invalid or expired token');
        socket.close();
        return;
      }
    }

    // SPECIAL: For mobile app, use testuser ID
    if (params.client.id === 'mobile-app' && !userId) {
      userId = 'a4904246-1df3-47ed-a5cf-bc5b5fc50f3c'; // testuser ID
      username = 'testuser';
      console.log(`[${new Date().toISOString()}] Mobile app using testuser ID`);
    }

    // Use authenticated username or client ID as session key
    const effectiveUsername = username || params.client.id || 'anonymous';
    const sessionKey = `user:${effectiveUsername}`;

    // Check if this is a reconnection (session queue already exists)
    const isReconnection = this.sessionQueues.has(sessionKey);

    const client: ClientConnection = {
      id: uuidv4(),
      socket,
      info: params.client,
      connectedAt: Date.now(),
      sessionKey, // User-based session key for persistence
      userId, // Authenticated user ID (if authenticated)
      username // Authenticated username (if authenticated)
    };

    this.clients.set(socket, client);

    const response = createResponse(id, {
      status: 'connected',
      gatewayId: client.id,
      sessionKey: client.sessionKey, // Send sessionKey back to client
      protocolVersion: 3,
      timestamp: Date.now(),
      isReconnection, // Indicate if this is a reconnection
      authenticated: !!userId // NEW: Indicate if authenticated
    });

    socket.send(JSON.stringify(response));

    console.log(`[${new Date().toISOString()}] Client ${isReconnection ? 'reconnected' : 'connected'}: ${params.client.id} (${params.client.platform}), sessionKey: ${sessionKey}${username ? `, user: ${username}` : ''}`);

    // Initialize session queue if it doesn't exist (new session)
    // If it exists (reconnection), reuse the existing queue and history
    if (!this.sessionQueues.has(sessionKey)) {
      this.sessionQueues.set(sessionKey, []);
      this.sessionProcessing.set(sessionKey, false);
      console.log(`[${new Date().toISOString()}] New session created for user: ${effectiveUsername}`);
    } else {
      console.log(`[${new Date().toISOString()}] Resumed existing session for user: ${effectiveUsername}`);
    }

    // Send connected event
    this.sendEvent(socket, 'connected', {
      gatewayId: client.id,
      sessionKey,
      isReconnection,
      authenticated: !!userId
    });
  }

  private async handleChatSend(socket: WebSocket, id: string, params: ChatSendParams): Promise<void> {
    const client = this.clients.get(socket);
    const sessionKey = client?.sessionKey || params.sessionKey || 'main';

    const message: ChatMessage = {
      role: 'user',
      content: params.message,
      timestamp: Date.now()
    };

    this.chatManager.addMessage(sessionKey, message);

    // Only send response to the sender, no broadcasting
    this.sendResponse(socket, id, {
      sessionId: sessionKey,
      messageId: message.id,
      timestamp: message.timestamp
    });

    // Broadcast removed - each client has their own isolated session
    // this.broadcast(createEvent('chat', { sessionKey, message }));
  }

  private async handleChatHistory(socket: WebSocket, id: string, params: ChatHistoryParams): Promise<void> {
    const sessionKey = params.sessionKey || 'main';
    const messages = this.chatManager.getHistory(sessionKey, params.limit, params.before);

    this.sendResponse(socket, id, {
      sessionKey,
      messages
    });
  }

  private async handleChatSearch(socket: WebSocket, id: string, params: ChatSearchParams): Promise<void> {
    // Use searchSessions to group by session instead of individual decisions
    const results = this.memoService.searchSessions(params.query || '', params.tag);

    this.sendResponse(socket, id, {
      query: params.query,
      tag: params.tag,
      results
    });
  }

  private async handleChatSessionHistory(socket: WebSocket, id: string, params: ChatSessionHistoryParams): Promise<void> {
    // Get all messages for a specific session
    const messages = this.memoService.getSessionHistory(params.sessionId);

    this.sendResponse(socket, id, {
      sessionId: params.sessionId,
      messages
    });
  }

  private async handleAgent(socket: WebSocket, id: string, params: AgentParams): Promise<void> {
    const client = this.clients.get(socket);
    // Prioritize params.sessionKey for multi-session support, fall back to client's sessionKey
    const sessionKey = params.sessionKey || client?.sessionKey || 'main';
    const runId = uuidv4();
    console.log('[Gateway] handleAgent called:', { id, sessionKey, runId, message: params.message });

    // Log attachments if present
    if (params.attachments && params.attachments.length > 0) {
      console.log('[Gateway] Received attachments:', params.attachments.length);
      params.attachments.forEach((att, index) => {
        console.log(`[Gateway]   Attachment ${index + 1}:`, {
          type: att.type,
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          language: att.language
        });
      });
    }

    if (params.image) {
      console.log('[Gateway] Received image attachment (base64 length):', params.image.length);
    }

    // Add user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: params.message,
      timestamp: Date.now()
    };
    this.chatManager.addMessage(sessionKey, userMessage);

    // Send initial response
    this.sendResponse(socket, id, {
      runId,
      sessionKey,
      status: 'started'
    });

    // Get or create session queue
    if (!this.sessionQueues.has(sessionKey)) {
      this.sessionQueues.set(sessionKey, []);
      this.sessionProcessing.set(sessionKey, false);
    }

    const queue = this.sessionQueues.get(sessionKey)!;

    // Add to session queue (not global queue)
    queue.push({
      socket,
      requestId: id,
      sessionKey,
      message: params.message,
      runId
    });
    console.log('[Gateway] Added to session queue, sessionKey:', sessionKey, 'queue size:', queue.length, 'isProcessing:', this.sessionProcessing.get(sessionKey));

    // Process session queue if not already processing
    const isProcessing = this.sessionProcessing.get(sessionKey);
    if (!isProcessing) {
      console.log('[Gateway] Starting session queue processing for sessionKey:', sessionKey);
      this.processSessionQueue(sessionKey);
    }
  }

  private async processSessionQueue(sessionKey: string): Promise<void> {
    const queue = this.sessionQueues.get(sessionKey);
    if (!queue || queue.length === 0) {
      console.log('[Gateway] processSessionQueue skipped:', { sessionKey, queueLength: queue?.length || 0 });
      return;
    }

    console.log('[Gateway] processSessionQueue starting:', { sessionKey, queueSize: queue.length });
    this.sessionProcessing.set(sessionKey, true);

    while (queue.length > 0) {
      const request = queue.shift();
      if (!request) break;

      console.log('[Gateway] Processing request from session queue, remaining:', queue.length, 'sessionKey:', sessionKey);
      try {
        await this.processAgentRequest(request);
        console.log('[Gateway] Request processed successfully for sessionKey:', sessionKey);
      } catch (error: any) {
        console.error('[Gateway] Error processing agent request for sessionKey:', sessionKey, error);
        this.sendEvent(request.socket, 'agent', {
          runId: request.runId,
          sessionKey: request.sessionKey,
          state: 'error',
          errorMessage: error.message
        });
      }
    }

    console.log('[Gateway] Session queue processing complete, sessionKey:', sessionKey);
    this.sessionProcessing.set(sessionKey, false);
  }

  private async processAgentRequest(request: AgentRequest): Promise<void> {
    const { socket, sessionKey, runId } = request;
    console.log('[Gateway] processAgentRequest started:', { runId, sessionKey });

    // Get conversation history
    const history = this.chatManager.getHistory(sessionKey);
    console.log('[Gateway] History retrieved:', history.length, 'messages');

    // Extract the last user message for Memo recording
    const lastUserMessage = history.filter(m => m.role === 'user').pop();
    const userMessageContent = lastUserMessage?.content || request.message;

    // Get client to check for user-specific AI config
    const client = this.clients.get(socket);
    let aiService = this.aiService;

    // If client has userId, try to load their AI config from database
    if (client && client.userId) {
      try {
        const userConfigs = this.database.getAllAIConfigs(client.userId);
        if (userConfigs && userConfigs.length > 0) {
          // Use the first/default config
          const config = userConfigs[0];
          console.log('[Gateway] Using user AI config from database:', {
            id: config.id,
            provider: config.provider,
            configName: config.config_name
          });

          // Get decrypted API key
          const apiKey = this.configService.getDecryptedApiKey(config);

          // Create a new AI service instance with user's config
          if (config.provider === 'newma') {
            const { NewmaService } = await import('./NewmaService.js');
            aiService = new NewmaService(
              config.newma_path || process.env.NEWMA_PATH || 'newma',
              config.workspace_dir || process.env.WORKSPACE_DIR || process.cwd(),
              process.env.DATABASE_PATH,
              process.env.WORKSPACES_DIR,
              apiKey,
              config.base_url,
              undefined, // endpoint
              config.model,
              process.env.NEWMA_API_MODE === 'true'
            );
            console.log('[Gateway] Created NewmaService with user config');
          } else if (config.provider === 'openai' || config.provider === 'claude') {
            const { AIService } = await import('./AIService.js');
            aiService = new AIService(
              config.provider as 'claude' | 'openai',
              apiKey,
              config.model
            );
            console.log('[Gateway] Created AIService with user config');
          }
        }
      } catch (error: any) {
        console.warn('[Gateway] Failed to load user AI config, using default:', error.message);
      }
    }

    // Start AI processing
    const aiMessages = history.map(m => ({
      role: m.role,
      content: m.content
    }));
    console.log('[Gateway] Calling aiService.chat with', aiMessages.length, 'messages');

    let fullResponse = '';

    const response = await aiService.chat(aiMessages, (delta, isFinal) => {
      fullResponse += delta;
      console.log('[Gateway] Stream callback:', { delta, isFinal, fullResponseLength: fullResponse.length });

      // Only send delta events during streaming
      // Don't send final event here - it will be sent after completion
      if (!isFinal) {
        this.sendEvent(socket, 'agent', {
          runId,
          sessionKey,
          state: 'delta',
          delta
        });
      }
    }, sessionKey); // Pass sessionKey to AI service for session-level indexing
    console.log('[Gateway] aiService.chat completed, response:', response);

    // Add assistant message
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: response.content,
      timestamp: Date.now()
    };
    this.chatManager.addMessage(sessionKey, assistantMessage);

    // Record conversation to Memo (after AI completes)
    if (this.memoService.isEnabled()) {
      try {
        this.memoService.recordConversation(
          sessionKey,
          userMessageContent,
          response.content,
          ['chat', 'ai-conversation']
        );
      } catch (error: any) {
        console.error('[Gateway] Failed to record conversation to Memo:', error.message);
      }
    }

    // Send final event with usage
    this.sendEvent(socket, 'agent', {
      runId,
      sessionKey,
      state: 'final',
      message: {
        role: 'assistant',
        content: response.content
      },
      usage: response.usage,
      stopReason: response.stopReason
    });
  }

  private sendResponse(socket: WebSocket, id: string, payload: any): void {
    const response = createResponse(id, payload);
    socket.send(JSON.stringify(response));
  }

  private sendError(socket: WebSocket, id: string, code: string, message: string): void {
    const response = createErrorResponse(id, code, message);
    socket.send(JSON.stringify(response));
  }

  private sendEvent(socket: WebSocket, event: string, payload?: any): void {
    const frame = createEvent(event, payload);
    console.log('[Gateway] sendEvent:', { event, payload: JSON.stringify(payload).substring(0, 100) });
    console.log('[Gateway] Socket readyState:', socket.readyState);

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
      console.log('[Gateway] Event sent successfully');
    } else {
      console.error('[Gateway] Cannot send event, socket not open. readyState:', socket.readyState);
    }
  }

  private broadcast(frame: any, exclude?: WebSocket): void {
    const data = JSON.stringify(frame);
    this.clients.forEach((client, socket) => {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });
  }

  close(): void {
    this.wss.close();
  }

  // ============================================================================
  // NEW: Authentication Handlers
  // ============================================================================

  private async handleAuthRegister(socket: WebSocket, id: string, params: RegisterParams): Promise<void> {
    try {
      // Check if username already exists
      const existingUser = this.database.getUserByUsername(params.username);
      if (existingUser) {
        this.sendError(socket, id, 'USER_EXISTS', 'Username already exists');
        return;
      }

      // Check if email already exists
      if (params.email) {
        const existingEmail = this.database.getUserByEmail(params.email);
        if (existingEmail) {
          this.sendError(socket, id, 'EMAIL_EXISTS', 'Email already exists');
          return;
        }
      }

      // Hash password
      const passwordHash = await this.authService.hashPassword(params.password);

      // Create user
      const userId = this.database.createUser(params.username, passwordHash, params.email);

      // Generate tokens
      const accessToken = this.authService.generateAccessToken(userId, params.username);
      const refreshToken = this.authService.generateRefreshToken();
      const refreshTokenHash = this.authService.hashToken(refreshToken);
      const refreshTokenExpiry = this.authService.getRefreshTokenExpiry();

      // Store refresh token
      this.database.createRefreshToken(
        userId,
        refreshTokenHash,
        refreshTokenExpiry,
        JSON.stringify((params as any).deviceInfo || {})
      );

      // Get user from DB
      const user = this.database.getUserById(userId);

      this.sendResponse(socket, id, {
        user: {
          id: user!.id,
          username: user!.username,
          email: user!.email,
          created_at: user!.created_at,
          last_login: user!.last_login
        },
        accessToken,
        refreshToken,
        expiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
      });

      console.log(`[${new Date().toISOString()}] User registered: ${params.username}`);
    } catch (error: any) {
      console.error('[Gateway] Register error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleAuthLogin(socket: WebSocket, id: string, params: LoginParams): Promise<void> {
    try {
      // Find user by username or email
      let user = this.database.getUserByUsername(params.emailOrUsername);
      if (!user) {
        user = this.database.getUserByEmail(params.emailOrUsername);
      }

      if (!user) {
        this.sendError(socket, id, 'INVALID_CREDENTIALS', 'Invalid username or password');
        return;
      }

      // Verify password
      const isValid = await this.authService.verifyPassword(params.password, user.password_hash);
      if (!isValid) {
        this.sendError(socket, id, 'INVALID_CREDENTIALS', 'Invalid username or password');
        return;
      }

      // Update last login
      this.database.updateUserLastLogin(user.id);

      // Generate tokens
      const accessToken = this.authService.generateAccessToken(user.id, user.username);
      const refreshToken = this.authService.generateRefreshToken();
      const refreshTokenHash = this.authService.hashToken(refreshToken);
      const refreshTokenExpiry = this.authService.getRefreshTokenExpiry();

      // Store refresh token
      this.database.createRefreshToken(
        user.id,
        refreshTokenHash,
        refreshTokenExpiry,
        JSON.stringify((params as any).deviceInfo || {})
      );

      this.sendResponse(socket, id, {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          created_at: user.created_at,
          last_login: user.last_login
        },
        accessToken,
        refreshToken,
        expiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
      });

      console.log(`[${new Date().toISOString()}] User logged in: ${user.username}`);
    } catch (error: any) {
      console.error('[Gateway] Login error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleAuthRefresh(socket: WebSocket, id: string, params: RefreshTokenParams): Promise<void> {
    try {
      // Hash the refresh token
      const tokenHash = this.authService.hashToken(params.refreshToken);

      // Look up token in database
      const tokenRecord = this.database.getRefreshToken(tokenHash);
      if (!tokenRecord) {
        this.sendError(socket, id, 'INVALID_TOKEN', 'Invalid or expired refresh token');
        return;
      }

      // Get user
      const user = this.database.getUserById(tokenRecord.user_id);
      if (!user) {
        this.sendError(socket, id, 'USER_NOT_FOUND', 'User not found');
        return;
      }

      // Delete old refresh token
      this.database.deleteRefreshToken(tokenHash);

      // Generate new tokens
      const accessToken = this.authService.generateAccessToken(user.id, user.username);
      const newRefreshToken = this.authService.generateRefreshToken();
      const newRefreshTokenHash = this.authService.hashToken(newRefreshToken);
      const refreshTokenExpiry = this.authService.getRefreshTokenExpiry();

      // Store new refresh token
      this.database.createRefreshToken(
        user.id,
        newRefreshTokenHash,
        refreshTokenExpiry,
        tokenRecord.device_info
      );

      this.sendResponse(socket, id, {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          created_at: user.created_at,
          last_login: user.last_login
        },
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 7 * 24 * 60 * 60 // 7 days in seconds
      });

      console.log(`[${new Date().toISOString()}] Token refreshed for user: ${user.username}`);
    } catch (error: any) {
      console.error('[Gateway] Token refresh error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleAuthLogout(socket: WebSocket, id: string, params: LogoutParams): Promise<void> {
    try {
      // Hash and delete refresh token
      const tokenHash = this.authService.hashToken(params.refreshToken);
      this.database.deleteRefreshToken(tokenHash);

      this.sendResponse(socket, id, {
        success: true
      });

      console.log(`[${new Date().toISOString()}] User logged out`);
    } catch (error: any) {
      console.error('[Gateway] Logout error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  // ============================================================================
  // NEW: Configuration Handlers
  // ============================================================================

  private async handleConfigCreate(socket: WebSocket, id: string, params: ConfigCreateParams): Promise<void> {
    try {
      // Get authenticated user from client connection
      const client = this.clients.get(socket);
      if (!client || !client.userId) {
        this.sendError(socket, id, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      // Save configuration
      await this.configService.saveUserConfig(
        client.userId,
        params.name || 'default',
        params.provider,
        params.apiKey,
        {
          baseUrl: params.baseUrl,
          model: params.model,
          newmaPath: params.newmaPath,
          workspaceDir: params.workspaceDir
        }
      );

      // Get the saved config (without API key)
      const config = this.configService.getUserAIConfig(client.userId, params.name || 'default');

      this.sendResponse(socket, id, {
        id: config!.id,
        provider: config!.provider,
        configName: config!.config_name,
        baseUrl: config!.base_url,
        model: config!.model,
        newmaPath: config!.newma_path,
        workspaceDir: config!.workspace_dir,
        created_at: config!.created_at,
        updated_at: config!.updated_at
      });

      console.log(`[${new Date().toISOString()}] Config created for user ${client.userId}: ${params.provider}`);
    } catch (error: any) {
      console.error('[Gateway] Config create error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleConfigUpdate(socket: WebSocket, id: string, params: ConfigUpdateParams): Promise<void> {
    try {
      const client = this.clients.get(socket);
      if (!client || !client.userId) {
        this.sendError(socket, id, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      // Get existing config
      const existing = this.database.getAIConfig(params.id);
      if (!existing || existing.user_id !== client.userId) {
        this.sendError(socket, id, 'CONFIG_NOT_FOUND', 'Configuration not found');
        return;
      }

      // Update configuration if API key provided
      if (params.apiKey) {
        await this.configService.saveUserConfig(
          client.userId,
          existing.config_name,
          params.provider || existing.provider,
          params.apiKey,
          {
            baseUrl: params.baseUrl || existing.base_url,
            model: params.model || existing.model,
            newmaPath: params.newmaPath || existing.newma_path,
            workspaceDir: params.workspaceDir || existing.workspace_dir
          }
        );
      }

      // Get updated config
      const config = this.database.getAIConfig(params.id);

      this.sendResponse(socket, id, {
        id: config!.id,
        provider: config!.provider,
        configName: config!.config_name,
        baseUrl: config!.base_url,
        model: config!.model,
        newmaPath: config!.newma_path,
        workspaceDir: config!.workspace_dir,
        created_at: config!.created_at,
        updated_at: config!.updated_at
      });

      console.log(`[${new Date().toISOString()}] Config updated for user ${client.userId}: ${params.id}`);
    } catch (error: any) {
      console.error('[Gateway] Config update error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleConfigGet(socket: WebSocket, id: string, params: ConfigGetParams): Promise<void> {
    try {
      const client = this.clients.get(socket);
      if (!client || !client.userId) {
        this.sendError(socket, id, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      const config = this.configService.getUserAIConfig(client.userId, params.configName || 'default');
      if (!config) {
        this.sendError(socket, id, 'CONFIG_NOT_FOUND', 'Configuration not found');
        return;
      }

      this.sendResponse(socket, id, {
        id: config.id,
        provider: config.provider,
        configName: config.config_name,
        baseUrl: config.base_url,
        model: config.model,
        newmaPath: config.newma_path,
        workspaceDir: config.workspace_dir,
        created_at: config.created_at,
        updated_at: config.updated_at
      });
    } catch (error: any) {
      console.error('[Gateway] Config get error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleConfigList(socket: WebSocket, id: string, params: ConfigListParams): Promise<void> {
    try {
      const client = this.clients.get(socket);
      if (!client || !client.userId) {
        this.sendError(socket, id, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      const configs = this.configService.listUserConfigs(client.userId);

      const response = configs.map(config => ({
        id: config.id,
        provider: config.provider,
        configName: config.config_name,
        baseUrl: config.base_url,
        model: config.model,
        newmaPath: config.newma_path,
        workspaceDir: config.workspace_dir,
        created_at: config.created_at,
        updated_at: config.updated_at
      }));

      this.sendResponse(socket, id, response);
    } catch (error: any) {
      console.error('[Gateway] Config list error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  private async handleConfigDelete(socket: WebSocket, id: string, params: ConfigDeleteParams): Promise<void> {
    try {
      const client = this.clients.get(socket);
      if (!client || !client.userId) {
        this.sendError(socket, id, 'UNAUTHORIZED', 'Authentication required');
        return;
      }

      await this.configService.deleteUserConfig(client.userId, params.configName);

      this.sendResponse(socket, id, {
        success: true
      });

      console.log(`[${new Date().toISOString()}] Config deleted for user ${client.userId}: ${params.configName}`);
    } catch (error: any) {
      console.error('[Gateway] Config delete error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  // ============================================================================
  // Exploration Methods
  // ============================================================================

  /**
   * 获取探索系统当前状态
   */
  private async handleExplorationStatus(socket: WebSocket, id: string): Promise<void> {
    try {
      const stats = await this.explorationScheduler.getStatistics();

      this.sendResponse(socket, id, {
        enabled: true,
        isRunning: this.explorationScheduler['isRunning'],
        statistics: stats,
        timestamp: Date.now()
      });

      console.log(`[${new Date().toISOString()}] Exploration status requested`);
    } catch (error: any) {
      console.error('[Gateway] Exploration status error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  /**
   * 获取探索历史记录
   */
  private async handleExplorationHistory(socket: WebSocket, id: string, params: any): Promise<void> {
    try {
      const limit = params?.limit || 50;
      const tasks = await this.explorationScheduler.getAllTasks(limit);

      this.sendResponse(socket, id, {
        tasks: tasks.map(task => ({
          id: task.id,
          status: task.status,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          createdAt: task.createdAt,
          summary: task.resultSummary ? JSON.parse(task.resultSummary).summary : undefined
        })),
        count: tasks.length
      });

      console.log(`[${new Date().toISOString()}] Exploration history requested: ${tasks.length} tasks`);
    } catch (error: any) {
      console.error('[Gateway] Exploration history error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  /**
   * 获取单个探索任务详情
   */
  private async handleExplorationGet(socket: WebSocket, id: string, params: any): Promise<void> {
    try {
      const taskId = params?.taskId;
      if (!taskId) {
        this.sendError(socket, id, 'INVALID_PARAMS', 'taskId is required');
        return;
      }

      const task = await this.explorationScheduler.getTask(taskId);
      if (!task) {
        this.sendError(socket, id, 'NOT_FOUND', `Task ${taskId} not found`);
        return;
      }

      this.sendResponse(socket, id, {
        task: {
          id: task.id,
          status: task.status,
          plan: task.plan ? JSON.parse(task.plan) : undefined,
          executionLog: task.executionLog ? JSON.parse(task.executionLog) : undefined,
          resultSummary: task.resultSummary ? JSON.parse(task.resultSummary) : undefined,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          createdAt: task.createdAt
        }
      });

      console.log(`[${new Date().toISOString()}] Exploration task requested: ${taskId}`);
    } catch (error: any) {
      console.error('[Gateway] Exploration get error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }

  /**
   * 获取探索统计信息
   */
  private async handleExplorationStats(socket: WebSocket, id: string): Promise<void> {
    try {
      const stats = await this.explorationScheduler.getStatistics();

      this.sendResponse(socket, id, {
        total: stats.total,
        completed: stats.completed,
        failed: stats.failed,
        running: stats.running,
        lastExploration: stats.lastExploration,
        successRate: stats.total > 0 ? (stats.completed / stats.total * 100).toFixed(2) + '%' : 'N/A'
      });

      console.log(`[${new Date().toISOString()}] Exploration statistics requested`);
    } catch (error: any) {
      console.error('[Gateway] Exploration stats error:', error);
      this.sendError(socket, id, 'INTERNAL_ERROR', error.message);
    }
  }
}

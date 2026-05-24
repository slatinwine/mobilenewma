// Configuration Service - AI config management with per-user workspaces

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService, AIConfig } from './Database.js';
import { AuthService } from './AuthService.js';
import { NewmaService } from './NewmaService.js';

interface UserWorkspace {
  userId: string;
  workspaceDir: string;
  newmaService: NewmaService | null;
}

export class ConfigService {
  private workspaces: Map<string, UserWorkspace> = new Map();
  private db: DatabaseService;
  private auth: AuthService;
  private baseWorkspaceDir: string;

  constructor(db: DatabaseService, auth: AuthService, baseWorkspaceDir: string = './workspaces') {
    this.db = db;
    this.auth = auth;
    this.baseWorkspaceDir = baseWorkspaceDir;

    // Ensure base workspace directory exists
    if (!existsSync(baseWorkspaceDir)) {
      mkdirSync(baseWorkspaceDir, { recursive: true });
    }
  }

  // Get user's AI configuration from database
  getUserAIConfig(userId: string, configName: string = 'default'): AIConfig | null {
    const config = this.db.getAIConfig(userId, configName);

    if (!config) {
      console.log(`[ConfigService] No config found for user ${userId}, config ${configName}`);
      return null;
    }

    console.log(`[ConfigService] Found config for user ${userId}: ${config.provider}`);
    return config;
  }

  // List all user's configurations
  listUserConfigs(userId: string): AIConfig[] {
    return this.db.getAllAIConfigs(userId);
  }

  // Save user's AI configuration
  async saveUserConfig(
    userId: string,
    configName: string,
    provider: string,
    apiKey: string,
    options: {
      baseUrl?: string;
      model?: string;
      newmaPath?: string;
      workspaceDir?: string;
    }
  ): Promise<void> {
    console.log(`[ConfigService] Saving config for user ${userId}: ${provider}`);

    // Encrypt API key
    const { encrypted, iv, authTag } = this.auth.encryptApiKey(apiKey);

    // Store as base64 (combined iv:authTag:encrypted)
    const apiKeyEncrypted = `${iv}:${authTag}:${encrypted}`;

    // Save to database
    this.db.saveAIConfig({
      id: uuidv4(),
      user_id: userId,
      provider,
      config_name: configName,
      api_key_encrypted: apiKeyEncrypted,
      base_url: options.baseUrl,
      model: options.model,
      newma_path: options.newmaPath,
      workspace_dir: options.workspaceDir
    });

    console.log(`[ConfigService] Config saved successfully`);

    // If this is the default config, reload the user's workspace
    if (configName === 'default') {
      await this.reloadUserWorkspace(userId);
    }
  }

  // Decrypt and get API key from config
  getDecryptedApiKey(config: AIConfig): string {
    const parts = config.api_key_encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted API key format');
    }

    const [iv, authTag, encrypted] = parts;
    return this.auth.decryptApiKey(encrypted, iv, authTag);
  }

  // Get or create user's workspace
  async getUserWorkspace(userId: string): Promise<UserWorkspace> {
    // Check if workspace already exists
    if (this.workspaces.has(userId)) {
      return this.workspaces.get(userId)!;
    }

    // Get user's default config
    const config = this.getUserAIConfig(userId, 'default');
    if (!config) {
      throw new Error(`No AI configuration found for user ${userId}`);
    }

    // Create workspace directory
    const workspaceDir = join(this.baseWorkspaceDir, userId);

    if (!existsSync(workspaceDir)) {
      mkdirSync(workspaceDir, { recursive: true });
    }

    // Generate settings.json for this user
    await this.generateUserSettingsJson(config, workspaceDir);

    // Create NewmaService for this user
    let newmaService: NewmaService | null = null;

    if (config.provider === 'newma' || config.provider === 'newmaweb') {
      const newmaPath = config.newma_path || 'newma';
      newmaService = new NewmaService(newmaPath, workspaceDir);
      console.log(`[ConfigService] Created NewmaService for user ${userId}`);
    }

    const workspace: UserWorkspace = {
      userId,
      workspaceDir,
      newmaService
    };

    this.workspaces.set(userId, workspace);
    return workspace;
  }

  // Generate settings.json for user's workspace
  private async generateUserSettingsJson(config: AIConfig, workspaceDir: string): Promise<void> {
    const settingsPath = join(workspaceDir, 'settings.json');

    let settings: any = {};

    // Decrypt API key
    const apiKey = this.getDecryptedApiKey(config);

    switch (config.provider) {
      case 'openai':
      case 'claude':
        settings = {
          openai: {
            apiKey: apiKey,
            baseUrl: config.base_url || 'https://api.openai.com/v1',
            endpoint: config.base_url || 'https://api.openai.com/v1/chat/completions',
            model: config.model || 'gpt-4'
          },
          project: {
            rootDir: workspaceDir,
            maxIterations: 3,
            enableTools: true,
            permissionLevel: 'standard',
            enableVerification: false,
            enableMultiAgent: true
          }
        };
        break;

      case 'newma':
      case 'newmaweb':
        settings = {
          openai: {
            apiKey: apiKey,
            baseUrl: config.base_url || 'https://api.openai.com/v1',
            endpoint: config.base_url || 'https://api.openai.com/v1/chat/completions',
            model: config.model || 'gpt-4'
          },
          project: {
            rootDir: workspaceDir,
            maxIterations: 3,
            enableTools: true,
            permissionLevel: 'standard',
            enableVerification: false,
            enableMultiAgent: true
          }
        };
        break;
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`[ConfigService] Generated settings.json at ${settingsPath}`);
  }

  // Reload user's workspace (restart newma with new config)
  async reloadUserWorkspace(userId: string): Promise<void> {
    console.log(`[ConfigService] Reloading workspace for user ${userId}`);

    // Clean up existing workspace
    if (this.workspaces.has(userId)) {
      const oldWorkspace = this.workspaces.get(userId)!;

      // TODO: Stop any running newma processes
      // This would require tracking active processes and terminating them

      // Remove from memory
      this.workspaces.delete(userId);

      // Optionally clean up workspace directory
      // rmSync(oldWorkspace.workspaceDir, { recursive: true, force: true });
    }

    // Create new workspace with updated config
    await this.getUserWorkspace(userId);

    console.log(`[ConfigService] Workspace reloaded for user ${userId}`);
  }

  // Delete user configuration
  async deleteUserConfig(userId: string, configName: string): Promise<void> {
    this.db.deleteAIConfig(userId, configName);

    // If default config was deleted, clean up workspace
    if (configName === 'default') {
      if (this.workspaces.has(userId)) {
        const workspace = this.workspaces.get(userId)!;
        this.workspaces.delete(userId);

        // Clean up workspace directory
        rmSync(workspace.workspaceDir, { recursive: true, force: true });
        console.log(`[ConfigService] Cleaned up workspace for user ${userId}`);
      }
    }
  }

  // Get NewmaService for a user
  async getNewmaService(userId: string): Promise<NewmaService | null> {
    const workspace = await this.getUserWorkspace(userId);
    return workspace.newmaService;
  }

  // Clean up all workspaces (call on shutdown)
  cleanup(): void {
    console.log('[ConfigService] Cleaning up all workspaces...');

    this.workspaces.forEach((workspace, userId) => {
      try {
        // Clean up workspace directory
        rmSync(workspace.workspaceDir, { recursive: true, force: true });
        console.log(`[ConfigService] Cleaned up workspace for user ${userId}`);
      } catch (error) {
        console.error(`[ConfigService] Error cleaning up workspace for user ${userId}:`, error);
      }
    });

    this.workspaces.clear();
  }
}

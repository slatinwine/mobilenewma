// Main entry point for Gateway server

import dotenv from 'dotenv';
import { AIService } from './services/AIService.js';
import { NewmaService } from './services/NewmaService.js';
import { NewmaWebService } from './services/NewmaWebService.js';
import { MockAIService } from './services/MockAIService.js';
import { GatewayServer } from './services/GatewayServer.js';
import { DatabaseService } from './services/Database.js';
import { AuthService } from './services/AuthService.js';
import { ConfigService } from './services/ConfigService.js';
import { ExplorationScheduler } from './services/ExplorationScheduler.js';

// Load environment variables
dotenv.config();

async function main() {
  const port = parseInt(process.env.PORT || '18789');
  const backend = process.env.AI_BACKEND || 'mock'; // 'api', 'newma', 'newmaweb', or 'mock'

  // ============================================================================
  // Initialize Database and Auth Services
  // ============================================================================
  console.log('[Gateway] Initializing database and authentication services...');

  // Check required environment variables
  const jwtSecret = process.env.JWT_SECRET;
  const encryptionKey = process.env.ENCRYPTION_KEY;

  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('ERROR: JWT_SECRET must be set and at least 32 characters');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  if (!encryptionKey || encryptionKey.length < 32) {
    console.error('ERROR: ENCRYPTION_KEY must be set and at least 32 characters');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  // Initialize database
  const database = new DatabaseService(process.env.DATABASE_PATH || './database/gateway.db');
  await database.initialize();
  console.log('[Gateway] ✓ Database initialized');

  // Initialize auth service
  const authService = new AuthService(jwtSecret, encryptionKey);
  console.log('[Gateway] ✓ Auth service initialized');

  // Initialize config service
  const workspacesDir = process.env.WORKSPACES_DIR || './workspaces';
  const configService = new ConfigService(database, authService, workspacesDir);
  console.log('[Gateway] ✓ Config service initialized');

  // Initialize exploration scheduler
  const explorationEnabled = process.env.EXPLORATION_ENABLED === 'true';
  const explorationLogDir = process.env.EXPLORATION_LOG_DIR || './.memo/logs';
  const explorationScheduler = new ExplorationScheduler(database, {
    enabled: explorationEnabled,
    schedule: '*/1 * * * *',
    logDir: explorationLogDir
  });
  console.log('[Gateway] ✓ Exploration scheduler initialized');

  // Start exploration scheduler if enabled
  if (explorationEnabled) {
    await explorationScheduler.start();
    console.log('[Gateway] ✓ Exploration scheduler started');
  }

  let aiService: AIService | NewmaService | NewmaWebService | MockAIService;

  if (backend === 'mock') {
    // Use Mock AI for testing
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║          Simple Chat Gateway v1.0.0                   ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Backend:  ${'Mock AI (Testing)'.padEnd(45)}║`);
    console.log(`║  Port:     ${port.toString().padEnd(45)}║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log();
    console.log('✓ Mock AI service ready (no API key required)\n');

    aiService = new MockAIService();
  } else if (backend === 'newma') {
    // Use Newma CLI
    const newmaPath = process.env.NEWMA_PATH || 'newma';
    const workspaceDir = process.env.WORKSPACE_DIR || process.cwd();
    const databasePath = process.env.DATABASE_PATH;
    const workspacesDir = process.env.WORKSPACES_DIR;

    // Read AI configuration from settings.json or environment
    // Priority: settings.json > Environment variables
    let apiKey = process.env.OPENAI_API_KEY;
    let baseUrl = process.env.OPENAI_BASE_URL;
    let endpoint = process.env.OPENAI_ENDPOINT;
    let model = process.env.OPENAI_MODEL;

    // Try to read from settings.json
    try {
      const fs = await import('fs');
      const path = await import('path');

      // Try multiple locations for settings.json
      const settingsPaths = [
        path.resolve(workspaceDir, 'settings.json'),  // workspaceDir/settings.json
        path.resolve(process.cwd(), 'settings.json'),  // cwd/settings.json
        path.resolve('settings.json')                   // Relative to cwd
      ];

      for (const settingsPath of settingsPaths) {
        if (fs.existsSync(settingsPath)) {
          console.log(`[Gateway] Loading settings from: ${settingsPath}`);
          const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsContent);
          if (settings.openai) {
            apiKey = apiKey || settings.openai.apiKey;
            baseUrl = baseUrl || settings.openai.baseUrl;
            endpoint = endpoint || settings.openai.endpoint;
            model = model || settings.openai.model;
            break; // Found and loaded settings
          }
        }
      }
    } catch (error) {
      console.warn('[Gateway] Warning: Could not read settings.json:', error);
    }

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║          Simple Chat Gateway v1.0.0                   ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Backend:  ${'Newma CLI'.padEnd(45)}║`);
    console.log(`║  Path:     ${newmaPath.padEnd(45)}║`);
    console.log(`║  Database: ${(databasePath || 'N/A').padEnd(45)}║`);
    console.log(`║  API Key:  ${(apiKey ? 'Configured' : 'Missing').padEnd(45)}║`);
    console.log(`║  Model:    ${(model || 'N/A').padEnd(45)}║`);
    console.log(`║  Port:     ${port.toString().padEnd(45)}║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log();

    // 🔥 新增：检查是否启用API模式
    const useApiMode = process.env.NEWMA_API_MODE === 'true';

    aiService = new NewmaService(
      newmaPath,
      workspaceDir,
      databasePath,
      workspacesDir,
      apiKey,
      baseUrl,
      endpoint,
      model,
      useApiMode // 🔥 新增：传递API模式标志
    );

    // Skip CLI availability check for now
    // The check can fail due to spawn environment issues, but CLI may still work
    console.log('✓ Newma CLI configuration loaded\n');
    if (useApiMode) {
      console.log('🔥 API Mode enabled - clean output without logs\n');
    }
  } else if (backend === 'newmaweb') {
    // Use Newma Web API
    const newmaWebUrl = process.env.NEWMA_WEB_URL || 'http://localhost:3000';

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║          Simple Chat Gateway v1.0.0                   ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Backend:  ${'Newma Web API'.padEnd(45)}║`);
    console.log(`║  URL:      ${newmaWebUrl.padEnd(45)}║`);
    console.log(`║  Port:     ${port.toString().padEnd(45)}║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log();

    aiService = new NewmaWebService(newmaWebUrl);

    // Check if newma web server is available
    const newmaWebService = aiService as NewmaWebService;
    const available = await newmaWebService.checkAvailable();

    if (!available) {
      console.error('ERROR: newma web server is not available');
      console.error(`Please ensure newma web server is running at: ${newmaWebUrl}`);
      console.error('Start it with: node /path/to/kode/dist/cli.js --web --web-port 3000');
      process.exit(1);
    }

    console.log('✓ Newma web server is available and ready\n');
  } else {
    // Use API (Claude or OpenAI)
    const provider = (process.env.AI_PROVIDER || 'claude') as 'claude' | 'openai';

    let apiKey = '';

    if (provider === 'claude') {
      apiKey = process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        console.error('ERROR: ANTHROPIC_API_KEY is required when using Claude');
        console.error('Please set it in .env file or environment variable');
        console.error('Or use AI_BACKEND=newma to use Newma CLI');
        process.exit(1);
      }
    } else {
      apiKey = process.env.OPENAI_API_KEY || '';
      if (!apiKey) {
        console.error('ERROR: OPENAI_API_KEY is required when using OpenAI');
        console.error('Please set it in .env file or environment variable');
        console.error('Or use AI_BACKEND=newma to use Newma CLI');
        process.exit(1);
      }
    }

    const model = process.env.AI_MODEL;

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║          Simple Chat Gateway v1.0.0                   ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Backend:  ${'API'.padEnd(45)}║`);
    console.log(`║  Provider: ${provider.padEnd(45)}║`);
    console.log(`║  Model:    ${(model || 'default').padEnd(45)}║`);
    console.log(`║  Port:     ${port.toString().padEnd(45)}║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log();

    aiService = new AIService(provider, apiKey, model);
  }

  const server = new GatewayServer(port, aiService, authService, database, configService, explorationScheduler);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down gateway...');
    configService.cleanup();
    database.close();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down gateway...');
    server.close();
    process.exit(0);
  });
}

main().catch(console.error);

// Newma CLI Service - Integrates with newma CLI tool

import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

export interface NewmaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NewmaResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

export interface NewmaStreamCallback {
  (delta: string, isFinal: boolean): void;
}

export class NewmaService {
  private newmaPath: string;
  private workspaceDir: string;
  private databasePath?: string;
  private workspacesDir?: string;
  private apiKey?: string;
  private baseUrl?: string;
  private endpoint?: string;
  private model?: string;
  private useApiMode?: boolean; // 🔥 新增：是否使用API模式

  constructor(
    newmaPath?: string,
    workspaceDir?: string,
    databasePath?: string,
    workspacesDir?: string,
    apiKey?: string,
    baseUrl?: string,
    endpoint?: string,
    model?: string,
    useApiMode?: boolean // 🔥 新增：API模式标志
  ) {
    this.newmaPath = newmaPath || 'newma';
    this.workspaceDir = workspaceDir || process.cwd();
    this.databasePath = databasePath;
    this.workspacesDir = workspacesDir;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.endpoint = endpoint;
    this.model = model;
    this.useApiMode = useApiMode;
  }

  // Parse newmaPath into command and base arguments
  // e.g., "node /path/to/cli.js" => ["node", "/path/to/cli.js"]
  private parseCommand(): [string, string[]] {
    const parts = this.newmaPath.trim().split(/\s+/);
    if (parts.length === 1) {
      return [parts[0], []];
    }
    // If first part is "node", use the system Node.js path
    // In Electron, process.execPath points to Electron, not Node.js
    // Use actual binary path instead of symlink to avoid spawn issues
    if (parts[0] === 'node') {
      return ['/opt/homebrew/Cellar/node/25.5.0/bin/node', parts.slice(1)];
    }
    return [parts[0], parts.slice(1)];
  }

  async chat(
    messages: NewmaMessage[],
    onStream?: NewmaStreamCallback
  ): Promise<NewmaResponse> {
    // Get the last user message
    const userMessage = messages.filter(m => m.role === 'user').pop();

    if (!userMessage) {
      throw new Error('No user message found');
    }

    // Build context from previous messages
    const context = messages.slice(0, -1).map(m => {
      return `${m.role}: ${m.content}`;
    }).join('\n\n');

    return this.executeNewma(userMessage.content, context, onStream);
  }

  private executeNewma(
    prompt: string,
    context: string,
    onStream?: NewmaStreamCallback
  ): Promise<NewmaResponse> {
    return new Promise((resolve, reject) => {
      // Parse command and base arguments
      const [command, baseArgs] = this.parseCommand();

      // Build arguments
      const args = [...baseArgs];

      // Note: API configuration is passed via environment variables, not command-line args
      // The compiled CLI doesn't support the new --api-key, --base-url, --model options yet

      // 🔥 新增：添加API模式标志
      if (this.useApiMode) {
        args.push('--api');
      }

      // Add database path if specified
      if (this.databasePath) {
        args.push('--database-path', this.databasePath);
      }

      // Add workspaces directory if specified
      if (this.workspacesDir) {
        args.push('--workspaces-dir', this.workspacesDir);
      }

      // Add prompt (without autonomous mode for faster responses)
      args.push(prompt);

      // Set up environment with database and API configuration
      const envVars: any = {
        ...process.env,
        NODE_ENV: 'production',
        PATH: `/opt/homebrew/Cellar/node/25.5.0/bin:${process.env.PATH}`  // Add Node.js to PATH
      };

      // Pass database config via environment variables
      if (this.databasePath) {
        envVars.DATABASE_PATH = this.databasePath;
      }
      if (this.workspacesDir) {
        envVars.WORKSPACES_DIR = this.workspacesDir;
      }

      // Pass API configuration via environment variables (priority: CLI params > settings.json > env)
      // These will override existing env vars if they were set in Gateway
      if (this.apiKey) {
        envVars.OPENAI_API_KEY = this.apiKey;
      }
      if (this.baseUrl) {
        envVars.OPENAI_BASE_URL = this.baseUrl;
      }
      if (this.endpoint) {
        envVars.OPENAI_ENDPOINT = this.endpoint;
      }
      if (this.model) {
        envVars.OPENAI_MODEL = this.model;
      }

      const newmaProcess = spawn(command, args, {
        cwd: this.workspaceDir,
        env: envVars
      });

      let fullOutput = '';
      let errorOutput = '';
      const sentLines = new Set<string>(); // 🔥 跟踪已发送的行，避免重复

      // Handle stdout
      newmaProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;

        if (onStream) {
          // 🔥 在API模式下，过滤掉日志行，只发送真正的AI响应
          const lines = text.split('\n').filter((line: string) => line.trim());

          for (const line of lines) {
            // 跳过日志行（包含emoji的进度信息）
            if (this.isLogLine(line)) {
              continue;
            }

            // 🔥 跳过已发送的行，避免重复
            if (sentLines.has(line)) {
              continue;
            }

            try {
              // Check if it's a JSON line (for streaming)
              if (line.startsWith('{') && line.endsWith('}')) {
                const parsed = JSON.parse(line);
                if (parsed.delta) {
                  sentLines.add(line); // 标记为已发送
                  onStream(parsed.delta, false);
                }
              } else {
                // Plain text - send as is
                sentLines.add(line); // 标记为已发送
                onStream(line + '\n', false);
              }
            } catch (e) {
              // Not JSON, treat as plain text
              sentLines.add(line); // 标记为已发送
              onStream(line + '\n', false);
            }
          }
        }
      });

      // Handle stderr
      newmaProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Handle process exit
      newmaProcess.on('close', (code) => {
        if (code === 0 || code === null) {
          if (onStream) {
            onStream('', true); // Signal completion
          }

          // Clean the output to remove logs and duplicates
          const cleanedContent = this.cleanOutput(fullOutput);

          resolve({
            content: cleanedContent,
            stopReason: code === 0 ? 'stop' : 'error'
          });
        } else {
          reject(new Error(`Newma process exited with code ${code}: ${errorOutput}`));
        }
      });

      // Handle process error
      newmaProcess.on('error', (error) => {
        reject(new Error(`Failed to start newma process: ${error.message}`));
      });

      // Set timeout (5 minutes)
      const timeout = setTimeout(() => {
        newmaProcess.kill();
        reject(new Error('Newma process timeout after 5 minutes'));
      }, 5 * 60 * 1000);

      // Clear timeout on close
      newmaProcess.on('close', () => {
        clearTimeout(timeout);
      });
    });
  }

  async executeCommand(
    command: string,
    args: string[] = []
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Parse command and base arguments
      const [cmd, baseArgs] = this.parseCommand();

      // Build arguments
      const cmdArgs = [...baseArgs];

      // Add database path if specified
      if (this.databasePath) {
        cmdArgs.push('--database-path', this.databasePath);
      }

      // Add workspaces directory if specified
      if (this.workspacesDir) {
        cmdArgs.push('--workspaces-dir', this.workspacesDir);
      }

      // Add command and additional args
      cmdArgs.push(command, ...args);

      // Set up environment with database and API configuration
      const envVars: any = {
        ...process.env,
        NODE_ENV: 'production',
        PATH: `/opt/homebrew/Cellar/node/25.5.0/bin:${process.env.PATH}`  // Add Node.js to PATH
      };

      // Pass database config via environment variables
      if (this.databasePath) {
        envVars.DATABASE_PATH = this.databasePath;
      }
      if (this.workspacesDir) {
        envVars.WORKSPACES_DIR = this.workspacesDir;
      }

      // Pass API configuration via environment variables (priority: CLI params > settings.json > env)
      // These will override existing env vars if they were set in Gateway
      if (this.apiKey) {
        envVars.OPENAI_API_KEY = this.apiKey;
      }
      if (this.baseUrl) {
        envVars.OPENAI_BASE_URL = this.baseUrl;
      }
      if (this.endpoint) {
        envVars.OPENAI_ENDPOINT = this.endpoint;
      }
      if (this.model) {
        envVars.OPENAI_MODEL = this.model;
      }

      const newmaProcess = spawn(cmd, cmdArgs, {
        cwd: this.workspaceDir,
        env: envVars
      });

      let output = '';
      let errorOutput = '';

      newmaProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      newmaProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      newmaProcess.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
        }
      });

      newmaProcess.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });

      setTimeout(() => {
        newmaProcess.kill();
        reject(new Error('Command timeout after 2 minutes'));
      }, 2 * 60 * 1000);
    });
  }

  // Check if newma is available
  async checkAvailable(): Promise<boolean> {
    try {
      // Simple version check without extra parameters
      const [cmd, baseArgs] = this.parseCommand();
      console.log(`[NewmaService] Checking availability with command: ${cmd} ${baseArgs.join(' ')} --version`);
      console.log(`[NewmaService] Working directory: ${this.workspaceDir}`);
      const result = await this.executeSimpleCommand(cmd, baseArgs, '--version');
      console.log(`[NewmaService] ✓ Version check successful: ${result}`);
      return true;
    } catch (error) {
      console.error(`[NewmaService] ✗ Version check failed:`, error);
      return false;
    }
  }

  private async executeSimpleCommand(
    cmd: string,
    baseArgs: string[],
    command: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [...baseArgs, command];

      const proc = spawn(cmd, args, {
        cwd: this.workspaceDir,
        stdio: 'pipe',
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Command failed with code ${code}: ${errorOutput}`));
        }
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });

      setTimeout(() => {
        proc.kill();
        reject(new Error('Command timeout after 10 seconds'));
      }, 10000);
    });
  }

  /**
   * 检查一行文本是否是日志行
   * 日志行通常包含emoji进度标记或特定格式
   */
  private isLogLine(line: string): boolean {
    // 跳过空行
    if (!line.trim()) {
      return true;
    }

    // 跳过包含emoji的进度日志
    if (/^[✅📤📥📊⚠️❌]/.test(line)) {
      return true;
    }

    // 跳过特定的日志模式
    const logPatterns = [
      /Search tools enabled/i,
      /Sending message to AI/i,
      /Received final response/i,
      /Total Tokens:/i,
      /Response time:/i,
    ];

    for (const pattern of logPatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 清理CLI输出，移除日志和重复内容
   * CLI会输出两次AI响应，只保留最后（干净）的那一次
   */
  private cleanOutput(output: string): string {
    const lines = output.split('\n');
    const cleanLines: string[] = [];
    const seenContent: string[] = [];

    for (const line of lines) {
      // 跳过日志行
      if (this.isLogLine(line)) {
        continue;
      }

      // 跳过空行
      if (!line.trim()) {
        continue;
      }

      // 检查是否是重复的AI响应
      if (seenContent.includes(line)) {
        // 已经见过这行，跳过第一次出现，只保留最后一次
        const index = cleanLines.indexOf(line);
        if (index !== -1) {
          cleanLines.splice(index, 1);
        }
      }

      // 记录并添加这行
      seenContent.push(line);
      cleanLines.push(line);
    }

    return cleanLines.join('\n').trim();
  }
}

// Newma Web Service - Integrates with newma web API

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

export class NewmaWebService {
  private baseUrl: string;
  private timeout: number;
  // Session-based buffer tracking: each session has its own processed index
  private sessionBuffers: Map<string, number> = new Map();

  constructor(baseUrl: string = 'http://localhost:3000', timeout: number = 300000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async chat(
    messages: NewmaMessage[],
    onStream?: NewmaStreamCallback,
    sessionKey: string = 'default'
  ): Promise<NewmaResponse> {
    // Get the last user message
    const userMessage = messages.filter(m => m.role === 'user').pop();

    if (!userMessage) {
      throw new Error('No user message found');
    }

    // Newma Web API is stateless - only send the latest message
    // No need to send conversation history
    return this.executeWeb(userMessage.content, onStream, sessionKey);
  }

  private async executeWeb(
    prompt: string,
    onStream?: NewmaStreamCallback,
    sessionKey: string = 'default'
  ): Promise<NewmaResponse> {
    console.log('[NewmaWebService] executeWeb called with prompt:', prompt, 'sessionKey:', sessionKey);

    // NOTE: clearBuffer() removed to avoid conflicts between concurrent requests
    // Each session tracks its own processed index, so we don't need to clear
    // await this.clearBuffer();
    // console.log('[NewmaWebService] Buffer cleared');

    // Send task to newma web API (only the latest message)
    await this.sendRequest('/api/execute', {
      requirement: prompt,
      mode: 'chat'
    });
    console.log('[NewmaWebService] Request sent to /api/execute');

    // Poll for results with session-specific indexing
    const content = await this.pollForResult(onStream, sessionKey);
    console.log('[NewmaWebService] pollForResult returned, content length:', content.length);

    return {
      content,
      stopReason: 'stop'
    };
  }

  private async pollForResult(onStream?: NewmaStreamCallback, sessionKey: string = 'default'): Promise<string> {
    console.log('[NewmaWebService] pollForResult started for sessionKey:', sessionKey);
    const startTime = Date.now();

    // Get or initialize session-specific buffer index
    let lastProcessedIndex = this.sessionBuffers.get(sessionKey) || 0;
    console.log('[NewmaWebService] Initial lastProcessedIndex for session:', sessionKey, '=', lastProcessedIndex);

    let fullContent = '';
    let lastContentTime = Date.now();
    const STALL_TIMEOUT = 60000; // 60 seconds without new output = complete (allow time for initial AI response)

    let iteration = 0;
    while (Date.now() - startTime < this.timeout) {
      iteration++;
      await new Promise(resolve => setTimeout(resolve, 500)); // Poll every 500ms

      const status = await this.getStatus();
      const outputBuffer = status.outputBuffer || [];
      console.log(`[NewmaWebService] Poll iteration ${iteration} for session ${sessionKey}: buffer length = ${outputBuffer.length}, lastProcessedIndex = ${lastProcessedIndex}`);

      // Check if there's new output since our last processed index
      if (outputBuffer.length > lastProcessedIndex) {
        const newOutputs = outputBuffer.slice(lastProcessedIndex);
        console.log(`[NewmaWebService] Processing ${newOutputs.length} new outputs for session ${sessionKey}`);

        for (const outputStr of newOutputs) {
          try {
            const output = JSON.parse(outputStr);

            if (output.type === 'output' && output.content) {
              // Skip decorative messages (info/success styles like "💬 Chat" and "✅ Done")
              // Only include actual AI responses (default style or no style)
              const shouldSkip = output.style === 'info' || output.style === 'success';

              if (!shouldSkip) {
                if (onStream) {
                  onStream(output.content, false);
                }
                fullContent += output.content;
                lastContentTime = Date.now(); // Update last content time
              }
            }
          } catch (e) {
            // Not JSON, treat as plain text
            if (onStream) {
              onStream(outputStr, false);
            }
            fullContent += outputStr;
            lastContentTime = Date.now(); // Update last content time
          }
        }

        // Update session-specific processed index
        lastProcessedIndex = outputBuffer.length;
        this.sessionBuffers.set(sessionKey, lastProcessedIndex);
        console.log(`[NewmaWebService] Updated lastProcessedIndex for session ${sessionKey} to ${lastProcessedIndex}`);
      }

      // Check if task is complete (no new output for too long)
      const timeSinceLastContent = Date.now() - lastContentTime;

      if (fullContent && lastProcessedIndex > 0) {
        // We have some content, check if we're done
        await new Promise(resolve => setTimeout(resolve, 2000));

        const finalStatus = await this.getStatus();
        if (finalStatus.outputBuffer.length === lastProcessedIndex) {
          // No new output, task is complete
          console.log('[NewmaWebService] Task complete with content for session', sessionKey, ', returning');
          if (onStream) {
            onStream('', true);
          }
          return fullContent;
        }
      } else if (timeSinceLastContent > STALL_TIMEOUT) {
        // No content for 60 seconds, assume task is complete (maybe no output)
        console.log(`[NewmaWebService] Stall timeout triggered for session ${sessionKey}: ${timeSinceLastContent}ms since last content, returning empty`);
        if (onStream) {
          onStream('', true);
        }
        return fullContent;
      }
    }

    throw new Error('Timeout waiting for newma response');
  }

  private async sendRequest(endpoint: string, body: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to send request to newma web API: ${error.message}`);
    }
  }

  private async getStatus(): Promise<any> {
    const url = `${this.baseUrl}/api/status`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      throw new Error(`Failed to get status from newma web API: ${error.message}`);
    }
  }

  private async clearBuffer(): Promise<void> {
    try {
      await this.sendRequest('/api/clear', {});
    } catch (error) {
      // Ignore clear errors
      console.warn('Failed to clear newma output buffer:', error);
    }
  }

  async executeCommand(
    command: string,
    args: string[] = []
  ): Promise<string> {
    // Web API doesn't support arbitrary commands
    throw new Error('executeCommand not supported in web mode');
  }

  // Check if newma web server is available
  async checkAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json() as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}

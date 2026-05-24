// AI Service - Handles integration with AI providers

import { v4 as uuidv4 } from 'uuid';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

export interface AIStreamCallback {
  (delta: string, isFinal: boolean): void;
}

export class AIService {
  private provider: 'claude' | 'openai';
  private apiKey: string;
  private model: string;

  constructor(provider: 'claude' | 'openai', apiKey: string, model?: string) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.model = model || (provider === 'claude' ? 'claude-3-5-sonnet-20241022' : 'gpt-4-turbo');
  }

  async chat(
    messages: AIMessage[],
    onStream?: AIStreamCallback,
    sessionKey?: string // Session key for session-level isolation (optional, for NewmaService compatibility)
  ): Promise<AIResponse> {
    // Note: sessionKey is not used in AIService, only in NewmaService
    // It's kept here for interface compatibility
    if (this.provider === 'claude') {
      return this.chatWithClaude(messages, onStream);
    } else {
      return this.chatWithOpenAI(messages, onStream);
    }
  }

  private async chatWithClaude(
    messages: AIMessage[],
    onStream?: AIStreamCallback
  ): Promise<AIResponse> {
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...(onStream && { 'accept': 'text/event-stream' })
      },
      body: JSON.stringify({
        model: this.model,
        messages: conversationMessages,
        system: systemMessage?.content,
        stream: !!onStream,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    if (onStream) {
      return this.handleClaudeStream(response, onStream);
    } else {
      const data = await response.json() as any;
      return {
        content: data.content[0].text,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens
        },
        stopReason: data.stop_reason
      };
    }
  }

  private async handleClaudeStream(
    response: Response,
    onStream: AIStreamCallback
  ): Promise<AIResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta') {
                const delta = event.delta?.text || '';
                if (delta) {
                  fullContent += delta;
                  onStream(delta, false);
                }
              } else if (event.type === 'message_stop') {
                stopReason = event.stop_reason;
                onStream('', true);
              } else if (event.type === 'message_start') {
                inputTokens = event.message?.usage?.input_tokens || 0;
              } else if (event.type === 'message_delta') {
                outputTokens = event.usage?.output_tokens || 0;
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      usage: { inputTokens, outputTokens },
      stopReason
    };
  }

  private async chatWithOpenAI(
    messages: AIMessage[],
    onStream?: AIStreamCallback
  ): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: !!onStream,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    if (onStream) {
      return this.handleOpenAIStream(response, onStream);
    } else {
      const data = await response.json() as any;
      return {
        content: data.choices[0].message.content,
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens
        },
        stopReason: data.choices[0].finish_reason
      };
    }
  }

  private async handleOpenAIStream(
    response: Response,
    onStream: AIStreamCallback
  ): Promise<AIResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              const delta = event.choices[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                onStream(delta, false);
              }
              if (event.choices[0]?.finish_reason) {
                stopReason = event.choices[0].finish_reason;
                onStream('', true);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      usage: { inputTokens, outputTokens },
      stopReason
    };
  }
}

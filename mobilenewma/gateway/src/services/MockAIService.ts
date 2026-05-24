// Mock AI Service for testing without API keys

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

export class MockAIService {
  async chat(
    messages: AIMessage[],
    onStream?: AIStreamCallback
  ): Promise<AIResponse> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the last user message
    const userMessage = messages.filter(m => m.role === 'user').pop();

    if (!userMessage) {
      throw new Error('No user message found');
    }

    // Generate a mock response
    const response = this.generateMockResponse(userMessage.content);

    // Simulate streaming
    if (onStream) {
      const words = response.split(' ');
      for (let i = 0; i < words.length; i++) {
        const delta = words[i] + (i < words.length - 1 ? ' ' : '');
        onStream(delta, i === words.length - 1);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return {
      content: response,
      usage: {
        inputTokens: userMessage.content.length / 4,
        outputTokens: response.length / 4
      },
      stopReason: 'stop'
    };
  }

  private generateMockResponse(input: string): string {
    const responses = [
      `你好！我收到了你的消息："${input}"\n\n这是一个模拟的 AI 响应，用于测试 Gateway 和移动应用的连接功能。`,
      `感谢你的提问！关于"${input}"，我想说这是一个测试响应。\n\nGateway 服务器运行正常！`,
      `很有趣的问题："${input}"\n\n作为测试 AI，我可以确认所有组件都在正常工作。✓`,
      `收到消息："${input}"\n\n✅ WebSocket 连接正常\n✅ 消息收发正常\n✅ 流式响应正常`
    ];

    // Select response based on input hash to be deterministic
    const hash = input.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return responses[hash % responses.length];
  }
}

// Chat Manager - Manages chat sessions and history

import { v4 as uuidv4 } from 'uuid';
import { ChatMessage } from '../protocol/types.js';

interface ChatSession {
  sessionKey: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export class ChatManager {
  private sessions: Map<string, ChatSession> = new Map();

  constructor() {
    // Create default session
    this.getOrCreateSession('main');
  }

  getOrCreateSession(sessionKey: string): ChatSession {
    let session = this.sessions.get(sessionKey);

    if (!session) {
      session = {
        sessionKey,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.sessions.set(sessionKey, session);
    }

    return session;
  }

  addMessage(sessionKey: string, message: ChatMessage): void {
    const session = this.getOrCreateSession(sessionKey);
    message.id = message.id || uuidv4();
    message.timestamp = message.timestamp || Date.now();
    session.messages.push(message);
    session.updatedAt = Date.now();
  }

  getHistory(
    sessionKey: string,
    limit?: number,
    before?: number
  ): ChatMessage[] {
    const session = this.getOrCreateSession(sessionKey);
    let messages = [...session.messages];

    if (before) {
      messages = messages.filter(m => m.timestamp < before);
    }

    if (limit && limit > 0) {
      messages = messages.slice(-limit);
    }

    return messages;
  }

  getSession(sessionKey: string): ChatSession | undefined {
    return this.sessions.get(sessionKey);
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values());
  }

  clearSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.messages = [];
      session.updatedAt = Date.now();
    }
  }

  deleteSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }
}

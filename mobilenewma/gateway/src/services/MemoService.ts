// Memo Service - Chat history persistence using file-based storage

import * as fs from 'fs';
import * as path from 'path';
import { ChatMessage } from '../protocol/types.js';

interface ConversationDecision {
  id: number;
  timestamp: string;
  title: string;
  content: string;
  tags: string[];
  context: string;
}

interface DecisionsData {
  decisions: ConversationDecision[];
}

// Session-based result for history listing
interface ChatSession {
  sessionId: string;
  title: string;
  timestamp: string;
  messageCount: number;
  tags: string[];
}

export { ChatSession };

export class MemoService {
  private enabled: boolean;
  private decisionsPath: string;

  constructor(projectPath?: string) {
    try {
      // Use current working directory if not specified
      const basePath = projectPath || process.cwd();
      const memoDir = path.join(basePath, '.memo');

      // Create .memo directory if it doesn't exist
      if (!fs.existsSync(memoDir)) {
        fs.mkdirSync(memoDir, { recursive: true });
      }

      this.decisionsPath = path.join(memoDir, 'decisions.json');
      this.enabled = true;

      // Initialize decisions file if it doesn't exist
      if (!fs.existsSync(this.decisionsPath)) {
        this.writeDecisions({ decisions: [] });
      }

      console.log('[MemoService] Initialized with path:', this.decisionsPath);
    } catch (error: any) {
      console.error('[MemoService] Failed to initialize:', error.message);
      this.enabled = false;
      this.decisionsPath = '';
    }
  }

  /**
   * Record a conversation decision to Memo
   */
  recordConversation(
    sessionId: string,
    userMessage: string,
    aiResponse: string,
    tags: string[] = ['chat', 'ai-conversation'],
    attachments?: any[]
  ): boolean {
    if (!this.enabled) {
      console.warn('[MemoService] Not enabled, skipping record');
      return false;
    }

    try {
      const data = this.readDecisions();

      const decision: ConversationDecision = {
        id: data.decisions.length + 1,
        timestamp: new Date().toISOString(),
        title: this.generateTitle(userMessage),
        content: this.formatConversation(userMessage, aiResponse, attachments),
        tags,
        context: `Session: ${sessionId} | Timestamp: ${new Date().toISOString()}`
      };

      data.decisions.push(decision);
      this.writeDecisions(data);

      console.log('[MemoService] ✓ Recorded conversation:', decision.title);
      return true;
    } catch (error: any) {
      console.error('[MemoService] Error recording conversation:', error.message);
      return false;
    }
  }

  /**
   * Search conversations by query
   */
  searchConversations(query: string, tag?: string): ConversationDecision[] {
    if (!this.enabled) {
      console.warn('[MemoService] Not enabled, skipping search');
      return [];
    }

    try {
      const data = this.readDecisions();
      const results: ConversationDecision[] = [];
      const queryLower = query.toLowerCase();

      for (const decision of data.decisions) {
        // Tag filter
        if (tag) {
          const tags = (decision.tags || []).map(t => t.toLowerCase());
          if (!tags.includes(tag.toLowerCase())) {
            continue;
          }
        }

        // Query matching
        if (query) {
          const titleMatch = decision.title.toLowerCase().includes(queryLower);
          const contentMatch = decision.content.toLowerCase().includes(queryLower);

          if (!titleMatch && !contentMatch) {
            continue;
          }
        }

        results.push(decision);
      }

      // Sort by timestamp (newest first)
      results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      return results;
    } catch (error: any) {
      console.error('[MemoService] Error searching conversations:', error.message);
      return [];
    }
  }

  /**
   * Search sessions (grouped by session ID)
   * This groups individual decisions by session and returns one entry per session
   */
  searchSessions(query: string, tag?: string): ChatSession[] {
    if (!this.enabled) {
      console.warn('[MemoService] Not enabled, skipping session search');
      return [];
    }

    try {
      const data = this.readDecisions();
      const sessionMap = new Map<string, ConversationDecision[]>();
      const queryLower = query.toLowerCase();

      // Group decisions by session ID
      for (const decision of data.decisions) {
        // Extract session ID from context field (format: "Session: main | Timestamp: ...")
        const sessionMatch = decision.context.match(/Session:\s*(\S+)/);
        const sessionId = sessionMatch ? sessionMatch[1] : 'default';

        // Tag filter
        if (tag) {
          const tags = (decision.tags || []).map(t => t.toLowerCase());
          if (!tags.includes(tag.toLowerCase())) {
            continue;
          }
        }

        // Query matching
        if (query) {
          const titleMatch = decision.title.toLowerCase().includes(queryLower);
          const contentMatch = decision.content.toLowerCase().includes(queryLower);

          if (!titleMatch && !contentMatch) {
            continue;
          }
        }

        // Add to session group
        if (!sessionMap.has(sessionId)) {
          sessionMap.set(sessionId, []);
        }
        sessionMap.get(sessionId)!.push(decision);
      }

      // Convert to ChatSession objects
      const sessions: ChatSession[] = [];
      for (const [sessionId, decisions] of sessionMap.entries()) {
        // Sort decisions by timestamp (newest first)
        decisions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        // Get the most recent decision for this session
        const latestDecision = decisions[0];

        // Collect all unique tags
        const allTags = new Set<string>();
        for (const d of decisions) {
          (d.tags || []).forEach(tag => allTags.add(tag));
        }

        sessions.push({
          sessionId,
          title: latestDecision.title,
          timestamp: latestDecision.timestamp,
          messageCount: decisions.length,
          tags: Array.from(allTags)
        });
      }

      // Sort sessions by timestamp (newest first)
      sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      console.log('[MemoService] Found', sessions.length, 'sessions matching query:', query);
      return sessions;
    } catch (error: any) {
      console.error('[MemoService] Error searching sessions:', error.message);
      return [];
    }
  }

  /**
   * Get all messages for a specific session
   * Returns decisions formatted as ChatMessage[]
   */
  getSessionHistory(sessionId: string): { role: 'user' | 'assistant'; content: string; timestamp: number }[] {
    if (!this.enabled) {
      console.warn('[MemoService] Not enabled, skipping session history fetch');
      return [];
    }

    try {
      const data = this.readDecisions();
      console.log('[MemoService] Total decisions in file:', data.decisions.length);
      console.log('[MemoService] Looking for session:', sessionId);

      const messages: { role: 'user' | 'assistant'; content: string; timestamp: number }[] = [];

      // Find all decisions for this session
      for (const decision of data.decisions) {
        // Extract session ID from context field
        const sessionMatch = decision.context.match(/Session:\s*(\S+)/);
        const decisionSessionId = sessionMatch ? sessionMatch[1] : 'default';

        console.log('[MemoService] Checking decision:', decisionSessionId, 'vs', sessionId);

        if (decisionSessionId === sessionId) {
          console.log('[MemoService] Found matching decision, parsing content...');
          console.log('[MemoService] Content length:', decision.content.length);
          console.log('[MemoService] Content (first 100 chars):', decision.content.substring(0, 100));
          console.log('[MemoService] Content char codes (first 20):', Array.from(decision.content.substring(0, 20)).map(c => c.charCodeAt(0)));

          // Parse the content to extract user/assistant messages
          // The content format is markdown with sections like "**用户:**" and "**AI 助手:**"
          const userMatch = decision.content.match(/\*\*用户:\*\*\n```([\s\S]*?)\n```/);
          const assistantMatch = decision.content.match(/\*\*AI 助手:\*\*\n```([\s\S]*?)\n```/);

          console.log('[MemoService] User match:', !!userMatch, 'Assistant match:', !!assistantMatch);

          if (userMatch && userMatch[1]) {
            messages.push({
              role: 'user',
              content: userMatch[1].trim(),
              timestamp: new Date(decision.timestamp).getTime()
            });
          }

          if (assistantMatch && assistantMatch[1]) {
            messages.push({
              role: 'assistant',
              content: assistantMatch[1].trim(),
              timestamp: new Date(decision.timestamp).getTime()
            });
          }
        }
      }

      // Sort by timestamp (oldest first)
      messages.sort((a, b) => a.timestamp - b.timestamp);

      console.log('[MemoService] Found', messages.length, 'messages for session:', sessionId);
      return messages;
    } catch (error: any) {
      console.error('[MemoService] Error getting session history:', error.message);
      return [];
    }
  }

  /**
   * Get all conversations
   */
  getAllConversations(): ConversationDecision[] {
    if (!this.enabled) {
      return [];
    }

    try {
      const data = this.readDecisions();
      return data.decisions;
    } catch (error: any) {
      console.error('[MemoService] Error reading conversations:', error.message);
      return [];
    }
  }

  /**
   * Get conversation statistics
   */
  getStats(): {
    totalConversations: number;
    tags: Record<string, number>;
    latestConversation?: string;
  } {
    if (!this.enabled) {
      return { totalConversations: 0, tags: {} };
    }

    try {
      const decisions = this.readDecisions().decisions;
      const tagCounts: Record<string, number> = {};

      for (const decision of decisions) {
        for (const tag of decision.tags || []) {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }

      const latest = decisions.length > 0 ? decisions[decisions.length - 1].timestamp : undefined;

      return {
        totalConversations: decisions.length,
        tags: tagCounts,
        latestConversation: latest
      };
    } catch (error: any) {
      console.error('[MemoService] Error getting stats:', error.message);
      return { totalConversations: 0, tags: {} };
    }
  }

  /**
   * Generate a title from user message
   */
  private generateTitle(userMessage: string): string {
    // Take first 50 chars as title
    let title = userMessage.trim().substring(0, 50);

    // Add ellipsis if truncated
    if (userMessage.length > 50) {
      title += '...';
    }

    return title;
  }

  /**
   * Format conversation as Markdown content
   */
  private formatConversation(
    userMessage: string,
    aiResponse: string,
    attachments?: any[]
  ): string {
    const lines: string[] = [];

    lines.push('## 对话记录\n\n');

    // User message
    lines.push('**用户:**\n');
    lines.push('```\n');
    lines.push(userMessage);
    lines.push('\n```\n\n');

    // Attachments info
    if (attachments && attachments.length > 0) {
      lines.push('**附件:**\n');
      for (const att of attachments) {
        lines.push(`- ${att.type}: ${att.filename} (${att.size} bytes)\n`);
      }
      lines.push('\n');
    }

    // AI response
    lines.push('**AI 助手:**\n');
    lines.push('```\n');
    lines.push(aiResponse);
    lines.push('\n```\n');

    return lines.join('');
  }

  /**
   * Read decisions JSON file
   */
  private readDecisions(): DecisionsData {
    const content = fs.readFileSync(this.decisionsPath, 'utf-8');
    return JSON.parse(content) as DecisionsData;
  }

  /**
   * Write decisions JSON file
   */
  private writeDecisions(data: DecisionsData): void {
    fs.writeFileSync(this.decisionsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Check if Memo service is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

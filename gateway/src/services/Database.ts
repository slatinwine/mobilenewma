// Database Service - SQLite database management with sql.js

// @ts-ignore - sql.js types may not be perfect
import initSqlJs, { Database } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  email?: string;
  created_at: number;
  last_login?: number;
}

export interface AIConfig {
  id: string;
  user_id: string;
  provider: string;
  config_name: string;
  api_key_encrypted: string;
  base_url?: string;
  model?: string;
  newma_path?: string;
  workspace_dir?: string;
  created_at: number;
  updated_at: number;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  device_info?: string;
  created_at: number;
}

export interface Process {
  id: string;
  user_id: string;
  process_type: string;
  session_key: string;
  status: string;
  pid?: number;
  metadata?: string;
  created_at: number;
  updated_at: number;
}

export class DatabaseService {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './database/gateway.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    console.log('[Database] Initializing...');

    // Initialize sql.js
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
      console.log('[Database] Loaded existing database from', this.dbPath);
    } else {
      this.db = new SQL.Database();
      console.log('[Database] Created new database');

      // Run schema
      await this.runSchema();
    }

    // Enable foreign keys
    this.run('PRAGMA foreign_keys = ON;');
  }

  private async runSchema(): Promise<void> {
    console.log('[Database] Running schema...');
    const schema = readFileSync('./schema.sql', 'utf-8');
    this.exec(schema);
    console.log('[Database] Schema initialized');
  }

  saveToFile(): void {
    if (!this.db) throw new Error('Database not initialized');

    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
    console.log('[Database] Saved to', this.dbPath);
  }

  run(sql: string, params: any[] = []): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(sql, params);
  }

  exec(sql: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.exec(sql);
  }

  get<T>(sql: string, params: any[] = []): T | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const result = stmt.step();

    if (!result) return null;

    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }

  all<T>(sql: string, params: any[] = []): T[] {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];

    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }

    stmt.free();
    return results;
  }

  // User operations
  createUser(username: string, passwordHash: string, email?: string): string {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.run(
      `INSERT INTO users (id, username, password_hash, email, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, username, passwordHash, email || null, now]
    );

    this.saveToFile();
    return id;
  }

  getUserByUsername(username: string): User | null {
    return this.get<User>(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
  }

  getUserById(id: string): User | null {
    return this.get<User>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
  }

  getUserByEmail(email: string): User | null {
    return this.get<User>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
  }

  updateUserLastLogin(userId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.run(
      'UPDATE users SET last_login = ? WHERE id = ?',
      [now, userId]
    );
    this.saveToFile();
  }

  // AI Config operations
  getAIConfig(userId: string, configName: string = 'default'): AIConfig | null {
    return this.get<AIConfig>(
      'SELECT * FROM ai_configs WHERE user_id = ? AND config_name = ?',
      [userId, configName]
    );
  }

  getAllAIConfigs(userId: string): AIConfig[] {
    return this.all<AIConfig>(
      'SELECT * FROM ai_configs WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  saveAIConfig(config: Omit<AIConfig, 'created_at' | 'updated_at'>): void {
    const now = Math.floor(Date.now() / 1000);
    const existing = this.getAIConfig(config.user_id, config.config_name);

    if (existing) {
      // Update
      this.run(
        `UPDATE ai_configs SET
          provider = ?,
          api_key_encrypted = ?,
          base_url = ?,
          model = ?,
          newma_path = ?,
          workspace_dir = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          config.provider,
          config.api_key_encrypted,
          config.base_url || null,
          config.model || null,
          config.newma_path || null,
          config.workspace_dir || null,
          now,
          existing.id
        ]
      );
    } else {
      // Insert
      this.run(
        `INSERT INTO ai_configs
          (id, user_id, provider, config_name, api_key_encrypted, base_url, model, newma_path, workspace_dir, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          config.id,
          config.user_id,
          config.provider,
          config.config_name,
          config.api_key_encrypted,
          config.base_url || null,
          config.model || null,
          config.newma_path || null,
          config.workspace_dir || null,
          now,
          now
        ]
      );
    }

    this.saveToFile();
  }

  deleteAIConfig(userId: string, configName: string): void {
    this.run(
      'DELETE FROM ai_configs WHERE user_id = ? AND config_name = ?',
      [userId, configName]
    );
    this.saveToFile();
  }

  // Refresh token operations
  createRefreshToken(userId: string, tokenHash: string, expiresAt: number, deviceInfo?: string): string {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.run(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, device_info, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, tokenHash, expiresAt, deviceInfo || null, now]
    );

    this.saveToFile();
    return id;
  }

  getRefreshToken(tokenHash: string): RefreshToken | null {
    return this.get<RefreshToken>(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?',
      [tokenHash, Math.floor(Date.now() / 1000)]
    );
  }

  deleteRefreshToken(tokenHash: string): void {
    this.run(
      'DELETE FROM refresh_tokens WHERE token_hash = ?',
      [tokenHash]
    );
    this.saveToFile();
  }

  deleteExpiredTokens(): void {
    const now = Math.floor(Date.now() / 1000);
    this.run(
      'DELETE FROM refresh_tokens WHERE expires_at < ?',
      [now]
    );
    this.saveToFile();
  }

  // Process operations
  createProcess(userId: string, processType: string, sessionKey: string, pid?: number): string {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.run(
      `INSERT INTO processes (id, user_id, process_type, session_key, status, pid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, processType, sessionKey, 'running', pid || null, now, now]
    );

    this.saveToFile();
    return id;
  }

  getProcessBySession(sessionKey: string): Process | null {
    return this.get<Process>(
      'SELECT * FROM processes WHERE session_key = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [sessionKey, 'running']
    );
  }

  updateProcessStatus(processId: string, status: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.run(
      'UPDATE processes SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, processId]
    );
    this.saveToFile();
  }

  getProcessesByUser(userId: string): Process[] {
    return this.all<Process>(
      'SELECT * FROM processes WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
  }

  close(): void {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
      console.log('[Database] Closed');
    }
  }
}

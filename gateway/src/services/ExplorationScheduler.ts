/**
 * Exploration Scheduler Service
 *
 * Gateway 调度器服务 - 监控 Kode CLI 的自主探索任务
 */

import * as schedule from 'node-schedule';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from './Database';

/**
 * 探索任务状态
 */
export type ExplorationStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 探索任务记录
 */
export interface ExplorationTask {
  id: string;
  status: ExplorationStatus;
  plan?: string; // JSON string
  executionLog?: string; // JSON string
  resultSummary?: string; // JSON string
  startedAt?: number; // timestamp
  completedAt?: number; // timestamp
  createdAt: number; // timestamp
}

/**
 * 调度器配置
 */
export interface SchedulerConfig {
  enabled: boolean;
  schedule: string; // cron expression
  logDir: string; // Kode CLI 日志目录
}

/**
 * 探索调度器服务
 */
export class ExplorationScheduler {
  private db: DatabaseService;
  private job?: schedule.Job;
  private config: SchedulerConfig;
  private isRunning: boolean = false;

  constructor(db: DatabaseService, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
  }

  /**
   * 启动调度器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[ExplorationScheduler] Already running');
      return;
    }

    if (!this.config.enabled) {
      console.log('[ExplorationScheduler] Disabled, not starting');
      return;
    }

    this.isRunning = true;
    console.log('[ExplorationScheduler] Starting...');

    // 启动监控任务（每分钟检查一次）
    this.job = schedule.scheduleJob('*/1 * * * *', async () => {
      await this.monitorExplorationTasks();
    });

    console.log('[ExplorationScheduler] ✓ Started');
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[ExplorationScheduler] Stopping...');

    if (this.job) {
      this.job.cancel();
      this.job = undefined;
    }

    this.isRunning = false;
    console.log('[ExplorationScheduler] ✓ Stopped');
  }

  /**
   * 监控探索任务
   */
  private async monitorExplorationTasks(): Promise<void> {
    try {
      // 1. 扫描 Kode CLI 日志目录
      const logFiles = await this.scanLogFiles();

      // 2. 检查是否有新的任务
      for (const logFile of logFiles) {
        const taskId = this.extractTaskId(logFile);

        // 检查数据库中是否已存在
        const existing = await this.getTask(taskId);
        if (existing) {
          // 更新状态
          await this.updateTaskStatus(taskId, logFile);
        } else {
          // 创建新记录
          await this.createTaskFromLog(logFile, taskId);
        }
      }
    } catch (error: any) {
      console.error(`[ExplorationScheduler] Monitor error: ${error.message}`);
    }
  }

  /**
   * 扫描日志文件
   */
  private async scanLogFiles(): Promise<string[]> {
    const logDir = this.config.logDir;
    if (!fs.existsSync(logDir)) {
      return [];
    }

    const logFiles: string[] = [];

    // 递归扫描所有目录
    const scanDir = (dir: string) => {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (item.endsWith('.json')) {
          logFiles.push(fullPath);
        }
      }
    };

    scanDir(logDir);
    return logFiles;
  }

  /**
   * 从文件名提取任务ID
   */
  private extractTaskId(logPath: string): string {
    const basename = path.basename(logPath, '.json');
    return basename;
  }

  /**
   * 从日志文件创建任务记录
   */
  private async createTaskFromLog(logPath: string, taskId: string): Promise<void> {
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const logData = JSON.parse(content);

      const task: ExplorationTask = {
        id: taskId,
        status: this.determineStatus(logData),
        plan: JSON.stringify(logData.plan, null, 2),
        executionLog: JSON.stringify(logData.actions, null, 2),
        resultSummary: JSON.stringify(
          {
            summary: logData.summary,
            insights: logData.insights,
            recommendations: logData.recommendations,
          },
          null,
          2
        ),
        startedAt: new Date(logData.startTime).getTime(),
        completedAt: new Date(logData.endTime).getTime(),
        createdAt: Date.now(),
      };

      await this.insertTask(task);
      console.log(`[ExplorationScheduler] ✓ New task discovered: ${taskId}`);
    } catch (error: any) {
      console.error(`[ExplorationScheduler] Failed to create task from log: ${error.message}`);
    }
  }

  /**
   * 更新任务状态
   */
  private async updateTaskStatus(taskId: string, logPath: string): Promise<void> {
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const logData = JSON.parse(content);

      const status = this.determineStatus(logData);
      const completedAt = new Date(logData.endTime).getTime();

      await this.db.run(
        `
        UPDATE exploration_tasks
        SET status = ?, completed_at = ?
        WHERE id = ?
      `,
        [status, completedAt, taskId]
      );
    } catch (error: any) {
      console.error(`[ExplorationScheduler] Failed to update task: ${error.message}`);
    }
  }

  /**
   * 确定任务状态
   */
  private determineStatus(logData: any): ExplorationStatus {
    if (logData.summary && logData.summary.failed === 0) {
      return 'completed';
    } else if (logData.summary && logData.summary.completed === 0) {
      return 'failed';
    } else {
      return 'completed'; // partial也算完成
    }
  }

  /**
   * 插入任务到数据库
   */
  private async insertTask(task: ExplorationTask): Promise<void> {
    await this.db.run(
      `
      INSERT INTO exploration_tasks (
        id, status, plan, execution_log, result_summary,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        task.id,
        task.status,
        task.plan || null,
        task.executionLog || null,
        task.resultSummary || null,
        task.startedAt || null,
        task.completedAt || null,
        task.createdAt,
      ]
    );
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<ExplorationTask | null> {
    const row = await this.db.get(
      'SELECT * FROM exploration_tasks WHERE id = ?',
      [taskId]
    ) as any;

    if (!row) return null;

    return {
      id: row.id as string,
      status: row.status as ExplorationStatus,
      plan: row.plan as string | undefined,
      executionLog: row.execution_log as string | undefined,
      resultSummary: row.result_summary as string | undefined,
      startedAt: row.started_at as number | undefined,
      completedAt: row.completed_at as number | undefined,
      createdAt: row.created_at as number,
    };
  }

  /**
   * 获取所有任务
   */
  async getAllTasks(limit: number = 50): Promise<ExplorationTask[]> {
    const rows = await this.db.all(
      `
      SELECT * FROM exploration_tasks
      ORDER BY created_at DESC
      LIMIT ?
    `,
      [limit]
    ) as any[];

    return rows.map((row: any) => ({
      id: row.id,
      status: row.status,
      plan: row.plan,
      executionLog: row.execution_log,
      resultSummary: row.result_summary,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<boolean> {
    try {
      await this.db.run('DELETE FROM exploration_tasks WHERE id = ?', [taskId]);
      return true;
    } catch (error: any) {
      console.error(`[ExplorationScheduler] Failed to delete task: ${error.message}`);
      return false;
    }
  }

  /**
   * 获取统计信息
   */
  async getStatistics(): Promise<{
    total: number;
    completed: number;
    failed: number;
    running: number;
    lastExploration?: number;
  }> {
    const stats: any = {
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
      lastExploration: undefined,
    };

    const rows = await this.db.all(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        MAX(started_at) as last_exploration
      FROM exploration_tasks
    `) as any[];

    if (rows && rows.length > 0) {
      const row = rows[0] as any;
      stats.total = row.total || 0;
      stats.completed = row.completed || 0;
      stats.failed = row.failed || 0;
      stats.running = row.running || 0;
      stats.lastExploration = row.last_exploration;
    }

    return stats;
  }
}

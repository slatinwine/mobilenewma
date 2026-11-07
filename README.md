# MobileNewma · AI 聊天网关（simple-chat-gateway）

一个 TypeScript WebSocket 网关服务：为移动端 AI 聊天提供统一的连接、认证、会话与多后端 AI 接入（newma CLI / newma web / OpenAI 兼容 API / Mock）。

## ✨ 功能特性

- **WebSocket 网关**：基于 ws 的帧协议（事件 / 请求 / 响应编解码），每客户端独立会话隔离
- **用户认证体系**：注册登录、bcrypt 密码哈希、JWT 访问令牌 + 刷新令牌轮换、设备信息记录
- **多用户 AI 配置管理**：AI 配置（API Key 等）以 AES-256-GCM 加密存库，支持 openai / newma 等多供应商配置
- **可插拔 AI 后端**：`AI_BACKEND` 可切换 newma（子进程调用 CLI）、newmaweb、api、mock（免密钥测试）
- **聊天与智能体**：会话历史、消息搜索、二进制帧文件附件、可取消的 Agent 请求
- **定时任务**：ExplorationScheduler 按分钟级 cron 调度探索任务；MemoService 提供备忘

## 🚀 使用方法

```bash
cd gateway
npm install
# 配置环境变量（均需至少 32 字符）：JWT_SECRET、ENCRYPTION_KEY
# 可选：PORT、AI_BACKEND（mock/newma/newmaweb/api）等
npm run dev    # tsx watch 开发运行
npm run build && npm start   # tsc 编译后运行 dist
```

数据库使用 sql.js（SQLite），建表脚本见 `gateway/schema.sql`。

## 🛠️ 技术栈

- TypeScript（ESM）+ Node.js + ws
- sql.js（SQLite）、bcrypt、jsonwebtoken、node-schedule、uuid、dotenv

## 📁 目录结构

- `gateway/` — 网关项目根（package.json、schema.sql、src/）
  - `src/index.ts` — 启动入口与环境装配
  - `src/protocol/` — 帧协议类型与编解码
  - `src/services/` — 网关服务器、认证、配置、数据库、AI 后端、会话与调度等服务
- `mobilenewma/` — 同一套代码的历史嵌套副本

## 关注公众号

![公众号二维码](qrcode.jpg)

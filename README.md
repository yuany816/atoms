# Atoms Platform Clone

一比一复刻 Atoms 平台核心能力的 Web 应用：提供工作台、AI 对话（真实模型流式生成）、在线编辑与实时预览、一键发布与分享、知识库、技能配置与评测能力。全站中文界面，Notion 风格设计。

## 功能模块

- **工作台**：项目管理、官方模板创建、Remix 复制
- **AI 对话**：8 个文本模型（claude-opus-5、deepseek-v4-flash、gpt-5.6-sol、gpt-5.4、gpt-5.5、gemini-3.1-pro-preview、deepseek-v4-pro、claude-opus-4.6），SSE 流式响应，多级路由回退与网络防护自动重试
- **知识库**：知识文件上传、切块向量化存储、会话自动检索注入（来源可标注）
- **技能配置**：Skills 包上传解析、应用场景标签、启用/禁用管理
- **评测**：会话数据回流、人工标注（好/坏/待定）、RAG 检索质量评测、微调数据集导出（JSON/CSV）
- **发布分享**：项目发布为独立站点并生成分享链接

## 技术栈

前端 React + Vite + shadcn/ui（Notion 主题语义变量），后端 Atoms Cloud（Auth / Database / File Storage / Edge Functions / AI Capabilities）。

## 目录结构

```
app/frontend/   前端应用
app/backend/    后端业务接口
docs/design/    产品需求（PRD）、UI 规范、系统设计文档
```

## 入口路由

- 工作台：`/dashboard`
- 项目工作区：`/project/:id`
- 发布页：`/p/:slug`，分享页：`/share/:token`
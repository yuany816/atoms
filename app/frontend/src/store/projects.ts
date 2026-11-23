import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getTemplate,
  uid,
  type ChatMessage,
  type DraftFile,
  type Project,
  type TerminalLog,
} from '@/lib/platform';

/**
 * 项目本地存储：项目 / 对话 / 文件树 / 终端日志全部持久化在浏览器 localStorage。
 * 云端仅承载发布快照、分享快照与生成应用的业务数据（三表边界见系统设计）。
 */

interface ProjectsState {
  projects: Project[];
  createProject: (name: string, templateId: string) => Project;
  remixProject: (sourceId: string) => Project | null;
  deleteProject: (id: string) => void;
  addMessage: (projectId: string, message: ChatMessage) => void;
  patchMessage: (projectId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  appendMessageChunk: (projectId: string, messageId: string, text: string) => void;
  appendLog: (projectId: string, text: string, kind?: TerminalLog['kind']) => void;
  applyFiles: (projectId: string, files: { path: string; content: string }[]) => void;
  updateFileContent: (projectId: string, path: string, content: string) => void;
  /** 按路径新增或替换不完整草稿 */
  upsertDrafts: (projectId: string, drafts: DraftFile[]) => void;
  /** 丢弃草稿（保留标记，避免从历史对话再次恢复） */
  dismissDraft: (projectId: string, path: string) => void;
  setPublishedSlug: (projectId: string, slug: string) => void;
}

function mapProject(
  projects: Project[],
  projectId: string,
  mapper: (project: Project) => Project,
): Project[] {
  return projects.map((p) => (p.id === projectId ? mapper(p) : p));
}

export const useProjectStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [],

      createProject: (name, templateId) => {
        const template = getTemplate(templateId);
        const now = Date.now();
        const project: Project = {
          id: uid('p-'),
          name: name.trim() || '未命名项目',
          templateId: template.id,
          files: template.files.map((f) => ({ ...f, updatedAt: now })),
          messages: [],
          logs: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },

      remixProject: (sourceId) => {
        const source = get().projects.find((p) => p.id === sourceId);
        if (!source) return null;
        const now = Date.now();
        const copy: Project = {
          ...source,
          id: uid('p-'),
          name: `${source.name}（副本）`,
          files: source.files.map((f) => ({ ...f })),
          messages: source.messages.map((m) => ({ ...m, id: uid('m-') })),
          logs: source.logs.map((l) => ({ ...l, id: uid('l-') })),
          publishedSlug: undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ projects: [copy, ...state.projects] }));
        return copy;
      },

      deleteProject: (id) =>
        set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),

      addMessage: (projectId, message) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            messages: [...p.messages, message],
            updatedAt: Date.now(),
          })),
        })),

      patchMessage: (projectId, messageId, patch) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            messages: p.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
          })),
        })),

      appendMessageChunk: (projectId, messageId, text) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            messages: p.messages.map((m) =>
              m.id === messageId ? { ...m, content: m.content + text } : m,
            ),
          })),
        })),

      appendLog: (projectId, text, kind = 'info') =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            logs: [...p.logs, { id: uid('l-'), time: Date.now(), text, kind }],
          })),
        })),

      applyFiles: (projectId, files) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => {
            const map = new Map(p.files.map((f) => [f.path, f]));
            for (const f of files) {
              map.set(f.path, { path: f.path, content: f.content, updatedAt: Date.now() });
            }
            // 已写入完整版本的文件，其不完整草稿随之失效
            const written = new Set(files.map((f) => f.path.toLowerCase()));
            const drafts = (p.drafts ?? []).filter((d) => !written.has(d.path.toLowerCase()));
            return { ...p, files: Array.from(map.values()), drafts, updatedAt: Date.now() };
          }),
        })),

      upsertDrafts: (projectId, drafts) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => {
            const map = new Map((p.drafts ?? []).map((d) => [d.path.toLowerCase(), d]));
            for (const d of drafts) map.set(d.path.toLowerCase(), { ...d, dismissed: false });
            return { ...p, drafts: Array.from(map.values()), updatedAt: Date.now() };
          }),
        })),

      dismissDraft: (projectId, path) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            drafts: (p.drafts ?? []).map((d) => (d.path === path ? { ...d, dismissed: true } : d)),
          })),
        })),

      updateFileContent: (projectId, path, content) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            files: p.files.map((f) =>
              f.path === path ? { ...f, content, updatedAt: Date.now() } : f,
            ),
            updatedAt: Date.now(),
          })),
        })),

      setPublishedSlug: (projectId, slug) =>
        set((state) => ({
          projects: mapProject(state.projects, projectId, (p) => ({
            ...p,
            publishedSlug: slug,
            updatedAt: Date.now(),
          })),
        })),
    }),
    { name: 'atoms-clone-projects-v1' },
  ),
);
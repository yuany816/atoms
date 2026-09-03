import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getTemplate, uid, type ChatMessage, type Project, type TerminalLog } from '@/lib/platform';

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
            return { ...p, files: Array.from(map.values()), updatedAt: Date.now() };
          }),
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
import type { ChatFileRef } from '@/common/types/chatFile';
import { emitter } from '@/renderer/utils/emitter';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';

export type Brief = {
  direction: string;
  intent: string;
  count: number;
  minutes: number;
  months: number;
  region: string;
  strict_quartile: boolean;
  style: string;
  inputs: string[];
};
export type Paper = {
  id: string;
  title: string;
  doi: string;
  source: string;
  journal: string;
  date: string;
  finding: string;
  role: string;
  ranking: string;
  ranking_source: string;
  version: string;
  access?: string;
  pdf: string | null;
};
export type SlideDesign = {
  layout: 'cover' | 'concept' | 'comparison' | 'figure' | 'mechanism' | 'evidence' | 'discussion';
  subtitle: string;
  key: string;
  points: { title: string; text: string }[];
  comparisons: { label: string; baseline: string; change: string; effect: string }[];
  annotations: { label: string; rect: [number, number, number, number] }[];
  metrics: {
    label: string;
    unit: string;
    baseline_label: string;
    baseline: number;
    result_label: string;
    result: number;
    axis_max: number;
    decimals: number;
  }[];
};
export type Slide = {
  title: string;
  body: string;
  notes: string;
  seconds: number;
  table?: string[][];
  figure: string | null;
  evidence: { paper: string; page: number; label: string }[];
  design?: SlideDesign | null;
};
export type Stage = 'search' | 'outline' | 'revise';
export type ChoiceCard = {
  id: string;
  created_at: number;
  revision: number;
  kind: 'papers' | 'outline' | 'deck';
  brief: Brief;
  papers: Paper[];
  selected: string[];
  outline: Slide[];
  deck: string | null;
};
export type Report = {
  id: string;
  revision: number;
  workspace?: string;
  conversation?: string | null;
  brief: Brief;
  papers: Paper[];
  selected: string[];
  outline: Slide[];
  outline_current: boolean;
  deck: string | null;
  published?: { path: string; revision: number; slides: Slide[]; papers?: Paper[] };
  turns?: { user: string; answer: string }[];
  cards?: ChoiceCard[];
  job: { id: string; stage: Stage; workspace: string; conversation: string | null; instruction: string } | null;
};
export const conversationCards = (report: Report): ChoiceCard[] =>
  report.cards?.length
    ? report.cards
    : report.papers.length || report.outline.length
      ? [
          {
            id: 'legacy',
            created_at: 0,
            revision: report.revision,
            kind: report.deck ? 'deck' : report.outline_current && report.outline.length ? 'outline' : 'papers',
            brief: report.brief,
            papers: report.papers,
            selected: report.selected,
            outline: report.outline,
            deck: report.deck,
          },
        ]
      : [];
export const initialBrief: Brief = {
  direction: '',
  intent: '',
  count: 3,
  minutes: 10,
  months: 12,
  region: 'international',
  strict_quartile: true,
  style: 'international',
  inputs: [],
};
export const root = '/api/paper-talk';
export const reportPath = (r: Report) => root + '/' + r.id;
export type ReportSummary = { id: string; direction: string; conversation?: string | null };
export type ReportHistoryAction = 'archive' | 'unarchive' | 'delete';
export const listReports = (archived = false) =>
  httpRequest<ReportSummary[]>('GET', archived ? root + '?archived=true' : root);
export function updateReportHistory(id: string, action: ReportHistoryAction) {
  const path = root + '/' + encodeURIComponent(id);
  return action === 'delete' ? httpRequest<void>('DELETE', path) : httpRequest<void>('POST', path + '/' + action);
}
export const activeReportKey = 'paper-talk.active';
export function forgetActiveReport(id: string) {
  if (localStorage.getItem(activeReportKey) === id) localStorage.removeItem(activeReportKey);
}
export function unavailableReport(error: unknown): 'archived' | 'missing' | undefined {
  if (!isBackendHttpError(error)) return undefined;
  if (error.code === 'CONVERSATION_ARCHIVED' || error.status === 410) return 'archived';
  if (error.status === 404) return 'missing';
  return undefined;
}
export type Sources = { discovery: string; fulltext: string; ranking: string };
export const readSources = (): Sources =>
  JSON.parse(localStorage.getItem('paper-talk.sources') ?? '{"discovery":"","fulltext":"","ranking":""}') as Sources;
export const serviceIds = (sources: Sources) => [
  ...new Set(
    Object.values(sources)
      .map((s) => s.trim())
      .filter(Boolean)
  ),
];
export function errorText(error: unknown) {
  if (
    error instanceof Error &&
    'body' in error &&
    error.body &&
    typeof error.body === 'object' &&
    'error' in error.body
  )
    return String(error.body.error);
  return error instanceof Error ? error.message : String(error);
}
const opening = new Map<string, Promise<Report>>();
export function ensureConversation(report: Report, name: string): Promise<Report> {
  if (report.conversation) return Promise.resolve(report);
  const pending = opening.get(report.id);
  if (pending) return pending;
  const request = (async () => {
    if (!report.workspace) throw new Error('Report workspace is missing');
    const bindingKey = 'paper-talk.binding.' + report.id;
    const staged = localStorage.getItem(bindingKey);
    const conversation = staged
      ? { id: staged }
      : await httpRequest<{ id: string }>('POST', '/api/conversations', {
          type: 'acp',
          name,
          extra: {
            backend: 'codex',
            workspace: report.workspace,
            paper_talk_report_id: report.id,
            selected_mcp_server_ids: serviceIds(readSources()),
            preset_context: [
              '你是 Paper2Talk 组会助手。学生在同一会话中与您讨论、搜索论文、改大纲；直接用中文解释研究内容。',
              '对话面向研究生，不是开发者。执行过程只用一两句话说明当前阶段：检索论文、阅读原文、整理大纲、设计页面或生成可编辑 PPT；不要宣告技能名称，不要描述读取配置、运行命令、内部路径或代码。需要用户处理的错误与确认必须明确说明。',
              '每次收到新消息，必须重新读取工作目录中的 active-task.json；从其中 workspace 路径读取 task.md 和 request.json。',
              '任务目录会逐轮变化，不要复用上轮任务目录。按当前 task.md 执行，所有新文件写入当前任务目录；以绝对路径引用已有论文和图片。',
              '按任务契约原子写入当前任务目录的 result.json，然后正常回复学生，简述发现、关系或问题，不要在回复中展示任务文件和 JSON 实现细节。',
              '学生上传的 PDF 可从本条消息附件读取，复制到当前任务目录后再引用。继续尊重 request.json 中的手动修改、已选论文与时长要求。',
              '只做当前请求，区分新增和替换；用户只问问题时只解答。用户在对话中确认当前大纲并要求生成后，按当前 task.md 与 generate.md 完成设计稿和可编辑 PPT。产物完成并通过核验后再写 result.json，由应用发布和预览。',
            ].join('\n'),
          },
        });
    localStorage.setItem(bindingKey, conversation.id);
    let bound: Report;
    try {
      bound = await httpRequest<Report>('POST', reportPath(report) + '/conversation', {
        conversation: conversation.id,
      });
    } catch (error) {
      // A report can be deleted or archived after we read it and before we
      // bind its conversation. Discard only the empty chat created this time.
      if (!staged && unavailableReport(error)) {
        localStorage.removeItem(bindingKey);
        await httpRequest('DELETE', '/api/conversations/' + encodeURIComponent(conversation.id)).catch(() => {});
      }
      throw error;
    }
    localStorage.removeItem(bindingKey);
    emitter.emit('chat.history.refresh');
    return bound;
  })();
  opening.set(report.id, request);
  void request.then(
    () => opening.delete(report.id),
    () => opening.delete(report.id)
  );
  return request;
}
export async function cancelPending(report: Report | null) {
  const id = report?.conversation ?? report?.job?.conversation;
  if (!id) return;
  const path = '/api/conversations/' + encodeURIComponent(id);
  const conversation = await httpRequest<{ runtime?: { turn_id?: string; is_processing: boolean } }>('GET', path);
  const runtime = conversation.runtime;
  if (!runtime?.turn_id || !runtime.is_processing) return;
  await httpRequest('POST', path + '/cancel', { turn_id: runtime.turn_id });
  for (let attempt = 0; attempt < 50; attempt++) {
    const current = await httpRequest<{ runtime?: { is_processing: boolean } }>('GET', path);
    if (!current.runtime?.is_processing) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Previous turn has not stopped yet. Please retry.');
}
export async function prepareJob(report: Report, stage: Stage, instruction: string, files: ChatFileRef[] = []) {
  if (!report.conversation) throw new Error('Report has no conversation');
  await cancelPending(report);
  return httpRequest<Report>('POST', reportPath(report) + '/jobs', {
    revision: report.revision,
    stage,
    instruction,
    files,
  });
}

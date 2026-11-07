import { createContext, useContext } from 'react';
import type { ChatFileRef } from '@/common/types/chatFile';
import type { Report, Stage } from './client';
import type { PreviewItem } from './components/Preview';

export type Draft = Pick<Report, 'brief' | 'selected' | 'outline'>;
export type PaperTalkState = {
  report: Report | null;
  draft: Draft;
  busy: boolean;
  error: string;
  waiting: boolean;
  needsConfirmation: boolean;
  previewOpen: boolean;
  item: PreviewItem | null;
  dirty: boolean;
  update: (draft: Draft) => void;
  preview: (item: PreviewItem) => void;
  togglePreview: (open: boolean) => void;
  prepare: (input: string, files: ChatFileRef[]) => Promise<void>;
  run: (stage: Stage, instruction: string) => Promise<void>;
  save: () => Promise<void>;
  exportDeck: () => Promise<void>;
  fail: (error: unknown) => void;
};
export const PaperTalkContext = createContext<PaperTalkState | null>(null);
export const usePaperTalk = () => useContext(PaperTalkContext);

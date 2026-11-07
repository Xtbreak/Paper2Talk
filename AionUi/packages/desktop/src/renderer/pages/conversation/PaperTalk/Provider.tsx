import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatFileRef } from '@/common/types/chatFile';
import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import { mutate } from 'swr';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '../Preview';
import {
  cancelPending,
  errorText,
  initialBrief,
  prepareJob,
  reportPath,
  root,
  type Report,
  type Stage,
} from './client';
import { PaperTalkContext, type Draft } from './context';
import type { PreviewItem } from './components/Preview';

const draftKey = (r: Report) => `paper-talk.draft.${r.id}.${r.revision}`;
const initial: Draft = { brief: initialBrief, selected: [], outline: [] };
export default function PaperTalkProvider({ reportId, children }: { reportId: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const { closePreview } = usePreviewContext();
  const [report, setReport] = useState<Report | null>(null);
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(() => {
    const stored = localStorage.getItem(`paper-talk.preview.${reportId}`);
    return stored === 'on';
  });
  const [item, setItem] = useState<PreviewItem | null>(null);
  const current = useRef(report);
  const edit = useRef(draft);
  const changed = useRef(false);
  const locked = useRef(false);
  const collection = useRef<Promise<void> | null>(null);
  const fail = useCallback((e: unknown) => setError(errorText(e)), []);
  const adopt = useCallback((r: Report) => {
    const stored = localStorage.getItem(draftKey(r));
    const next = stored ? (JSON.parse(stored) as Draft) : { brief: r.brief, selected: r.selected, outline: r.outline };
    current.current = r;
    edit.current = next;
    changed.current = !!stored;
    setReport(r);
    void mutate('paper-talk.history');
    setError('');
    setDraft(next);
    setDirty(!!stored);
    localStorage.setItem('paper-talk.active', r.id);
  }, []);
  useEffect(() => {
    let live = true;
    httpRequest<Report>('GET', root + '/' + reportId)
      .then((r) => {
        if (live) adopt(r);
      })
      .catch((e) => {
        if (live) fail(e);
      });
    return () => {
      live = false;
    };
  }, [reportId, adopt, fail]);
  const update = (next: Draft) => {
    const r = current.current;
    if (!r) return;
    edit.current = next;
    changed.current = true;
    setDraft(next);
    setDirty(true);
    localStorage.setItem(draftKey(r), JSON.stringify(next));
  };
  const togglePreview = (open: boolean) => {
    closePreview();
    setPreviewOpen(open);
    localStorage.setItem(`paper-talk.preview.${reportId}`, open ? 'on' : 'off');
  };
  const preview = (next: PreviewItem) => {
    setItem(next);
    togglePreview(true);
  };
  const exclusive = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (locked.current) throw new Error(t('common.paperTalk.dispatching'));
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await collection.current;
      return await fn();
    } catch (e) {
      fail(e);
      throw e;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const persist = async () => {
    const r = current.current;
    if (!r) throw new Error(t('common.loading'));
    if (!changed.current) return r;
    await cancelPending(r);
    const snapshot = edit.current;
    const saved = await httpRequest<Report>('PUT', reportPath(r), { ...snapshot, revision: r.revision });
    if (snapshot !== edit.current) localStorage.setItem(draftKey(saved), JSON.stringify(edit.current));
    localStorage.removeItem(draftKey(r));
    adopt(saved);
    return saved;
  };
  const prepare = async (input: string, files: ChatFileRef[], stage: Stage = 'revise') =>
    exclusive(async () => {
      const pending = current.current;
      if (pending?.job && !changed.current) {
        const collected = await httpRequest<Report>(
          'POST',
          reportPath(pending) + '/jobs/' + pending.job.id + '/collect'
        );
        if (changed.current && collected.revision !== pending.revision) {
          localStorage.setItem(draftKey(collected), JSON.stringify(edit.current));
          localStorage.removeItem(draftKey(pending));
        }
        adopt(collected);
      }
      const pdfs = files.flatMap((f) => (f.kind !== 'project' && /\.pdf$/i.test(f.path) ? [f.path] : []));
      if (pdfs.length)
        update({
          ...edit.current,
          brief: { ...edit.current.brief, inputs: [...new Set([...edit.current.brief.inputs, ...pdfs])] },
        });
      if (stage === 'outline' && edit.current.selected.length !== edit.current.brief.count)
        update({ ...edit.current, brief: { ...edit.current.brief, count: edit.current.selected.length } });
      const saved = await persist();
      const job = await prepareJob(saved, stage, input, files);
      if (changed.current) {
        localStorage.setItem(draftKey(job), JSON.stringify(edit.current));
        localStorage.removeItem(draftKey(saved));
      }
      adopt(job);
      setWaiting(false);
      setNeedsConfirmation(false);
    });
  const run = async (stage: Stage, instruction: string) => {
    try {
      await prepare(instruction, [], stage);
      const r = current.current;
      if (!r?.conversation) throw new Error('Report has no conversation');
      await httpRequest('POST', '/api/conversations/' + r.conversation + '/messages', {
        content: instruction,
        files: [],
      });
    } catch (e) {
      fail(e);
    }
  };
  const save = async () => {
    try {
      await exclusive(persist);
    } catch (e) {
      fail(e);
    }
  };
  const exportDeck = async () => run('revise', t('common.paperTalk.confirmGenerate'));

  useEffect(() => {
    const job = report?.job;
    if (!job) return;
    let live = true;
    const poll = () => {
      const r = current.current;
      if (collection.current || locked.current || changed.current || r?.job?.id !== job.id) return;
      collection.current = (async () => {
        try {
          const result = await httpRequest<Report>('POST', reportPath(r) + '/jobs/' + job.id + '/collect');
          if (!live || current.current?.job?.id !== job.id) return;
          if (!result.job) {
            if (changed.current) {
              localStorage.setItem(draftKey(result), JSON.stringify(edit.current));
              localStorage.removeItem(draftKey(r));
            }
            adopt(result);
            setWaiting(false);
            setNeedsConfirmation(false);
            setItem(result.deck ? { path: result.deck } : result.outline.length ? { path: 'outline' } : null);
            if (result.deck && result.deck !== r.deck) {
              setPreviewOpen(true);
              localStorage.setItem(`paper-talk.preview.${reportId}`, 'on');
            }
          } else if (job.conversation) {
            const conversation = await httpRequest<{
              runtime?: { is_processing: boolean; pending_confirmations?: number };
            }>('GET', '/api/conversations/' + job.conversation);
            if (live) {
              setWaiting(!conversation.runtime?.is_processing);
              setNeedsConfirmation((conversation.runtime?.pending_confirmations ?? 0) > 0);
            }
          }
        } catch (e) {
          if (!live) return;
          if (isBackendHttpError(e) && e.status === 409) {
            try {
              const latest = await httpRequest<Report>('GET', reportPath(r));
              if (!live || current.current?.job?.id !== job.id) return;
              if (changed.current && latest.revision !== r.revision) {
                localStorage.setItem(draftKey(latest), JSON.stringify(edit.current));
                localStorage.removeItem(draftKey(r));
              }
              adopt(latest);
            } catch (refreshError) {
              fail(refreshError);
            }
          } else fail(e);
        }
      })().finally(() => {
        collection.current = null;
      });
    };
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [report?.job?.id, reportId, adopt, fail]);
  return (
    <PaperTalkContext.Provider
      value={{
        report,
        draft,
        busy,
        error,
        waiting,
        needsConfirmation,
        previewOpen,
        item,
        dirty,
        update,
        preview,
        togglePreview,
        prepare,
        run,
        save,
        exportDeck,
        fail,
      }}
    >
      {children}
    </PaperTalkContext.Provider>
  );
}

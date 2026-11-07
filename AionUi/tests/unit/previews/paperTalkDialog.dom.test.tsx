import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  PaperTalkProvider,
  PaperTalkMessages,
  PaperTalkPreview,
  usePaperTalk,
} from '@/renderer/pages/conversation/PaperTalk';
import {
  ensureConversation,
  initialBrief,
  conversationCards,
  type Report,
} from '@/renderer/pages/conversation/PaperTalk/client';
import { httpRequest } from '@/common/adapter/httpBridge';

vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(),
  getBaseUrl: () => '',
  isBackendHttpError: (e: unknown) => e instanceof Error && 'status' in e,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ closePreview: vi.fn() }) }));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: vi.fn() }));
vi.mock('swr', () => ({ default: () => ({ data: [], mutate: vi.fn() }), mutate: vi.fn() }));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers/PDFViewer', () => ({ default: () => null }));
const report: Report = {
  id: 'report',
  revision: 3,
  conversation: 'conversation',
  workspace: '/tmp/report',
  brief: { ...initialBrief, direction: 'NLP', intent: 'What changed?' },
  papers: [
    {
      id: 'p1',
      title: 'First paper',
      doi: '',
      date: '2026',
      journal: 'Journal',
      source: '',
      finding: 'Finding',
      role: 'First study',
      ranking: 'Pending',
      ranking_source: '',
      version: 'PDF',
      pdf: '/a.pdf',
    },
  ],
  selected: ['p1'],
  outline: [
    { title: 'A measured change', body: 'Result', notes: 'Tell the group', seconds: 60, evidence: [], figure: null },
  ],
  outline_current: true,
  deck: '/talk.pptx',
  job: null,
  turns: [{ user: 'Read the first paper', answer: 'Results found' }],
};
const request = vi.mocked(httpRequest);
beforeEach(() => {
  request.mockReset();
  localStorage.clear();
  localStorage.setItem('paper-talk.active', 'report');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function open() {
  return render(
    <MemoryRouter>
      <PaperTalkProvider reportId='report'>
        <CardsProbe />
        <PaperTalkMessages />
        <PaperTalkPreview />
      </PaperTalkProvider>
    </MemoryRouter>
  );
}
function CardsProbe() {
  const state = usePaperTalk();
  return (
    <>
      <button onClick={() => void state?.run('revise', 'common.paperTalk.generateChosen')}>
        send generation in chat
      </button>
      {state?.report && conversationCards(state.report).map((card) => <PaperTalkMessages key={card.id} card={card} />)}
    </>
  );
}
function PrepareProbe() {
  const state = usePaperTalk();
  return <button onClick={() => void state?.prepare('Keep going', [])}>send from native seam</button>;
}
describe('Paper2Talk conversation workspace', () => {
  it('recovers a report already collected by another client', async () => {
    vi.useFakeTimers();
    let loads = 0;
    const pending = {
      ...report,
      job: {
        id: 'job',
        stage: 'revise' as const,
        workspace: '/tmp/job',
        conversation: 'conversation',
        instruction: 'old',
      },
    };
    request.mockImplementation(async (_method, path) => {
      if (path.endsWith('/collect')) throw Object.assign(new Error('Superseded task'), { status: 409 });
      if (path === '/api/paper-talk/report')
        return ++loads === 1
          ? pending
          : { ...report, revision: 4, brief: { ...report.brief, direction: 'Updated direction' } };
      return report;
    });
    open();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText('Updated direction.pptx')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('waits for an arriving result before preparing the next user request', async () => {
    vi.useFakeTimers();
    let resolveResult!: (r: Report) => void;
    const pending = {
      ...report,
      job: {
        id: 'job',
        stage: 'revise' as const,
        workspace: '/tmp/job',
        conversation: 'conversation',
        instruction: 'old',
      },
    };
    request.mockImplementation(async (method, path) => {
      if (path.endsWith('/collect'))
        return new Promise<Report>((resolve) => {
          resolveResult = resolve;
        });
      if (path.endsWith('/jobs')) return { ...pending, revision: 5 };
      if (path.startsWith('/api/conversations/')) return { runtime: { is_processing: false } };
      return pending;
    });
    render(
      <PaperTalkProvider reportId='report'>
        <PrepareProbe />
      </PaperTalkProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => fireEvent.click(screen.getByText('send from native seam')));
    expect(request.mock.calls.some((c) => c[1].endsWith('/jobs'))).toBe(false);
    await act(async () => resolveResult({ ...report, revision: 4 }));
    expect(request.mock.calls.find((c) => c[1].endsWith('/jobs'))?.[2]).toMatchObject({
      revision: 4,
      instruction: 'Keep going',
    });
  });

  it('reuses the created native conversation after a binding failure', async () => {
    const old = { ...report, conversation: null };
    request.mockResolvedValueOnce({ id: 'short-id' }).mockRejectedValueOnce(new Error('network unavailable'));
    await expect(ensureConversation(old, 'NLP')).rejects.toThrow('network unavailable');
    request.mockResolvedValueOnce({ ...report, conversation: 'short-id' });
    await ensureConversation(old, 'NLP');
    expect(request.mock.calls.filter((c) => c[0] === 'POST' && c[1] === '/api/conversations')).toHaveLength(1);
    expect(request.mock.calls[2][2]).toEqual({ conversation: 'short-id' });
  });

  it('keeps the completed outline compact and opens the PPT from its conversation card', async () => {
    request.mockResolvedValue(report);
    open();
    await screen.findByText('NLP.pptx');
    expect(screen.queryByText('common.paperTalk.deckReady')).toBeNull();
    expect(screen.queryByText('common.paperTalk.continueEditing')).toBeNull();
    expect(screen.queryByText('First paper')).toBeNull();
    expect(screen.queryByText('A measured change')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'common.paperTalk.viewDeck' })[0]);
    expect(document.querySelector('aside img')?.getAttribute('src')).toContain('/preview/3/1');
    expect(screen.queryByText('common.paperTalk.savedDecisions')).toBeNull();
  });

  it('starts with a conversation and leaves the empty preview closed', async () => {
    request.mockResolvedValue({ ...report, brief: initialBrief, papers: [], outline: [], deck: null, turns: [] });
    function StateProbe() {
      const state = usePaperTalk();
      return <span>{state?.previewOpen ? 'preview-open' : 'preview-closed'}</span>;
    }
    render(
      <PaperTalkProvider reportId='report'>
        <PaperTalkMessages welcomeOnly />
        <StateProbe />
      </PaperTalkProvider>
    );
    await screen.findByText('common.paperTalk.intro');
    expect(screen.getByText('preview-closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.find' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.editBrief' })).toBeNull();
    expect(document.querySelector('input, textarea')).toBeNull();
  });

  it('does not append a welcome after a greeting without a research direction', async () => {
    request.mockResolvedValue({
      ...report,
      brief: initialBrief,
      papers: [],
      outline: [],
      deck: null,
      turns: [{ user: '你好', answer: '你想汇报哪个方向？' }],
    });
    open();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(screen.queryByText('common.paperTalk.intro')).toBeNull();
  });

  it('hides the welcome as soon as sending starts, before a job or message is saved', async () => {
    const empty = { ...report, brief: initialBrief, papers: [], outline: [], deck: null, turns: [] };
    request.mockImplementation(async (_method, path) =>
      path.startsWith('/api/conversations/') ? new Promise(() => {}) : empty
    );
    render(
      <PaperTalkProvider reportId='report'>
        <PaperTalkMessages welcomeOnly />
        <PrepareProbe />
      </PaperTalkProvider>
    );
    await screen.findByText('common.paperTalk.intro');
    fireEvent.click(screen.getByText('send from native seam'));
    expect(screen.queryByText('common.paperTalk.intro')).toBeNull();
  });

  it('does not push a search or default requirements after a direction-only discussion', async () => {
    request.mockResolvedValue({ ...report, papers: [], outline: [], deck: null, turns: [] });
    open();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(screen.queryByText('common.paperTalk.briefSummary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.find' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.editBrief' })).toBeNull();
  });

  it('shows an approval wait instead of claiming the assistant is still working', async () => {
    vi.useFakeTimers();
    const pending = {
      ...report,
      job: {
        id: 'job',
        stage: 'revise' as const,
        workspace: '/tmp/job',
        conversation: 'conversation',
        instruction: 'continue',
      },
    };
    request.mockImplementation(async (_method, path) =>
      path.startsWith('/api/conversations/') ? { runtime: { is_processing: true, pending_confirmations: 1 } } : pending
    );
    open();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('common.paperTalk.needsConfirmation');
    expect(screen.queryByText('common.paperTalk.working')).toBeNull();
  });

  it('opens the generated PPT when a confirmation sent in chat finishes collecting', async () => {
    vi.useFakeTimers();
    const pending = {
      ...report,
      deck: null,
      job: {
        id: 'export-job',
        stage: 'revise' as const,
        workspace: '/tmp/export-job',
        conversation: 'conversation',
        instruction: 'Confirm and generate PPT',
      },
    };
    request.mockImplementation(async (_method, path) =>
      path.endsWith('/collect') ? { ...report, revision: 5, deck: '/chat-confirmed.pptx' } : pending
    );
    function PreviewState() {
      const state = usePaperTalk();
      return <span>{state?.previewOpen ? state.item?.path : 'closed'}</span>;
    }
    render(
      <PaperTalkProvider reportId='report'>
        <PreviewState />
      </PaperTalkProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('closed')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText('/chat-confirmed.pptx')).toBeTruthy();
    expect(localStorage.getItem('paper-talk.preview.report')).toBe('on');
  });
  it('keeps edited notes and routes generation confirmation through the same chat', async () => {
    request.mockImplementation(async (method, path, body) => {
      if (method === 'PUT') return { ...report, ...(body as Record<string, unknown>), revision: 4, deck: null };
      if (path.endsWith('/jobs')) return { ...report, revision: 5, deck: null };
      if (path.endsWith('/styles')) return [];
      return { ...report, deck: null };
    });
    const app = open();
    await screen.findByText('common.paperTalk.chooseStyle');
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.editOutline' }));
    fireEvent.change(screen.getByLabelText('common.paperTalk.notes'), { target: { value: 'Keep this note' } });
    app.unmount();
    open();
    await screen.findByText('common.paperTalk.chooseStyle');
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.editOutline' }));
    expect(screen.getByLabelText('common.paperTalk.notes')).toHaveValue('Keep this note');
    expect(request.mock.calls.some((c) => c[1].endsWith('/export'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'common.paperTalk.generateChosenButton' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'send generation in chat' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('POST', '/api/conversations/conversation/messages', {
        content: 'common.paperTalk.generateChosen',
        files: [],
      })
    );
    expect(request).toHaveBeenCalledWith('POST', '/api/paper-talk/report/jobs', {
      revision: 4,
      stage: 'revise',
      instruction: 'common.paperTalk.generateChosen',
      files: [],
    });
    expect(request.mock.calls.some((c) => c[1].endsWith('/export'))).toBe(false);
    expect(request.mock.calls.find((c) => c[0] === 'PUT')?.[2]).toMatchObject({
      outline: [{ notes: 'Keep this note' }],
    });
  });
  it('shows paper choices inline and keeps old cards visible and read only', async () => {
    const candidate = { ...report, outline: [], deck: null, selected: [] };
    const old = { ...conversationCards(candidate)[0], id: 'old', created_at: 1 };
    const current = { ...old, id: 'new', created_at: 2 };
    request.mockResolvedValue({ ...candidate, cards: [old, current] });
    open();
    await screen.findAllByText('1. First paper');
    const historical = document.querySelector('[data-card-id="old"]')!;
    expect(historical.querySelector('input')).toBeDisabled();
    const currentCheckbox = document.querySelector('[data-card-id="new"] input')!;
    fireEvent.click(currentCheckbox);
    expect(currentCheckbox).toBeChecked();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.showDetails' })).toBeNull();
  });
  it('separates the outline from templates without historical status clutter', async () => {
    const draft = { ...report, deck: null };
    const old = { ...conversationCards(draft)[0], id: 'old-outline' };
    request.mockImplementation(async (_method, path) =>
      path.endsWith('/styles') ? [] : { ...report, cards: [old, ...conversationCards(report)] }
    );
    open();
    const heading = await screen.findByRole('heading', { name: 'common.paperTalk.outline' });
    const outline = heading.closest('section')!;
    expect(outline).toHaveTextContent('A measured change');
    expect(outline.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'common.paperTalk.chooseStyle' }).closest('section')).not.toBe(outline);
    expect(screen.queryByText(/common.paperTalk.historicalChoice/)).toBeNull();
  });
  it('shows real style thumbnails and preserves the chosen style when generating', async () => {
    const draft = { ...report, deck: null };
    const styles = ['clean-professional', 'scientific-defense', 'handdrawn-technical', 'creative-magazine'].map(
      (id) => ({ id, name: id, preview: '/api/paper-talk/styles/' + id + '/preview' })
    );
    request.mockImplementation(async (method, path, body) => {
      if (path.endsWith('/styles')) return styles;
      if (method === 'PUT') return { ...draft, ...(body as Record<string, unknown>), revision: 4 };
      if (path.endsWith('/jobs')) return { ...draft, revision: 5 };
      return draft;
    });
    open();
    await screen.findByRole('radio', { name: 'common.paperTalk.styleNames.handdrawn-technical' });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByAltText('common.paperTalk.styleNames.handdrawn-technical')).toHaveAttribute(
      'src',
      '/api/paper-talk/styles/handdrawn-technical/preview'
    );
    fireEvent.click(screen.getByRole('radio', { name: 'common.paperTalk.styleNames.handdrawn-technical' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.allStyles' }));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'common.paperTalk.generateChosenButton' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'send generation in chat' }));
    await waitFor(() =>
      expect(request.mock.calls.find((call) => call[0] === 'PUT')?.[2]).toMatchObject({
        brief: { style: 'handdrawn-technical' },
      })
    );
  });
});

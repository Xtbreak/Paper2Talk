import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import PaperTalkHistory from '@/renderer/components/layout/Sider/SiderNav/PaperTalkHistory';
import PaperTalkEntry from '@/renderer/pages/conversation/PaperTalk/Entry';
import PaperTalkProvider from '@/renderer/pages/conversation/PaperTalk/Provider';
import { initialBrief, type Report } from '@/renderer/pages/conversation/PaperTalk/client';
import { usePaperTalk } from '@/renderer/pages/conversation/PaperTalk/context';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import common from '@/renderer/services/i18n/locales/en-US/common.json';
import conversation from '@/renderer/services/i18n/locales/en-US/conversation.json';
import settings from '@/renderer/services/i18n/locales/en-US/settings.json';
import { emitter } from '@/renderer/utils/emitter';

const { listChanged, closePreview, setSiderCollapsed } = vi.hoisted(() => ({
  listChanged: vi.fn(),
  closePreview: vi.fn(),
  setSiderCollapsed: vi.fn(),
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { listChanged: { on: listChanged } } } }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ closePreview }) }));

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en-US',
  resources: { 'en-US': { translation: { common, conversation, settings } } },
  interpolation: { escapeValue: false },
});

const initialReport = { id: 'report-id', direction: 'Few-shot segmentation', conversation: 'short-id' };
const report: Report = {
  ...initialReport,
  brief: { ...initialBrief, direction: initialReport.direction },
  revision: 1,
  papers: [],
  selected: [],
  outline: [],
  outline_current: false,
  deck: null,
  job: null,
};
type State = 'active' | 'archived' | 'deleted';
let state: State;
let rejectMutation: boolean;
let onListChanged: (() => void) | undefined;
let deletePending: Promise<void> | undefined;
let savePending: Promise<Report> | undefined;

function response(data: unknown) {
  return Response.json({ success: true, data });
}

function failure(status: number, code: string, error: string) {
  return Response.json({ success: false, code, error }, { status });
}

const request = vi.fn(async (path: string, options: RequestInit): Promise<Response> => {
  const route = '/api/paper-talk';
  switch (`${options.method} ${path}`) {
    case `GET ${route}`:
      return response(state === 'active' ? [initialReport] : []);
    case `GET ${route}?archived=true`:
      return response(state === 'archived' ? [initialReport] : []);
    case `GET ${route}/report-id`:
      if (state === 'deleted') return failure(404, 'NOT_FOUND', 'Missing report');
      if (state === 'archived') return failure(410, 'CONVERSATION_ARCHIVED', 'Archived conversation');
      return response(report);
    case 'GET /api/conversations/short-id':
      return response({ runtime: { is_processing: false } });
    case `PUT ${route}/report-id`:
      return response(await (savePending ?? report));
    case `POST ${route}`:
      return response({ id: 'fresh-id', conversation: 'fresh-conversation', brief: { direction: '' } });
    case `POST ${route}/report-id/archive`:
      if (rejectMutation) return failure(503, 'INTERNAL_ERROR', 'Service unavailable');
      state = 'archived';
      return response(null);
    case `POST ${route}/report-id/unarchive`:
      state = 'active';
      return response(null);
    case `DELETE ${route}/report-id`:
      await deletePending;
      state = 'deleted';
      return response(null);
    default:
      throw new Error(`Unexpected request: ${options.method} ${path}`);
  }
});

function Location() {
  const location = useLocation();
  return <output aria-label='Current route'>{location.pathname + location.search}</output>;
}

function SaveProbe() {
  const workspace = usePaperTalk();
  return (
    <button
      disabled={!workspace?.report}
      onClick={() => {
        if (!workspace) return;
        workspace.update({ ...workspace.draft, brief: { ...workspace.draft.brief, intent: 'A saved edit' } });
        void workspace.save();
      }}
    >
      Save report
    </button>
  );
}

function renderHistory(path = '/conversation/short-id', withEntry = false, withProvider = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
        <MemoryRouter initialEntries={[path]}>
          <PaperTalkHistory collapsed={false} />
          {withEntry && (
            <LayoutContext.Provider value={{ isMobile: false, siderCollapsed: true, setSiderCollapsed }}>
              <Routes>
                <Route path='/paper-talk' element={<PaperTalkEntry />} />
                {withProvider && (
                  <Route
                    path='/conversation/short-id'
                    element={
                      <PaperTalkProvider reportId={report.id}>
                        <SaveProbe />
                      </PaperTalkProvider>
                    }
                  />
                )}
                <Route path='/conversation/:id' element={null} />
              </Routes>
            </LayoutContext.Provider>
          )}
          <Location />
        </MemoryRouter>
      </SWRConfig>
    </I18nextProvider>
  );
}

const reportName = 'Few-shot segmentation';
const actionLabel = /Actions for Few-shot segmentation/i;

async function clickMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  const item = await screen.findByRole('menuitem', { name });
  // Arco suppresses pointer events until the opening animation completes.
  await waitFor(() => expect(getComputedStyle(item).pointerEvents).not.toBe('none'));
  await user.click(item);
}

beforeEach(() => {
  state = 'active';
  rejectMutation = false;
  onListChanged = undefined;
  deletePending = undefined;
  savePending = undefined;
  request.mockClear();
  closePreview.mockClear();
  setSiderCollapsed.mockClear();
  vi.stubGlobal('fetch', request);
  listChanged.mockImplementation((handler: () => void) => {
    onListChanged = handler;
    return () => {
      onListChanged = undefined;
    };
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PaperTalk history', () => {
  it('opens a fresh conversation and resumes an existing report by its readable topic', async () => {
    const user = userEvent.setup();
    renderHistory();
    expect(await screen.findByRole('button', { name: reportName })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('report-id')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/paper-talk?new=1');
    await user.click(screen.getByRole('button', { name: reportName }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/paper-talk?report=report-id');
    expect(closePreview).toHaveBeenCalled();
  });

  it('archives the current report through the keyboard menu and restores it without reopening it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('paper-talk.active', initialReport.id);
    renderHistory('/conversation/short-id', true);

    const actions = await screen.findByRole('button', { name: actionLabel });
    (await screen.findByRole('button', { name: reportName })).focus();
    await user.tab();
    expect(actions).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/paper-talk?history=active'));
    expect(localStorage.getItem('paper-talk.active')).toBeNull();
    expect(closePreview).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: reportName })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText(reportName)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: reportName })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Unarchive');
    await waitFor(() => expect(screen.queryByText(reportName)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Recent chats' }));
    expect(await screen.findByRole('button', { name: reportName })).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/paper-talk?history=active');
  });

  it('does not delete on cancel and removes a report after its named confirmation', async () => {
    const user = userEvent.setup();
    renderHistory('/conversation/some-other-chat');
    await user.click(await screen.findByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Delete');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(reportName);
    expect(dialog).toHaveTextContent(/linked conversation/i);
    expect(dialog).toHaveTextContent(/generated files will be kept/i);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: reportName })).toBeInTheDocument();
    expect(request.mock.calls.some(([, options]) => options.method === 'DELETE')).toBe(false);

    await user.click(screen.getByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Delete');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: reportName })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/conversation/some-other-chat');
  });

  it('keeps the current report and its remembered ID when archiving fails', async () => {
    const user = userEvent.setup();
    localStorage.setItem('paper-talk.active', initialReport.id);
    rejectMutation = true;
    renderHistory();

    await user.click(await screen.findByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Archive');
    expect(await screen.findByText(/Archive failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: reportName })).toHaveAttribute('aria-current', 'page');
    expect(localStorage.getItem('paper-talk.active')).toBe(initialReport.id);
  });

  it('prevents a duplicate delete while the first confirmation is pending', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<void>();
    deletePending = promise;
    state = 'archived';
    renderHistory('/paper-talk?history=archived');
    await user.click(await screen.findByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Delete');
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' });
    await user.click(confirm);
    await user.click(confirm);
    expect(request.mock.calls.filter(([, options]) => options.method === 'DELETE')).toHaveLength(1);
    resolve();
    await waitFor(() => expect(screen.queryByRole('button', { name: actionLabel })).not.toBeInTheDocument());
  });

  it('does not remember an archived report when its earlier save completes late', async () => {
    const user = userEvent.setup();
    const { promise, resolve } = Promise.withResolvers<Report>();
    savePending = promise;
    renderHistory('/conversation/short-id', true, true);
    const save = await screen.findByRole('button', { name: 'Save report' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('/api/paper-talk/report-id', expect.objectContaining({ method: 'PUT' }))
    );

    await user.click(await screen.findByRole('button', { name: actionLabel }));
    await clickMenuItem(user, 'Archive');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save report' })).not.toBeInTheDocument());
    await act(async () => resolve({ ...report, revision: 2 }));
    expect(localStorage.getItem('paper-talk.active')).toBeNull();
  });

  it('refreshes both history views when ordinary conversations change', async () => {
    const user = userEvent.setup();
    renderHistory('/conversation/some-other-chat');
    expect(await screen.findByRole('button', { name: reportName })).toBeInTheDocument();

    state = 'archived';
    act(() => emitter.emit('chat.history.refresh'));
    await waitFor(() => expect(screen.queryByRole('button', { name: reportName })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByText(reportName)).toBeInTheDocument();

    state = 'active';
    act(() => {
      onListChanged?.();
    });
    await waitFor(() => expect(screen.queryByText(reportName)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Recent chats' }));
    expect(await screen.findByRole('button', { name: reportName })).toBeInTheDocument();

    state = 'deleted';
    act(() => {
      onListChanged?.();
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: reportName })).not.toBeInTheDocument());
  });
});

describe('PaperTalk entry recovery', () => {
  it.each(['deleted', 'archived'] as const)('replaces an implicit %s report with a fresh chat', async (unavailable) => {
    state = unavailable;
    localStorage.setItem('paper-talk.active', initialReport.id);
    renderHistory('/paper-talk', true);
    await waitFor(() =>
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/conversation/fresh-conversation')
    );
    expect(localStorage.getItem('paper-talk.active')).toBe('fresh-id');
  });

  it('opens archived history from an explicit old link without creating a replacement', async () => {
    const user = userEvent.setup();
    state = 'archived';
    localStorage.setItem('paper-talk.active', initialReport.id);
    renderHistory('/paper-talk?report=report-id', true);
    await user.click(await screen.findByRole('button', { name: 'View archived chats' }));
    expect(await screen.findByText(reportName)).toBeInTheDocument();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/paper-talk?history=archived');
    expect(setSiderCollapsed).toHaveBeenCalledWith(false);
    expect(request.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });

  it('creates a replacement for an explicit deleted link only after the user asks', async () => {
    const user = userEvent.setup();
    state = 'deleted';
    renderHistory('/paper-talk?report=report-id', true);
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
    expect(request.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    await user.click(screen.getAllByRole('button', { name: 'New chat' })[1]);
    await waitFor(() =>
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/conversation/fresh-conversation')
    );
  });

  it('shows active history when starting a new chat from the archived landing', async () => {
    const user = userEvent.setup();
    renderHistory('/paper-talk?history=archived', true);
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getAllByRole('button', { name: 'New chat' })[1]);
    await waitFor(() =>
      expect(screen.getByLabelText('Current route')).toHaveTextContent('/conversation/fresh-conversation')
    );
    expect(screen.getByRole('button', { name: 'Recent chats' })).toHaveAttribute('aria-pressed', 'true');
  });
});

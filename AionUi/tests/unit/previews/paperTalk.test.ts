import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError, httpRequest } from '@/common/adapter/httpBridge';
import {
  cancelPending,
  ensureConversation,
  prepareJob,
  initialBrief,
  type Report,
} from '@/renderer/pages/conversation/PaperTalk/client';

vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  httpRequest: vi.fn(),
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
const request = vi.mocked(httpRequest);
const report: Report = {
  id: 'report',
  revision: 2,
  workspace: '/tmp/report',
  conversation: 'conversation',
  brief: initialBrief,
  papers: [],
  selected: [],
  outline: [],
  outline_current: false,
  deck: null,
  job: { id: 'job', stage: 'search', workspace: '/tmp/report/job', conversation: 'conversation', instruction: '' },
};

describe('Paper2Talk native conversation tasks', () => {
  beforeEach(() => request.mockReset());
  it('keeps the same conversation for subsequent stages', async () => {
    request.mockResolvedValueOnce({ runtime: { is_processing: false } }).mockResolvedValueOnce(report);
    expect(await ensureConversation(report, 'Report')).toBe(report);
    await prepareJob(report, 'outline', 'Use these papers');
    expect(request.mock.calls.map((c) => c[1])).toEqual([
      '/api/conversations/conversation',
      '/api/paper-talk/report/jobs',
    ]);
  });
  it('does not start a new task when cancelling the previous turn fails', async () => {
    request
      .mockResolvedValueOnce({ runtime: { turn_id: 'turn', is_processing: true } })
      .mockRejectedValueOnce(new Error('cancel failed'));
    await expect(prepareJob(report, 'revise', 'replace')).rejects.toThrow('cancel failed');
    expect(request.mock.calls.some((c) => c[1].endsWith('/jobs'))).toBe(false);
  });
  it('waits for cancellation before preparing a replacement task in the same conversation', async () => {
    request
      .mockResolvedValueOnce({ runtime: { turn_id: 'turn', is_processing: true } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ runtime: { is_processing: false } })
      .mockResolvedValueOnce(report);
    await prepareJob(report, 'revise', 'replace');
    expect(request.mock.calls[1]).toEqual(['POST', '/api/conversations/conversation/cancel', { turn_id: 'turn' }]);
    expect(request.mock.calls[3][1]).toBe('/api/paper-talk/report/jobs');
  });
  it('retains a completed conversation when changing the brief', async () => {
    request.mockResolvedValueOnce({ runtime: { is_processing: false } });
    await cancelPending(report);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('Paper2Talk conversation binding', () => {
  beforeEach(() => {
    request.mockReset();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [404, 'NOT_FOUND'],
    [410, 'CONVERSATION_ARCHIVED'],
  ])('cleans up the newly created conversation when binding rejects with %d', async (status, code) => {
    const unavailable = new BackendHttpError({
      method: 'POST',
      path: '/api/paper-talk/report/conversation',
      status,
      body: { code, error: 'Report unavailable' },
    });
    request.mockResolvedValueOnce({ id: 'empty-chat' }).mockRejectedValueOnce(unavailable).mockResolvedValueOnce(null);

    await expect(ensureConversation({ ...report, conversation: null }, 'Report')).rejects.toBe(unavailable);
    expect(request).toHaveBeenLastCalledWith('DELETE', '/api/conversations/empty-chat');
    expect(localStorage.getItem('paper-talk.binding.report')).toBeNull();
  });

  it('retries a staged conversation binding after an ambiguous failure', async () => {
    request
      .mockResolvedValueOnce({ id: 'previous-chat' })
      .mockRejectedValueOnce(new Error('Network disconnected'))
      .mockResolvedValueOnce({ ...report, conversation: 'previous-chat' });

    await expect(ensureConversation({ ...report, conversation: null }, 'Report')).rejects.toThrow(
      'Network disconnected'
    );
    const opened = await ensureConversation({ ...report, conversation: null }, 'Report');
    expect(opened.conversation).toBe('previous-chat');
    expect(request.mock.calls.map(([method, path]) => [method, path])).toEqual([
      ['POST', '/api/conversations'],
      ['POST', '/api/paper-talk/report/conversation'],
      ['POST', '/api/paper-talk/report/conversation'],
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpRequest } from '@/common/adapter/httpBridge';
import {
  cancelPending,
  ensureConversation,
  prepareJob,
  initialBrief,
  type Report,
} from '@/renderer/pages/conversation/PaperTalk/client';

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: vi.fn() }));
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

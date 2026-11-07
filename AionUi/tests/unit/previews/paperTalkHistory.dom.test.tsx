import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import PaperTalkHistory from '@/renderer/components/layout/Sider/SiderNav/PaperTalkHistory';

const { mutate, closePreview } = vi.hoisted(() => ({ mutate: vi.fn(), closePreview: vi.fn() }));
vi.mock('swr', () => ({
  default: () => ({
    data: [{ id: 'report-id', direction: 'Few-shot segmentation', conversation: 'short-id' }],
    mutate,
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/pages/conversation/PaperTalk/client', () => ({ listReports: vi.fn() }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ closePreview }) }));
afterEach(cleanup);

function Location() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}

describe('PaperTalk chat navigation', () => {
  it('opens a fresh conversation and resumes an existing report by its readable topic', () => {
    render(
      <MemoryRouter initialEntries={['/conversation/short-id']}>
        <PaperTalkHistory collapsed={false} />
        <Location />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Few-shot segmentation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('report-id')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.newConversation' }));
    expect(screen.getByRole('status')).toHaveTextContent('/paper-talk?new=1');
    fireEvent.click(screen.getByRole('button', { name: 'Few-shot segmentation' }));
    expect(screen.getByRole('status')).toHaveTextContent('/paper-talk?report=report-id');
    expect(closePreview).toHaveBeenCalled();
  });
});

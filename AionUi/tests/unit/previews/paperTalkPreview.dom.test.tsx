import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Preview from '@/renderer/pages/conversation/PaperTalk/components/Preview';
import DraftSlide from '@/renderer/pages/conversation/PaperTalk/components/DraftSlide';
import { initialBrief, type Report } from '@/renderer/pages/conversation/PaperTalk/client';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));
vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => 'http://localhost:1234' }));
vi.mock('@/common', () => ({ ipcBridge: { shell: { openFile: { invoke: vi.fn() } } } }));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers/PDFViewer', () => ({
  default: ({ content }: { content: string }) => <div data-testid='pdf'>{content}</div>,
}));
afterEach(cleanup);
const slides = ['First', 'Second'].map((title) => ({
  title,
  notes: 'Explain',
  body: 'Read',
  seconds: 50,
  evidence: [{ paper: 'p1', page: 5, label: 'Table 2' }],
  figure: null,
  table: [],
}));
const report: Report = {
  id: 'test',
  revision: 7,
  brief: initialBrief,
  papers: [
    {
      id: 'p1',
      title: 'Paper',
      pdf: '/one.pdf',
      doi: '',
      journal: '',
      date: '',
      ranking: '',
      source: '',
      ranking_source: '',
      version: 'published',
      role: '',
      finding: '',
    },
  ],
  selected: ['p1'],
  outline: slides,
  outline_current: true,
  deck: '/export.pptx',
  job: null,
};
describe('Paper2Talk side preview', () => {
  it('groups evidence pages under one paper title', () => {
    const choose = vi.fn();
    render(
      <Preview
        item={{ path: 'outline' }}
        report={report}
        slides={[
          {
            ...slides[0],
            evidence: [
              { paper: 'p1', page: 3, label: 'Figure' },
              { paper: 'p1', page: 5, label: 'Table' },
            ],
          },
        ]}
        style='international'
        inputs={[]}
        choose={choose}
        close={vi.fn()}
      />
    );
    expect(screen.getAllByText('Paper')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Paper · p.5' }));
    expect(choose).toHaveBeenCalledWith({ path: '/one.pdf', page: 5 });
  });
  it('previews evidence comparisons and original figure annotations from the saved design', () => {
    render(
      <DraftSlide
        classic={false}
        slide={{
          ...slides[0],
          figure: '/figure.png',
          design: {
            layout: 'evidence',
            subtitle: 'Same model and test set',
            key: '',
            points: [],
            comparisons: [],
            annotations: [{ label: 'Matched rows', rect: [0.1, 0.2, 0.8, 0.3] }],
            metrics: [
              {
                label: 'DSC',
                unit: '0–1',
                baseline_label: 'Point',
                baseline: 0.65,
                result_label: 'Mask3',
                result: 0.85,
                axis_max: 1,
                decimals: 2,
              },
            ],
          },
        }}
      />
    );
    expect(screen.getByText('Same model and test set')).toBeTruthy();
    expect(screen.getByText('Matched rows')).toBeTruthy();
    expect(screen.getByText('0.85')).toBeTruthy();
    expect(screen.getByText('+0.20')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
  });
  it('opens a cited PDF page and returns to the same slide without leaving the conversation', () => {
    function Workbench() {
      const [item, setItem] = React.useState({ path: '/export.pptx', page: 1 });
      return (
        <Preview
          report={report}
          slides={slides}
          inputs={[]}
          style='international'
          item={item}
          choose={(v) => setItem({ page: 1, ...v })}
          close={() => {}}
        />
      );
    }
    render(<Workbench />);
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.down' }));
    expect(screen.getByAltText('Second').getAttribute('src')).toContain('/preview/7/2');
    fireEvent.click(screen.getByRole('button', { name: /Paper · p.5/ }));
    expect(screen.getByTestId('pdf').textContent).toContain('#page=5');
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.viewDeck' }));
    expect(screen.getByAltText('Second').getAttribute('src')).toContain('/preview/7/2');
  });
  it('shows the edited outline before a deck exists', () => {
    render(
      <Preview
        report={{ ...report, deck: null }}
        slides={[{ ...slides[0], title: 'Edited title' }]}
        inputs={[]}
        style='domestic'
        item={null}
        choose={() => {}}
        close={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: 'Edited title' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.paperTalk.viewDeck' })).toBeNull();
  });
  it('keeps the confirmed slide and its revision available after changing the draft', () => {
    const revised: Report = {
      ...report,
      revision: 10,
      outline: [{ ...slides[0], title: 'New draft' }],
      deck: null,
      published: { path: '/talk.pptx', revision: 5, slides },
    };
    render(
      <Preview
        report={revised}
        slides={revised.outline}
        inputs={[]}
        style='international'
        item={{ path: '/talk.pptx', slide: 2 }}
        choose={() => {}}
        close={() => {}}
      />
    );
    expect(screen.getByAltText('Second').getAttribute('src')).toContain('/preview/5/2');
    expect(screen.queryByText('Explain')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.paperTalk.notes' }));
    expect(screen.getByText('Explain')).toBeTruthy();
  });
  it('opens the original PDF when the current selection reuses a paper ID', () => {
    const revised: Report = {
      ...report,
      deck: null,
      papers: [{ ...report.papers[0], title: 'Replacement', pdf: '/new.pdf' }],
      published: { path: '/talk.pptx', revision: 5, slides, papers: report.papers },
    };
    const choose = vi.fn();
    render(
      <Preview
        report={revised}
        slides={slides}
        inputs={[]}
        style='international'
        item={{ path: '/talk.pptx' }}
        choose={choose}
        close={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Paper · p.5/ }));
    expect(choose).toHaveBeenCalledWith({ path: '/one.pdf', page: 5 });
  });
  it('uses the historical card snapshot instead of the latest deck', () => {
    render(
      <Preview
        item={{ path: '/old.pptx', snapshot: { revision: 3, outline: [slides[0]], papers: report.papers } }}
        report={report}
        slides={slides}
        style='international'
        inputs={[]}
        choose={vi.fn()}
        close={vi.fn()}
      />
    );
    expect(document.querySelector('aside img')?.getAttribute('src')).toContain('/preview/3/1');
    expect(screen.queryByTestId('pdf')).toBeNull();
  });
});

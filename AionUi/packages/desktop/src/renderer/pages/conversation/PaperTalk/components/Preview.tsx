import React, { useState } from 'react';
import { Button, Empty, Select, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import PDFViewer from '../../Preview/components/viewers/PDFViewer';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { reportPath, type Report, type Slide } from '../client';
import DraftSlide from './DraftSlide';
import { buildStreamUrl } from '../../Preview/previewUrls';
import styles from '../PaperTalk.module.css';

export type PreviewItem = {
  path: string;
  page?: number;
  slide?: number;
  snapshot?: Pick<Report, 'revision' | 'outline' | 'papers'>;
};
type Props = {
  item: PreviewItem | null;
  report: Report | null;
  slides: Slide[];
  style: string;
  inputs: string[];
  choose: (item: PreviewItem) => void;
  close: () => void;
};
export default function Preview({ item, report, slides, style, inputs, choose, close }: Props) {
  const { t } = useTranslation();
  const tr = (k: string) => t(`common.paperTalk.${k}`);
  const [pageIndex, setPageIndex] = useState(0);
  const [failed, setFailed] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  React.useEffect(() => {
    if (item?.slide) setPageIndex(Math.max(0, item.slide - 1));
  }, [item]);
  const deck = report?.deck ?? report?.published?.path;
  const path = item?.path ?? (report?.deck || '');
  const isDeck = (Boolean(deck) && path === deck) || Boolean(item?.snapshot);
  const isPaper = !!path && !isDeck && path !== 'outline';
  const files = [
    ...new Set([...(report?.papers ?? []).map((p) => p.pdf).filter((p): p is string => Boolean(p)), ...inputs]),
  ];
  const citationPapers =
    item?.snapshot?.papers ??
    (isDeck && report?.published
      ? report.published.papers?.length
        ? report.published.papers
        : report.deck
          ? report.papers
          : []
      : (report?.papers ?? []));
  const shownSlides =
    item?.snapshot?.outline ?? (isDeck ? (report?.published?.slides ?? report?.outline ?? []) : slides);
  const index = Math.min(pageIndex, Math.max(0, shownSlides.length - 1));
  const slide = shownSlides[index];
  const page = index + 1;
  const url =
    isDeck && report
      ? getBaseUrl() +
        reportPath(report) +
        '/preview/' +
        (item?.snapshot?.revision ?? report.published?.revision ?? report.revision) +
        '/' +
        page
      : '';
  return (
    <aside className={styles.preview}>
      <header>
        <strong>{tr('preview')}</strong>
        <Button size='small' onClick={close}>
          {t('common.close')}
        </Button>
      </header>
      <div className={styles.actions}>
        {!!slides.length && (
          <Button
            size='small'
            type={!isDeck && !isPaper ? 'primary' : 'secondary'}
            onClick={() => choose({ path: 'outline' })}
          >
            {tr('draftPreview')}
          </Button>
        )}
        {deck && (
          <Button size='small' type={isDeck ? 'primary' : 'secondary'} onClick={() => choose({ path: deck })}>
            {tr(report?.deck ? 'viewDeck' : 'priorDeck')}
          </Button>
        )}
        {!!files.length && (
          <Select
            aria-label={tr('viewPaper')}
            style={{ maxWidth: 220 }}
            size='small'
            placeholder={tr('viewPaper')}
            value={isPaper ? path : undefined}
            options={files.map((f) => ({ value: f, label: f.split(/[/\\]/).pop() }))}
            onChange={(v) => choose({ path: v })}
          />
        )}
      </div>
      {isPaper ? (
        <div className={styles.viewer} key={path + ':' + (item?.page ?? 1)}>
          <PDFViewer
            file_path={path}
            content={buildStreamUrl({ kind: 'local', path }) + '#page=' + (item?.page ?? 1)}
            hideToolbar
          />
        </div>
      ) : slide ? (
        <div className={styles.slideArea}>
          <div className={styles.actions}>
            <Button size='mini' disabled={index === 0} aria-label={tr('up')} onClick={() => setPageIndex(index - 1)}>
              ←
            </Button>
            <span>
              {page} / {shownSlides.length}
            </span>
            <Button
              size='mini'
              disabled={page >= shownSlides.length}
              aria-label={tr('down')}
              onClick={() => setPageIndex(index + 1)}
            >
              →
            </Button>
          </div>
          {isDeck ? (
            <img className={styles.slideImage} alt={slide.title} src={url} onError={() => setFailed(url)} />
          ) : (
            <DraftSlide slide={slide} classic={style === 'domestic'} />
          )}
          {url && failed === url && <p role='alert'>{t('preview.ppt.startFailed')}</p>}
          <div className={styles.sources}>
            {citationPapers
              .filter((paper) => paper.pdf && slide.evidence.some((e) => e.paper === paper.id))
              .map((paper) => (
                <div className={styles.sourceGroup} key={paper.id}>
                  <span className={styles.sourceTitle} title={paper.title}>
                    {paper.title}
                  </span>
                  <div className={styles.sourcePages}>
                    {slide.evidence
                      .filter((e) => e.paper === paper.id)
                      .map((e, i) => (
                        <Button
                          type='text'
                          size='mini'
                          key={i}
                          className={styles.sourceButton}
                          title={e.label}
                          aria-label={`${paper.title} · p.${e.page}`}
                          onClick={() => choose({ path: paper.pdf!, page: e.page })}
                        >
                          p.{e.page}
                        </Button>
                      ))}
                  </div>
                </div>
              ))}
          </div>
          <div>
            <Button size='mini' aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)}>
              {tr('notes')}
            </Button>
          </div>
          {showNotes && <p className={styles.speakerNotes}>{slide.notes}</p>}
        </div>
      ) : (
        <Empty description={tr('previewHint')} />
      )}
      {(isPaper || isDeck) && (
        <Button onClick={() => void ipcBridge.shell.openFile.invoke(path).catch((e) => Message.error(String(e)))}>
          {tr('openFile')}
        </Button>
      )}
    </aside>
  );
}

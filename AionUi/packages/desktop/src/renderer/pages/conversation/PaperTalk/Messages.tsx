import React, { useState } from 'react';
import { Alert, Button, Checkbox, Tag } from '@arco-design/web-react';
import { BookOpen, FileText, Right, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { openExternalUrl } from '@/renderer/utils/platform';
import { usePaperTalk } from './context';
import { conversationCards, type ChoiceCard } from './client';
import Outline from './components/Outline';
import StyleGallery from './components/StyleGallery';
import choices from './components/Choices.module.css';
import styles from './PaperTalk.module.css';

export default function PaperTalkMessages({ welcomeOnly = false, card }: { welcomeOnly?: boolean; card?: ChoiceCard }) {
  const state = usePaperTalk();
  const { t } = useTranslation();
  const tr = (key: string) => t(`common.paperTalk.${key}`);
  const [editOutline, setEditOutline] = useState(false);
  if (!state) return null;
  const { report, draft, update, preview, busy, run, fail } = state;
  if (!report) return null;
  const papers = report.papers;
  if (welcomeOnly) {
    if (busy || report.job || report.turns?.length || draft.brief.direction || papers.length || draft.outline.length)
      return null;
    return (
      <section className={styles.messages} aria-label={tr('title')}>
        <div className={styles.welcome}>
          <div className={styles.welcomeMark}>
            <BookOpen size={28} fill='currentColor' />
          </div>
          <h2>{tr('intro')}</h2>
          <p>{tr('chatHint')}</p>
          <div className={styles.startingPoints}>
            <div>
              <Search size={18} fill='currentColor' />
              <strong>{tr('startDirection')}</strong>
              <span>{tr('startDirectionHint')}</span>
            </div>
            <div>
              <FileText size={18} fill='currentColor' />
              <strong>{tr('startPapers')}</strong>
              <span>{tr('startPapersHint')}</span>
            </div>
          </div>
        </div>
      </section>
    );
  }
  if (!card)
    return state.error ? (
      <Alert type='error' content={tr('actionFailed')} />
    ) : state.needsConfirmation ? (
      <p role='status'>{tr('needsConfirmation')}</p>
    ) : null;
  const latest = conversationCards(report).at(-1)?.id === card.id;
  const active =
    latest &&
    !report.job &&
    (card.kind !== 'outline' || report.outline_current) &&
    card.brief.direction === report.brief.direction;
  const selected = latest ? draft.selected : card.selected;
  const slides = latest ? draft.outline : card.outline;
  const disabled = !active || busy;
  const choose = (id: string, include: boolean) =>
    update({
      ...draft,
      selected: include ? [...new Set([...draft.selected, id])] : draft.selected.filter((v) => v !== id),
    });
  if (card.kind === 'deck')
    return (
      <section className={choices.attachment} data-testid='paper-talk-card-deck' data-card-id={card.id}>
        <Button
          type='text'
          className={choices.fileButton}
          aria-label={tr('viewDeck')}
          onClick={() =>
            preview({
              path: card.deck!,
              snapshot: { revision: card.revision, outline: card.outline, papers: card.papers },
            })
          }
        >
          <span className={choices.fileIcon}>
            <FileText size={22} />
          </span>
          <span className={choices.fileInfo}>
            <strong>{card.brief.direction}.pptx</strong>
            <span className={choices.hint}>
              {t('common.paperTalk.pageCount', { count: card.outline.length })} · {tr(`styleNames.${card.brief.style}`)}
            </span>
          </span>
          <Right size={16} />
        </Button>
      </section>
    );
  return (
    <div
      className={card.kind === 'papers' ? choices.card : choices.cardGroup}
      data-testid={`paper-talk-card-${card.kind}`}
      data-card-id={card.id}
    >
      {card.kind === 'papers' && (
        <>
          <div className={choices.heading}>
            <h3>{tr('choosePapers')}</h3>
          </div>
          <p className={choices.hint}>
            {t('common.paperTalk.selectionCount', { count: selected.length, total: card.brief.count })}
          </p>
          <div className={choices.paperList}>
            {card.papers.map((paper, index) => (
              <article key={paper.id} className={choices.paper} data-selected={selected.includes(paper.id)}>
                <Checkbox
                  checked={selected.includes(paper.id)}
                  disabled={disabled}
                  onChange={(v) => choose(paper.id, v)}
                >
                  <strong>
                    {index + 1}. {paper.title}
                  </strong>
                </Checkbox>
                <div className={choices.tags}>
                  {[
                    paper.date,
                    paper.journal,
                    paper.ranking || tr('rankingUnverified'),
                    paper.pdf ? tr('available') : tr('abstract'),
                  ]
                    .filter(Boolean)
                    .map((tag, i) => (
                      <Tag key={i} size='small'>
                        {tag}
                      </Tag>
                    ))}
                </div>
                <p>{paper.finding}</p>
                <p className={choices.hint}>{paper.role}</p>
                <div className={choices.actions}>
                  {paper.pdf && (
                    <Button size='mini' onClick={() => preview({ path: paper.pdf! })}>
                      {tr('viewPaper')}
                    </Button>
                  )}
                  {/^https?:\/\//i.test(paper.source) && (
                    <Button size='mini' onClick={() => void openExternalUrl(paper.source).catch(fail)}>
                      {tr('source')}
                    </Button>
                  )}
                  {/^https?:\/\//i.test(paper.ranking_source) && (
                    <Button size='mini' onClick={() => void openExternalUrl(paper.ranking_source).catch(fail)}>
                      {tr('ranking')}
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {active && (
            <Button
              type='primary'
              disabled={disabled || !selected.length}
              onClick={() =>
                void run(
                  'outline',
                  t('common.paperTalk.confirmPapers', {
                    numbers: card.papers.flatMap((p, i) => (selected.includes(p.id) ? [i + 1] : [])).join('、'),
                  })
                )
              }
            >
              {tr('confirmSelection')}
            </Button>
          )}
        </>
      )}
      {card.kind === 'outline' && (
        <>
          <section className={choices.card} aria-label={tr('outline')}>
            <div className={choices.heading}>
              <h3>{tr('outline')}</h3>
            </div>
            {editOutline && active ? (
              <Outline
                slides={slides}
                papers={papers}
                change={(outline) => update({ ...draft, outline })}
                preview={preview}
              />
            ) : (
              <ol className={choices.outline}>
                {slides.map((slide, index) => (
                  <li key={index}>{slide.title}</li>
                ))}
              </ol>
            )}
            {active && (
              <div className={choices.actions}>
                <Button size='small' onClick={() => setEditOutline(!editOutline)}>
                  {tr(editOutline ? 'collapse' : 'editOutline')}
                </Button>
                <Button size='small' onClick={() => preview({ path: 'outline' })}>
                  {tr('draftPreview')}
                </Button>
              </div>
            )}
          </section>
          <section className={choices.card} aria-label={tr('chooseStyle')}>
            <div className={choices.heading}>
              <h3>{tr('chooseStyle')}</h3>
            </div>
            <StyleGallery
              value={latest ? draft.brief.style : card.brief.style}
              disabled={disabled}
              change={(style) => update({ ...draft, brief: { ...draft.brief, style } })}
            />
          </section>
        </>
      )}
    </div>
  );
}

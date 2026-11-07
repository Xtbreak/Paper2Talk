import React from 'react';
import { Button, Input, InputNumber } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { Paper, Slide } from '../client';
import type { PreviewItem } from './Preview';
import { buildStreamUrl } from '../../Preview/previewUrls';
import styles from '../PaperTalk.module.css';

export default function Outline({
  slides,
  papers,
  change,
  preview,
}: {
  slides: Slide[];
  papers: Paper[];
  change: (slides: Slide[]) => void;
  preview: (item: PreviewItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {slides.map((s, i) => {
        const set = (patch: Partial<Slide>) =>
          change(slides.map((slide, n) => (n === i ? { ...slide, ...patch } : slide)));
        const move = (to: number) => {
          const next = [...slides];
          next.splice(to, 0, ...next.splice(i, 1));
          change(next);
        };
        return (
          <article className={styles.card} key={i}>
            <header>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <div>
                <Button size='mini' disabled={!i} aria-label={t('common.paperTalk.up')} onClick={() => move(i - 1)}>
                  ↑
                </Button>
                <Button
                  size='mini'
                  disabled={i + 1 === slides.length}
                  aria-label={t('common.paperTalk.down')}
                  onClick={() => move(i + 1)}
                >
                  ↓
                </Button>
                <Button
                  size='mini'
                  disabled={slides.length === 1}
                  onClick={() => change(slides.filter((_, n) => n !== i))}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </header>
            <label>
              {t('common.paperTalk.slideTitle')}
              <Input value={s.title} onChange={(title) => set({ title })} />
            </label>
            <label>
              {t('common.paperTalk.body')}
              <Input.TextArea value={s.body} autoSize onChange={(body) => set({ body })} />
            </label>
            {!!s.table?.length && (
              <div className={styles.tableScroll}>
                <table>
                  <tbody>
                    {s.table.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>
                            <Input
                              aria-label={row[0] + ' · ' + s.table![0][ci]}
                              value={cell}
                              onChange={(v) =>
                                set({
                                  table: s.table!.map((r, n) =>
                                    n === ri ? r.map((value, k) => (k === ci ? v : value)) : r
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.figure && (
              <img
                className={styles.figure}
                src={buildStreamUrl({ kind: 'local', path: s.figure })}
                alt={s.evidence.map((e) => e.label).join(' / ')}
              />
            )}
            {s.evidence.map((e, n) => {
              const p = papers.find((p) => p.id === e.paper);
              return (
                p?.pdf && (
                  <Button size='mini' key={n} onClick={() => preview({ path: p.pdf!, page: e.page })}>
                    {p.title} · p.{e.page} {e.label}
                  </Button>
                )
              );
            })}
            <label>
              {t('common.paperTalk.notes')}
              <Input.TextArea value={s.notes} autoSize onChange={(notes) => set({ notes })} />
            </label>
            <label>
              {t('common.paperTalk.seconds')}
              <InputNumber min={1} value={s.seconds} onChange={(seconds) => set({ seconds })} />
            </label>
          </article>
        );
      })}
    </>
  );
}

import React from 'react';
import type { Slide } from '../client';
import { buildStreamUrl } from '../../Preview/previewUrls';
import styles from '../PaperTalk.module.css';
import DesignedSlide from './DesignedSlide';

export default function DraftSlide({ slide, classic }: { slide: Slide; classic: boolean }) {
  if (slide.design) return <DesignedSlide slide={slide} design={slide.design} classic={classic} />;
  return (
    <article className={classic ? styles.classicSlide : styles.draftSlide}>
      <h3>{slide.title}</h3>
      <div
        className={styles.draftContent}
        data-layout={slide.figure ? (slide.table?.length ? 'evidence' : 'figure') : 'text'}
      >
        <p>{slide.body}</p>
        <div className={styles.draftVisual}>
          {slide.table?.length ? (
            <table>
              <tbody>
                {slide.table.map((row, i) => (
                  <tr key={i}>{row.map((v, n) => (i === 0 ? <th key={n}>{v}</th> : <td key={n}>{v}</td>))}</tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {slide.figure && (
            <img
              src={buildStreamUrl({ kind: 'local', path: slide.figure })}
              alt={slide.evidence.map((e) => e.label).join(' / ')}
            />
          )}
        </div>
      </div>
      <small>{slide.evidence.map((e) => e.paper + ' · p.' + e.page + ' ' + e.label).join(' / ')}</small>
    </article>
  );
}

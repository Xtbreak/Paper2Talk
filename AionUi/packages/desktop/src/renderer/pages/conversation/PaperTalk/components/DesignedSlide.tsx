import React from 'react';
import type { Slide, SlideDesign } from '../client';
import { buildStreamUrl } from '../../Preview/previewUrls';
import styles from '../PaperTalk.module.css';

export default function DesignedSlide({
  slide,
  design,
  classic,
}: {
  slide: Slide;
  design: SlideDesign;
  classic: boolean;
}) {
  return (
    <article
      className={`${classic ? styles.classicSlide : styles.draftSlide} ${styles.designedSlide}`}
      data-design={design.layout}
    >
      <header>
        <h3>{slide.title}</h3>
        <p className={styles.designSubtitle}>{design.subtitle}</p>
      </header>
      <div className={styles.designComposition}>
        {(slide.figure || !!slide.table?.length) && (
          <div className={styles.designSource}>
            {slide.figure && (
              <div className={styles.annotatedFigure}>
                <img
                  src={buildStreamUrl({ kind: 'local', path: slide.figure })}
                  alt={slide.evidence.map((e) => e.label).join(' / ')}
                />
                {design.annotations.map((a, index) => (
                  <span
                    key={index}
                    className={styles.figureAnnotation}
                    style={{
                      left: `${a.rect[0] * 100}%`,
                      top: `${a.rect[1] * 100}%`,
                      width: `${a.rect[2] * 100}%`,
                      height: `${a.rect[3] * 100}%`,
                    }}
                    title={a.label}
                  >
                    <b>{String(index + 1).padStart(2, '0')}</b>
                  </span>
                ))}
              </div>
            )}
            {!!slide.table?.length && (
              <table>
                <tbody>
                  {slide.table.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (i === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!!design.annotations.length && (
              <div className={styles.annotationLegend}>
                {design.annotations.map((a, i) => (
                  <span key={i}>
                    {String(i + 1).padStart(2, '0')} <span>{a.label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {(design.key || design.points.length > 0) && (
          <div className={styles.designExplanations}>
            {design.key && <strong className={styles.designKey}>{design.key}</strong>}
            {design.points.map((point, i) => (
              <section key={i}>
                <h4>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {point.title}
                </h4>
                <p>{point.text}</p>
              </section>
            ))}
          </div>
        )}
        {!!design.comparisons.length && (
          <div className={styles.designComparisons}>
            {design.comparisons.map((row, i) => (
              <div key={i}>
                <b>
                  {String(i + 1).padStart(2, '0')} {row.label}
                </b>
                <span>{row.baseline}</span>
                <strong>{row.change}</strong>
                <span>{row.effect}</span>
              </div>
            ))}
          </div>
        )}
        {!!design.metrics.length && (
          <div className={styles.designMetrics}>
            {design.metrics.map((m, i) => (
              <section key={i}>
                <h4>
                  {m.label} · {m.unit}
                </h4>
                {[
                  [m.baseline_label, m.baseline],
                  [m.result_label, m.result],
                ].map(([label, value], j) => (
                  <div className={styles.metricBar} data-result={j === 1} key={j}>
                    <span>{label}</span>
                    <div>
                      <i style={{ width: `${(Number(value) / m.axis_max) * 100}%` }} />
                    </div>
                    <b>{Number(value).toFixed(m.decimals)}</b>
                  </div>
                ))}
                <strong className={styles.metricDelta}>
                  {m.result - m.baseline >= 0 ? '+' : ''}
                  {(m.result - m.baseline).toFixed(m.decimals)}
                </strong>
                <span>{m.unit}</span>
              </section>
            ))}
          </div>
        )}
      </div>
      <p className={styles.designTakeaway}>{slide.body}</p>
      <small>{slide.evidence.map((e) => e.paper + ' · p.' + e.page + ' ' + e.label).join(' / ')}</small>
    </article>
  );
}

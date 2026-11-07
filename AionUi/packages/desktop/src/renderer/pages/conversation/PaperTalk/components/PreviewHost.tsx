import React from 'react';
import { usePaperTalk } from '../context';
import Preview from './Preview';

export default function PreviewHost() {
  const state = usePaperTalk();
  if (!state) return null;
  const { report, draft, item, preview, togglePreview } = state;
  return (
    <Preview
      report={report}
      slides={draft.outline}
      style={draft.brief.style}
      inputs={draft.brief.inputs}
      item={item ?? (report?.deck ? { path: report.deck } : draft.outline.length ? { path: 'outline' } : null)}
      choose={preview}
      close={() => togglePreview(false)}
    />
  );
}

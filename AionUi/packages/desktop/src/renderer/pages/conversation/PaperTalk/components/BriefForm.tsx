import { Button, Checkbox, Input, InputNumber, Select } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { Brief } from '../client';
import styles from '../PaperTalk.module.css';

export default function BriefForm({
  brief,
  change,
  preview,
  failure,
}: {
  brief: Brief;
  change: (value: Brief) => void;
  preview: (path: string) => void;
  failure: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof Brief>(key: K, value: Brief[K]) => change({ ...brief, [key]: value });
  const pick = async () => {
    const files = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (files?.length) set('inputs', [...new Set([...brief.inputs, ...files])]);
  };
  return (
    <div className={styles.fields}>
      <label>
        {t('common.paperTalk.direction')}
        <Input
          value={brief.direction}
          onChange={(v) => set('direction', v)}
          placeholder={t('common.paperTalk.directionExample')}
        />
      </label>
      <label>
        {t('common.paperTalk.intent')}
        <Input.TextArea
          placeholder={t('common.paperTalk.intentPrompt', { direction: brief.direction })}
          autoSize
          value={brief.intent}
          onChange={(v) => set('intent', v)}
        />
      </label>
      <div className={styles.row}>
        <label>
          {t('common.paperTalk.count')}
          <InputNumber min={1} max={20} value={brief.count} onChange={(v) => set('count', v)} />
        </label>
        <label>
          {t('common.paperTalk.minutes')}
          <InputNumber min={1} max={180} value={brief.minutes} onChange={(v) => set('minutes', v)} />
        </label>
        <label>
          {t('common.paperTalk.months')}
          <InputNumber min={1} max={120} value={brief.months} onChange={(v) => set('months', v)} />
        </label>
        <label>
          {t('common.paperTalk.region')}
          <Select
            value={brief.region}
            onChange={(v) => set('region', v)}
            options={['international', 'domestic', 'all'].map((v) => ({ value: v, label: t(`common.paperTalk.${v}`) }))}
          />
        </label>
      </div>
      <Checkbox checked={brief.strict_quartile} onChange={(v) => set('strict_quartile', v)}>
        {t('common.paperTalk.strict')}
      </Checkbox>
      <div>
        <Button onClick={() => void pick().catch(failure)}>{t('common.paperTalk.addPdf')}</Button>
      </div>
      {brief.inputs.map((path) => (
        <div key={path} className={styles.fileRow}>
          <Button type='text' onClick={() => preview(path)}>
            {path.split(/[/\\]/).pop()}
          </Button>
          <Button
            size='mini'
            onClick={() =>
              set(
                'inputs',
                brief.inputs.filter((f) => f !== path)
              )
            }
          >
            {t('common.delete')}
          </Button>
        </div>
      ))}
    </div>
  );
}

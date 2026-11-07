import React, { useState } from 'react';
import { Button, Collapse, Input, Modal } from '@arco-design/web-react';
import { PreviewOpen, SettingConfig } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePaperTalk } from './context';
import { readSources } from './client';
import BriefForm from './components/BriefForm';
import styles from './PaperTalk.module.css';

export default function PaperTalkHeader() {
  const state = usePaperTalk();
  const { t } = useTranslation();
  const tr = (key: string) => t(`common.paperTalk.${key}`);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState(readSources);
  if (!state) return null;
  return (
    <>
      <Button
        className={styles.toolbarButton}
        size='small'
        type={state.previewOpen ? 'secondary' : 'text'}
        icon={<PreviewOpen size={16} fill='currentColor' />}
        aria-expanded={state.previewOpen}
        onClick={() => state.togglePreview(!state.previewOpen)}
      >
        {tr('preview')}
      </Button>
      <Button
        className={styles.toolbarButton}
        size='small'
        type='text'
        icon={<SettingConfig size={16} fill='currentColor' />}
        onClick={() => setOpen(true)}
      >
        {tr('reportOptions')}
      </Button>
      <Modal title={tr('reportOptions')} visible={open} onCancel={() => setOpen(false)} footer={null}>
        <div className={styles.fields}>
          <BriefForm
            brief={state.draft.brief}
            change={(brief) => state.update({ ...state.draft, brief })}
            preview={(path) => state.preview({ path })}
            failure={state.fail}
          />
          {state.dirty && (
            <Button type='primary' loading={state.busy} onClick={() => void state.save()}>
              {t('common.save')}
            </Button>
          )}
          {state.error && <p role='alert'>{state.error}</p>}
          <Collapse bordered={false}>
            <Collapse.Item name='sources' header={tr('sources')}>
              <div className={styles.fields}>
                <p>{tr('sourcesHint')}</p>
                {(['discovery', 'fulltext', 'ranking'] as const).map((key) => (
                  <label key={key}>
                    {tr(key)}
                    <Input
                      value={sources[key]}
                      placeholder={tr('mcpId')}
                      onChange={(v) => {
                        const next = { ...sources, [key]: v };
                        setSources(next);
                        localStorage.setItem('paper-talk.sources', JSON.stringify(next));
                      }}
                    />
                  </label>
                ))}
                <p>{tr('sourcesNextChat')}</p>
                <Button onClick={() => void navigate('/settings/tools')}>{tr('manageTools')}</Button>
              </div>
            </Collapse.Item>
            {!!state.report?.turns?.length && (
              <Collapse.Item name='decisions' header={tr('savedDecisions')}>
                {state.report.turns.map((turn, index) => (
                  <div key={index} className={styles.savedTurn}>
                    <strong>{turn.user}</strong>
                    <p>{turn.answer}</p>
                  </div>
                ))}
              </Collapse.Item>
            )}
          </Collapse>
        </div>
      </Modal>
    </>
  );
}

import React, { useEffect } from 'react';
import { Alert, Button, Spin, Tooltip } from '@arco-design/web-react';
import { BookOpen, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { listReports } from '@/renderer/pages/conversation/PaperTalk/client';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import styles from '../Sider.module.css';

export default function PaperTalkHistory({
  collapsed,
  onSessionClick,
}: {
  collapsed: boolean;
  onSessionClick?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { closePreview } = usePreviewContext();
  const { data, error, mutate } = useSWR('paper-talk.history', listReports);
  useEffect(() => {
    void mutate();
  }, [pathname, mutate]);
  const open = (target: string) => {
    closePreview();
    void navigate(target);
    onSessionClick?.();
  };
  return (
    <div className={styles.reportNavigation}>
      <Tooltip content={t('common.paperTalk.newConversation')} disabled={!collapsed} position='right'>
        <Button
          type='primary'
          long
          className={styles.newReport}
          icon={<Plus size={18} fill='currentColor' />}
          aria-label={t('common.paperTalk.newConversation')}
          onClick={() => open('/paper-talk?new=1')}
        >
          {!collapsed && t('common.paperTalk.newConversation')}
        </Button>
      </Tooltip>
      {!collapsed && <div className={styles.historyHeading}>{t('common.paperTalk.history')}</div>}
      <nav className={styles.reportList} aria-label={t('common.paperTalk.history')}>
        {error && <Alert type='error' content={String(error)} />}
        {!data && !error && <Spin />}
        {data?.length === 0 && !collapsed && (
          <p className={styles.historyEmpty}>{t('common.paperTalk.historyEmpty')}</p>
        )}
        {data?.map((report) => {
          const title = report.direction || t('common.paperTalk.untitled');
          const active = pathname === '/conversation/' + report.conversation;
          return (
            <Tooltip key={report.id} content={title} position='right'>
              <Button
                type='text'
                className={styles.reportRow}
                data-active={active}
                aria-current={active ? 'page' : undefined}
                aria-label={title}
                icon={<BookOpen size={16} fill='currentColor' />}
                onClick={() => open('/paper-talk?report=' + report.id)}
              >
                {!collapsed && <span className={styles.reportName}>{title}</span>}
              </Button>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}

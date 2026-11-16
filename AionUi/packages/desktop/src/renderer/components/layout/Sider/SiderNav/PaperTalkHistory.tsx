import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Menu, Modal, Spin, Tooltip } from '@arco-design/web-react';
import { BookOpen, Inbox, MoreOne, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import {
  forgetActiveReport,
  listReports,
  updateReportHistory,
  type ReportHistoryAction,
  type ReportSummary,
} from '@/renderer/pages/conversation/PaperTalk/client';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import styles from '../Sider.module.css';

const actionErrorKeys = {
  archive: 'conversation.history.archiveFailed',
  unarchive: 'settings.archived.restoreFailed',
  delete: 'settings.archived.deleteFailed',
} as const;

function focusFirstMenuItem(node: HTMLDivElement | null) {
  node?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

function activateMenuItem(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.currentTarget.click();
  }
}

export default function PaperTalkHistory({
  collapsed,
  onSessionClick,
}: {
  collapsed: boolean;
  onSessionClick?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { closePreview } = usePreviewContext();
  const latestLocation = useRef(location);
  const [archived, setArchived] = useState(() => new URLSearchParams(location.search).get('history') === 'archived');
  const [openMenuId, setOpenMenuId] = useState<string>();
  const [deleteReport, setDeleteReport] = useState<ReportSummary>();
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string }>();
  const inFlight = useRef(new Set<string>());
  const [busyReports, setBusyReports] = useState<ReadonlySet<string>>(inFlight.current);
  const activeHistory = useSWR('paper-talk.history', () => listReports());
  const archivedHistory = useSWR('paper-talk.history.archived', () => listReports(true));
  const { mutate: mutateActive } = activeHistory;
  const { mutate: mutateArchived } = archivedHistory;
  const { data, error } = archived ? archivedHistory : activeHistory;

  const refresh = useCallback(() => {
    void Promise.allSettled([mutateActive(), mutateArchived()]);
  }, [mutateActive, mutateArchived]);
  useLayoutEffect(() => {
    latestLocation.current = location;
  }, [location]);
  useEffect(() => {
    if (location.pathname === '/paper-talk') {
      const params = new URLSearchParams(location.search);
      const view = params.get('history');
      if (view === 'active' || view === 'archived' || params.has('new')) setArchived(view === 'archived');
    }
    refresh();
  }, [location.key, location.pathname, location.search, refresh]);
  useEffect(() => {
    const unsubscribeRefresh = addEventListener('chat.history.refresh', refresh);
    const unsubscribeListChanged = ipcBridge.conversation.listChanged.on(refresh);
    return () => {
      unsubscribeRefresh();
      unsubscribeListChanged();
    };
  }, [refresh]);

  const titleOf = (report: ReportSummary) => report.direction || t('common.paperTalk.untitled');
  const switchView = (value: boolean) => {
    setFeedback(undefined);
    setOpenMenuId(undefined);
    setArchived(value);
  };
  const open = (target: string) => {
    closePreview();
    void navigate(target);
    onSessionClick?.();
  };
  const newReport = () => {
    switchView(false);
    open('/paper-talk?new=1');
  };
  const runAction = async (report: ReportSummary, action: ReportHistoryAction) => {
    if (inFlight.current.has(report.id)) return;
    inFlight.current.add(report.id);
    setBusyReports(new Set(inFlight.current));
    setFeedback(undefined);
    try {
      await updateReportHistory(report.id, action);
      if (action === 'archive') setFeedback({ type: 'success', message: t('conversation.history.archiveSuccess') });
      if (action === 'delete') setDeleteReport(undefined);
      if (action !== 'unarchive') {
        forgetActiveReport(report.id);
        localStorage.removeItem('paper-talk.preview.' + report.id);
        const { pathname, search } = latestLocation.current;
        const isCurrentConversation = report.conversation && pathname === '/conversation/' + report.conversation;
        const isCurrentReport = pathname === '/paper-talk' && new URLSearchParams(search).get('report') === report.id;
        if (isCurrentConversation || isCurrentReport) {
          closePreview();
          void navigate('/paper-talk?history=active', { replace: true });
          onSessionClick?.();
        }
      }

      // Remove the row from its old view even if revalidating the list fails.
      // Re-fetch both views to retain the server's ordering and other changes.
      const remove = (rows?: ReportSummary[]) => rows?.filter((row) => row.id !== report.id);
      await Promise.allSettled([
        action === 'unarchive' ? mutateActive() : mutateActive(remove),
        action === 'archive' ? mutateArchived() : mutateArchived(remove),
      ]);
      emitter.emit('chat.history.refresh');
    } catch {
      setFeedback({ type: 'error', message: t(actionErrorKeys[action]) });
    } finally {
      inFlight.current.delete(report.id);
      setBusyReports(new Set(inFlight.current));
    }
  };

  const archivedLabel = t('settings.archived.title');
  const historyLabel = t('common.paperTalk.history');
  const viewLabel = archived ? archivedLabel : historyLabel;
  const deleting = deleteReport !== undefined && busyReports.has(deleteReport.id);
  return (
    <div className={styles.reportNavigation} data-collapsed={collapsed}>
      <Tooltip content={t('common.paperTalk.newConversation')} disabled={!collapsed} position='right'>
        <Button
          type='primary'
          long
          className={styles.newReport}
          icon={<Plus size={18} fill='currentColor' />}
          aria-label={t('common.paperTalk.newConversation')}
          onClick={newReport}
        >
          {!collapsed && t('common.paperTalk.newConversation')}
        </Button>
      </Tooltip>
      <div className={styles.historyViews}>
        {collapsed ? (
          <Tooltip content={archived ? historyLabel : archivedLabel} position='right'>
            <Button
              type='text'
              aria-label={archivedLabel}
              aria-pressed={archived}
              icon={<Inbox size={16} fill='currentColor' />}
              onClick={() => switchView(!archived)}
            />
          </Tooltip>
        ) : (
          <Button.Group>
            <Button
              size='small'
              type={archived ? 'text' : 'secondary'}
              aria-pressed={!archived}
              onClick={() => switchView(false)}
            >
              {historyLabel}
            </Button>
            <Button
              size='small'
              type={archived ? 'secondary' : 'text'}
              aria-pressed={archived}
              onClick={() => switchView(true)}
            >
              {archivedLabel}
            </Button>
          </Button.Group>
        )}
      </div>
      <nav className={styles.reportList} aria-label={viewLabel}>
        {feedback && !deleteReport && (
          <Alert type={feedback.type} content={feedback.message} closable onClose={() => setFeedback(undefined)} />
        )}
        {error && (
          <Alert
            type='error'
            content={t('common.paperTalk.historyLoadFailed')}
            action={
              <Button type='text' size='mini' onClick={refresh}>
                {t('common.retry')}
              </Button>
            }
          />
        )}
        {!data && !error && <Spin />}
        {data?.length === 0 && !collapsed && (
          <p className={styles.historyEmpty}>
            {archived ? t('settings.archived.empty') : t('common.paperTalk.historyEmpty')}
          </p>
        )}
        {data?.map((report) => {
          const title = titleOf(report);
          const active =
            !archived && !!report.conversation && location.pathname === '/conversation/' + report.conversation;
          const busy = busyReports.has(report.id);
          const menuOpen = openMenuId === report.id;
          const actionLabel = t('common.paperTalk.historyActions', { name: title });
          return (
            <div key={report.id} className={styles.reportItem} data-active={active}>
              <Tooltip content={title} position='right'>
                {archived ? (
                  <div className={styles.archivedReportTitle}>
                    <BookOpen size={16} fill='currentColor' aria-hidden />
                    {!collapsed && <span className={styles.reportName}>{title}</span>}
                  </div>
                ) : (
                  <Button
                    type='text'
                    className={styles.reportRow}
                    aria-current={active ? 'page' : undefined}
                    aria-label={title}
                    icon={<BookOpen size={16} fill='currentColor' />}
                    disabled={busy}
                    onClick={() => open('/paper-talk?report=' + encodeURIComponent(report.id))}
                  >
                    {!collapsed && <span className={styles.reportName}>{title}</span>}
                  </Button>
                )}
              </Tooltip>
              <Dropdown
                trigger='click'
                position='br'
                popupVisible={menuOpen}
                onVisibleChange={(visible) =>
                  setOpenMenuId((id) => (visible ? report.id : id === report.id ? undefined : id))
                }
                disabled={busy}
                droplist={
                  <Menu
                    ref={focusFirstMenuItem}
                    aria-label={actionLabel}
                    onKeyDown={(event) => {
                      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
                      const focused = items.indexOf(document.activeElement as HTMLElement);
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const step = event.key === 'ArrowDown' ? 1 : -1;
                        items[(focused + step + items.length) % items.length]?.focus();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        document.getElementById('report-actions-' + report.id)?.focus();
                        setOpenMenuId(undefined);
                      }
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        setOpenMenuId((id) => (id === report.id ? undefined : id));
                      }
                    }}
                    onClickMenuItem={(key) => {
                      if (key === 'delete') {
                        setFeedback(undefined);
                        setDeleteReport(report);
                      } else {
                        void runAction(report, archived ? 'unarchive' : 'archive');
                      }
                    }}
                  >
                    <Menu.Item key='move' onKeyDown={activateMenuItem}>
                      {t(archived ? 'settings.archived.restore' : 'conversation.history.archive')}
                    </Menu.Item>
                    <Menu.Item key='delete' className={styles.deleteReportAction} onKeyDown={activateMenuItem}>
                      {t('common.delete')}
                    </Menu.Item>
                  </Menu>
                }
              >
                <Button
                  id={'report-actions-' + report.id}
                  type='text'
                  size='small'
                  className={styles.reportActions}
                  aria-label={actionLabel}
                  aria-haspopup='menu'
                  aria-expanded={menuOpen}
                  loading={busy}
                  icon={<MoreOne size={16} fill='currentColor' />}
                />
              </Dropdown>
            </div>
          );
        })}
      </nav>
      <Modal
        visible={!!deleteReport}
        title={t('settings.archived.deleteConfirmTitle')}
        okText={t('common.delete')}
        cancelText={t('common.cancel')}
        okButtonProps={{ status: 'danger' }}
        cancelButtonProps={{ disabled: deleting }}
        confirmLoading={deleting}
        closable={false}
        maskClosable={false}
        focusLock
        onCancel={() => {
          if (deleting) return;
          setFeedback(undefined);
          setDeleteReport(undefined);
        }}
        onOk={() => {
          if (deleteReport) void runAction(deleteReport, 'delete');
        }}
      >
        {deleteReport && (
          <>
            <p>
              {t(
                deleteReport.conversation
                  ? 'common.paperTalk.deleteLinkedReport'
                  : 'common.paperTalk.deleteHistoryReport',
                {
                  name: titleOf(deleteReport),
                }
              )}
            </p>
            {feedback?.type === 'error' && <Alert type='error' content={feedback.message} />}
          </>
        )}
      </Modal>
    </div>
  );
}

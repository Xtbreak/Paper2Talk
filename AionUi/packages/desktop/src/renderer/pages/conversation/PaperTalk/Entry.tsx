import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin } from '@arco-design/web-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { httpRequest } from '@/common/adapter/httpBridge';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import {
  activeReportKey,
  ensureConversation,
  errorText,
  forgetActiveReport,
  initialBrief,
  root,
  unavailableReport,
  type Report,
} from './client';

type Unavailable = 'archived' | 'missing';
type EntryError = { kind: Unavailable } | { kind: 'retry'; message: string };
type Attempt = {
  id: string | null;
  lookup: Promise<Report | null>;
  creation?: Promise<Report>;
  opening?: Promise<Report>;
};

function OpenReport({ reportId, fresh }: { reportId: string | null; fresh: boolean }) {
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const { t } = useTranslation();
  const name = t('common.paperTalk.title');
  const [error, setError] = useState<EntryError>();
  const [retry, setRetry] = useState(0);
  const pending = useRef<Attempt | null>(null);

  useEffect(() => {
    const id = reportId ?? (fresh ? null : localStorage.getItem(activeReportKey));
    const attempt: Attempt = (pending.current ??= {
      id,
      lookup: id
        ? httpRequest<Report>('GET', root + '/' + encodeURIComponent(id), undefined, { silentStatuses: [404, 410] })
        : Promise.resolve<Report | null>(null),
    });
    let live = true;
    void (async () => {
      try {
        let report = await attempt.lookup.catch((err: unknown): null => {
          if (attempt.id && !reportId && unavailableReport(err)) return null;
          throw err;
        });
        if (!live) return;
        if (!report) {
          if (attempt.id) forgetActiveReport(attempt.id);
          attempt.creation ??= httpRequest<Report>('POST', root, initialBrief);
          report = await attempt.creation;
        }
        if (!live) return;
        attempt.opening ??= ensureConversation(report, report.brief.direction || name);
        report = await attempt.opening;
        if (!live) return;
        localStorage.setItem(activeReportKey, report.id);
        void navigate('/conversation/' + report.conversation, { replace: true });
      } catch (err) {
        if (!live) return;
        const kind = reportId ? unavailableReport(err) : undefined;
        if (kind && reportId) {
          forgetActiveReport(reportId);
          setError({ kind });
        } else {
          setError({ kind: 'retry', message: errorText(err) });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [fresh, name, navigate, reportId, retry]);

  if (!error) return <Spin />;
  if (error.kind === 'retry') {
    return (
      <Space direction='vertical'>
        <Alert type='error' content={error.message} />
        <Button
          onClick={() => {
            pending.current = null;
            setError(undefined);
            setRetry((count) => count + 1);
          }}
        >
          {t('common.retry')}
        </Button>
      </Space>
    );
  }
  return (
    <Space direction='vertical'>
      <Alert
        type='warning'
        content={t(error.kind === 'archived' ? 'common.paperTalk.archivedLink' : 'common.paperTalk.missingLink')}
      />
      <Space wrap>
        {error.kind === 'archived' && (
          <Button
            type='primary'
            onClick={() => {
              layout?.setSiderCollapsed(false);
              void navigate('/paper-talk?history=archived', { replace: true });
            }}
          >
            {t('common.paperTalk.viewArchived')}
          </Button>
        )}
        <Button
          type={error.kind === 'missing' ? 'primary' : 'secondary'}
          onClick={() => void navigate('/paper-talk?new=1', { replace: true })}
        >
          {t('common.paperTalk.newConversation')}
        </Button>
      </Space>
    </Space>
  );
}

export default function PaperTalkEntry() {
  const [params] = useSearchParams();
  const { key } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const history = params.get('history');

  return (
    <div className='p-24px'>
      {history === 'active' || history === 'archived' ? (
        <Space direction='vertical'>
          <p>{t('common.paperTalk.historyLanding')}</p>
          <Button type='primary' onClick={() => void navigate('/paper-talk?new=1', { replace: true })}>
            {t('common.paperTalk.newConversation')}
          </Button>
        </Space>
      ) : (
        <OpenReport key={key} reportId={params.get('report') || null} fresh={params.has('new')} />
      )}
    </div>
  );
}

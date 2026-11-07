import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { httpRequest } from '@/common/adapter/httpBridge';
import { ensureConversation, errorText, initialBrief, root, type Report } from './client';

export default function PaperTalkEntry() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const pending = useRef<Promise<Report> | null>(null);
  useEffect(() => {
    let live = true;
    if (!pending.current) {
      const id = params.get('report') || (params.get('new') ? null : localStorage.getItem('paper-talk.active'));
      pending.current = (
        id ? httpRequest<Report>('GET', root + '/' + id) : httpRequest<Report>('POST', root, initialBrief)
      ).then((report) => ensureConversation(report, report.brief.direction || t('common.paperTalk.title')));
    }
    pending.current
      .then((report) => {
        if (!live) return;
        localStorage.setItem('paper-talk.active', report.id);
        void navigate('/conversation/' + report.conversation, { replace: true });
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [navigate, params, retry, t]);
  return (
    <div className='p-24px'>
      {error ? (
        <>
          <Alert type='error' content={error} />
          <Button
            onClick={() => {
              pending.current = null;
              setError('');
              setRetry((n) => n + 1);
            }}
          >
            {t('common.retry')}
          </Button>
        </>
      ) : (
        <Spin />
      )}
    </div>
  );
}

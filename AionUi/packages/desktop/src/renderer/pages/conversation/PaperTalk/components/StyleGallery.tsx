import React, { useEffect, useState } from 'react';
import { Button, Image, Radio, Alert } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { getBaseUrl, httpRequest } from '@/common/adapter/httpBridge';
import { errorText } from '../client';
import styles from './Choices.module.css';

type Style = { id: string; name: string; preview: string };
export default function StyleGallery({
  value,
  change,
  disabled,
}: {
  value: string;
  change: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Style[]>([]);
  const [all, setAll] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    httpRequest<Style[]>('GET', '/api/paper-talk/styles')
      .then((data) => {
        if (live) setItems(data);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, []);
  const visible = all ? items : items.filter((item, index) => index < 3 || item.id === value);
  return (
    <section className={styles.templates}>
      {error && <Alert type='error' content={t('common.paperTalk.stylesUnavailable')} />}
      <Radio.Group value={value} onChange={change} disabled={disabled} className={styles.gallery}>
        {visible.map((item) => (
          <article className={styles.styleCard} key={item.id} data-selected={value === item.id}>
            <Image src={getBaseUrl() + item.preview} alt={t(`common.paperTalk.styleNames.${item.id}`)} width='100%' />
            <Radio value={item.id}>{t(`common.paperTalk.styleNames.${item.id}`)}</Radio>
          </article>
        ))}
      </Radio.Group>
      {items.length > 3 && (
        <Button type='text' size='small' onClick={() => setAll(!all)}>
          {t(`common.paperTalk.${all ? 'collapse' : 'allStyles'}`)}
        </Button>
      )}
    </section>
  );
}

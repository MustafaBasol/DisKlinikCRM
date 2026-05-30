import { useTranslation } from 'react-i18next';
import LegalLayout, {
  LegalList,
  LegalNotice,
  LegalSection,
  LegalSources,
  LegalTable,
  type LegalSource,
  type LegalTableRow,
} from '../../components/legal/LegalLayout';

const PrivacyNoticePage = () => {
  const { t } = useTranslation('legal');
  const privacySources: LegalSource[] = [
    {
      label: t('privacy.sources.notice'),
      href: 'https://kvkk.gov.tr/Icerik/5395/Aydinlatma-Yukumlulugunun-Yerine-Getirilmesi-Rehberi-Kurum-Internet-Sayfasinda-Yayinlanmistir-',
    },
    {
      label: t('privacy.sources.transfer'),
      href: 'https://kvkk.gov.tr/Icerik/7938/Standart-Sozlesmeler-ve-Baglayici-Sirket-Kurallarina-Iliskin-Dokumanlar-Hakkinda-Kamuoyu-Duyurusu',
    },
    {
      label: t('privacy.sources.gdpr'),
      href: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    },
  ];
  const dataRows = t('privacy.data.rows', { returnObjects: true }) as LegalTableRow[];
  const purposes = t('privacy.purposes.items', { returnObjects: true }) as string[];
  const basisRows = t('privacy.basis.rows', { returnObjects: true }) as LegalTableRow[];
  const transferActions = t('privacy.transfers.actions', { returnObjects: true }) as string[];
  const retentionRows = t('privacy.retention.rows', { returnObjects: true }) as LegalTableRow[];
  const rights = t('privacy.rights.items', { returnObjects: true }) as string[];
  const publishItems = t('privacy.publish.items', { returnObjects: true }) as string[];

  return (
    <LegalLayout title={t('privacy.title')} description={t('privacy.description')} metaTitle={t('meta.privacy')}>
      <LegalSection title={t('privacy.controller.title')}>
        <p>{t('privacy.controller.body')}</p>
        <LegalNotice title={t('privacy.controller.requiredTitle')}>
          {t('privacy.controller.requiredBody')}
        </LegalNotice>
      </LegalSection>

      <LegalSection title={t('privacy.data.title')}>
        <p>{t('privacy.data.body')}</p>
        <LegalTable rows={dataRows} />
      </LegalSection>

      <LegalSection title={t('privacy.purposes.title')}>
        <LegalList items={purposes} />
      </LegalSection>

      <LegalSection title={t('privacy.basis.title')}>
        <p>{t('privacy.basis.body')}</p>
        <LegalTable rows={basisRows} />
        <p>{t('privacy.basis.special')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.transfers.title')}>
        <p>{t('privacy.transfers.body')}</p>
        <LegalList items={transferActions} />
      </LegalSection>

      <LegalSection title={t('privacy.retention.title')}>
        <p>{t('privacy.retention.body')}</p>
        <LegalTable rows={retentionRows} />
      </LegalSection>

      <LegalSection title={t('privacy.rights.title')}>
        <p>{t('privacy.rights.body')}</p>
        <LegalList items={rights} />
        <p>{t('privacy.rights.contact')}</p>
      </LegalSection>

      <LegalSection title={t('privacy.publish.title')}>
        <LegalList items={publishItems} />
      </LegalSection>

      <LegalSources items={privacySources} />
    </LegalLayout>
  );
};

export default PrivacyNoticePage;

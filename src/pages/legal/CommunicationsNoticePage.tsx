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

const CommunicationsNoticePage = () => {
  const { t } = useTranslation('legal');
  const communicationsSources: LegalSource[] = [
    {
      label: t('communications.sources.commercial'),
      href: 'https://www.ticaret.gov.tr/ic-ticaret/mevzuat/elektronik-ticaret',
    },
    {
      label: t('communications.sources.transfer'),
      href: 'https://kvkk.gov.tr/Icerik/7938/Standart-Sozlesmeler-ve-Baglayici-Sirket-Kurallarina-Iliskin-Dokumanlar-Hakkinda-Kamuoyu-Duyurusu',
    },
    {
      label: t('communications.sources.eprivacy'),
      href: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219',
    },
    {
      label: t('communications.sources.gdpr'),
      href: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    },
  ];
  const channelRows = t('communications.channels.rows', { returnObjects: true }) as LegalTableRow[];
  const messageRows = t('communications.messages.rows', { returnObjects: true }) as LegalTableRow[];
  const protectionItems = t('communications.protection.items', { returnObjects: true }) as string[];
  const aiItems = t('communications.ai.items', { returnObjects: true }) as string[];

  return (
    <LegalLayout
      title={t('communications.title')}
      description={t('communications.description')}
      metaTitle={t('meta.communications')}
    >
      <LegalSection title={t('communications.scope.title')}>
        <p>{t('communications.scope.body')}</p>
      </LegalSection>

      <LegalSection title={t('communications.channels.title')}>
        <p>{t('communications.channels.body')}</p>
        <LegalTable rows={channelRows} />
      </LegalSection>

      <LegalSection title={t('communications.roles.title')}>
        <p>{t('communications.roles.body')}</p>
      </LegalSection>

      <LegalSection title={t('communications.ai.title')}>
        <p>{t('communications.ai.body')}</p>
        <LegalList items={aiItems} />
      </LegalSection>

      <LegalSection title={t('communications.messages.title')}>
        <p>{t('communications.messages.body')}</p>
        <LegalTable rows={messageRows} />
      </LegalSection>

      <LegalSection title={t('communications.protection.title')}>
        <LegalList items={protectionItems} />
      </LegalSection>

      <LegalNotice title={t('communications.emergency.title')}>
        {t('communications.emergency.body')}
      </LegalNotice>

      <LegalSources items={communicationsSources} />
    </LegalLayout>
  );
};

export default CommunicationsNoticePage;

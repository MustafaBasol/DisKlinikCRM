import { useTranslation } from 'react-i18next';
import LegalLayout, {
  LegalList,
  LegalSection,
  LegalSources,
  LegalTable,
  type LegalSource,
  type LegalTableRow,
} from '../../components/legal/LegalLayout';

const DataSubjectRequestPage = () => {
  const { t } = useTranslation('legal');
  const requestSources: LegalSource[] = [
    {
      label: t('dataRequest.sources.kvkk'),
      href: 'https://www.kvkk.gov.tr/Icerik/5395/Aydinlatma-Yukumlulugunun-Yerine-Getirilmesi-Rehberi-Kurum-Internet-Sayfasinda-Yayinlanmistir-',
    },
    {
      label: t('dataRequest.sources.gdpr'),
      href: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    },
  ];
  const platformRows = t('dataRequest.platform.rows', { returnObjects: true }) as LegalTableRow[];
  const requestTypes = t('dataRequest.types.items', { returnObjects: true }) as string[];

  return (
    <LegalLayout
      title={t('dataRequest.title')}
      description={t('dataRequest.description')}
      metaTitle={t('meta.dataRequest')}
    >
      <LegalSection title={t('dataRequest.platform.title')}>
        <p>{t('dataRequest.platform.body')}</p>
        <LegalTable rows={platformRows} />
      </LegalSection>

      <LegalSection title={t('dataRequest.types.title')}>
        <p>{t('dataRequest.types.body')}</p>
        <LegalList items={requestTypes} />
      </LegalSection>

      <LegalSection title={t('dataRequest.clinic.title')}>
        <p>{t('dataRequest.clinic.body')}</p>
      </LegalSection>

      <LegalSection title={t('dataRequest.response.title')}>
        <p>{t('dataRequest.response.body')}</p>
      </LegalSection>

      <LegalSources items={requestSources} />
    </LegalLayout>
  );
};

export default DataSubjectRequestPage;

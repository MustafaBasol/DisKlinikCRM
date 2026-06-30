import { useTranslation } from 'react-i18next';
import LegalLayout, {
  LegalList,
  LegalNotice,
  LegalSection,
  LegalSources,
  type LegalSource,
} from '../../components/legal/LegalLayout';

const ConsentTemplatePage = () => {
  const { t } = useTranslation('legal');
  const consentSources: LegalSource[] = [
    {
      label: t('consent.sources.kvkk'),
      href: 'https://kvkk.gov.tr/Icerik/5395/Aydinlatma-Yukumlulugunun-Yerine-Getirilmesi-Rehberi-Kurum-Internet-Sayfasinda-Yayinlanmistir-',
    },
    {
      label: t('consent.sources.gdpr'),
      href: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    },
  ];
  const distinctionItems = t('consent.distinction.items', { returnObjects: true }) as string[];

  return (
    <LegalLayout
      title={t('consent.title')}
      description={t('consent.description')}
      metaTitle={t('meta.consent')}
    >
      <LegalNotice title={t('consent.disclaimer.title')}>
        {t('consent.disclaimer.body')}
      </LegalNotice>

      <LegalSection title={t('consent.distinction.title')}>
        <p>{t('consent.distinction.body')}</p>
        <LegalList items={distinctionItems} />
      </LegalSection>

      <LegalSection title={t('consent.template.title')}>
        <p>{t('consent.template.body')}</p>
        <p>{t('consent.template.notice')}</p>
        <p>{t('consent.template.explicit')}</p>
      </LegalSection>

      <LegalSection title={t('consent.clinicNote.title')}>
        <p>{t('consent.clinicNote.body')}</p>
      </LegalSection>

      <LegalSources items={consentSources} />
    </LegalLayout>
  );
};

export default ConsentTemplatePage;

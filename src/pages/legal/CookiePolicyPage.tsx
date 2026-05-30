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

const CookiePolicyPage = () => {
  const { t } = useTranslation('legal');
  const cookieSources: LegalSource[] = [
    {
      label: t('cookies.sources.guide'),
      href: 'https://www.kvkk.gov.tr/SharedFolderServer/CMSFiles/1336263f-22bb-4da3-a1b9-aabc0e0e8bff.pdf',
    },
    {
      label: t('cookies.sources.eprivacy'),
      href: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02002L0058-20091219',
    },
    {
      label: t('cookies.sources.edpb'),
      href: 'https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en',
    },
  ];
  const storageRows = t('cookies.storage.rows', { returnObjects: true }) as LegalTableRow[];
  const rules = t('cookies.future.items', { returnObjects: true }) as string[];
  const controlItems = t('cookies.controls.items', { returnObjects: true }) as string[];

  return (
    <LegalLayout title={t('cookies.title')} description={t('cookies.description')} metaTitle={t('meta.cookies')}>
      <LegalNotice title={t('cookies.current.title')}>
        {t('cookies.current.body')}
      </LegalNotice>

      <LegalSection title={t('cookies.scope.title')}>
        <p>{t('cookies.scope.body')}</p>
      </LegalSection>

      <LegalSection title={t('cookies.storage.title')}>
        <p>{t('cookies.storage.body')}</p>
        <LegalTable rows={storageRows} />
      </LegalSection>

      <LegalSection title={t('cookies.future.title')}>
        <p>{t('cookies.future.body')}</p>
        <LegalList items={rules} />
      </LegalSection>

      <LegalSection title={t('cookies.controls.title')}>
        <LegalList items={controlItems} />
      </LegalSection>

      <LegalSources items={cookieSources} />
    </LegalLayout>
  );
};

export default CookiePolicyPage;

import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LegalLayout, { LegalList, LegalSection, LegalSources, type LegalSource } from '../../components/legal/LegalLayout';

interface LegalCard {
  path: string;
  title: string;
  description: string;
}

const LegalCenterPage = () => {
  const { t } = useTranslation('legal');
  const cards = t('center.cards', { returnObjects: true }) as LegalCard[];
  const checklist = t('center.checklist.items', { returnObjects: true }) as string[];
  const officialSources: LegalSource[] = [
    {
      label: t('center.sources.kvkk'),
      href: 'https://www.kvkk.gov.tr/',
    },
    {
      label: t('center.sources.gdpr'),
      href: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    },
    {
      label: t('center.sources.commercial'),
      href: 'https://www.ticaret.gov.tr/ic-ticaret/mevzuat/elektronik-ticaret',
    },
  ];

  return (
    <LegalLayout title={t('center.title')} description={t('center.description')} metaTitle={t('meta.center')}>
      <LegalSection title={t('center.pagesTitle')}>
        <p>{t('center.pagesDescription')}</p>
        <div className="legal-card-grid">
          {cards.map((card) => (
            <Link key={card.path} to={card.path} className="legal-card-link">
              <h3 className="text-base font-bold">{card.title}</h3>
              <p className="mt-2 text-sm leading-7 text-[var(--landing-muted)]">{card.description}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--landing-teal)]">
                {t('center.open')}
                <ArrowRight size={15} />
              </span>
            </Link>
          ))}
        </div>
      </LegalSection>

      <LegalSection title={t('center.scope.title')}>
        <p>{t('center.scope.body')}</p>
      </LegalSection>

      <LegalSection title={t('center.checklist.title')}>
        <p>{t('center.checklist.description')}</p>
        <LegalList items={checklist} />
      </LegalSection>

      <LegalSources items={officialSources} />
    </LegalLayout>
  );
};

export default LegalCenterPage;

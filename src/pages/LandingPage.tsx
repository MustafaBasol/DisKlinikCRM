import React from 'react';
import { useTranslation } from 'react-i18next';
import LandingHeader from '../components/landing/LandingHeader';
import HeroSection from '../components/landing/HeroSection';
import ProblemSection from '../components/landing/ProblemSection';
import FeatureGrid from '../components/landing/FeatureGrid';
import MultiClinicSection from '../components/landing/MultiClinicSection';
import IntegrationSection from '../components/landing/IntegrationSection';
import WorkflowSection from '../components/landing/WorkflowSection';
import SocialProofSection from '../components/landing/SocialProofSection';
import PricingSection from '../components/landing/PricingSection';
import TrustSection from '../components/landing/TrustSection';
import DemoCtaSection from '../components/landing/DemoCtaSection';
import FaqSection from '../components/landing/FaqSection';
import LandingFooter from '../components/landing/LandingFooter';
import { faqItems } from '../data/landing';
import '../components/landing/landing.css';

const SITE_URL = 'https://noramedi.com';

const LandingPage: React.FC = () => {
  const { t } = useTranslation('landing');

  React.useEffect(() => {
    const previousTitle = document.title;
    document.title = t('meta.title');

    return () => {
      document.title = previousTitle;
    };
  }, [t]);

  // Structured data (SoftwareApplication + FAQPage) for search engines.
  React.useEffect(() => {
    const structuredData = [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: t('brand.name'),
        description: t('hero.description'),
        url: SITE_URL,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: ['tr', 'en', 'de', 'fr'],
        offers: {
          '@type': 'Offer',
          category: 'SaaS',
          url: `${SITE_URL}/#pricing`,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqItems.map((item) => ({
          '@type': 'Question',
          name: t(`faq.items.${item}.question`),
          acceptedAnswer: {
            '@type': 'Answer',
            text: t(`faq.items.${item}.answer`),
          },
        })),
      },
    ];

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(structuredData);
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [t]);

  return (
    <div className="landing-page min-h-screen">
      <LandingHeader />
      <main id="top">
        <HeroSection />
        <ProblemSection />
        <FeatureGrid />
        <MultiClinicSection />
        <IntegrationSection />
        <WorkflowSection />
        <SocialProofSection />
        <PricingSection />
        <TrustSection />
        <DemoCtaSection />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;

import React from 'react';
import { useTranslation } from 'react-i18next';
import LandingHeader from '../components/landing/LandingHeader';
import HeroSection from '../components/landing/HeroSection';
import ProblemSection from '../components/landing/ProblemSection';
import FeatureGrid from '../components/landing/FeatureGrid';
import MultiClinicSection from '../components/landing/MultiClinicSection';
import IntegrationSection from '../components/landing/IntegrationSection';
import WorkflowSection from '../components/landing/WorkflowSection';
import TrustSection from '../components/landing/TrustSection';
import DemoCtaSection from '../components/landing/DemoCtaSection';
import FaqSection from '../components/landing/FaqSection';
import LandingFooter from '../components/landing/LandingFooter';
import '../components/landing/landing.css';

const LandingPage: React.FC = () => {
  const { t } = useTranslation('landing');

  React.useEffect(() => {
    const previousTitle = document.title;
    document.title = t('meta.title');

    return () => {
      document.title = previousTitle;
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
        <TrustSection />
        <DemoCtaSection />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;

import { useEffect } from 'react';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const publicLanguages = ['tr', 'en', 'fr', 'de'] as const;

interface PublicLanguageSelectorProps {
  label: string;
}

const PublicLanguageSelector = ({ label }: PublicLanguageSelectorProps) => {
  const { i18n } = useTranslation();
  const currentLanguage = publicLanguages.find((language) => i18n.language.startsWith(language)) ?? 'tr';

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = currentLanguage;

    return () => {
      document.documentElement.lang = previousLanguage;
    };
  }, [currentLanguage]);

  return (
    <label className="landing-language-select inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-[var(--landing-border)] bg-[var(--landing-surface)] px-2 text-[var(--landing-muted)] transition-colors hover:bg-[var(--landing-surface-muted)] hover:text-[var(--landing-heading)]">
      <Globe size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="cursor-pointer bg-transparent text-xs font-bold uppercase outline-none"
        value={currentLanguage}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
      >
        {publicLanguages.map((language) => (
          <option key={language} value={language}>
            {language.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
};

export default PublicLanguageSelector;

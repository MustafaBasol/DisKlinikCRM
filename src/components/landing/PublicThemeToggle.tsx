import { Moon, Sun } from 'lucide-react';
import { useDarkMode } from '../../utils/darkMode';

interface PublicThemeToggleProps {
  label: string;
}

const PublicThemeToggle = ({ label }: PublicThemeToggleProps) => {
  const { isDark, toggle } = useDarkMode();

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--landing-border)] bg-[var(--landing-surface)] text-[var(--landing-muted)] transition-colors hover:bg-[var(--landing-surface-muted)] hover:text-[var(--landing-heading)] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2 focus:ring-offset-[var(--landing-bg)]"
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      {isDark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
  );
};

export default PublicThemeToggle;

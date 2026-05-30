import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DemoCtaSection = () => {
  const { t } = useTranslation('landing');
  const [isComplete, setIsComplete] = React.useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.currentTarget.reset();
    setIsComplete(true);
  };

  return (
    <section id="demo" className="landing-anchor pb-16 sm:pb-24">
      <div className="landing-container">
        <div className="landing-demo-panel rounded-[2rem] border p-5 sm:p-8 lg:p-12">
          <div className="grid items-start gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14">
            <div className="lg:pt-7">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--landing-teal)]">{t('demo.label')}</p>
              <h2 className="text-3xl font-bold leading-tight tracking-[-0.045em] sm:text-[2.45rem]">{t('demo.title')}</h2>
              <p className="mt-4 text-base leading-8 text-[var(--landing-muted)]">{t('demo.description')}</p>
            </div>

            <form
              className="landing-shadow-md rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-surface)] p-5 sm:p-7"
              onSubmit={handleSubmit}
              onChange={() => setIsComplete(false)}
            >
              <div className="mb-5">
                <h3 className="text-lg font-semibold">{t('demo.formTitle')}</h3>
                <p className="mt-1.5 text-xs leading-5 text-[var(--landing-muted)]">{t('demo.formNote')}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t('demo.fields.name')} placeholder={t('demo.placeholders.name')} name="name" required />
                <FormField label={t('demo.fields.clinic')} placeholder={t('demo.placeholders.clinic')} name="clinic" required />
                <FormField label={t('demo.fields.city')} placeholder={t('demo.placeholders.city')} name="city" />
                <FormField label={t('demo.fields.branches')} placeholder={t('demo.placeholders.branches')} name="branches" type="number" min="1" required />
                <div className="sm:col-span-2">
                  <FormField label={t('demo.fields.contact')} placeholder={t('demo.placeholders.contact')} name="contact" required />
                </div>
                <label className="sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-[var(--landing-heading)]">{t('demo.fields.note')}</span>
                  <textarea
                    className="landing-form-field min-h-24 resize-none"
                    name="note"
                    placeholder={t('demo.placeholders.note')}
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-[var(--landing-teal)] px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#0b7e71] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2"
              >
                {t('demo.submit')}
              </button>
              {isComplete ? (
                <div className="landing-success-panel mt-4 flex gap-3 rounded-xl border bg-[var(--landing-teal-soft)] p-3.5" role="status">
                  <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-[var(--landing-teal)]" />
                  <div>
                    <p className="text-sm font-semibold text-[var(--landing-heading)]">{t('demo.successTitle')}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--landing-muted)]">{t('demo.successDescription')}</p>
                  </div>
                </div>
              ) : null}
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

interface FormFieldProps {
  label: string;
  placeholder: string;
  name: string;
  type?: string;
  min?: string;
  required?: boolean;
}

const FormField = ({ label, placeholder, name, type = 'text', min, required = false }: FormFieldProps) => (
  <label>
    <span className="mb-1.5 block text-sm font-medium text-[var(--landing-heading)]">{label}</span>
    <input className="landing-form-field" name={name} type={type} min={min} placeholder={placeholder} required={required} />
  </label>
);

export default DemoCtaSection;

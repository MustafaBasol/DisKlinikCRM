interface AddonPackageCardProps {
  name: string;
  metaLine?: string;
  priceLine: string;
  cta: string;
  ctaHref?: string;
}

const AddonPackageCard = ({ name, metaLine, priceLine, cta, ctaHref = '#demo' }: AddonPackageCardProps) => (
  <div className="landing-surface flex flex-col rounded-xl p-5">
    <h4 className="text-sm font-semibold text-[var(--landing-heading)]">{name}</h4>
    {metaLine ? <p className="mt-1 text-xs text-[var(--landing-muted)]">{metaLine}</p> : null}
    <p className="mt-3 text-lg font-bold text-[var(--landing-heading)]">{priceLine}</p>
    <a
      href={ctaHref}
      className="mt-4 inline-flex items-center justify-center rounded-lg border border-[var(--landing-border)] px-3 py-2 text-xs font-semibold text-[var(--landing-heading)] transition-colors hover:bg-[var(--landing-surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--landing-teal)] focus:ring-offset-2"
    >
      {cta}
    </a>
  </div>
);

export default AddonPackageCard;

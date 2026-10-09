/**
 * Original inline icons.
 *
 * Drawn here rather than pulled from an icon package so the bundle stays small
 * and no third-party proprietary glyph is shipped.
 */
type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconSports = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v4.5M12 16.5V21M3.6 8.4l4 2.2M16.4 13.4l4 2.2M20.4 8.4l-4 2.2M7.6 13.4l-4 2.2" />
  </svg>
);

export const IconLive = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M3 12h3l2.5-6 4 13 2.5-7h6" />
  </svg>
);

export const IconCasino = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconBets = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M5 4h14v16l-3.5-2-3.5 2-3.5-2L5 20z" />
    <path d="M9 9h6M9 13h4" />
  </svg>
);

export const IconProfile = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const IconStar = ({ className, filled }: IconProps & { filled?: boolean }) => (
  <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />
  </svg>
);

export const IconChevron = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="m6 9 6 6 6-6" /></svg>
);

export const IconClose = ({ className }: IconProps) => (
  <svg {...base} className={className}><path d="m6 6 12 12M18 6 6 18" /></svg>
);

export const IconSearch = ({ className }: IconProps) => (
  <svg {...base} className={className} strokeWidth={2}>
    <circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" />
  </svg>
);

export const IconBack = ({ className }: IconProps) => (
  <svg {...base} className={className} strokeWidth={2.2}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);

export const IconInfo = ({ className }: IconProps) => (
  <svg {...base} className={className} strokeWidth={2.4}><path d="M12 11v6M12 7.2v.1" /></svg>
);

export const IconPlusCircle = ({ className }: IconProps) => (
  <svg {...base} className={className} strokeWidth={2}>
    <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
  </svg>
);

export const IconShield =({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 3.2 5 6v5.5c0 4 2.9 7.6 7 9.3 4.1-1.7 7-5.3 7-9.3V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);

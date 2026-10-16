// Kevyet piirretyt ikonit (ei ulkoisia kirjastoja).
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconOcta = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M12 2.5 21 12l-9 9.5L3 12z" />
    <path d="M3 12h18M12 2.5 9 12l3 9.5M12 2.5l3 9.5-3 9.5" opacity=".7" />
  </svg>
);
export const IconSpiral = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M12 12.2c.6-.6 1.7-.3 1.8.6.2 1.3-1.1 2.3-2.4 2.1-1.9-.3-2.9-2.3-2.4-4.1.6-2.5 3.3-3.8 5.7-3.1 3.1.9 4.7 4.3 3.8 7.3-1.1 3.7-5.2 5.6-8.8 4.4C5.4 18 3.2 13.2 4.7 9 6.3 4.4 11.6 2 16.2 3.8" />
  </svg>
);
export const IconDigits = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 6h18M3 18h18" opacity=".5" />
    <path d="M5.5 9.5 7 8.5v7M11 9.2c.4-.5 1-.8 1.7-.8 1 0 1.8.7 1.8 1.7 0 1.6-3.5 3.2-3.5 5.4h3.6M17.3 8.6h3l-1.7 2.6c1 0 1.9.7 1.9 1.9s-.9 2.4-2.2 2.4c-.7 0-1.3-.3-1.6-.8" />
  </svg>
);
export const IconTests = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 20h18" />
    <path d="M5 20v-4M8.5 20v-8M12 20V7M15.5 20v-6M19 20v-3" />
    <path d="M10 4.5v15.5" stroke="currentColor" strokeDasharray="1.5 2" opacity=".8" />
  </svg>
);
/** Solmuverkko: Recursive Story Matrix. */
export const IconMatrix = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="2.7" />
    <circle cx="4.8" cy="5.3" r="1.9" />
    <circle cx="19.2" cy="5.6" r="1.9" />
    <circle cx="5.2" cy="18.7" r="1.9" />
    <circle cx="18.8" cy="18.4" r="1.9" />
    <path d="M10 10.1 6.2 6.6M14 10.2l3.7-3.3M10 13.9l-3.4 3.4M14 13.8l3.4 3.3" />
    <path d="M6.7 5.4h10.6M19.1 7.5v9" opacity=".5" strokeDasharray="1.5 2" />
  </svg>
);
export const IconPanel = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="m15 15 5 5" />
  </svg>
);
export const IconClose = () => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconAnchor = () => (
  <svg viewBox="0 0 24 24" {...base} width="15" height="15" aria-hidden="true">
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v13M7 11h10M4.5 14c.8 3.4 3.8 6 7.5 6s6.7-2.6 7.5-6" />
  </svg>
);
export const IconChevron = ({ up }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" {...base} width="20" height="20" aria-hidden="true">
    <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
  </svg>
);

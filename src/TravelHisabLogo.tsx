type TravelHisabLogoProps = {
  size?: number;
  className?: string;
  title?: string;
};

export default function TravelHisabLogo({ size = 48, className = "", title = "Travel Hisab" }: TravelHisabLogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 240 260"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="th-navy" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e4a7a" />
          <stop offset="100%" stopColor="#0f2847" />
        </linearGradient>
        <linearGradient id="th-teal" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1f9aa8" />
          <stop offset="100%" stopColor="#147a81" />
        </linearGradient>
        <linearGradient id="th-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4b87a" />
          <stop offset="100%" stopColor="#a8864f" />
        </linearGradient>
        <clipPath id="th-pin-left">
          <rect x="0" y="0" width="120" height="260" />
        </clipPath>
        <clipPath id="th-pin-right">
          <rect x="120" y="0" width="120" height="260" />
        </clipPath>
        <filter id="th-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f2847" floodOpacity="0.22" />
        </filter>
      </defs>

      <ellipse cx="118" cy="246" rx="52" ry="7" fill="#0f2847" opacity="0.18" />

      <g filter="url(#th-soft-shadow)">
        <path
          d="M44 168c-2 18 8 34 22 44 18 12 40 18 52 18s34-6 52-18c14-10 24-26 22-44-6-48-46-88-96-88s-90 40-96 88z"
          fill="url(#th-navy)"
          clipPath="url(#th-pin-left)"
        />
        <path
          d="M44 168c-2 18 8 34 22 44 18 12 40 18 52 18s34-6 52-18c14-10 24-26 22-44-6-48-46-88-96-88s-90 40-96 88z"
          fill="url(#th-teal)"
          clipPath="url(#th-pin-right)"
        />
        <path
          d="M120 44c-34 0-62 28-62 62 0 22 12 42 28 56 16 14 34 22 34 22s18-8 34-22c16-14 28-34 28-56 0-34-28-62-62-62z"
          fill="#fff"
        />
        <path
          d="M44 168c-2 18 8 34 22 44 18 12 40 18 52 18s34-6 52-18c14-10 24-26 22-44-6-48-46-88-96-88s-90 40-96 88z"
          fill="none"
          stroke="#0f2847"
          strokeWidth="3"
        />
      </g>

      <g transform="translate(78 58)">
        <rect x="34" y="8" width="36" height="46" rx="4" fill="url(#th-teal)" opacity="0.95" />
        <rect x="38" y="12" width="28" height="10" rx="2" fill="#fff" />
        <rect x="38" y="26" width="8" height="8" rx="1.5" fill="#fff" />
        <rect x="48" y="26" width="8" height="8" rx="1.5" fill="#fff" />
        <rect x="58" y="26" width="8" height="8" rx="1.5" fill="#fff" />
        <rect x="38" y="36" width="8" height="8" rx="1.5" fill="#fff" />
        <rect x="48" y="36" width="8" height="8" rx="1.5" fill="#fff" />
        <rect x="58" y="36" width="8" height="8" rx="1.5" fill="url(#th-gold)" />
        <path d="M8 18h28v40c0 4-3 7-7 7H15c-4 0-7-3-7-7V18z" fill="none" stroke="url(#th-teal)" strokeWidth="3" />
        <line x1="12" y1="28" x2="32" y2="28" stroke="url(#th-teal)" strokeWidth="2.5" />
        <line x1="12" y1="36" x2="32" y2="36" stroke="url(#th-teal)" strokeWidth="2.5" />
        <line x1="12" y1="44" x2="26" y2="44" stroke="url(#th-teal)" strokeWidth="2.5" />
        <ellipse cx="24" cy="58" rx="11" ry="4" fill="url(#th-gold)" />
        <text x="24" y="61" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
          Rs
        </text>
        <ellipse cx="42" cy="62" rx="9" ry="3.5" fill="url(#th-gold)" />
        <text x="42" y="64.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">
          Rs
        </text>
      </g>

      <g filter="url(#th-soft-shadow)">
        <path d="M34 206c0-12 8-22 18-22s18 10 18 22-8 30-18 30-18-18-18-30z" fill="url(#th-navy)" />
        <circle cx="52" cy="206" r="7" fill="#fff" />
      </g>

      <path
        d="M176 118l14-18 12 10 16-28 14 22 10-8"
        fill="none"
        stroke="url(#th-navy)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M176 118l14-18 12 10 16-28"
        fill="none"
        stroke="url(#th-teal)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

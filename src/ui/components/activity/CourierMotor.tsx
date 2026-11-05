export function CourierMotor() {
  return (
    <div className="relative h-full w-full pointer-events-none select-none">
      <svg
        viewBox="0 0 64 40"
        className="h-full w-full overflow-visible courier-motor-bounce"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="headlight-glow" cx="0%" cy="50%" r="90%">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
          </radialGradient>
        </defs>

        <polygon points="53,15 63,11 63,20" fill="currentColor" opacity="0.14" />

        <path
          d="M17 31 L8 31"
          stroke="#475569"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="7" cy="31" r="1.5" fill="#334155" />

        <g className="courier-exhaust-group">
          <circle className="courier-smoke-puff puff-1" cx="5" cy="30" r="2.2" />
          <circle className="courier-smoke-puff puff-2" cx="3" cy="29" r="2.8" />
          <circle className="courier-smoke-puff puff-3" cx="1" cy="27" r="3.4" />
        </g>

        <circle cx="14" cy="29" r="6.5" fill="#0f172a" stroke="#334155" strokeWidth="1" />
        <circle cx="14" cy="29" r="3" fill="#64748b" />
        <circle cx="14" cy="29" r="1.2" fill="#e2e8f0" />

        <circle cx="48" cy="29" r="6.5" fill="#0f172a" stroke="#334155" strokeWidth="1" />
        <circle cx="48" cy="29" r="3" fill="#64748b" />
        <circle cx="48" cy="29" r="1.2" fill="#e2e8f0" />

        <path
          d="M14 28 L23 28 L30 24 L42 24 L47 28"
          fill="none"
          stroke="#c2410c"
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        <path
          d="M8 29 C8 21 20 21 20 29 Z"
          fill="#ea580c"
          stroke="#9a3412"
          strokeWidth="0.8"
        />

        <path
          d="M36 24 L43 14 L40 14 L34 24 Z"
          fill="#ea580c"
          stroke="#9a3412"
          strokeWidth="0.8"
        />

        <path
          d="M44 14 C47 14 49 16 48 18 C46 19 43 18 42 16 Z"
          fill="#ea580c"
          stroke="#9a3412"
          strokeWidth="0.8"
        />
        <circle cx="48" cy="16.5" r="2.2" fill="#fef08a" stroke="#eab308" strokeWidth="0.6" />

        <path d="M42 14 L42 10" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="42" cy="9.5" r="1.2" fill="#0f172a" />
        <path d="M44 12 L48 13.5" stroke="#0f172a" strokeWidth="1.8" strokeLinecap="round" />

        <rect
          x="6"
          y="10"
          width="13"
          height="12"
          rx="2"
          fill="#f59e0b"
          stroke="#b45309"
          strokeWidth="1.2"
        />
        <line x1="6" y1="13" x2="19" y2="13" stroke="#b45309" strokeWidth="0.8" />
        <rect x="11.5" y="12" width="2" height="2" rx="0.5" fill="#78350f" />

        <path
          d="M21 24 L26 21 L34 24 L34 27"
          fill="none"
          stroke="#1e293b"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="32" y="26.5" width="4.5" height="2" rx="1" fill="#0f172a" />

        <path
          d="M20 22 L24 13 L33 13 L34 22 Z"
          fill="#f97316"
          stroke="#c2410c"
          strokeWidth="0.8"
        />
        <path d="M25 13 L28 16 L31 13" fill="none" stroke="#ea580c" strokeWidth="0.8" />

        <path
          d="M28 15 L36 17 L43 14"
          fill="none"
          stroke="#ea580c"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="43" cy="14" r="1.5" fill="#0f172a" />

        <circle cx="28" cy="8.5" r="5.5" fill="#f97316" stroke="#c2410c" strokeWidth="0.8" />
        <path
          d="M29 7 C34 7 34 11 32 12 C30 12.5 28 11.5 28 9 Z"
          fill="none"
          stroke="#94a3b8"
        />
        <path d="M30 8 C32 8 32.5 9.5 31.5 10.5" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

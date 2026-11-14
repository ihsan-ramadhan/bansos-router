export function CourierMotor() {
  return (
    <div className="relative h-full w-full pointer-events-none select-none">
      <svg
        viewBox="0 0 64 40"
        className="h-full w-full overflow-visible courier-motor-bounce"
        aria-hidden="true"
      >
        {/* Headlight beam cone */}
        <polygon points="53,15 63,11 63,20" fill="currentColor" opacity="0.16" />

        {/* Exhaust Pipe at rear */}
        <path d="M17 31 L8 31" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
        <circle cx="7" cy="31" r="1.5" fill="currentColor" opacity="0.55" />

        {/* Animated Exhaust Smoke Puffs */}
        <g className="courier-exhaust-group">
          <circle className="courier-smoke-puff puff-1" cx="5" cy="30" r="2.2" />
          <circle className="courier-smoke-puff puff-2" cx="3" cy="29" r="2.8" />
          <circle className="courier-smoke-puff puff-3" cx="1" cy="27" r="3.4" />
        </g>

        {/* Rear Wheel */}
        <circle cx="14" cy="29" r="6.5" fill="#0b1220" stroke="currentColor" strokeWidth="1" opacity="0.85" />
        <circle cx="14" cy="29" r="3" fill="currentColor" opacity="0.55" />
        <circle cx="14" cy="29" r="1.2" fill="#e2e8f0" opacity="0.9" />

        {/* Front Wheel */}
        <circle cx="48" cy="29" r="6.5" fill="#0b1220" stroke="currentColor" strokeWidth="1" opacity="0.85" />
        <circle cx="48" cy="29" r="3" fill="currentColor" opacity="0.55" />
        <circle cx="48" cy="29" r="1.2" fill="#e2e8f0" opacity="0.9" />

        {/* Scooter Chassis / Body (Vespa style) */}
        <path
          d="M14 28 L23 28 L30 24 L42 24 L47 28"
          fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
        />
        <path d="M8 29 C8 21 20 21 20 29 Z" fill="currentColor" opacity="0.9" />
        <path d="M36 24 L43 14 L40 14 L34 24 Z" fill="currentColor" opacity="0.9" />
        <path d="M44 14 C47 14 49 16 48 18 C46 19 43 18 42 16 Z" fill="currentColor" opacity="0.9" />

        {/* Headlight Lens */}
        <circle cx="48" cy="16.5" r="2.2" fill="#fef08a" stroke="currentColor" strokeWidth="0.6" />

        {/* Handlebars & Mirror */}
        <path d="M42 14 L42 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
        <circle cx="42" cy="9.5" r="1.2" fill="currentColor" opacity="0.9" />
        <path d="M44 12 L48 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />

        {/* Delivery Cargo Box */}
        <rect x="6" y="10" width="13" height="12" rx="2" fill="currentColor" opacity="0.75" />
        <line x1="6" y1="13" x2="19" y2="13" stroke="#0b1220" strokeWidth="0.8" opacity="0.5" />
        <rect x="11.5" y="12" width="2" height="2" rx="0.5" fill="#0b1220" opacity="0.5" />

        {/* Courier Body (Driver) */}
        <path
          d="M21 24 L26 21 L34 24 L34 27" fill="none"
          stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
        />
        <rect x="32" y="26.5" width="4.5" height="2" rx="1" fill="currentColor" opacity="0.85" />

        <path d="M20 22 L24 13 L33 13 L34 22 Z" fill="currentColor" opacity="0.9" />
        <path d="M25 13 L28 16 L31 13" fill="none" stroke="#0b1220" strokeWidth="0.8" opacity="0.45" />

        <path d="M28 15 L36 17 L43 14" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <circle cx="43" cy="14" r="1.5" fill="currentColor" opacity="0.9" />

        <circle cx="28" cy="8.5" r="5.5" fill="currentColor" opacity="0.95" />
        <path d="M29 7 C34 7 34 11 32 12 C30 12.5 28 11.5 28 9 Z"
          fill="none" stroke="#0b1220" strokeWidth="1" opacity="0.45" />
        <path d="M30 8 C32 8 32.5 9.5 31.5 10.5" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

// Single-path line icons in the same visual language as the rest of the app:
// 24×24 box, round caps, stroke inherited from the caller via `color`.
function Icon({ children, size = 20, color = 'var(--sage)', strokeWidth = 1.75 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export const HeartLeafIcon = (props) => (
  <Icon {...props}>
    <path d="M12 21C12 21 4 17 4 9C4 5 7 3 12 3C17 3 20 5 20 9C20 17 12 21 12 21Z" />
    <path d="M12 21V9" />
  </Icon>
);

export const ClockIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7V12L15.5 14" />
  </Icon>
);

export const PhoneIcon = (props) => (
  <Icon {...props}>
    <path d="M6.5 3.5H9L10.5 7.5L8.5 9C9.5 11.5 12.5 14.5 15 15.5L16.5 13.5L20.5 15V17.5C20.5 19.2 19.2 20.5 17.5 20.5C10.6 20 4 13.4 3.5 6.5C3.5 4.8 4.8 3.5 6.5 3.5Z" />
  </Icon>
);

export const ChatIcon = (props) => (
  <Icon {...props}>
    <path d="M20.5 11.5C20.5 16 16.7 19.5 12 19.5C10.8 19.5 9.7 19.3 8.7 18.9L3.5 20.5L5.1 15.8C4.1 14.5 3.5 13.1 3.5 11.5C3.5 7 7.3 3.5 12 3.5C16.7 3.5 20.5 7 20.5 11.5Z" />
  </Icon>
);

export const SendIcon = (props) => (
  <Icon {...props}>
    <path d="M21 3L10.5 13.5" />
    <path d="M21 3L14.5 21L10.5 13.5L3 9.5L21 3Z" />
  </Icon>
);

export const CalendarIcon = (props) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10H20.5" />
    <path d="M8 3V6.5" />
    <path d="M16 3V6.5" />
  </Icon>
);

export const CameraIcon = (props) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17 7H17.01" />
  </Icon>
);

export const MailIcon = (props) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M4 7L12 12.5L20 7" />
  </Icon>
);

export const PinIcon = (props) => (
  <Icon {...props}>
    <path d="M12 21.5C12 21.5 19 15.6 19 10.5C19 6.6 15.9 3.5 12 3.5C8.1 3.5 5 6.6 5 10.5C5 15.6 12 21.5 12 21.5Z" />
    <circle cx="12" cy="10.5" r="2.5" />
  </Icon>
);

export const ChevronRightIcon = (props) => (
  <Icon {...props}>
    <path d="M9 6L15 12L9 18" />
  </Icon>
);

export const ChevronLeftIcon = (props) => (
  <Icon {...props}>
    <path d="M15 6L9 12L15 18" />
  </Icon>
);

// --- Treatment icons, keyed by category slug ---------------------------------

const DropletIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3.5C12 3.5 5.5 10 5.5 14C5.5 17.6 8.4 20.5 12 20.5C15.6 20.5 18.5 17.6 18.5 14C18.5 10 12 3.5 12 3.5Z" />
  </Icon>
);

const SugarCubeIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z" />
    <path d="M4 7.5L12 12L20 7.5" />
    <path d="M12 12V21" />
  </Icon>
);

const BoltIcon = (props) => (
  <Icon {...props}>
    <path d="M13.5 3L5 13.5H11L10.5 21L19 10.5H13L13.5 3Z" />
  </Icon>
);

const SparkleIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3L13.9 9.1L20 11L13.9 12.9L12 19L10.1 12.9L4 11L10.1 9.1L12 3Z" />
    <path d="M18.5 16.5L19.2 18.3L21 19L19.2 19.7L18.5 21.5L17.8 19.7L16 19L17.8 18.3L18.5 16.5" />
  </Icon>
);

const CATEGORY_ICONS = {
  waxing: DropletIcon,
  sugaring: SugarCubeIcon,
  electrolysis: BoltIcon,
};

// Masters add their own categories in the admin; anything unrecognised gets
// the neutral sparkle rather than no icon at all.
export function CategoryIcon({ slug, ...props }) {
  const Glyph = CATEGORY_ICONS[slug] ?? SparkleIcon;
  return <Glyph {...props} />;
}

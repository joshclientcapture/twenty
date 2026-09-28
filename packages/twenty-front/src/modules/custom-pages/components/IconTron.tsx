import { type TablerIconsProps } from "twenty-ui/icon";

// Custom icon: two light-cycle trails on a grid.
export const IconTron = ({
  size = 24,
  stroke = 2,
  color = "currentColor",
  ...rest
}: TablerIconsProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M6 16v-6h5v4" />
    <path d="M18 8v6h-5v-4" />
    <circle cx="11" cy="14" r="0.6" fill={color} stroke="none" />
    <circle cx="13" cy="10" r="0.6" fill={color} stroke="none" />
  </svg>
);

import { type TablerIconsProps } from "twenty-ui/icon";

// Custom icon: Tabler has no snake. Any SVG works here.
export const IconSnake = ({
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
    <path d="M4 18h6a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h5" />
    <path d="M16 6h1.5a2.5 2.5 0 0 1 0 5H17" />
    <circle cx="19" cy="8.5" r="0.5" fill={color} stroke="none" />
  </svg>
);

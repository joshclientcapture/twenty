import { type TablerIconsProps } from "twenty-ui/icon";

// Custom icon: twenty-ui does not export a bird. Any SVG works here.
export const IconBird = ({
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
    <path d="M16 7a4 4 0 0 1 4 4v1l2 1-2 1a7 7 0 0 1-7 6H8l-4 3v-6a7 7 0 0 1 3-5.7" />
    <path d="M9 10a4 4 0 0 1 7-3" />
    <path d="M7 15h5" />
    <circle cx="16.5" cy="10.5" r="0.5" fill={color} stroke="none" />
  </svg>
);

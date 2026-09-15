import { type TablerIconsProps } from "twenty-ui/icon";
export const IconSales = ({ size = 24, stroke = 2, color = "currentColor", ...rest }: TablerIconsProps) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
);

import { useLocation } from "react-router-dom";

import {
  CUSTOM_PAGE_SECTIONS,
  type CustomPageSectionKey,
} from "@/custom-pages/constants/CustomPages";
import { NavigationDrawerItem } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerItem";
import { NavigationDrawerSection } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerSection";
import { NavigationDrawerSectionTitle } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle";

export const CustomPagesSection = ({ section }: { section: CustomPageSectionKey }) => {
  const { pathname } = useLocation();
  const def = CUSTOM_PAGE_SECTIONS.find((s) => s.key === section);

  if (!def || def.pages.length === 0) return null;

  return (
    <NavigationDrawerSection>
      <NavigationDrawerSectionTitle label={def.title} />
      {def.pages.map(({ label, path, Icon }) => (
        <NavigationDrawerItem
          key={path}
          label={label}
          to={path}
          Icon={Icon}
          active={pathname === path}
        />
      ))}
    </NavigationDrawerSection>
  );
};

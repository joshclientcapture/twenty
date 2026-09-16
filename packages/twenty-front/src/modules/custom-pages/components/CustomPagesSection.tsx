import { useLocation } from "react-router-dom";

import {
  CUSTOM_PAGE_SECTIONS,
  type CustomPageSectionKey,
} from "@/custom-pages/constants/CustomPages";
import { CollapsibleNavigationDrawerSection } from "@/ui/navigation/navigation-drawer/components/CollapsibleNavigationDrawerSection";
import { NavigationDrawerItem } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerItem";

export const CustomPagesSection = ({ section }: { section: CustomPageSectionKey }) => {
  const { pathname } = useLocation();
  const def = CUSTOM_PAGE_SECTIONS.find((s) => s.key === section);

  if (!def || def.pages.length === 0) return null;

  return (
    <CollapsibleNavigationDrawerSection sectionId={`custom-pages/${def.key}`} label={def.title}>
      {def.pages.map(({ label, path, Icon }) => (
        <NavigationDrawerItem
          key={path}
          label={label}
          to={path}
          Icon={Icon}
          active={pathname === path || pathname.startsWith(`${path}/`)}
        />
      ))}
    </CollapsibleNavigationDrawerSection>
  );
};

import { useLocation } from "react-router-dom";

import {
  CUSTOM_PAGE_SECTIONS,
  type CustomPageSectionKey,
} from "@/custom-pages/constants/CustomPages";
import { CollapsibleNavigationDrawerSection } from "@/ui/navigation/navigation-drawer/components/CollapsibleNavigationDrawerSection";
import { NavigationDrawerItem } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerItem";
import { useIsOsAdmin } from "@/custom-pages/os/OsRestricted";

export const CustomPagesSection = ({ section }: { section: CustomPageSectionKey }) => {
  const { pathname } = useLocation();
  const isAdmin = useIsOsAdmin();
  const def = CUSTOM_PAGE_SECTIONS.find((s) => s.key === section);
  const pages = def?.pages.filter((page) => isAdmin || !page.adminOnly) ?? [];

  if (!def || pages.length === 0) return null;

  return (
    <CollapsibleNavigationDrawerSection sectionId={`custom-pages/${def.key}`} label={def.title}>
      {pages.map(({ label, path, Icon }) => (
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

import { useLocation } from "react-router-dom";

import { CUSTOM_PAGES } from "@/custom-pages/constants/CustomPages";
import { NavigationDrawerItem } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerItem";
import { NavigationDrawerSection } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerSection";
import { NavigationDrawerSectionTitle } from "@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle";

export const CustomPagesSection = () => {
  const { pathname } = useLocation();

  if (CUSTOM_PAGES.length === 0) return null;

  return (
    <NavigationDrawerSection>
      <NavigationDrawerSectionTitle label="Conversifi" />
      {CUSTOM_PAGES.map(({ label, path, Icon }) => (
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

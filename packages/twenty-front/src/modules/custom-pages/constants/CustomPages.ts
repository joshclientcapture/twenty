import { AppPath } from "twenty-shared/types";
import { IconBuildingSkyscraper, IconPresentation, IconTrendingUp, IconUsers, type IconComponent } from "twenty-ui/icon";

import { IconSnake } from "@/custom-pages/components/IconSnake";
import { IconSales } from "@/custom-pages/os/IconSales";

export type CustomPage = {
  label: string;
  path: string;
  Icon: IconComponent;
  // Financial pages are hidden from members; the page itself refuses them too.
  adminOnly?: boolean;
};

export type CustomPageSectionKey = "financials" | "games";

export type CustomPageSection = {
  key: CustomPageSectionKey;
  title: string;
  pages: CustomPage[];
};

/**
 * Conversifi custom pages shown in the sidebar, grouped by section.
 * "financials" renders at the top of the sidebar, "games" at the bottom.
 * To add a page: create the route in AppPath + createWorkspaceRouteObjects,
 * then add one entry to the section it belongs in.
 */
export const CUSTOM_PAGE_SECTIONS: CustomPageSection[] = [
  {
    key: "financials",
    title: "Financials",
    pages: [
      { label: "Sales", path: AppPath.Sales, Icon: IconSales as IconComponent, adminOnly: true },
      // Individual closers live inside Closers; /therapon stays as a URL alias only.
      { label: "Closers", path: AppPath.Closers, Icon: IconUsers as IconComponent },
      { label: "Revenue", path: AppPath.Revenue, Icon: IconTrendingUp as IconComponent, adminOnly: true },
      { label: "Webinar", path: AppPath.Webinar, Icon: IconPresentation as IconComponent, adminOnly: true },
      { label: "Customers", path: AppPath.Customers, Icon: IconBuildingSkyscraper as IconComponent, adminOnly: true },
    ],
  },
  {
    key: "games",
    title: "Games",
    pages: [{ label: "Snake", path: AppPath.Snake, Icon: IconSnake as IconComponent }],
  },
];

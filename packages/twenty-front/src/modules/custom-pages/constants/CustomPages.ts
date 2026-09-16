import { AppPath } from "twenty-shared/types";
import { type IconComponent } from "twenty-ui/icon";

import { IconSnake } from "@/custom-pages/components/IconSnake";
import { IconSales } from "@/custom-pages/os/IconSales";

export type CustomPage = {
  label: string;
  path: string;
  Icon: IconComponent;
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
    pages: [{ label: "Sales", path: AppPath.Sales, Icon: IconSales as IconComponent }],
  },
  {
    key: "games",
    title: "Games",
    pages: [{ label: "Snake", path: AppPath.Snake, Icon: IconSnake as IconComponent }],
  },
];

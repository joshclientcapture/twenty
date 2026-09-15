import { AppPath } from "twenty-shared/types";
import { type IconComponent } from "twenty-ui/icon";

import { IconSnake } from "@/custom-pages/components/IconSnake";

export type CustomPage = {
  label: string;
  path: string;
  Icon: IconComponent;
};

/**
 * Conversifi custom pages shown in the sidebar.
 * To add a page: create the route in AppPath + createWorkspaceRouteObjects,
 * then add one entry here.
 */
export const CUSTOM_PAGES: CustomPage[] = [
  { label: "Snake", path: AppPath.Snake, Icon: IconSnake as IconComponent },
];

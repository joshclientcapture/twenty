import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { AppPath, SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';

import { LazyRoute } from '@/app/components/LazyRoute';
import {
  createSettingsRouteObjects,
  SettingsRouteOutlet,
} from '@/app/components/SettingsRoutes';
import { type WorkspaceRouteObject } from '@/app/routing/types/WorkspaceRouteObject';
import { RecordIndexSkeletonLoader } from '@/object-record/record-index/components/RecordIndexSkeletonLoader';

const WorkflowCoreIndexPage = lazy(() =>
  import('~/pages/object-core/WorkflowCoreIndexPage').then((module) => ({
    default: module.WorkflowCoreIndexPage,
  })),
);

const RecordIndexPage = lazy(() =>
  import('~/pages/object-record/RecordIndexPage').then((module) => ({
    default: module.RecordIndexPage,
  })),
);

const RecordShowPage = lazy(() =>
  import('~/pages/object-record/RecordShowPage').then((module) => ({
    default: module.RecordShowPage,
  })),
);

const StandalonePageLayoutPage = lazy(() =>
  import('~/pages/page-layout/StandalonePageLayoutPage').then((module) => ({
    default: module.StandalonePageLayoutPage,
  })),
);

const AiChatPage = lazy(() =>
  import('~/pages/ai-chat/AiChatPage').then((module) => ({
    default: module.AiChatPage,
  })),
);

const MobileHomePage = lazy(() =>
  import('~/pages/mobile-home/MobileHomePage').then((module) => ({
    default: module.MobileHomePage,
  })),
);

const RecordsPage = lazy(() =>
  import('~/pages/records/RecordsPage').then((module) => ({
    default: module.RecordsPage,
  })),
);

const CloserPage = lazy(() =>
  import('~/pages/closers/CloserPage').then((module) => ({
    default: module.CloserPage,
  })),
);

const ClosersPage = lazy(() =>
  import('~/pages/closers/ClosersPage').then((module) => ({
    default: module.ClosersPage,
  })),
);

const RevenuePage = lazy(() =>
  import('~/pages/revenue/RevenuePage').then((module) => ({
    default: module.RevenuePage,
  })),
);

const WebinarPage = lazy(() =>
  import('~/pages/webinar/WebinarPage').then((module) => ({
    default: module.WebinarPage,
  })),
);

const CustomersPage = lazy(() =>
  import('~/pages/customers/CustomersPage').then((module) => ({
    default: module.CustomersPage,
  })),
);

const SalesPage = lazy(() =>
  import('~/pages/sales/SalesPage').then((module) => ({
    default: module.SalesPage,
  })),
);

const SnakePage = lazy(() =>
  import('~/pages/snake/SnakePage').then((module) => ({
    default: module.SnakePage,
  })),
);

const Game2048Page = lazy(() =>
  import('~/pages/game2048/Game2048Page').then((module) => ({
    default: module.Game2048Page,
  })),
);

const FlappyPage = lazy(() =>
  import('~/pages/flappy/FlappyPage').then((module) => ({
    default: module.FlappyPage,
  })),
);

const NotFound = lazy(() =>
  import('~/pages/not-found/NotFound').then((module) => ({
    default: module.NotFound,
  })),
);

type CreateWorkspaceRouteObjectsArgs = {
  isAdminPageEnabled?: boolean;
  isWorkflowCoreIndexPageEnabled?: boolean;
};

const MAIN_AND_SIDE_PANEL = ['main', 'side-panel'] as const;
const SETTINGS_ROOT_PATH = AppPath.SettingsCatchAll.replace('/*', '');

export const createWorkspaceRouteObjects = ({
  isAdminPageEnabled,
  isWorkflowCoreIndexPageEnabled,
}: CreateWorkspaceRouteObjectsArgs): WorkspaceRouteObject[] => {
  const settingsRouteObjects = createSettingsRouteObjects({
    isAdminPageEnabled,
  });

  return [
    ...(isWorkflowCoreIndexPageEnabled
      ? [
          {
            path: AppPath.WorkflowCoreIndexPage,
            element: (
              <LazyRoute>
                <WorkflowCoreIndexPage />
              </LazyRoute>
            ),
            handle: {
              workspaceSurfaces: MAIN_AND_SIDE_PANEL,
              isLocationExpandableFromSidePanel: true,
            },
          } satisfies WorkspaceRouteObject,
        ]
      : []),
    {
      path: AppPath.Index,
      element: <RecordIndexSkeletonLoader />,
    },
    {
      path: AppPath.RecordIndexPage,
      element: (
        <LazyRoute fallback={<RecordIndexSkeletonLoader />}>
          <RecordIndexPage />
        </LazyRoute>
      ),
      handle: {
        workspaceSurfaces: MAIN_AND_SIDE_PANEL,
        isLocationExpandableFromSidePanel: true,
      },
    },
    {
      path: AppPath.RecordShowPage,
      element: (
        <LazyRoute>
          <RecordShowPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.PageLayoutPage,
      element: (
        <LazyRoute>
          <StandalonePageLayoutPage />
        </LazyRoute>
      ),
    },
    {
      path: AppPath.AiChat,
      element: (
        <LazyRoute>
          <AiChatPage />
        </LazyRoute>
      ),
    },
    {
      path: AppPath.Records,
      element: (
        <LazyRoute>
          <RecordsPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Therapon,
      element: (
        <LazyRoute>
          <CloserPage closerId="therapon" />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Closers,
      element: (
        <LazyRoute>
          <ClosersPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Closer,
      element: (
        <LazyRoute>
          <CloserPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Revenue,
      element: (
        <LazyRoute>
          <RevenuePage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Webinar,
      element: (
        <LazyRoute>
          <WebinarPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Customers,
      element: (
        <LazyRoute>
          <CustomersPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Sales,
      element: (
        <LazyRoute>
          <SalesPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Snake,
      element: (
        <LazyRoute>
          <SnakePage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Game2048,
      element: (
        <LazyRoute>
          <Game2048Page />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Flappy,
      element: (
        <LazyRoute>
          <FlappyPage />
        </LazyRoute>
      ),
      handle: { workspaceSurfaces: MAIN_AND_SIDE_PANEL },
    },
    {
      path: AppPath.Home,
      element: (
        <LazyRoute>
          <MobileHomePage />
        </LazyRoute>
      ),
    },
    {
      path: SETTINGS_ROOT_PATH,
      element: <SettingsRouteOutlet />,
      children: settingsRouteObjects,
    },
    {
      path: AppPath.Dpa,
      element: <Navigate to={getSettingsPath(SettingsPath.LegalDpa)} replace />,
    },
    {
      path: AppPath.NotFoundWildcard,
      element: (
        <LazyRoute>
          <NotFound />
        </LazyRoute>
      ),
    },
  ];
};

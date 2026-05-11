import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/layout/AuthGuard';
import { ProjectScopeGuard } from './components/layout/ProjectScopeGuard';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/Login';
import { ForgotPasswordPage } from './pages/auth/ForgotPassword';
import { UpdatePasswordPage } from './pages/auth/UpdatePassword';
import { PendingAssignmentPage } from './pages/auth/PendingAssignment';
import { DashboardPage } from './pages/Dashboard';

// Lazy-load the chart-heavy / xlsx-heavy pages so they don't blow up the
// initial bundle. The Suspense boundary lives in AppShell.
const ProjectSetupPage = lazy(() =>
  import('./pages/ProjectSetup').then((m) => ({ default: m.ProjectSetupPage })),
);
const ProgressPage = lazy(() =>
  import('./pages/Progress').then((m) => ({ default: m.ProgressPage })),
);
const ChangeManagementPage = lazy(() =>
  import('./pages/ChangeManagement').then((m) => ({ default: m.ChangeManagementPage })),
);
const CoaPage = lazy(() => import('./pages/Coa').then((m) => ({ default: m.CoaPage })));
const WorkTypesPage = lazy(() =>
  import('./pages/WorkTypes').then((m) => ({ default: m.WorkTypesPage })),
);
const BudgetPage = lazy(() => import('./pages/Budget').then((m) => ({ default: m.BudgetPage })));
const ReportsPage = lazy(() =>
  import('./pages/Reports').then((m) => ({ default: m.ReportsPage })),
);
const SnapshotsPage = lazy(() =>
  import('./pages/Snapshots').then((m) => ({ default: m.SnapshotsPage })),
);
const EarnedValuePage = lazy(() =>
  import('./pages/EarnedValue').then((m) => ({ default: m.EarnedValuePage })),
);
const DisciplineProgressPage = lazy(() =>
  import('./pages/DisciplineProgress').then((m) => ({ default: m.DisciplineProgressPage })),
);
const UploadPage = lazy(() => import('./pages/Upload').then((m) => ({ default: m.UploadPage })));
const QmrPage = lazy(() => import('./pages/Qmr').then((m) => ({ default: m.QmrPage })));

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <UpdatePasswordPage /> },
  { path: '/update-password', element: <UpdatePasswordPage mode="recovery" /> },
  { path: '/accept-invite', element: <UpdatePasswordPage mode="invite" /> },
  { path: '/pending-assignment', element: <PendingAssignmentPage /> },
  {
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <DashboardPage />, handle: { title: 'Executive Dashboard' } },
      { path: '/projects', element: <ProjectSetupPage />, handle: { title: 'Project Setup' } },
      { path: '/coa', element: <CoaPage />, handle: { title: 'COA & Unit Rates' } },
      { path: '/work-types', element: <WorkTypesPage />, handle: { title: 'Work Types' } },
      {
        path: '/budget',
        element: (
          <ProjectScopeGuard>
            <BudgetPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Budget & Baseline' },
      },
      {
        path: '/progress',
        element: (
          <ProjectScopeGuard>
            <ProgressPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Progress & Earned Value' },
      },
      {
        path: '/changes',
        element: (
          <ProjectScopeGuard>
            <ChangeManagementPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Change Management' },
      },
      {
        path: '/reports',
        element: (
          <ProjectScopeGuard>
            <ReportsPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Reports & Analytics' },
      },
      {
        path: '/snapshots',
        element: (
          <ProjectScopeGuard>
            <SnapshotsPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Period Snapshots' },
      },
      {
        path: '/progress/earned-value',
        element: (
          <ProjectScopeGuard>
            <EarnedValuePage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Earned Value' },
      },
      {
        path: '/progress/disciplines',
        element: (
          <ProjectScopeGuard>
            <DisciplineProgressPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Discipline Progress' },
      },
      {
        path: '/progress/upload',
        element: (
          <ProjectScopeGuard>
            <UploadPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'Upload Progress Data' },
      },
      {
        path: '/qmr',
        element: (
          <ProjectScopeGuard>
            <QmrPage />
          </ProjectScopeGuard>
        ),
        handle: { title: 'QMR Report' },
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

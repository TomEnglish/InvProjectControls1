import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthGuard } from './components/layout/AuthGuard';
import { ProjectScopeGuard } from './components/layout/ProjectScopeGuard';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/Login';
import { ForgotPasswordPage } from './pages/auth/ForgotPassword';
import { UpdatePasswordPage } from './pages/auth/UpdatePassword';
import { PendingAssignmentPage } from './pages/auth/PendingAssignment';
import { DashboardPage } from './pages/Dashboard';
import { ProjectSetupPage } from './pages/ProjectSetup';
import { ProgressPage } from './pages/Progress';
import { ChangeManagementPage } from './pages/ChangeManagement';
import { CoaPage } from './pages/Coa';
import { RocPage } from './pages/Roc';
import { BudgetPage } from './pages/Budget';
import { ReportsPage } from './pages/Reports';
import { SnapshotsPage } from './pages/Snapshots';
import { EarnedValuePage } from './pages/EarnedValue';
import { DisciplineProgressPage } from './pages/DisciplineProgress';
import { UploadPage } from './pages/Upload';

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
      { path: '/roc', element: <RocPage />, handle: { title: 'Rules of Credit' } },
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
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

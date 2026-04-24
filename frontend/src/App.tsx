import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { AuthGuard } from './components/layout/AuthGuard';
import { ProjectScopeGuard } from './components/layout/ProjectScopeGuard';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import {
  ProjectSetupPage,
  CoaPage,
  RocPage,
  BudgetPage,
  ProgressPage,
  ChangesPage,
  ReportsPage,
} from './pages/stubs';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AuthGuard>
              <AppShell />
            </AuthGuard>
          }
        >
          <Route index element={<DashboardPage />} handle={{ title: 'Executive Dashboard' }} />
          <Route path="projects" element={<ProjectSetupPage />} handle={{ title: 'Project Setup' }} />
          <Route path="coa" element={<CoaPage />} handle={{ title: 'COA & Unit Rates' }} />
          <Route path="roc" element={<RocPage />} handle={{ title: 'Rules of Credit' }} />
          <Route
            path="budget"
            element={
              <ProjectScopeGuard>
                <BudgetPage />
              </ProjectScopeGuard>
            }
            handle={{ title: 'Budget & Baseline' }}
          />
          <Route
            path="progress"
            element={
              <ProjectScopeGuard>
                <ProgressPage />
              </ProjectScopeGuard>
            }
            handle={{ title: 'Progress & Earned Value' }}
          />
          <Route
            path="changes"
            element={
              <ProjectScopeGuard>
                <ChangesPage />
              </ProjectScopeGuard>
            }
            handle={{ title: 'Change Management' }}
          />
          <Route
            path="reports"
            element={
              <ProjectScopeGuard>
                <ReportsPage />
              </ProjectScopeGuard>
            }
            handle={{ title: 'Reports & Analytics' }}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

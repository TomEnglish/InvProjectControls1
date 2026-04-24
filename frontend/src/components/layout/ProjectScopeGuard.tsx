import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useProjectStore } from '@/stores/project';

export function ProjectScopeGuard({ children }: { children: ReactNode }) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  if (!currentProjectId) {
    return <Navigate to="/projects" replace />;
  }
  return <>{children}</>;
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export type DisciplineRollup = {
  discipline_id: string;
  discipline_code: string;
  display_name: string;
  records: number;
  budget_hrs: number;
  earned_hrs: number;
  actual_hrs: number;
  earned_pct: number;
  cpi: number | null;
};

export type ProjectSummary = {
  project_id: string;
  total_budget_hrs: number;
  total_earned_hrs: number;
  total_actual_hrs: number;
  overall_pct: number;
  cpi: number | null;
  spi: number | null;
  disciplines: DisciplineRollup[];
};

export type ProgressPeriod = {
  id: string;
  period_number: number;
  start_date: string;
  end_date: string;
  locked_at: string | null;
  bcws_hrs: number | null;
  bcwp_hrs: number | null;
  acwp_hrs: number | null;
};

export function useProjectSummary(projectId: string | null) {
  return useQuery({
    queryKey: ['project-summary', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectSummary> => {
      const { data, error } = await supabase.rpc('project_summary', { p_project_id: projectId });
      if (error) throw error;
      return data as ProjectSummary;
    },
  });
}

export function useProgressPeriods(projectId: string | null) {
  return useQuery({
    queryKey: ['progress-periods', projectId] as const,
    enabled: !!projectId,
    queryFn: async (): Promise<ProgressPeriod[]> => {
      const { data, error } = await supabase
        .from('progress_periods')
        .select('id, period_number, start_date, end_date, locked_at, bcws_hrs, bcwp_hrs, acwp_hrs')
        .eq('project_id', projectId!)
        .order('period_number');
      if (error) throw error;
      return (data ?? []) as ProgressPeriod[];
    },
  });
}

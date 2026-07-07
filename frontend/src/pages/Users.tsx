import { useCurrentUser, hasRole } from '@/lib/queries';
import { Card } from '@/components/ui/Card';
import { UsersCard } from '@/components/projects/UsersCard';
import { ForemanAliasesCard } from '@/components/projects/ForemanAliasesCard';
import { ClerkCraftsCard } from '@/components/projects/ClerkCraftsCard';
import { RoleMatrixCard } from '@/components/projects/RoleMatrixCard';
import { ExportDataCard } from '@/components/reports/ExportDataCard';

/**
 * Tenant-wide user administration (A15). Consolidates users, invites,
 * and foreman aliases off the Project Setup page so PMs working on a
 * specific project don't have to scroll past tenant-wide knobs they
 * don't own.
 *
 * Route-level role gate: admin+ only. UsersCard tightens edit to
 * super_admin internally; ForemanAliasesCard tightens edit to admin
 * internally. Both happily read-only for any role admitted to the page.
 */
export function UsersPage() {
  const { data: me, isLoading } = useCurrentUser();

  if (isLoading) {
    return (
      <Card>
        <div className="is-skeleton" style={{ height: 200 }} />
      </Card>
    );
  }
  if (!hasRole(me?.role, 'admin')) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          User administration — restricted to Controllers. Ask a tenant
          Controller to manage users on your behalf.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <UsersCard />
      <ExportDataCard />
      <ClerkCraftsCard />
      <ForemanAliasesCard />
      <RoleMatrixCard />
    </div>
  );
}

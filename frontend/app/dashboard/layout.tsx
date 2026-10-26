import { Metadata } from "next";
import { DashboardGuard } from '@/components/auth/dashboard-guard';

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your account and view your activity",
};

export const dynamic = 'force-dynamic'

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1"><DashboardGuard>{children}</DashboardGuard></div>
    </div>
  );
}

'use client';

import { Suspense } from "react";

import dynamic from "next/dynamic";
 
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { DashboardShell } from "@/components/features/dashboard/dashboard-shell";

// Dynamically import heavy components 
const DashboardTabs = dynamic(() => import("@/components/features/dashboard/dashboard-tabs").then(mod => mod.DashboardTabs), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse bg-muted rounded-lg" />
});

const UserStats = dynamic(() => import("@/components/features/dashboard/user-stats").then(mod => mod.UserStats), {
  ssr: false,
  loading: () => <div className="h-[100px] animate-pulse bg-muted rounded-lg" />
});

const RecentActivity = dynamic(() => import("@/components/features/dashboard/recent-activity").then(mod => mod.RecentActivity), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse bg-muted rounded-lg" />
});

/**
 * ClientDashboardPage - A client component that wraps all the client-side dashboard functionality
 * This is separated to allow the parent page.tsx to be a server component
 */
export function ClientDashboardPage() {
  return (
    <DashboardShell>
      <DashboardHeader 
        heading="Dashboard"
        text="Manage your account and view your activity"
      />
      <div className="grid gap-8">
        <Suspense fallback={<div className="h-[100px] animate-pulse bg-muted rounded-lg" />}>
          <SellerOnboardingCard />
        </Suspense>
        <Suspense fallback={<div className="h-[100px] animate-pulse bg-muted rounded-lg" />}>
          <UserStats />
        </Suspense>
        <Suspense fallback={<div className="h-[200px] animate-pulse bg-muted rounded-lg" />}>
          <DashboardTabs />
        </Suspense>
        <Suspense fallback={<div className="h-[300px] animate-pulse bg-muted rounded-lg" />}>
          <RecentActivity />
        </Suspense>
      </div>
    </DashboardShell>
  );
} 
const SellerOnboardingCard = dynamic(() => import("@/components/features/dashboard/seller-onboarding-card").then(mod => mod.default), {
  ssr: false,
  loading: () => <div className="h-[100px] animate-pulse bg-muted rounded-lg" />
});

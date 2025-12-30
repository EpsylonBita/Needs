"use client";

import { redirect } from "next/navigation";

import { useAuth } from "@/contexts/auth-context";

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const { user, isLoading } = useAuth();

  if (!isLoading && !user) {
    redirect("/");
  }

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        {children}
      </div>
    </div>
  );
} 

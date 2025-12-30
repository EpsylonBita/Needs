"use client"

import { useMemo, useState } from "react"

import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const DashboardTabs = dynamic(() => import("@/components/features/dashboard/dashboard-tabs").then(mod => mod.DashboardTabs), { ssr: false })
const UserStats = dynamic(() => import("@/components/features/dashboard/user-stats").then(mod => mod.UserStats), { ssr: false })
const RecentActivity = dynamic(() => import("@/components/features/dashboard/recent-activity").then(mod => mod.RecentActivity), { ssr: false })

export function ProfileTabs() {
  const searchParams = useSearchParams()
  const initial = useMemo(() => searchParams.get('tab') || 'listings', [searchParams])
  const [tab, setTab] = useState(initial)
  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="listings">Listings</TabsTrigger>
        <TabsTrigger value="reviews">Reviews</TabsTrigger>
        <TabsTrigger value="saved">Saved</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="listings" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Listings</CardTitle>
            <CardDescription>
              Manage your active listings and view their performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] rounded-md border p-4">
              <div className="grid gap-4">
                {/* Placeholder for listings */}
                <p className="text-muted-foreground">No listings yet</p>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="reviews" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Reviews</CardTitle>
            <CardDescription>
              See what others are saying about you
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] rounded-md border p-4">
              <div className="grid gap-4">
                {/* Placeholder for reviews */}
                <p className="text-muted-foreground">No reviews yet</p>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="saved" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Saved Items</CardTitle>
            <CardDescription>
              Items you've saved for later
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] rounded-md border p-4">
              <div className="grid gap-4">
                {/* Placeholder for saved items */}
                <p className="text-muted-foreground">No saved items yet</p>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="settings" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>
              Manage your profile settings and preferences
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] rounded-md border p-4">
              <div className="grid gap-4">
                {/* Placeholder for settings */}
                <p className="text-muted-foreground">Settings coming soon</p>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
} 
      <TabsContent value="dashboard" className="mt-6">
        <div className="grid gap-8">
          <UserStats />
          <DashboardTabs />
          <RecentActivity />
        </div>
      </TabsContent>

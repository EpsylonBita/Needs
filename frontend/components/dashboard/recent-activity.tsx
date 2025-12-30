"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RecentActivity() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>
          Your recent activity and notifications
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {/* Today's Activity */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">TODAY</h4>
            <div className="grid gap-4">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                  </div>
                  <div className="absolute w-px h-full bg-border left-1 top-3" />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium">New listing created</p>
                  <p className="text-sm text-muted-foreground">
                    You created a new listing "iPhone 13 Pro Max"
                  </p>
                  <p className="text-xs text-muted-foreground">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </div>
                  <div className="absolute w-px h-full bg-border left-1 top-3" />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium">Sale completed</p>
                  <p className="text-sm text-muted-foreground">
                    You sold "MacBook Pro M1" for $1,299
                  </p>
                  <p className="text-xs text-muted-foreground">5 hours ago</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Yesterday's Activity */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">YESTERDAY</h4>
            <div className="grid gap-4">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                  </div>
                  <div className="absolute w-px h-full bg-border left-1 top-3" />
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium">Listing updated</p>
                  <p className="text-sm text-muted-foreground">
                    You updated the price of "iPad Air 5th Gen"
                  </p>
                  <p className="text-xs text-muted-foreground">Yesterday at 11:34 PM</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="flex h-2 w-2">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </div>
                </div>
                <div className="grid gap-1">
                  <p className="text-sm font-medium">Message received</p>
                  <p className="text-sm text-muted-foreground">
                    John Doe sent you a message about "AirPods Pro"
                  </p>
                  <p className="text-xs text-muted-foreground">Yesterday at 9:42 PM</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 
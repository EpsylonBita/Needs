import { Star, MessageSquare, Package, Heart } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

const stats = [
  {
    label: "Average Rating",
    value: "4.8",
    icon: Star,
    description: "Based on 24 reviews",
  },
  {
    label: "Messages",
    value: "128",
    icon: MessageSquare,
    description: "Total conversations",
  },
  {
    label: "Items Listed",
    value: "37",
    icon: Package,
    description: "Active listings",
  },
  {
    label: "Saved Items",
    value: "15",
    icon: Heart,
    description: "Items in wishlist",
  },
]

export function ProfileStats() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.label} className="overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-blue-50 p-2.5">
                  <Icon className="h-6 w-6 text-blue-600" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">
                      {stat.description}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
} 

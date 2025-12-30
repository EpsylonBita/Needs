"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SaleItem {
  name: string;
  email: string;
  amount: string;
  initials: string;
}

const recentSales: SaleItem[] = [
  {
    name: "Olivia Martin",
    email: "olivia.martin@email.com",
    amount: "+$1,999.00",
    initials: "OM"
  },
  {
    name: "Jackson Lee",
    email: "jackson.lee@email.com",
    amount: "+$39.00",
    initials: "JL"
  },
  {
    name: "Isabella Nguyen",
    email: "isabella.nguyen@email.com",
    amount: "+$299.00",
    initials: "IN"
  },
  {
    name: "William Kim",
    email: "will@email.com",
    amount: "+$99.00",
    initials: "WK"
  },
  {
    name: "Sofia Davis",
    email: "sofia.davis@email.com",
    amount: "+$39.00",
    initials: "SD"
  }
];

export function RecentSales() {
  return (
    <div className="p-6">
      <div className="space-y-1">
        <h3 className="text-lg font-medium">Recent Sales</h3>
        <p className="text-sm text-muted-foreground">
          You made 265 sales this month.
        </p>
      </div>
      <div className="space-y-8 mt-6">
        {recentSales.map((sale) => (
          <div key={sale.email} className="flex items-center">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{sale.initials}</AvatarFallback>
            </Avatar>
            <div className="ml-4 space-y-1">
              <p className="text-sm font-medium leading-none">{sale.name}</p>
              <p className="text-sm text-muted-foreground">
                {sale.email}
              </p>
            </div>
            <div className="ml-auto font-medium">{sale.amount}</div>
          </div>
        ))}
      </div>
    </div>
  );
} 
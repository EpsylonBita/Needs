import { Skeleton } from '@/components/ui/skeleton';

export function LoadingMap() {
  return (
    <div className="w-full h-full relative">
      <Skeleton className="absolute inset-0" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-muted-foreground">Loading map...</div>
      </div>
    </div>
  );
} 
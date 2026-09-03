import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

// P8 404 兜底页

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background font-sans">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-foreground">页面不存在</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          你访问的页面不存在或已被移除
        </p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">返回工作台</Link>
        </Button>
      </div>
    </div>
  );
}
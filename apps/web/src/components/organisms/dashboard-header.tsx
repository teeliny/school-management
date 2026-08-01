import { Button } from "../atoms/button";

interface DashboardHeaderProps {
  firstName: string;
  lastName: string;
  onLogout: () => void;
}

export function DashboardHeader({ firstName, lastName, onLogout }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="text-xl font-semibold">
        Welcome, {firstName} {lastName}
      </h1>
      <Button variant="outline" onClick={onLogout} className="px-3 py-1 text-sm">
        Log out
      </Button>
    </div>
  );
}

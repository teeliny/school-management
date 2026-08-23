import type { ReactNode } from "react";
import { PublicLayout } from "../../components/templates/public-layout";

export default function PublicRouteLayout({ children }: { children: ReactNode }) {
  return <PublicLayout>{children}</PublicLayout>;
}

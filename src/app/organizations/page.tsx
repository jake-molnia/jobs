import { Suspense } from "react";
import { Organizations } from "@/components/organizations";
export default function OrganizationsPage() {
  return (
    <Suspense
      fallback={
        <p className="p-8 text-sm text-muted-foreground">
          Loading organizations…
        </p>
      }
    >
      <Organizations />
    </Suspense>
  );
}

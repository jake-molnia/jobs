import { Suspense } from "react";
import { Collection, CollectionSkeleton } from "@/components/collection";
export default function Page() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <Collection />
    </Suspense>
  );
}

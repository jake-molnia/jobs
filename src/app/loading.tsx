import { CollectionSkeleton } from "@/components/collection";
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-xl font-semibold">Collection</h1>
      <CollectionSkeleton />
    </main>
  );
}

import ExperienceReviewClient from "./ExperienceReviewClient";

export const instant = false;

export default async function ExperiencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  return <ExperienceReviewClient sourceId={resolvedParams.id} />;
}

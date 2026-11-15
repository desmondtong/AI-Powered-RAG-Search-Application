import FilePageClient from "./FilePageClient";

export const instant = false;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExperienceFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <FilePageClient key={id} sourceId={id} cite={first(query.cite) ?? null} rev={first(query.rev) ?? null} />;
}

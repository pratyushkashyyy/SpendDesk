import { redirect } from "next/navigation";
import { authenticated } from "@/lib/server/auth";
import Dashboard from "@/components/dashboard";
import { resolveReportSelection } from "@/lib/report-selection";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await authenticated())) redirect("/login");
  return (
    <Dashboard initialRange={resolveReportSelection(await searchParams)} />
  );
}

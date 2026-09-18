import { redirect } from "next/navigation";
import { authenticated } from "@/lib/server/auth";
import Dashboard from "@/components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!(await authenticated())) redirect("/login");
  return <Dashboard />;
}

import Dashboard from "./dashboard";
import { publicState } from "../lib/news-store";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <Dashboard initial={await publicState()} />;
}

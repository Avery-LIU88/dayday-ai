import Dashboard from "./dashboard";
import { snapshot } from "../lib/store";
import { getChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const [data, user] = await Promise.all([snapshot(), getChatGPTUser()]);
  return <Dashboard initial={{...data,user:user?.email??null}} />;
}

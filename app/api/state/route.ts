import { snapshot } from "../../../lib/store";
import { getChatGPTUser } from "../../chatgpt-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const [data,user]=await Promise.all([snapshot(),getChatGPTUser()]);
  return Response.json({...data,user:user?.email??null},{headers:{"Cache-Control":"no-store"}});
}

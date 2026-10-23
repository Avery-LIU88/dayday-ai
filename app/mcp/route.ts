import {publicState} from '../../lib/news-store';
import {mcpResponse} from '../../lib/distribution-http.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return mcpResponse(request,publicState);}
export async function GET(){return new Response(null,{status:405,headers:{Allow:'POST'}});}

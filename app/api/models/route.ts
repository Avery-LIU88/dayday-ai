import {modelRankings} from '../../../lib/model-ranking-store';
export const dynamic='force-dynamic';
export async function GET(){
 return Response.json(await modelRankings(),{headers:{'Cache-Control':'public, max-age=300'}});
}

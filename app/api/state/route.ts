import {publicState} from '../../../lib/news-store';
export const dynamic='force-dynamic';
export async function GET(){return Response.json(await publicState(),{headers:{'Cache-Control':'public, max-age=60, stale-while-revalidate=120'}});}

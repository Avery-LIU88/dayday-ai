import {publicState} from '../../../../lib/news-store';
import {distributionResponse,options} from '../../../../lib/distribution-http.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return distributionResponse(request,'events',publicState);}
export const OPTIONS=options;

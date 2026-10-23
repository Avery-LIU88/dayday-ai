import {distributionResponse,options} from '../../../lib/distribution-http.mjs';
export async function GET(request:Request){return distributionResponse(request,'docs',undefined);}
export const OPTIONS=options;

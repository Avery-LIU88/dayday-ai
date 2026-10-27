import {env} from 'cloudflare:workers';
import {backupResponse} from '../../../lib/migration-backup.mjs';
import {backupRecipient} from '../../../lib/migration-recipient.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return backupResponse(request,env,backupRecipient);}
export async function GET(request:Request){return backupResponse(request,env,backupRecipient);}

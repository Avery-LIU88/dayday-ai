import {writeFile} from 'node:fs/promises';
import {fetchMediaSnapshot} from '../lib/model-media.mjs';
const snapshot=await fetchMediaSnapshot();
await writeFile(new URL('../data/model-media.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({updatedAt:snapshot.updatedAt,boards:snapshot.boards.map(b=>({id:b.id,models:b.rows.length,published:b.evaluatedAt}))}));

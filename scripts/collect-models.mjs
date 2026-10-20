import {writeFile} from 'node:fs/promises';
import {fetchModelSnapshot} from '../lib/model-ranking-fetch.mjs';
const snapshot=await fetchModelSnapshot();
await writeFile(new URL('../data/model-rankings.json',import.meta.url),JSON.stringify(snapshot)+'\n');
console.log(JSON.stringify({updatedAt:snapshot.updatedAt,boards:snapshot.boards.map(b=>({id:b.id,models:b.rows.length}))}));

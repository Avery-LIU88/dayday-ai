import {writeFile} from 'node:fs/promises';
import {fetchCostSnapshot} from '../lib/model-cost.mjs';
const snapshot=await fetchCostSnapshot();
await writeFile(new URL('../data/model-costs.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({updatedAt:snapshot.updatedAt,models:snapshot.rows.length}));

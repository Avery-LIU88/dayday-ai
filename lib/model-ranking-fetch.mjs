import {inflateRawSync} from 'node:zlib';
import {benchmarks,buildModelSnapshot,EPOCH_DOWNLOAD} from './model-ranking.mjs';

// Read only selected small CSV entries. Bound archive and inflated sizes for Worker memory.
export function readEpochZip(input){
 const bytes=Buffer.from(input);
 if(bytes.length>12*1024*1024)throw Error('Archive too large');
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
 if(end<0)throw Error('Invalid ZIP');
 let position=bytes.readUInt32LE(end+16);
 const count=bytes.readUInt16LE(end+10),wanted=new Set([...benchmarks.map(b=>b.file),'model_metadata.csv']),files={};
 for(let i=0;i<count;i++){
  if(bytes.readUInt32LE(position)!==0x02014b50)throw Error('Invalid ZIP directory');
  const method=bytes.readUInt16LE(position+10),size=bytes.readUInt32LE(position+20),expanded=bytes.readUInt32LE(position+24);
  const length=bytes.readUInt16LE(position+28),extra=bytes.readUInt16LE(position+30),comment=bytes.readUInt16LE(position+32),offset=bytes.readUInt32LE(position+42);
  const name=bytes.toString('utf8',position+46,position+46+length);
  if(wanted.has(name)){
   if(expanded>4*1024*1024)throw Error('CSV too large');
   if(bytes.readUInt32LE(offset)!==0x04034b50)throw Error('Invalid ZIP entry');
   const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);
   const packed=bytes.subarray(start,start+size);
   const decoded=method===8?inflateRawSync(packed,{maxOutputLength:4*1024*1024}):method===0?packed:null;
   if(!decoded||decoded.length!==expanded)throw Error('Invalid CSV size');
   files[name]=decoded.toString('utf8');
  }
  position+=46+length+extra+comment;
 }
 return files;
}
export async function fetchModelSnapshot(fetcher=fetch){
 const response=await fetcher(EPOCH_DOWNLOAD,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'DayDayAI/1.0 (+https://ai-observer-avery.activecoot128.chatgpt.site)'}});
 if(!response.ok)throw Error(`Epoch HTTP ${response.status}`);
 if(Number(response.headers.get('content-length'))>12*1024*1024)throw Error('Archive too large');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty archive');
 const chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>12*1024*1024){await reader.cancel();throw Error('Archive too large');}chunks.push(Buffer.from(value));}
 return buildModelSnapshot(readEpochZip(Buffer.concat(chunks)),new Date().toISOString());
}

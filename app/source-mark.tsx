'use client';
import {useState} from 'react';
import icons from '../data/source-icons.json';
const manifest=icons as Record<string,{path:string}>;
export default function SourceMark({publisher,name}:{publisher:string;name:string}){
 const [failed,setFailed]=useState(false),src=manifest[publisher]?.path;
 return <span className="source-brand" title={name}>{src&&!failed&&<img src={src} width={20} height={20} loading="lazy" alt="" onError={()=>setFailed(true)}/>}<span>{name.replace(/ ·.*/,'')}</span></span>;
}

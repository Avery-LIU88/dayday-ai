import type {ModelRow,ModelBoard} from './model-ranking-types';
export type DisplayRow=ModelRow&{samples?:number|null;uncertainty?:number|null;preliminary?:boolean;available?:boolean;modelURL?:string|null;sourceIcon?:string|null};
export type DisplayBoard=Omit<ModelBoard,'rows'>&{rows:DisplayRow[];label:string;metric:string;decimals:number;sourceName:string;source:string;license:string|null;updatedAt:string};
export type MediaSnapshot={version:number;updatedAt:string;boards:DisplayBoard[]};

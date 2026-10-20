export type ModelRow={
 id:string;name:string;configuration:string;organization:string;score:number;rank:number;
 releaseDate:string|null;evaluatedAt:string|null;logURL:string|null;
 intervalLow:number|null;intervalHigh:number|null;standardError:number|null;
};
export type ModelBoard={
 id:string;category:string;name:string;unit:string;description:string;url:string;
 rows:ModelRow[];evaluatedAt:string|null;
};
export type ModelSnapshot={version:number;updatedAt:string;source:string;boards:ModelBoard[]};
export type ModelHealth={ok:boolean;checkedAt:string;error?:string};

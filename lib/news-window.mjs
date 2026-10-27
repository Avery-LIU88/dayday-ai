// A run's window is fixed before its first source request and reused by retries.
export function collectionWindow(end=new Date().toISOString()){
 const time=Date.parse(end);if(!Number.isFinite(time))throw Error('无效采集窗口');
 return {start:new Date(time-24*3600000).toISOString(),end:new Date(time).toISOString()};
}
export function inCollectionWindow(item,window){
 if(item.activityListing)return true;
 const time=Date.parse(item.publishedAt);return Number.isFinite(time)&&time>=Date.parse(window.start)&&time<=Date.parse(window.end);
}

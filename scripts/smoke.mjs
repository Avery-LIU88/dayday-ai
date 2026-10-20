import assert from "node:assert/strict";
const origin="http://127.0.0.1:5173";
const state=await fetch(`${origin}/api/state`).then(r=>r.json());
assert.equal(state.databaseReady,true,"D1 database must be available");
assert.ok(state.entries.length>0,"Real entries are loaded");
const unauth=await fetch(`${origin}/api/action`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"follow",id:"valley101",active:true,mode:"digest"})});
assert.equal(unauth.status,401,"Anonymous writes must be rejected");
const login=await fetch(`${origin}/signin-with-chatgpt?return_to=/`,{redirect:"manual"});
const cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
assert.ok(cookie,"Local-only mock login must set a cookie");
const post=async data=>{
 const r=await fetch(`${origin}/api/action`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,Origin:origin},body:JSON.stringify(data)});
 return {status:r.status,data:await r.json()};
};
const get=()=>fetch(`${origin}/api/state`,{headers:{Cookie:cookie}}).then(r=>r.json());
const show=state.sources.find(s=>s.kind==="podcast");
const priorFollow=state.follows.find(f=>f.showId===show.id);
const entry=state.entries[0],priorSaved=state.saved.includes(entry.id);
try {
 assert.equal((await post({action:"follow",id:show.id,active:true,mode:"instant"})).status,200);
 assert.equal((await get()).follows.find(f=>f.showId===show.id).mode,"instant","Follow persists");
 assert.equal((await post({action:"save",id:entry.id,active:true})).status,200);
 assert.ok((await get()).saved.includes(entry.id),"Bookmark persists");
 assert.equal((await post({action:"preferences",value:{enabled:false,digestTime:"09:30",quiet:true}})).status,200);
 assert.equal((await get()).preferences.digestTime,"09:30","Preferences persist");
 assert.equal((await post({action:"preferences",value:{enabled:false,digestTime:"23:30",quiet:true}})).status,400,"Invalid quiet time rejected");
 assert.equal((await post({action:"follow",id:"not-a-show",active:true,mode:"digest"})).status,400);
 const csrf=await fetch(`${origin}/api/action`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,Origin:"https://other.invalid"},body:JSON.stringify({action:"save",id:entry.id,active:true})});
 assert.equal(csrf.status,403,"Cross-origin writes rejected");
 if(!state.feishuConnected)assert.equal((await post({action:"test"})).status,400,"No Webhook must not pretend to send");
 console.log("PASS: real content, database, authentication, follow, bookmark, settings, validation, CSRF, missing Feishu configuration.");
}finally{
 await post({action:"follow",id:show.id,active:!!priorFollow,mode:priorFollow?.mode||"digest"});
 await post({action:"save",id:entry.id,active:priorSaved});
 await post({action:"preferences",value:state.preferences});
}

// Former owner-shared writes are closed. Bookmarks now stay in the browser.
export async function POST(){return Response.json({error:'此接口已关闭；收藏保存在当前浏览器。'},{status:410});}

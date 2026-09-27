/* Keep Google account caches separate from guest browser records. */
let accessReady=false, cloudDirty=false, cloudLoading=false, identityVersion=0, saving=null;
const guestBrowserId=localStorage.getItem('easyinvoice_user_id');
function appMessage(message,error=false){
  let box=document.getElementById('sync-message');
  if(!box){box=document.createElement('p');box.id='sync-message';box.setAttribute('role','status');box.style.cssText='position:sticky;top:0;z-index:60;padding:12px 20px;background:#eef2ff;color:#312e81;margin:0;';document.body.prepend(box);}
  box.textContent=message;box.style.background=error?'#fff1f2':'#eef2ff';box.hidden=!message;
}
function showAccess(policy){
  document.getElementById('access-blocked')?.remove();
  if(policy.blocked){const panel=document.createElement('section');panel.id='access-blocked';panel.style.cssText='position:fixed;inset:0;z-index:9999;background:#f8fafc;display:grid;place-content:center;padding:30px;text-align:center;gap:16px';
    const title=document.createElement('h1');title.textContent='App access is blocked';const text=document.createElement('p');text.textContent='Contact craftsbyzareen@gmail.com about this account. Your saved cloud records have not been deleted.';
    const exit=document.createElement('button');exit.textContent='Sign out';exit.onclick=()=>easyAuth.signOut();const privacy=document.createElement('a');privacy.href='privacy.html';privacy.textContent='Privacy policy';panel.append(title,text,exit,privacy);document.body.append(panel);}
}
function canUseApp(){if(!accessReady||EasyUsage.policy.blocked){alert(!accessReady?'Please wait for the account check to finish.':'App access is blocked.');return false;}return true;}
function canStore(documents,clients){if(!canUseApp())return false;const p=EasyUsage.policy;if((documents>p.maxDocuments&&documents>savedDocuments.length)||(clients>p.maxClients&&clients>savedClients.length)){alert(`Your limit is ${p.maxDocuments} saved documents and ${p.maxClients} saved clients. Remove an existing record or contact the administrator.`);return false;}return true;}
function cacheCurrent(){for(const [key,value]of Object.entries(currentSnapshot()))localStorage.setItem(`easyinvoice_${currentUserId}_${key}`,JSON.stringify(value));}
function initFirebaseAuthAndSync(){
  if(!window.easyFirebaseReady){accessReady=true;appMessage('Cloud services are unavailable. Guest records stay on this device.',true);return;}
  EasyUsage.connect({auth:easyAuth,db:easyDb,counts:()=>({documents:savedDocuments.length,clients:savedClients.length}),onPolicy:showAccess,
    onIdentity:async(user,policy)=>{
      const version=++identityVersion;accessReady=false;cloudDirty=false;clearTimeout(syncTimer);cloudUser=null;cloudLoading=true;
      documentItems=[];editingDocId=null;router('home',true);
      updateAuthUI(user&&!user.isAnonymous?user:null);
      document.getElementById('admin-link')?.remove();
      if(user?.email===EASY_ADMIN_EMAIL&&user.emailVerified){const link=document.createElement('a');link.id='admin-link';link.href='admin.html';link.textContent=' · Admin dashboard';document.getElementById('app-footer').append(link);}
      if(policy.blocked){applyCloudData({});cloudLoading=false;return;}
      if(user&&!user.isAnonymous){
        const guestData=currentSnapshot(), fromGuest=!currentUserId.startsWith('cloud_');
        currentUserId='cloud_'+user.uid;applyCloudData({});
        try{const snap=await easyDb.doc(`users/${user.uid}/appData/main`).get({source:'server'});if(version!==identityVersion)return;
          if(snap.exists)applyCloudData(snap.data());
          else if(fromGuest&&(guestData.documents.length||guestData.clients.some(c=>c.id!=='CLI-1')||guestData.profile.name)&&confirm('Copy the guest records on this device into this Google account?')){applyCloudData(guestData);cloudDirty=true;}
          const pending=localStorage.getItem('easy_pending_'+user.uid);
          if(pending&&confirm('This account has changes on this device that were not synced. Restore them for review and retry saving?')){applyCloudData(JSON.parse(pending));cloudDirty=true;}
          cacheCurrent();cloudUser=user;accessReady=true;appMessage('Cloud records loaded. Changes are saved automatically.');
        }catch(e){appMessage('Cloud records could not be loaded. Editing is paused to protect existing data. Reload to try again.',true);throw e;}
      }else{
        currentUserId=guestBrowserId||localStorage.getItem('easyinvoice_user_id');applyCloudData({});loadCompanyProfile();loadSavedClients();loadSavedDocuments();accessReady=true;appMessage('');
        if(!user&&accessChoiceMade)easyAuth.signInAnonymously().catch(()=>appMessage('Guest tracking is unavailable. Documents still save on this device.',true));
      }
      cloudLoading=false;if(cloudDirty)queueCloudSync();
    },onError:e=>{cloudLoading=false;appMessage('Account check failed. Reload to retry. '+e.message,true);}
  });
}
async function continueAsGuest(){enterApplication();if(easyAuth&&!easyAuth.currentUser){try{await easyAuth.signInAnonymously();}catch(e){accessReady=true;appMessage('Guest tracking unavailable; records remain on this device.',true);}}}
function queueCloudSync(){EasyUsage.record();if(!cloudUser||cloudLoading)return;cloudDirty=true;clearTimeout(syncTimer);syncTimer=setTimeout(()=>saveCloudNow().catch(e=>appMessage(e.message,true)),5000);}
async function saveCloudNow(){
  if(!cloudUser||!cloudDirty||cloudLoading)return;if(saving){await saving;if(cloudDirty)return saveCloudNow();return;}
  const user=cloudUser,version=identityVersion,snapshot=JSON.parse(JSON.stringify(currentSnapshot()));cloudDirty=false;
  saving=(async()=>{
    const p=await EasyUsage.refreshPolicy();if(p.blocked)throw Error('Cloud save stopped: this account is blocked.');
    const ref=easyDb.doc(`users/${user.uid}/appData/main`);
    await easyDb.runTransaction(async tx=>{
      const prior=await tx.get(ref),old=prior.exists?prior.data():{},day=Math.floor(Date.now()/86400000),n=(old.usageDay===day?old.cloudSavesToday||0:0)+1;
      if(n>p.maxCloudSavesPerDay)throw Error('Daily cloud save limit reached. Your latest changes remain on this device. Try tomorrow (UTC) or contact the administrator.');
      if((snapshot.documents.length>p.maxDocuments&&snapshot.documents.length>(old.documents?.length||0))||(snapshot.clients.length>p.maxClients&&snapshot.clients.length>(old.clients?.length||0)))throw Error('Cloud save limit exceeded. Remove newly added records or contact the administrator.');
      tx.set(ref,{...snapshot,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),usageDay:day,cloudSavesToday:n});
    });
    if(version===identityVersion){localStorage.removeItem('easy_pending_'+user.uid);appMessage('Changes saved to your Google account.');}
  })();
  try{await saving;}catch(e){if(version===identityVersion){cloudDirty=true;localStorage.setItem('easy_pending_'+user.uid,JSON.stringify(snapshot));}throw Error('Cloud sync failed. '+e.message);}finally{saving=null;}
}
async function signOutGoogle(){
  try{await saveCloudNow();}catch(e){if(!confirm(e.message+' Sign out anyway? Unsynced records remain in this account’s local cache.'))return;}
  await easyAuth.signOut();
}
const originalSaveDocument=saveDocument;
saveDocument=function(){const data=gatherDocumentData(),exists=savedDocuments.some(d=>d.id===data.id||(d.type===data.type&&d.docNumber===data.docNumber)),newClient=data.clientName.trim()&&!savedClients.some(c=>c.name.toLowerCase()===data.clientName.trim().toLowerCase());if(canStore(savedDocuments.length+(exists?0:1),savedClients.length+(newClient?1:0)))originalSaveDocument();};
const originalSaveClient=saveClientFromModal;
saveClientFromModal=function(){if(canStore(savedDocuments.length,savedClients.length+(document.getElementById('modal-client-id').value?0:1)))originalSaveClient();};
for(const name of ['saveProfile','startNewDocument','openClientModal']){const original=window[name];if(typeof original==='function')window[name]=function(...args){if(canUseApp())return original.apply(this,args);};}
for(const name of ['shareDocumentAsPDF','downloadAsImage']){const original=window[name];if(typeof original==='function')window[name]=function(...args){if(!canUseApp())return;EasyUsage.record('exports');return original.apply(this,args);};}
window.addEventListener('beforeunload',()=>{if(cloudUser&&cloudDirty)localStorage.setItem('easy_pending_'+cloudUser.uid,JSON.stringify(currentSnapshot()));});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&EasyUsage.user)EasyUsage.refreshPolicy().catch(()=>{});});

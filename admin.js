'use strict';
firebase.initializeApp(EASY_FIREBASE_CONFIG);
const auth=firebase.auth(), db=firebase.firestore(), $=id=>document.getElementById(id);
let admin=null, rows=[], cursor=null, selected=null, busy=false, revision=0, pendingAccess=null;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function date(value){return value?.toDate?value.toDate().toLocaleString():'Not tracked yet';}
function add(parent,tag,text){const element=document.createElement(tag);element.textContent=text;parent.append(element);return element;}
async function total(kind){
  const token=await admin.getIdToken();
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${EASY_FIREBASE_CONFIG.projectId}/databases/(default)/documents:runAggregationQuery`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'activity'}],where:{fieldFilter:{field:{fieldPath:'kind'},op:'EQUAL',value:{stringValue:kind}}}},aggregations:[{alias:'total',count:{}}]}})});
  const result=await response.json();if(!response.ok)throw Error(result.error?.message||'Unable to count accounts.');return Number(result.find(r=>r.result)?.result.aggregateFields.total.integerValue||0);
}
async function action(fn){if(busy)return;busy=true;try{await fn();}catch(e){status('Could not complete this action: '+e.message,true);}finally{busy=false;}}
$('signin').onclick=()=>action(()=>auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
$('signout').onclick=()=>auth.signOut();
auth.onAuthStateChanged(async user=>{
  revision++;admin=null;rows=[];selected=null;pendingAccess=null;$('access-review').hidden=true;$('records').replaceChildren();$('accounts').replaceChildren();$('detail').hidden=true;$('dashboard').hidden=true;
  $('identity').textContent=user?.email||'';$('signout').hidden=!user;$('login').hidden=false;
  if(!user){status('Sign in to manage your site.');return;}
  const token=await user.getIdTokenResult();
  if(user.email!==EASY_ADMIN_EMAIL||!user.emailVerified||token.signInProvider!=='google.com'){status('This account does not have administrator access.',true);return;}
  admin=user;$('login').hidden=true;$('dashboard').hidden=false;status('Signed in securely. Refresh accounts to load activity.');
});
function render(){
  const needle=$('search').value.trim().toLowerCase();$('accounts').replaceChildren();
  for(const row of rows.filter(r=>[r.id,r.email,r.name].join(' ').toLowerCase().includes(needle))){
    const tr=add($('accounts'),'tr',''), who=add(tr,'td',row.email||row.name||'Older cloud account');add(who,'small',row.kind==='guest'?'Guest browser':row.kind==='legacy'?'Google · activity not recorded':'Google');
    add(tr,'td',date(row.lastSeen));add(tr,'td',row.sessions??'—');add(tr,'td',`${row.documents??'—'} / ${row.clients??'—'}`);add(tr,'td',`${row.exports??'—'} / ${row.measurements??'—'}`);
    const button=add(add(tr,'td',''),'button','Manage');button.onclick=()=>action(()=>openAccount(row));
  }
  $('list-note').textContent=`${rows.length} accounts loaded. Search filters this list only.`;
}
async function loadAccounts(next=false){
  const rev=revision;if(!admin)return;status('Loading activity…');
  let query=db.collection('activity');const kind=$('kind').value;if(kind!=='all')query=query.where('kind','==',kind);
  // Document ID ordering avoids requiring a paid or manually configured composite index.
  query=query.orderBy(firebase.firestore.FieldPath.documentId()).limit(25);if(next&&cursor)query=query.startAfter(cursor);
  const snap=await query.get({source:'server'});if(rev!==revision)return;
  if(!next) rows=[];rows.push(...snap.docs.map(d=>({id:d.id,...d.data()})));cursor=snap.docs.at(-1);$('more').hidden=snap.size<25;render();
  if(!next){const totals=await Promise.all(['google','guest'].map(total));if(rev!==revision)return;$('google-count').textContent=totals[0];$('guest-count').textContent=totals[1];}
  $('refreshed').textContent=new Date().toLocaleString();status('Activity loaded. Counts include accounts that have reported activity.');
}
$('refresh').onclick=()=>action(()=>loadAccounts());$('more').onclick=()=>action(()=>loadAccounts(true));$('search').oninput=render;
$('kind').onchange=()=>action(()=>loadAccounts());
$('legacy').onclick=()=>action(async()=>{const rev=revision;const snap=await db.collectionGroup('appData').limit(25).get({source:'server'});if(rev!==revision)return;rows=snap.docs.filter(d=>/^users\/[^/]+\/appData\/main$/.test(d.ref.path)).map(d=>({id:d.ref.parent.parent.id,kind:'legacy',documents:d.data().documents?.length||0,clients:d.data().clients?.length||0}));$('more').hidden=true;render();status('Showing up to 25 older cloud accounts. Email appears after their next app sign-in.');});
async function openAccount(row){
  pendingAccess=null;$('access-review').hidden=true;
  const rev=revision;const snap=await db.doc('access/'+row.id).get({source:'server'});if(rev!==revision)return;selected=row;
  const policy={...EASY_DEFAULT_LIMITS,...(snap.exists?snap.data():{})};$('detail-name').textContent=row.email||row.name||'Cloud account';$('detail-id').textContent=row.id;
  $('detail-note').textContent=row.kind==='guest'?'Only activity counts are available. This guest’s invoice and client contents stay in their browser.':'Saved cloud records are available on request below.';
  $('blocked').checked=policy.blocked;for(const key of ['maxDocuments','maxClients','maxCloudSavesPerDay'])$(key).value=policy[key];
  $('save-access').disabled=row.id===admin.uid;$('load-records').hidden=row.kind==='guest';$('records').replaceChildren();$('detail').hidden=false;$('detail').scrollIntoView({behavior:'smooth'});
}
$('close-detail').onclick=()=>{$('detail').hidden=true;selected=null;pendingAccess=null;};
$('controls').onsubmit=event=>{event.preventDefault();action(async()=>{
  if(!selected||selected.id===admin.uid)return;const target=selected.id;
  const settings={blocked:$('blocked').checked};for(const key of ['maxDocuments','maxClients','maxCloudSavesPerDay'])settings[key]=Number($(key).value);
  if(!Object.values(settings).every(v=>typeof v==='boolean'||Number.isInteger(v)))throw Error('Enter whole numbers for limits.');
  pendingAccess={target,settings};$('access-summary').textContent=`${selected.email||target}: ${settings.blocked?'Block access':'Allow access'}, up to ${settings.maxDocuments} documents, ${settings.maxClients} clients and ${settings.maxCloudSavesPerDay} cloud saves per UTC day.`;$('access-review').hidden=false;
});};
$('cancel-access').onclick=()=>{pendingAccess=null;$('access-review').hidden=true;};
$('confirm-access').onclick=()=>action(async()=>{
  if(!pendingAccess||!admin||selected?.id!==pendingAccess.target)return;
  const {target,settings}=pendingAccess;
  const batch=db.batch(),stamp=firebase.firestore.FieldValue.serverTimestamp();batch.set(db.doc('access/'+target),{...settings,updatedAt:stamp});batch.set(db.collection('adminAudit').doc(),{actor:admin.uid,target,action:'setAccess',at:stamp,settings});await batch.commit();pendingAccess=null;$('access-review').hidden=true;status('Access settings saved. Cloud enforcement is immediate; an open app refreshes its access on the next check.');
});
$('load-records').onclick=()=>action(async()=>{
  if(!selected)return;const uid=selected.id,rev=revision;const snap=await db.doc(`users/${uid}/appData/main`).get({source:'server'});if(rev!==revision||selected?.id!==uid)return;$('records').replaceChildren();
  if(!snap.exists){add($('records'),'p','No cloud records saved.');return;}
  const data=snap.data();add($('records'),'p',`Last saved: ${date(data.updatedAt)}. Cloud saves today (UTC): ${data.usageDay===Math.floor(Date.now()/86400000)?data.cloudSavesToday||0:0}.`);
  const show=(title,value)=>{const section=add($('records'),'details','');add(section,'summary',title);add(section,'pre',JSON.stringify(value,null,2));};
  show('Business profile',data.profile||{});for(const [i,record]of(data.documents||[]).entries())show(`Document ${i+1} · ${record.docNumber||record.id||''}`,record);for(const [i,record]of(data.clients||[]).entries())show(`Client ${i+1} · ${record.name||''}`,record);
  status('Cloud records loaded for administrator review.');
});

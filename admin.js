'use strict';
firebase.initializeApp(EASY_FIREBASE_CONFIG);
const auth=firebase.auth(), db=firebase.firestore(), $=id=>document.getElementById(id);
let admin=null, rows=[], cursor=null, busy=false, revision=0;
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
  revision++;admin=null;rows=[];cursor=null;$('accounts').replaceChildren();$('more').hidden=true;$('google-count').textContent='—';$('guest-count').textContent='—';$('dashboard').hidden=true;
  $('identity').textContent=user?.email||'';$('signout').hidden=!user;$('login').hidden=false;
  if(!user){status('Sign in to view account activity.');return;}
  const token=await user.getIdTokenResult();
  if(user.email!==EASY_ADMIN_EMAIL||!user.emailVerified||token.signInProvider!=='google.com'){status('This account does not have administrator access.',true);return;}
  admin=user;$('login').hidden=true;$('dashboard').hidden=false;status('Signed in securely. Refresh accounts to load activity.');
});
function render(){
  const needle=$('search').value.trim().toLowerCase();$('accounts').replaceChildren();
  for(const row of rows.filter(r=>[r.id,r.email,r.name].join(' ').toLowerCase().includes(needle))){
    const tr=add($('accounts'),'tr',''), who=add(tr,'td',row.email||row.name||'Guest browser');add(who,'small',row.kind==='guest'?'Guest browser':'Google');
    const place=row.location;
    const label=place?.source==='ip'&&place.country?`Approx. ${[place.city,place.region,place.country].filter(Boolean).join(', ')}`:'Location unavailable';
    const location=add(who,'small',label);
    location.title=place?.source==='ip'?`IP estimate, not a verified physical location. May reflect a VPN or network gateway. Lookup: ${new Date(place.checkedAt).toLocaleString()}.`:'Appears after a future visit if the IP lookup is available.';
    add(tr,'td',date(row.lastSeen));add(tr,'td',row.documents??'—');
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

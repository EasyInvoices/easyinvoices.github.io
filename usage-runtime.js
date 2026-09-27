/* Activity is approximate app telemetry; it is not a Firebase billing meter. */
window.EasyUsage = (() => {
  let auth, db, user, timer, counts = () => ({}), pending = {exports:0,measurements:0};
  let policy = {...EASY_DEFAULT_LIMITS}, generation = 0, onPolicy = () => {};
  const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
  async function refreshPolicy() {
    if (!user) return policy;
    const uid=user.uid, snap=await db.doc('access/'+uid).get({source:'server'});
    if (user?.uid===uid) { policy={...EASY_DEFAULT_LIMITS,...(snap.exists?snap.data():{})}; onPolicy(policy); }
    return policy;
  }
  async function flush() {
    timer=null;
    if (!user || policy.blocked) return;
    const current=user, uid=current.uid;
    const locationSummary=await EasyLocation.get();
    if(user?.uid!==uid||policy.blocked)return;
    const batch={...pending}, metrics=counts();
    try {
      const wait=await db.runTransaction(async tx=>{
        const ref=db.doc('activity/'+uid), snap=await tx.get(ref), old=snap.exists?snap.data():null;
        const remaining=old?61000-(Date.now()-old.lastSeen.toMillis()):0;
        if(remaining>0) return remaining;
        const sessionKey='easy_session_'+uid;
        tx.set(ref,{kind:current.isAnonymous?'guest':'google',email:current.email||'',name:(current.displayName||'Guest browser').slice(0,100),
          firstSeen:old?.firstSeen||stamp(),lastSeen:stamp(),sessions:old?(old.sessions+(sessionStorage.getItem(sessionKey)?0:1)):1,
          documents:Math.min(100000,Math.max(0,metrics.documents??old?.documents??0)),clients:Math.min(100000,Math.max(0,metrics.clients??old?.clients??0)),
          exports:(old?.exports||0)+Math.min(batch.exports,500),measurements:(old?.measurements||0)+Math.min(batch.measurements,500),location:locationSummary});
        return 0;
      });
      if(user?.uid!==uid) return;
      if(wait) { timer=setTimeout(flush,wait); return; }
      sessionStorage.setItem('easy_session_'+uid,'1');
      pending.exports-=Math.min(batch.exports,500); pending.measurements-=Math.min(batch.measurements,500);
    } catch(e) { console.warn('Activity summary was not sent:',e.code); }
  }
  function record(kind) { if(kind in pending) pending[kind]++; if(user&&!timer) timer=setTimeout(flush,61000); }
  async function connect(options) {
    auth=options.auth; db=options.db; counts=options.counts||counts; onPolicy=options.onPolicy||onPolicy;
    auth.onAuthStateChanged(async identity=>{
      const turn=++generation; clearTimeout(timer); timer=null; user=identity; pending={exports:0,measurements:0};
      policy={...EASY_DEFAULT_LIMITS};
      try {
        if(identity) await refreshPolicy();
        if(turn!==generation) return;
        await options.onIdentity?.(identity,policy);
        if(turn===generation && identity && !policy.blocked) await flush();
      } catch(e) { options.onError?.(e); }
    });
  }
  return {connect,record,refreshPolicy,get policy(){return policy;},get user(){return user;}};
})();

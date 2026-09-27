/* Coarse IP estimate only. Never request GPS, or retain the IP/coordinates returned by the provider. */
window.EasyLocation = (() => {
  const key='easy_location_summary_v1', ttl=86400000;
  const unavailable=()=>({source:'unavailable',country:'',region:'',city:'',checkedAt:0});
  let pending=null,pendingUntil=0;
  const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
  function summary(data,now){
    if(!data||data.is_bogon===true)return unavailable();
    const country=clean(data.country,80),region=clean(data.region,100),city=clean(data.city,100);
    return country?{source:'ip',country,region,city,checkedAt:now}:unavailable();
  }
  async function lookup(){
    const now=Date.now();
    try{
      const saved=JSON.parse(localStorage.getItem(key)||'null');
      if(saved&&Number.isFinite(saved.until)&&saved.until>now&&saved.until<=now+ttl){
        pendingUntil=saved.until;
        return saved.value?.source==='ip'?summary(saved.value,Number(saved.value.checkedAt)||now):unavailable();
      }
    }catch(_){/* Storage can be disabled; reporting still works. */}
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3000);
    let value=unavailable();
    try{
      const response=await fetch('https://api.ipapi.is/',{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
      if(response.ok)value=summary(await response.json(),now);
    }catch(_){/* Offline, blocked, limited or unavailable: no automatic retry loop. */}
    finally{clearTimeout(timeout);}
    try{localStorage.setItem(key,JSON.stringify({until:now+ttl,value}));}catch(_){}
    return value;
  }
  return {async get(){
    if(!window.EASY_LOCATION_ENABLED)return unavailable();
    // Share one lookup across account changes within this page.
    if(!pending||Date.now()>=pendingUntil){pendingUntil=Date.now()+ttl;pending=lookup();}
    return pending;
  }};
})();

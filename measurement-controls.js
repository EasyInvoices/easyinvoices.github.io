firebase.initializeApp(EASY_FIREBASE_CONFIG);
const measurementAuth=firebase.auth(),measurementDb=firebase.firestore();
let measurementReady=false;
function measurementAllowed(){if(!measurementReady||EasyUsage.policy.blocked){alert('Access is unavailable. Return to the invoice tool to sign in or check your account.');return false;}return true;}
window.addEventListener('load',()=>{
  EasyUsage.connect({auth:measurementAuth,db:measurementDb,onIdentity:async(user,policy)=>{
    if(!user){try{await measurementAuth.signInAnonymously();}catch(e){measurementReady=true;}return;}
    measurementReady=!policy.blocked;
    if(!user.isAnonymous){
      companyProfile=JSON.parse(localStorage.getItem(`easyinvoice_cloud_${user.uid}_profile`)||'{}');
      savedClients=JSON.parse(localStorage.getItem(`easyinvoice_cloud_${user.uid}_clients`)||'[]');
      document.getElementById('sheet-firm-name').textContent=companyProfile.name||'Your Firm Name';
      document.getElementById('sheet-firm-address').textContent=companyProfile.address||'';
      document.getElementById('sheet-sign-name').textContent=companyProfile.name||'Authorized Signatory';
      document.getElementById('sheet-logo-img').src=companyProfile.logo||'';
      document.getElementById('sheet-logo-box').classList.toggle('hidden',!companyProfile.logo);
    }
  },onPolicy:policy=>{
    if(policy.blocked){measurementReady=false;let box=document.getElementById('measurement-block');if(!box){box=document.createElement('div');box.id='measurement-block';box.style.cssText='position:fixed;inset:0;background:white;z-index:9999;padding:50px;';const text=document.createElement('p');text.textContent='This account is blocked. Contact craftsbyzareen@gmail.com.';const link=document.createElement('a');link.href='/';link.textContent='Return to the invoice tool';box.append(text,link);document.body.append(box);}}
  },onError:()=>{measurementReady=false;}});
});
for(const name of ['saveMeasurementFromModal','saveMeasurementDraft','shareMeasurementPDF','downloadAsImage']){const original=window[name];if(typeof original==='function')window[name]=function(...args){if(!measurementAllowed())return;const result=original.apply(this,args);if(name==='saveMeasurementFromModal')EasyUsage.record('measurements');if(name==='shareMeasurementPDF'||name==='downloadAsImage')EasyUsage.record('exports');return result;};}

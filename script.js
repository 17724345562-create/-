(function(){
'use strict';

/* ============================================================
   常量与配置
   ============================================================ */
var MIN_YEAR=2026, MAX_YEAR=2040, INVITE_CODE='XIEJIAYU';
var KEYS={
  users:'nova_users_v3',
  session:'nova_session_v3',
  dataPrefix:'nova_data_v3_',
  rangePrefix:'nova_range_v3_',
  fundPrefix:'nova_fund_v3_'
};
var SECURITY={
  PBKDF2_ITERATIONS:200000,
  FALLBACK_ITERATIONS:50000,
  SESSION_TTL:30*60*1000,
  MAX_FAIL_BEFORE_LOCK:5,
  LOCK_BASE_MS:5*60*1000,
  LOCK_MAX_MS:60*60*1000
};
var MONTH_CN=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
var WD=['日','一','二','三','四','五','六'];
var MONTH_EVENTS={
  1:{1:'元旦',5:'小寒',20:'大寒'},
  2:{4:'立春',17:'春节',18:'雨水'},
  3:{5:'惊蛰',8:'妇女节',20:'春分'},
  4:{5:'清明',20:'谷雨'},
  5:{1:'劳动节',5:'立夏',21:'小满'},
  6:{1:'儿童节',6:'芒种',19:'端午节',21:'夏至'},
  7:{1:'建党节',7:'小暑',23:'大暑'},
  8:{1:'建军节',7:'立秋',23:'处暑'},
  9:{7:'白露',10:'教师节',23:'秋分',25:'中秋节'},
  10:{1:'国庆节',8:'寒露',23:'霜降'},
  11:{7:'立冬',22:'小雪'},
  12:{7:'大雪',22:'冬至',25:'圣诞节'}
};
var MEAL_KEYS=['breakfast','lunch','dinner'];
var DEFAULT_START='08:00', DEFAULT_END='20:00';
var NIGHT_START='20:00', NIGHT_END='08:00';

var HAS_WEB_CRYPTO=(function(){
  try{ return !!(window.crypto && window.crypto.subtle && typeof window.crypto.subtle.importKey==='function'); }
  catch(e){ return false; }
})();

var hex=function(n){ return Array.from(n).map(function(b){ return b.toString(16).padStart(2,'0'); }).join(''); };

function randomHex(bytes){
  var arr=new Uint8Array(bytes);
  if(window.crypto&&window.crypto.getRandomValues) window.crypto.getRandomValues(arr);
  else for(var i=0;i<bytes;i++) arr[i]=Math.floor(Math.random()*256);
  return hex(arr);
}

async function pbkdf2(password,salt,iterations){
  var enc=new TextEncoder();
  var km=await crypto.subtle.importKey('raw',enc.encode(password),{name:'PBKDF2'},false,['deriveBits']);
  var bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:iterations,hash:'SHA-256'},km,256);
  return hex(new Uint8Array(bits));
}

function fallbackHash(password,salt,iterations){
  var seeds=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  var outs=seeds.slice();
  var base=password+'\x1f'+salt;
  for(var i=0;i<iterations;i++){
    var mix=base+'\x1f'+i;
    for(var j=0;j<4;j++){
      var h=(outs[j]^Math.imul(j+1,0x9e3779b9))>>>0;
      for(var k=0;k<mix.length;k++){ h^=mix.charCodeAt(k); h=Math.imul(h,0x01000193)>>>0; }
      outs[j]=h>>>0;
    }
  }
  return outs.map(function(x){ return x.toString(16).padStart(8,'0'); }).join('');
}

async function deriveKey(password,salt,iterations,algorithm){
  if(algorithm==='PBKDF2-SHA256'&&HAS_WEB_CRYPTO) return pbkdf2(password,salt,iterations);
  return fallbackHash(password,salt,Math.min(iterations,SECURITY.FALLBACK_ITERATIONS));
}

async function hashUsername(username){
  var normalized=String(username).toLowerCase().trim();
  var salt='nova_user_salt_v3';
  if(HAS_WEB_CRYPTO){
    var enc=new TextEncoder();
    var digest=await crypto.subtle.digest('SHA-256',enc.encode(salt+'\x1f'+normalized));
    return hex(new Uint8Array(digest)).substring(0,32);
  }
  return fallbackHash(normalized,salt,5000);
}

function checkPasswordStrength(p){
  if(typeof p!=='string'||!p) return {ok:false,level:0,msg:''};
  if(p.length<8) return {ok:false,level:1,msg:'密钥至少 8 位'};
  if(p.length>64) return {ok:false,level:2,msg:'密钥不能超过 64 位'};
  var hasLower=/[a-z]/.test(p), hasUpper=/[A-Z]/.test(p), hasDigit=/\d/.test(p), hasSpecial=/[^a-zA-Z0-9]/.test(p);
  if(!(hasLower||hasUpper)) return {ok:false,level:1,msg:'密钥必须包含字母'};
  if(!hasDigit) return {ok:false,level:2,msg:'密钥必须包含数字'};
  var weak=['12345678','password','qwerty123','abc12345','11111111','123456789','password1','admin123'];
  if(weak.indexOf(p.toLowerCase())>=0) return {ok:false,level:2,msg:'密钥过于常见，请更换'};
  var level=2;
  if(p.length>=12) level=3;
  if(p.length>=12&&hasSpecial&&hasLower&&hasUpper) level=4;
  else if(p.length>=10&&hasSpecial) level=3;
  return {ok:true,level:level,msg:''};
}

function isValidUsername(u){
  if(typeof u!=='string') return false;
  if(u.length<2||u.length>32) return false;
  return /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(u);
}

/* ============================================================
   用户与会话
   ============================================================ */
var loadUsers=function(){
  try{ var r=localStorage.getItem(KEYS.users); return r?JSON.parse(r):{}; }
  catch(e){ return {}; }
};
var saveUsers=function(users){
  try{ localStorage.setItem(KEYS.users,JSON.stringify(users)); return true; }
  catch(e){ return false; }
};

function recordFailure(userKey){
  var users=loadUsers();
  var r=users[userKey];
  if(!r) return;
  r.failCount=(r.failCount||0)+1;
  if(r.failCount>=SECURITY.MAX_FAIL_BEFORE_LOCK){
    var over=r.failCount-SECURITY.MAX_FAIL_BEFORE_LOCK;
    r.lockedUntil=Date.now()+Math.min(SECURITY.LOCK_BASE_MS*Math.pow(2,over),SECURITY.LOCK_MAX_MS);
  }
  saveUsers(users);
}

function resetFailure(userKey){
  var users=loadUsers();
  if(users[userKey]){
    users[userKey].failCount=0;
    users[userKey].lockedUntil=0;
    users[userKey].lastLoginAt=Date.now();
    saveUsers(users);
  }
}

function createSession(userKey,username){
  var now=Date.now();
  var sess={token:randomHex(32),userKey:userKey,username:username,createdAt:now,lastActive:now,expiresAt:now+SECURITY.SESSION_TTL};
  try{ sessionStorage.setItem(KEYS.session,JSON.stringify(sess)); }catch(e){}
  return sess;
}

function getSession(){
  try{
    var raw=sessionStorage.getItem(KEYS.session);
    if(!raw) return null;
    var s=JSON.parse(raw);
    if(!s||!s.token||!s.userKey) return null;
    if(Date.now()>s.expiresAt){ sessionStorage.removeItem(KEYS.session); return null; }
    return s;
  }catch(e){ return null; }
}

function touchSession(){
  try{
    var raw=sessionStorage.getItem(KEYS.session);
    if(!raw) return;
    var s=JSON.parse(raw);
    if(!s||!s.token) return;
    s.lastActive=Date.now();
    s.expiresAt=Date.now()+SECURITY.SESSION_TTL;
    sessionStorage.setItem(KEYS.session,JSON.stringify(s));
  }catch(e){}
}

var destroySession=function(){ try{ sessionStorage.removeItem(KEYS.session); }catch(e){} };

/* ============================================================
   数据模型
   ============================================================ */
var currentUserKey=null, currentUsername=null, DB={}, DBYear=null;

var dataKey=function(year){ return KEYS.dataPrefix+(currentUserKey||'guest')+'_'+year; };
var rangeKey=function(){ return KEYS.rangePrefix+(currentUserKey||'guest'); };
var fundKey=function(){ return KEYS.fundPrefix+(currentUserKey||'guest'); };

function loadDB(year){
  DBYear=year;
  if(year==null){ DB={}; return; }
  try{ var r=localStorage.getItem(dataKey(year)); DB=r?JSON.parse(r):{}; }
  catch(e){ DB={}; }
}

function saveDB(){
  try{ localStorage.setItem(dataKey(DBYear),JSON.stringify(DB)); return true; }
  catch(e){ return false; }
}

function readYearData(year){
  try{ var r=localStorage.getItem(dataKey(year)); return r?JSON.parse(r):{}; }
  catch(e){ return {}; }
}

var keyOf=function(year,m,d){ return year+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); };

var blankMeal=function(){ return {amount:'',photo:''}; };
var blankWage=function(){ return {mode:'hourly',hourlyRate:25,baseSalary:5000,monthDays:21.75,stdHours:8,allowances:[]}; };
var blankWork=function(){ return {enabled:false,location:'',shift:'白班',start:DEFAULT_START,end:DEFAULT_END,breaks:[],wage:blankWage()}; };
var blankLife=function(){ return {enabled:true,meals:{breakfast:blankMeal(),lunch:blankMeal(),dinner:blankMeal()},extras:[],incomes:[]}; };
var blankDay=function(){ return {work:blankWork(),life:blankLife()}; };

var normalizeMeal=function(m){ return {amount:m&&m.amount!=null?m.amount:'',photo:(m&&m.photo)||''}; };
var normalizeExtra=function(e){ return {name:(e&&e.name)||'',amount:e&&e.amount!=null?e.amount:'',photo:(e&&e.photo)||''}; };

function getDay(year,m,d){
  var k=keyOf(year,m,d);
  var base=blankDay();
  var raw=(year===DBYear?DB[k]:readYearData(year)[k]);
  if(!raw) return base;
  var rw=raw.work||{};
  var rl=raw.life||{};
  var workEnabled;
  if(rw.enabled!==undefined) workEnabled=!!rw.enabled;
  else workEnabled=!!(rw.location||(rw.breaks&&rw.breaks.length));
  var lifeEnabled=rl.enabled!==undefined?!!rl.enabled:true;
  return {
    work:Object.assign(base.work,rw,{enabled:workEnabled,wage:Object.assign(blankWage(),rw.wage||{})}),
    life:{
      enabled:lifeEnabled,
      meals:{
        breakfast:normalizeMeal(rl.meals&&rl.meals.breakfast),
        lunch:normalizeMeal(rl.meals&&rl.meals.lunch),
        dinner:normalizeMeal(rl.meals&&rl.meals.dinner)
      },
      extras:Array.isArray(rl.extras)?rl.extras.map(normalizeExtra):[],
      incomes:Array.isArray(rl.incomes)?rl.incomes.map(normalizeExtra):[]
    }
  };
}

/* ============================================================
   计算
   ============================================================ */
var toMin=function(t){
  if(!t||typeof t!=='string') return null;
  var p=t.split(':');
  var h=Number(p[0]),m=Number(p[1]);
  return isNaN(h)||isNaN(m)?null:h*60+m;
};

function durationHours(a,b){
  var s=toMin(a),e=toMin(b);
  if(s==null||e==null) return 0;
  var diff=e-s;
  if(diff<0) diff+=1440;
  return diff/60;
}

function calcHours(day){
  if(!day.work.enabled) return 0;
  var w=day.work;
  var total=durationHours(w.start,w.end);
  var unpaid=0;
  (w.breaks||[]).forEach(function(b){ unpaid+=durationHours(b.start,b.end); });
  return Math.max(0,Math.round((total-unpaid)*100)/100);
}

function calcPay(day){
  if(!day.work.enabled) return 0;
  var h=calcHours(day);
  var w=day.work.wage||{};
  var base;
  if(w.mode==='base'){
    var md=Number(w.monthDays)||21.75;
    var sh=Number(w.stdHours)||8;
    base=h*((Number(w.baseSalary)||0)/md/sh);
  }else{
    base=h*(Number(w.hourlyRate)||0);
  }
  var allow=(w.allowances||[]).reduce(function(s,a){ return s+(Number(a.amount)||0); },0);
  return Math.round((base+allow)*100)/100;
}

var calcMealTotal=function(day){
  if(day.life.enabled===false) return 0;
  var meals=day.life.meals||{};
  return MEAL_KEYS.reduce(function(s,k){ return s+(Number(meals[k]&&meals[k].amount)||0); },0);
};
var calcExtraTotal=function(day){
  if(day.life.enabled===false) return 0;
  return (day.life.extras||[]).reduce(function(s,e){ return s+(Number(e.amount)||0); },0);
};
var calcIncomeTotal=function(day){
  if(day.life.enabled===false) return 0;
  return (day.life.incomes||[]).reduce(function(s,e){ return s+(Number(e.amount)||0); },0);
};
var calcExpense=function(day){ return calcMealTotal(day)+calcExtraTotal(day); };
var calcNet=function(day){ return Math.round((calcPay(day)+calcIncomeTotal(day)-calcExpense(day))*100)/100; };

function fmtMoney(n){
  if(!isFinite(n)) n=0;
  var r=Math.round(n*100)/100;
  return r%1===0?String(r):r.toFixed(2);
}
var fmtNet=function(n){ return n<0?'-¥'+fmtMoney(Math.abs(n)):'¥'+fmtMoney(n); };
function fmtNetShort(n){
  var r=Math.round(n);
  if(r===0) return '0';
  return r<0?'-'+Math.abs(r):String(r);
}

var daysInMonth=function(year,m){ return new Date(year,m,0).getDate(); };
var dayOfYear=function(year,m,d){ return Math.round((new Date(year,m-1,d)-new Date(year,0,1))/86400000)+1; };

var escapeHtml=function(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};

var dayHasRecord=function(day){ return !!day&&(!!day.work.enabled||calcExpense(day)>0||calcIncomeTotal(day)>0); };

function calcRangeTotal(range){
  var income=0,expense=0;
  var isCustom=range.type==='custom';
  var sArr=isCustom?range.start.split('-').map(Number):[0,0];
  var eArr=isCustom?range.end.split('-').map(Number):[0,0];
  var smVal=sArr[0]*100+sArr[1];
  var emVal=eArr[0]*100+eArr[1];
  var years=range.type==='year'?[range.year]:Array.from({length:MAX_YEAR-MIN_YEAR+1},function(_,i){ return MIN_YEAR+i; });
  years.forEach(function(y){
    var ydata=readYearData(y);
    for(var k in ydata){
      if(!Object.prototype.hasOwnProperty.call(ydata,k)) continue;
      var parts=k.split('-');
      if(parts.length!==3||Number(parts[0])!==y) continue;
      var m=Number(parts[1]);
      if(isCustom){
        var ym=y*100+m;
        if(ym<smVal||ym>emVal) continue;
      }
      var day=getDay(y,m,Number(parts[2]));
      income+=calcPay(day)+calcIncomeTotal(day);
      expense+=calcExpense(day);
    }
  });
  income=Math.round(income*100)/100;
  expense=Math.round(expense*100)/100;
  return {income:income,expense:expense,balance:Math.round((income-expense)*100)/100};
}

/* ============================================================
   DOM 缓存
   ============================================================ */
var el={};
function cacheEls(){
  var ids=[
    'loginScreen','loginUser','loginPass','loginBtn','loginMsg','pwdToggle','pwdStrength','pwdText','capsWarn',
    'inviteField','inviteCode','app',
    'userName','userNameSettings','logoutBtn','exportBtn','importBtn','reportBtn',
    'balanceCard','balanceValue','totalIncome','totalExpense','balanceBadgeText','eyeBtn',
    'fundList','fundAddBtn','fundTotal','fundDiff','fundSaveBtn',
    'yearTrigger','monthTrigger','yearValue','monthValue',
    'yearModal','yearClose','yearPicker','yearConfirm',
    'monthModal','monthClose','monthPicker','monthConfirm',
    'daysSection','daysTitle','daysToggle','daysBody','daysGrid',
    'summaryCard','sumNum','sumDate','sumSub','sumIncome','sumExpense','sumBalance',
    'analysisCard','analysisReset','analysisTip',
    'editModal','editClose','editDate','editWeek','editTabs','panel-work','panel-life',
    'locInput','locBadge','shiftSeg','startTime','endTime','hoursBadge',
    'addBreak','breakList','payBlock','payVal','payArrow',
    'mealBadge','extraBadge','extraList','addExtra','incomeList','addIncome','incomeBadge',
    'lifeBalance','lifeDetail','resetBtn','saveBtn',
    'wageModal','wageClose','wageModeSeg','fieldHourly','fieldBase','hourlyRate','baseSalary','monthDays','stdHours',
    'addAllow','allowList','wagePreview','wageConfirm',
    'rangeModal','rangeClose','rangePanel-all','rangePanel-year','rangePanel-custom',
    'rangeAllDesc','rangeYearPicker','rangeStart','rangeEnd','rangeResult','rangeConfirm',
    'reportModal','reportClose','reportModeSeg','reportYearField','reportMonthField',
    'reportYear','reportYearM','reportMonth','reportDesc','reportConfirm',
    'fundModal','fundClose','fundModalTitle','fundName','fundAmount','fundConfirm','fundDelete',
    'photoInput','toast'
  ];
  ids.forEach(function(id){
    el[id.replace(/-([a-z])/g,function(_,c){ return c.toUpperCase(); })]=document.getElementById(id);
  });
  el.modeTabs=document.querySelectorAll('.mode-tab');
  el.rangeTabs=document.querySelectorAll('.range-tab');
}

/* ============================================================
   状态
   ============================================================ */
var state={
  year:null,month:null,day:null,
  draft:null,dirty:false,modalOpen:false,activeTab:'work',
  range:{type:'all'},
  authMode:'login',
  analysisMode:null,
  moneyHidden:true,
  currentTab:'home',
  daysCollapsed:false,
  pendingYear:MIN_YEAR,
  pendingMonth:1
};

var photoTarget=null, wageDraft=null, rangeDraft=null;
var sessionTimer=null, toastTimer=null;

/* ============================================================
   Toast
   ============================================================ */
var showToast=function(msg,isError){
  if(!el.toast) return;
  el.toast.textContent=msg;
  el.toast.classList.toggle('error',!!isError);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ el.toast.classList.remove('show'); },2000);
};

/* ============================================================
   页面切换
   ============================================================ */
function switchTab(tab){
  state.currentTab=tab;
  document.querySelectorAll('.nav-item').forEach(function(x){
    x.classList.toggle('active',x.dataset.tab===tab);
  });
  document.querySelectorAll('#app .page').forEach(function(p){ p.classList.remove('active'); });
  var target=document.getElementById('tab-'+tab);
  if(target) target.classList.add('active');
  window.scrollTo(0,0);
  if(tab==='home') refreshHome();
  if(tab==='date') refreshDateTab();
}

function showLoginScreen(){
  if(el.loginScreen) el.loginScreen.classList.add('show');
  if(el.app) el.app.classList.remove('show');
  if(el.loginPass) el.loginPass.value='';
  if(el.inviteCode) el.inviteCode.value='';
  if(el.loginBtn){ el.loginBtn.disabled=false; el.loginBtn.textContent='连 接 N O V A'; }
  showLoginMsg('','');
  hideStrength();
  if(el.capsWarn) el.capsWarn.classList.remove('show');
  setAuthMode('login');
}

function showApp(){
  if(el.loginScreen) el.loginScreen.classList.remove('show');
  if(el.app) el.app.classList.add('show');
}

function setAuthMode(mode){
  state.authMode=mode;
  el.modeTabs.forEach(function(t){ t.classList.toggle('active',t.dataset.mode===mode); });
  if(el.inviteField) el.inviteField.classList.toggle('show',mode==='register');
  if(el.loginBtn) el.loginBtn.textContent=mode==='register'?'注 册 N O V A':'连 接 N O V A';
  if(mode==='register') showStrength();
  else hideStrength();
}

function showLoginMsg(text,type){
  if(!el.loginMsg) return;
  el.loginMsg.textContent=text;
  el.loginMsg.className='login-msg '+(type||'');
  if(!text) el.loginMsg.className='login-msg';
}

function showStrength(){
  var p=el.loginPass.value;
  if(!p){ hideStrength(); return; }
  var s=checkPasswordStrength(p);
  el.pwdStrength.classList.add('show');
  el.pwdStrength.dataset.level=String(s.level||1);
  if(s.ok){
    var labels={2:'强度：一般',3:'强度：良好',4:'强度：很强'};
    el.pwdText.textContent=labels[s.level]||'强度：一般';
  }else{
    el.pwdText.textContent=s.msg;
  }
}

function hideStrength(){
  if(!el.pwdStrength) return;
  el.pwdStrength.classList.remove('show');
  el.pwdStrength.dataset.level='0';
  el.pwdText.textContent='';
}

/* ============================================================
   认证
   ============================================================ */
async function doAuth(){
  if(el.loginBtn.disabled) return;
  var mode=state.authMode;
  var u=(el.loginUser.value||'').trim();
  var p=el.loginPass.value;
  var invite=(el.inviteCode.value||'').trim().toUpperCase();

  if(!isValidUsername(u)){ showLoginMsg('身份标识需 2-32 位，仅限字母、数字、下划线或中文','error'); return; }
  if(!p||p.length<8){ showLoginMsg('密钥至少 8 位','error'); return; }
  if(p.length>64){ showLoginMsg('密钥不能超过 64 位','error'); return; }

  if(mode==='register'){
    if(!invite){ showLoginMsg('请输入邀请码','error'); return; }
    if(invite!==INVITE_CODE){ showLoginMsg('邀请码错误，无法注册','error'); return; }
  }

  el.loginBtn.disabled=true;
  el.loginBtn.textContent=mode==='register'?'注 册 中…':'连 接 中…';
  showLoginMsg('','');

  try{
    var userKey=await hashUsername(u);
    var users=loadUsers();
    var rec=users[userKey];

    if(mode==='login'){
      if(!rec){
        showLoginMsg('身份不存在，请先注册','error');
        el.loginBtn.disabled=false; el.loginBtn.textContent='连 接 N O V A';
        return;
      }
      if(rec.lockedUntil&&Date.now()<rec.lockedUntil){
        var remain=Math.ceil((rec.lockedUntil-Date.now())/1000);
        showLoginMsg('身份已临时锁定，请 '+remain+' 秒后重试','error');
        el.loginBtn.disabled=false; el.loginBtn.textContent='连 接 N O V A';
        return;
      }
      var derived=await deriveKey(p,rec.salt,rec.iterations,rec.algorithm);
      if(derived===rec.derivedKey){
        resetFailure(userKey);
        onAuthSuccess(u,userKey,false);
      }else{
        recordFailure(userKey);
        var rec2=loadUsers()[userKey];
        if(rec2&&rec2.lockedUntil&&Date.now()<rec2.lockedUntil){
          var remain2=Math.ceil((rec2.lockedUntil-Date.now())/1000);
          showLoginMsg('尝试次数过多，身份锁定 '+remain2+' 秒','error');
        }else{
          showLoginMsg('身份或密钥错误','error');
        }
        el.loginBtn.disabled=false; el.loginBtn.textContent='连 接 N O V A';
      }
    }else{
      if(rec){
        showLoginMsg('身份已存在，请直接登录','error');
        el.loginBtn.disabled=false; el.loginBtn.textContent='注 册 N O V A';
        return;
      }
      var strength=checkPasswordStrength(p);
      if(!strength.ok){
        showLoginMsg(strength.msg,'error');
        el.loginBtn.disabled=false; el.loginBtn.textContent='注 册 N O V A';
        return;
      }
      var salt=randomHex(16);
      var algorithm=HAS_WEB_CRYPTO?'PBKDF2-SHA256':'FALLBACK';
      var iterations=HAS_WEB_CRYPTO?SECURITY.PBKDF2_ITERATIONS:SECURITY.FALLBACK_ITERATIONS;
      var derived2=await deriveKey(p,salt,iterations,algorithm);
      users[userKey]={
        usernameHash:userKey,salt:salt,iterations:iterations,
        derivedKey:derived2,algorithm:algorithm,
        createdAt:Date.now(),lastLoginAt:Date.now(),
        failCount:0,lockedUntil:0,inviteUsed:invite
      };
      if(!saveUsers(users)){
        showLoginMsg('注册失败：浏览器存储不可用','error');
        el.loginBtn.disabled=false; el.loginBtn.textContent='注 册 N O V A';
        return;
      }
      onAuthSuccess(u,userKey,true);
    }
  }catch(err){
    console.error('认证异常:',err);
    showLoginMsg('认证异常，请重试','error');
    el.loginBtn.disabled=false;
    el.loginBtn.textContent=mode==='register'?'注 册 N O V A':'连 接 N O V A';
  }
}

function onAuthSuccess(username,userKey,isNew){
  currentUserKey=userKey;
  currentUsername=username;
  createSession(userKey,username);
  el.loginPass.value='';
  el.loginUser.value='';
  el.inviteCode.value='';
  hideStrength();
  el.loginBtn.disabled=false;
  showLoginMsg('','');
  try{ localStorage.setItem('nova_money_hidden','1'); }catch(e){}
  state.moneyHidden=true;
  showToast(isNew?'身份创建成功，欢迎回来':'连接成功');
  setTimeout(function(){ showApp(); enterHome(); },250);
}

function doLogout(){
  if(!confirm('确认退出登录？')) return;
  destroySession();
  currentUserKey=null; currentUsername=null;
  DB={}; DBYear=null;
  location.reload();
}

function startSessionWatcher(){
  if(sessionTimer) clearInterval(sessionTimer);
  sessionTimer=setInterval(function(){
    if(!currentUserKey) return;
    if(!getSession()) location.reload();
  },30000);
}

function bindSessionTouch(){
  var handler=function(){ if(currentUserKey) touchSession(); };
  ['click','keydown','touchstart'].forEach(function(evt){
    document.addEventListener(evt,handler,{passive:true,capture:true});
  });
}

/* ============================================================
   主页
   ============================================================ */
function enterHome(){
  el.userName.textContent=currentUsername||'用户';
  if(el.userNameSettings) el.userNameSettings.textContent=currentUsername||'用户';
  state.year=null; state.month=null; state.day=null;
  loadDB(null);
  loadRange();
  loadFunds();
  try{ state.moneyHidden=localStorage.getItem('nova_money_hidden')!=='0'; }
  catch(err){ state.moneyHidden=true; }
  if(el.eyeBtn) el.eyeBtn.classList.toggle('hidden',state.moneyHidden);
  if(el.pwdToggle) el.pwdToggle.classList.toggle('hidden',!state.moneyHidden);
  refreshHome();
  resetDateTab();
  switchTab('home');
}

function refreshHome(){
  refreshBalance();
  renderFunds();
}

function refreshBalance(){
  var t=calcRangeTotal(state.range);
  if(state.moneyHidden){
    el.balanceValue.textContent='¥****';
    el.balanceValue.classList.remove('negative');
    el.totalIncome.textContent='¥****';
    el.totalExpense.textContent='¥****';
  }else{
    el.balanceValue.textContent=fmtNet(t.balance);
    el.balanceValue.classList.toggle('negative',t.balance<0);
    el.totalIncome.textContent='¥'+fmtMoney(t.income);
    el.totalExpense.textContent='¥'+fmtMoney(t.expense);
  }
  el.balanceBadgeText.textContent=rangeLabel(state.range);
}

/* ============================================================
   资金管理
   ============================================================ */
var fundAccounts=[];
var fundDirty=false;
var fundEditIndex=-1;

function loadFunds(){
  try{
    var raw=localStorage.getItem(fundKey());
    if(raw){
      fundAccounts=JSON.parse(raw);
      if(!Array.isArray(fundAccounts)||!fundAccounts.length){
        fundAccounts=[{name:'微信',amount:0},{name:'支付宝',amount:0}];
      }
    }else{
      fundAccounts=[{name:'微信',amount:0},{name:'支付宝',amount:0}];
    }
  }catch(e){
    fundAccounts=[{name:'微信',amount:0},{name:'支付宝',amount:0}];
  }
  fundDirty=false;
}

function saveFunds(){
  try{ localStorage.setItem(fundKey(),JSON.stringify(fundAccounts)); return true; }
  catch(e){ return false; }
}

function renderFunds(){
  if(!el.fundList) return;
  el.fundList.innerHTML='';
  if(!fundAccounts.length){
    el.fundList.innerHTML='<div class="empty-tip">暂无账户，点击上方添加</div>';
  }else{
    fundAccounts.forEach(function(acc,i){
      var item=document.createElement('button');
      item.type='button';
      item.className='fund-item';
      item.dataset.fundIndex=String(i);
      item.innerHTML='<span class="fund-name">'+escapeHtml(acc.name)+'</span>'
        +'<span class="fund-amount">¥'+fmtMoney(acc.amount||0)+'</span>';
      el.fundList.appendChild(item);
    });
  }

  var total=fundAccounts.reduce(function(s,a){ return s+(Number(a.amount)||0); },0);
  total=Math.round(total*100)/100;
  if(el.fundTotal) el.fundTotal.textContent='¥'+fmtMoney(total);

  var balanceTotal=calcRangeTotal(state.range).balance;
  var diff=Math.round((total-balanceTotal)*100)/100;

  if(el.fundDiff){
    if(Math.abs(diff)<0.01){
      el.fundDiff.textContent='✓ 与余额一致';
      el.fundDiff.className='fs-hint ok';
    }else{
      el.fundDiff.textContent=(diff>0?'超出 ¥':'还差 ¥')+fmtMoney(Math.abs(diff));
      el.fundDiff.className='fs-hint warn';
    }
  }

  if(el.fundSaveBtn){
    el.fundSaveBtn.hidden=!fundDirty;
  }
}

function openFundModal(index){
  if(!el.fundModal) return;
  fundEditIndex=index;
  if(index>=0&&fundAccounts[index]){
    var acc=fundAccounts[index];
    el.fundModalTitle.textContent='编辑账户';
    el.fundName.value=acc.name;
    el.fundAmount.value=acc.amount||'';
    el.fundDelete.hidden=false;
  }else{
    el.fundModalTitle.textContent='添加账户';
    el.fundName.value='';
    el.fundAmount.value='';
    el.fundDelete.hidden=true;
  }
  el.fundModal.classList.add('open');
  el.fundModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeFundModal(){
  if(!el.fundModal) return;
  el.fundModal.classList.remove('open');
  el.fundModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

/* ============================================================
   日期页：年份 / 月份 触发器 + 弹窗
   ============================================================ */
function resetDateTab(){
  state.year=null; state.month=null; state.day=null;
  state.analysisMode=null;
  state.daysCollapsed=false;
  state.pendingYear=MIN_YEAR;
  state.pendingMonth=1;
  updateYMDisplay();
  if(el.monthTrigger) el.monthTrigger.disabled=true;
  if(el.daysSection) el.daysSection.hidden=true;
  if(el.daysBody) el.daysBody.hidden=false;
  if(el.daysGrid) el.daysGrid.innerHTML='';
  if(el.summaryCard) el.summaryCard.hidden=true;
  if(el.analysisCard) el.analysisCard.hidden=true;
  if(el.analysisTip){
    el.analysisTip.textContent='点击上方按钮，高亮当月对应日期';
    el.analysisTip.classList.remove('active');
  }
  document.querySelectorAll('.analysis-item').forEach(function(x){ x.classList.remove('active'); });
}

function refreshDateTab(){
  updateYMDisplay();
  if(el.monthTrigger) el.monthTrigger.disabled=!state.year;
  if(state.year&&state.month){
    if(el.daysSection) el.daysSection.hidden=false;
    if(el.summaryCard) el.summaryCard.hidden=false;
    if(el.analysisCard) el.analysisCard.hidden=false;
    buildDaysGrid(state.month);
    selectDay(state.month,state.day||1);
  }else{
    if(el.daysSection) el.daysSection.hidden=true;
    if(el.summaryCard) el.summaryCard.hidden=true;
    if(el.analysisCard) el.analysisCard.hidden=true;
  }
}

function updateYMDisplay(){
  if(el.yearValue) el.yearValue.textContent=state.year?state.year+' 年':'未选择';
  if(el.monthValue) el.monthValue.textContent=state.month?MONTH_CN[state.month-1]:'未选择';
}

/* --- 年份弹窗 --- */
function openYearModal(){
  if(!el.yearModal) return;
  state.pendingYear=state.year||MIN_YEAR;
  buildYearPicker();
  el.yearModal.classList.add('open');
  el.yearModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeYearModal(){
  if(!el.yearModal) return;
  el.yearModal.classList.remove('open');
  el.yearModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function buildYearPicker(){
  if(!el.yearPicker) return;
  el.yearPicker.innerHTML='';
  var frag=document.createDocumentFragment();
  for(var y=MIN_YEAR;y<=MAX_YEAR;y++){
    var btn=document.createElement('button');
    btn.type='button';
    btn.className='year-pick-btn'+(y===state.pendingYear?' active':'');
    btn.textContent=y;
    btn.dataset.year=y;
    btn.addEventListener('click',function(ev){
      var target=ev.currentTarget;
      var y=Number(target.dataset.year);
      // 如果点击已选中的年份，则取消该选择
      if(state.pendingYear===y&&state.year===y){
        state.pendingYear=null;
      }else{
        state.pendingYear=y;
      }
      buildYearPicker();
    });
    frag.appendChild(btn);
  }
  el.yearPicker.appendChild(frag);
}

function confirmYear(){
  // 如果 pendingYear 被清空（再次点击取消），则清除年份
  if(state.pendingYear==null){
    state.year=null;
    state.month=null;
    state.day=null;
    loadDB(null);
  }else{
    var y=state.pendingYear;
    // 如果和当前已选年份相同，则视为取消
    if(state.year===y){
      state.year=null;
      state.month=null;
      state.day=null;
      loadDB(null);
    }else{
      state.year=y;
      state.month=null;   // 换年份后月份清空
      state.day=null;
      loadDB(y);
    }
  }
  closeYearModal();
  updateYMDisplay();
  if(el.monthTrigger) el.monthTrigger.disabled=!state.year;
  if(el.daysSection) el.daysSection.hidden=true;
  if(el.summaryCard) el.summaryCard.hidden=true;
  if(el.analysisCard) el.analysisCard.hidden=true;
  if(el.daysGrid) el.daysGrid.innerHTML='';
  showToast(state.year?('已选择 '+state.year+' 年'):'已取消年份');
}

/* --- 月份弹窗 --- */
function openMonthModal(){
  if(!el.monthModal) return;
  if(!state.year){ showToast('请先选择年份',true); return; }
  state.pendingMonth=state.month||1;
  buildMonthPicker();
  el.monthModal.classList.add('open');
  el.monthModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeMonthModal(){
  if(!el.monthModal) return;
  el.monthModal.classList.remove('open');
  el.monthModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function buildMonthPicker(){
  if(!el.monthPicker) return;
  el.monthPicker.innerHTML='';
  var frag=document.createDocumentFragment();
  for(var i=1;i<=12;i++){
    var btn=document.createElement('button');
    btn.type='button';
    btn.className='month-pick-btn'+(i===state.pendingMonth?' active':'');
    btn.textContent=i+'月';
    btn.dataset.month=i;
    btn.addEventListener('click',function(ev){
      var target=ev.currentTarget;
      var m=Number(target.dataset.month);
      if(state.pendingMonth===m&&state.month===m){
        state.pendingMonth=null;
      }else{
        state.pendingMonth=m;
      }
      buildMonthPicker();
    });
    frag.appendChild(btn);
  }
  el.monthPicker.appendChild(frag);
}

function confirmMonth(){
  if(!state.year){ closeMonthModal(); return; }
  if(state.pendingMonth==null){
    state.month=null;
    state.day=null;
  }else{
    var m=state.pendingMonth;
    if(state.month===m){
      // 再次点击已选月份 = 取消
      state.month=null;
      state.day=null;
    }else{
      state.month=m;
      state.day=1;
      state.range={type:'year',year:state.year};
      saveRange();
      loadDB(state.year);
    }
  }
  closeMonthModal();
  updateYMDisplay();

  if(state.year&&state.month){
    if(el.daysSection) el.daysSection.hidden=false;
    if(el.summaryCard) el.summaryCard.hidden=false;
    if(el.analysisCard) el.analysisCard.hidden=false;
    if(el.daysBody) el.daysBody.hidden=false;
    if(el.daysToggle) el.daysToggle.textContent='收起 ▴';
    if(el.daysTitle) el.daysTitle.textContent=state.year+'年'+MONTH_CN[state.month-1];
    buildDaysGrid(state.month);
    selectDay(state.month,1);
    refreshBalance();
    showToast('已切换到 '+state.year+'年'+MONTH_CN[state.month-1]);
  }else{
    if(el.daysSection) el.daysSection.hidden=true;
    if(el.summaryCard) el.summaryCard.hidden=true;
    if(el.analysisCard) el.analysisCard.hidden=true;
    if(el.daysGrid) el.daysGrid.innerHTML='';
    showToast('已取消月份');
  }
}

/* ============================================================
   日期网格
   ============================================================ */
function buildDaysGrid(m){
  if(!el.daysGrid) return;
  el.daysGrid.innerHTML='';
  var n=daysInMonth(state.year,m);
  var frag=document.createDocumentFragment();
  for(var d=1;d<=n;d++){
    var cell=document.createElement('button');
    cell.type='button';
    cell.className='grid-day';
    cell.dataset.day=d;
    cell.innerHTML=dayCellHTML(state.year,m,d);
    cell.addEventListener('click',function(ev){
      var target=ev.currentTarget;
      var day=Number(target.dataset.day);
      // 再次点击同一天 = 取消选中
      if(state.day===day){
        state.day=null;
        updateActiveCell();
        if(el.summaryCard) el.summaryCard.hidden=true;
      }else{
        selectDay(m,day);
        if(el.summaryCard) el.summaryCard.hidden=false;
      }
    });
    frag.appendChild(cell);
  }
  el.daysGrid.appendChild(frag);
  applyAnalysisHighlight();
}

function dayCellHTML(year,m,d){
  var k=keyOf(year,m,d);
  var ev=(MONTH_EVENTS[m]||{})[d];
  var moneyHTML='';
  var hasData=(year===DBYear?DB[k]:readYearData(year)[k]);
  if(hasData){
    var day=getDay(year,m,d);
    if(dayHasRecord(day)){
      var net=calcNet(day);
      var cls=net<0?'gd-money negative':'gd-money';
      moneyHTML='<span class="'+cls+'">'+escapeHtml(fmtNetShort(net))+'</span>';
    }
  }
  var dotHTML=ev?'<span class="gd-dot"></span>':'';
  return dotHTML+'<span class="gd-num">'+d+'</span>'+moneyHTML;
}

function refreshDayCell(m,d){
  if(!el.daysGrid) return;
  var cell=el.daysGrid.querySelector('.grid-day[data-day="'+d+'"]');
  if(!cell) return;
  cell.innerHTML=dayCellHTML(state.year,m,d);
}

function updateActiveCell(){
  if(!el.daysGrid) return;
  el.daysGrid.querySelectorAll('.grid-day').forEach(function(c){
    c.classList.toggle('active',Number(c.dataset.day)===state.day);
  });
}

function selectDay(m,d){
  state.month=m;
  state.day=d;
  updateActiveCell();
  renderSummary(m,d);
}

function renderSummary(m,d){
  var year=state.year;
  if(!year||!d) return;
  var date=new Date(year,m-1,d);
  if(el.sumNum) el.sumNum.textContent=String(d).padStart(2,'0');
  if(el.sumDate) el.sumDate.textContent=year+'年'+m+'月'+d+'日 · 星期'+WD[date.getDay()];
  if(el.sumSub) el.sumSub.textContent=year+' 年第 '+dayOfYear(year,m,d)+' 天';
  var k=keyOf(year,m,d);
  var income=0,expense=0;
  var hasData=(year===DBYear?DB[k]:readYearData(year)[k]);
  if(hasData){
    var day=getDay(year,m,d);
    income=calcPay(day)+calcIncomeTotal(day);
    expense=calcExpense(day);
  }
  var balance=Math.round((income-expense)*100)/100;
  if(state.moneyHidden){
    if(el.sumIncome) el.sumIncome.textContent='¥****';
    if(el.sumExpense) el.sumExpense.textContent='¥****';
    if(el.sumBalance){
      el.sumBalance.textContent='¥****';
      el.sumBalance.classList.remove('negative');
    }
  }else{
    if(el.sumIncome) el.sumIncome.textContent='¥'+fmtMoney(income);
    if(el.sumExpense) el.sumExpense.textContent='¥'+fmtMoney(expense);
    if(el.sumBalance){
      el.sumBalance.textContent=fmtNet(balance);
      el.sumBalance.classList.toggle('negative',balance<0);
    }
  }
}

/* ============================================================
   每日编辑弹窗
   ============================================================ */
function openEditModal(){
  if(!state.year||!state.month||!state.day) return;
  state.draft=getDay(state.year,state.month,state.day);
  state.dirty=false;
  state.modalOpen=true;

  var date=new Date(state.year,state.month-1,state.day);
  if(el.editDate) el.editDate.textContent=state.month+'月'+state.day+'日';
  if(el.editWeek) el.editWeek.textContent='星期'+WD[date.getDay()]+' · '+state.year+' 年第 '+dayOfYear(state.year,state.month,state.day)+' 天';

  fillWorkForm();
  fillLifeForm();
  refreshPayPreview();
  setSaveState('idle');
  switchTabPanel('work');

  if(el.editModal){
    el.editModal.classList.add('open');
    el.editModal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
}

function closeEditModal(silent){
  if(!state.modalOpen) return;
  if(state.dirty&&!silent) showToast('未保存的修改已丢弃');
  if(el.editModal){
    el.editModal.classList.remove('open');
    el.editModal.setAttribute('aria-hidden','true');
  }
  document.body.style.overflow='';
  state.modalOpen=false;
  state.draft=null;
  state.dirty=false;
}

function switchTabPanel(tab){
  state.activeTab=tab;
  el.editTabs.querySelectorAll('.tab').forEach(function(t){
    t.classList.toggle('active',t.dataset.tab===tab);
  });
  if(el.panelWork) el.panelWork.hidden=tab!=='work';
  if(el.panelLife) el.panelLife.hidden=tab!=='life';
  if(el.resetBtn) el.resetBtn.textContent=tab==='work'?'重置工作':'重置生活';
  if(state.dirty) setSaveState('dirty');
}

function fillWorkForm(){
  var w=state.draft.work;
  if(el.locInput) el.locInput.value=w.location||'';
  updateLocBadge();
  el.shiftSeg.querySelectorAll('button').forEach(function(b){
    b.classList.toggle('active',b.dataset.v===w.shift);
  });
  if(el.startTime) el.startTime.value=w.start||DEFAULT_START;
  if(el.endTime) el.endTime.value=w.end||DEFAULT_END;
  renderBreaks();
  updateHoursBadge();
  updatePayBlockState();
}

function updateLocBadge(){
  if(!el.locBadge) return;
  if(state.draft.work.location){
    el.locBadge.textContent='已填写';
    el.locBadge.classList.remove('warn');
  }else{
    el.locBadge.textContent='未填写';
    el.locBadge.classList.add('warn');
  }
}

function updateHoursBadge(){
  if(!el.hoursBadge) return;
  if(!state.draft.work.enabled){
    el.hoursBadge.textContent='未启用';
    el.hoursBadge.classList.add('off');
    el.hoursBadge.classList.remove('warn');
  }else{
    el.hoursBadge.textContent=calcHours(state.draft)+' h';
    el.hoursBadge.classList.remove('off','warn');
  }
}

function updatePayBlockState(){
  if(!el.payBlock) return;
  if(state.draft.work.enabled){
    el.payBlock.classList.remove('disabled');
    if(el.payArrow) el.payArrow.textContent='设置模板 ›';
  }else{
    el.payBlock.classList.add('disabled');
    if(el.payArrow) el.payArrow.textContent='编辑后自动启用 ›';
  }
}

function renderBreaks(){
  if(!el.breakList) return;
  el.breakList.innerHTML='';
  var list=state.draft.work.breaks||[];
  if(!list.length){
    el.breakList.innerHTML='<div class="empty-tip">暂无无薪时段（如午休 12:00-13:00）</div>';
    return;
  }
  list.forEach(function(b,i){ appendBreakRow(b,i); });
}

function appendBreakRow(b,i){
  var row=document.createElement('div');
  row.className='row-item';
  row.innerHTML='<input type="time" value="'+escapeHtml(b.start||'12:00')+'"><span class="dash">—</span><input type="time" value="'+escapeHtml(b.end||'13:00')+'"><button type="button" class="del-btn">×</button>';
  var ins=row.querySelectorAll('input');
  ins[0].addEventListener('change',function(e){
    state.draft.work.breaks[i].start=e.target.value;
    enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
  });
  ins[1].addEventListener('change',function(e){
    state.draft.work.breaks[i].end=e.target.value;
    enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
  });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.work.breaks.splice(i,1);
    enableWork(); markDirty(); renderBreaks(); updateHoursBadge(); refreshPayPreview();
  });
  el.breakList.appendChild(row);
}

function enableWork(){
  if(!state.draft.work.enabled){
    state.draft.work.enabled=true;
    updatePayBlockState();
    updateHoursBadge();
  }
}

function fillLifeForm(){
  document.querySelectorAll('.meal-input').forEach(function(inp){
    inp.value=state.draft.life.meals[inp.dataset.meal].amount||'';
  });
  renderExtras();
  renderIncomes();
  renderPhotoBoxes();
  updateMealBadge();
  updateExtraBadge();
  updateIncomeBadge();
  updateLifeBalance();
}

var updateMealBadge=function(){ if(el.mealBadge) el.mealBadge.textContent='¥'+fmtMoney(calcMealTotal(state.draft)); };
var updateExtraBadge=function(){ if(el.extraBadge) el.extraBadge.textContent='¥'+fmtMoney(calcExtraTotal(state.draft)); };
var updateIncomeBadge=function(){ if(el.incomeBadge) el.incomeBadge.textContent='¥'+fmtMoney(calcIncomeTotal(state.draft)); };

function updateLifeBalance(){
  if(!el.lifeBalance||!state.draft) return;
  var pay=calcPay(state.draft);
  var exp=calcExpense(state.draft);
  var inc=calcIncomeTotal(state.draft);
  var net=Math.round((pay+inc-exp)*100)/100;
  el.lifeBalance.textContent=fmtNet(net);
  el.lifeBalance.style.color=net<0?'#ff5c7c':'#4affd4';
  if(el.lifeDetail) el.lifeDetail.textContent='工资 ¥'+fmtMoney(pay)+' ＋ 收入 ¥'+fmtMoney(inc)+' － 支出 ¥'+fmtMoney(exp);
}

function refreshPayPreview(){
  if(!state.draft) return;
  if(el.payVal) el.payVal.textContent='¥'+fmtMoney(calcPay(state.draft));
  updateLifeBalance();
}

function renderExtras(){
  if(!el.extraList) return;
  el.extraList.innerHTML='';
  var list=state.draft.life.extras||[];
  if(!list.length){
    el.extraList.innerHTML='<div class="empty-tip">暂无额外支出，点击下方按钮新增类目</div>';
    updateExtraBadge();
    return;
  }
  list.forEach(function(it,i){ appendExtraItem(it,i); });
  updateExtraBadge();
}

function appendExtraItem(it,i){
  var row=document.createElement('div');
  row.className='extra-item';
  row.innerHTML='<div class="extra-top"><input class="inp extra-name" type="text" placeholder="类目（交通 / 购物 / 医疗…）" value="'+escapeHtml(it.name)+'" maxlength="30"><input class="inp extra-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0.00" value="'+escapeHtml(it.amount===''||it.amount===undefined?'':it.amount)+'"><button type="button" class="del-btn">×</button></div><div class="extra-bottom"><div class="photo-box" id="photoBox-extra-'+i+'" data-kind="extra" data-index="'+i+'"></div><span class="extra-hint">点击拍照 / 上传凭证</span></div>';
  var nameI=row.querySelector('.extra-name');
  var amtI=row.querySelector('.extra-amt');
  nameI.addEventListener('input',function(e){
    state.draft.life.extras[i].name=e.target.value;
    enableLife(); markDirty();
  });
  amtI.addEventListener('input',function(e){
    state.draft.life.extras[i].amount=e.target.value;
    enableLife(); markDirty(); updateExtraBadge(); updateLifeBalance();
  });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.life.extras.splice(i,1);
    enableLife(); markDirty(); renderExtras(); renderPhotoBoxes(); updateLifeBalance();
  });
  el.extraList.appendChild(row);
  var box=row.querySelector('.photo-box');
  renderPhotoBox(box,it.photo||'',{kind:'extra',index:i});
}

function renderIncomes(){
  if(!el.incomeList) return;
  el.incomeList.innerHTML='';
  var list=state.draft.life.incomes||[];
  if(!list.length){
    el.incomeList.innerHTML='<div class="empty-tip">暂无其他收入，点击下方按钮新增类目</div>';
    updateIncomeBadge();
    return;
  }
  list.forEach(function(it,i){ appendIncomeItem(it,i); });
  updateIncomeBadge();
}

function appendIncomeItem(it,i){
  var row=document.createElement('div');
  row.className='extra-item';
  row.innerHTML='<div class="extra-top"><input class="inp extra-name" type="text" placeholder="类目（红包 / 兼职 / 退款…）" value="'+escapeHtml(it.name)+'" maxlength="30"><input class="inp extra-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0.00" value="'+escapeHtml(it.amount===''||it.amount===undefined?'':it.amount)+'"><button type="button" class="del-btn">×</button></div><div class="extra-bottom"><div class="photo-box" id="photoBox-income-'+i+'" data-kind="income" data-index="'+i+'"></div><span class="extra-hint">点击拍照 / 上传凭证</span></div>';
  var nameI=row.querySelector('.extra-name');
  var amtI=row.querySelector('.extra-amt');
  nameI.addEventListener('input',function(e){
    state.draft.life.incomes[i].name=e.target.value;
    enableLife(); markDirty();
  });
  amtI.addEventListener('input',function(e){
    state.draft.life.incomes[i].amount=e.target.value;
    enableLife(); markDirty(); updateIncomeBadge(); updateLifeBalance();
  });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.life.incomes.splice(i,1);
    enableLife(); markDirty(); renderIncomes(); renderPhotoBoxes(); updateLifeBalance();
  });
  el.incomeList.appendChild(row);
  var box=row.querySelector('.photo-box');
  renderPhotoBox(box,it.photo||'',{kind:'income',index:i});
}

function enableLife(){
  if(state.draft.life.enabled===false) state.draft.life.enabled=true;
}

function renderPhotoBoxes(){
  MEAL_KEYS.forEach(function(k){
    var box=document.getElementById('photoBox-'+k);
    if(box) renderPhotoBox(box,state.draft.life.meals[k].photo||'',{kind:'meal',key:k});
  });
  (state.draft.life.extras||[]).forEach(function(e,i){
    var box=document.getElementById('photoBox-extra-'+i);
    if(box) renderPhotoBox(box,e.photo||'',{kind:'extra',index:i});
  });
  (state.draft.life.incomes||[]).forEach(function(e,i){
    var box=document.getElementById('photoBox-income-'+i);
    if(box) renderPhotoBox(box,e.photo||'',{kind:'income',index:i});
  });
}

function renderPhotoBox(box,dataUrl,target){
  box.dataset.kind=target.kind;
  if(target.kind==='meal') box.dataset.key=target.key;
  else box.dataset.index=String(target.index);
  if(dataUrl){
    box.classList.add('has-photo');
    box.innerHTML='<img src="'+dataUrl+'" alt=""><button type="button" class="photo-remove">×</button>';
  }else{
    box.classList.remove('has-photo');
    box.innerHTML='<div class="photo-empty"><span class="photo-icon">📷</span><span class="photo-text">拍照</span></div>';
  }
}

function pickPhoto(target){
  photoTarget=target;
  try{ el.photoInput.value=''; }catch(e){}
  el.photoInput.click();
}

function compressImage(file,maxSize,quality){
  return new Promise(function(resolve,reject){
    if(!file||!file.type||!file.type.startsWith('image/')){ reject(new Error('不是图片文件')); return; }
    if(file.size>10*1024*1024){ reject(new Error('图片不能超过 10MB')); return; }
    var reader=new FileReader();
    reader.onload=function(){
      var img=new Image();
      img.onload=function(){
        try{
          var w=img.naturalWidth||img.width;
          var h=img.naturalHeight||img.height;
          var scale=Math.min(1,maxSize/Math.max(w,h));
          w=Math.max(1,Math.round(w*scale));
          h=Math.max(1,Math.round(h*scale));
          var canvas=document.createElement('canvas');
          canvas.width=w; canvas.height=h;
          canvas.getContext('2d').drawImage(img,0,0,w,h);
          resolve(canvas.toDataURL('image/jpeg',quality));
        }catch(err){ reject(err); }
      };
      img.onerror=function(){ reject(new Error('图片加载失败')); };
      img.src=reader.result;
    };
    reader.onerror=function(){ reject(new Error('文件读取失败')); };
    reader.readAsDataURL(file);
  });
}

function applyPhoto(target,dataUrl){
  if(!target) return;
  if(target.kind==='meal'){
    state.draft.life.meals[target.key].photo=dataUrl;
    enableLife();
    var box=document.getElementById('photoBox-'+target.key);
    if(box) renderPhotoBox(box,dataUrl,target);
  }else if(target.kind==='extra'){
    var item=state.draft.life.extras[target.index];
    if(item){ item.photo=dataUrl; enableLife(); var box2=document.getElementById('photoBox-extra-'+target.index); if(box2) renderPhotoBox(box2,dataUrl,target); }
  }else if(target.kind==='income'){
    var item2=state.draft.life.incomes[target.index];
    if(item2){ item2.photo=dataUrl; enableLife(); var box3=document.getElementById('photoBox-income-'+target.index); if(box3) renderPhotoBox(box3,dataUrl,target); }
  }
  markDirty();
}

function clearPhoto(box){
  if(!box) return;
  var kind=box.dataset.kind;
  if(kind==='meal'){
    var key=box.dataset.key;
    state.draft.life.meals[key].photo='';
    renderPhotoBox(box,'',{kind:'meal',key:key});
  }else if(kind==='extra'){
    var idx=Number(box.dataset.index);
    var item=state.draft.life.extras[idx];
    if(item) item.photo='';
    renderPhotoBox(box,'',{kind:'extra',index:idx});
  }else if(kind==='income'){
    var idx2=Number(box.dataset.index);
    var item2=state.draft.life.incomes[idx2];
    if(item2) item2.photo='';
    renderPhotoBox(box,'',{kind:'income',index:idx2});
  }
  markDirty();
}

function markDirty(){
  state.dirty=true;
  setSaveState('dirty');
}

function setSaveState(s){
  if(!el.saveBtn) return;
  el.saveBtn.classList.remove('dirty','saved');
  if(s==='dirty'){
    el.saveBtn.textContent='保 存 修 改';
    el.saveBtn.classList.add('dirty');
  }else if(s==='saved'){
    el.saveBtn.textContent='✓ 已 保 存';
    el.saveBtn.classList.add('saved');
  }else{
    el.saveBtn.textContent='保 存';
  }
}

function resetCurrentTab(){
  if(state.activeTab==='work'){
    state.draft.work=blankWork();
    state.draft.work.enabled=false;
    fillWorkForm();
    refreshPayPreview();
    showToast('工作已重置 · 保存后生效');
  }else{
    state.draft.life=blankLife();
    state.draft.life.enabled=false;
    fillLifeForm();
    refreshPayPreview();
    showToast('生活已重置 · 保存后生效');
  }
  markDirty();
}

function saveDay(){
  if(!state.draft||!state.year||!state.month||!state.day) return;
  var k=keyOf(state.year,state.month,state.day);
  DB[k]=JSON.parse(JSON.stringify(state.draft));
  var ok=saveDB();
  if(ok){
    state.dirty=false;
    setSaveState('saved');
    showToast('已保存 · '+state.year+'年'+state.month+'月'+state.day+'日');
    refreshDayCell(state.month,state.day);
    renderSummary(state.month,state.day);
    refreshHome();
    setTimeout(function(){ closeEditModal(true); },300);
  }else{
    showToast('保存失败：本地存储可能已满',true);
  }
}

/* ============================================================
   工资模板
   ============================================================ */
function openWageModal(){
  if(!el.wageModal||!state.draft) return;
  wageDraft=JSON.parse(JSON.stringify(state.draft.work.wage||blankWage()));
  wageDraft.allowances=wageDraft.allowances||[];
  el.wageModeSeg.querySelectorAll('button').forEach(function(b){
    b.classList.toggle('active',b.dataset.v===wageDraft.mode);
  });
  el.fieldHourly.hidden=wageDraft.mode!=='hourly';
  el.fieldBase.hidden=wageDraft.mode!=='base';
  el.hourlyRate.value=wageDraft.hourlyRate!=null?wageDraft.hourlyRate:25;
  el.baseSalary.value=wageDraft.baseSalary!=null?wageDraft.baseSalary:5000;
  el.monthDays.value=wageDraft.monthDays!=null?wageDraft.monthDays:21.75;
  el.stdHours.value=wageDraft.stdHours!=null?wageDraft.stdHours:8;
  renderAllowances();
  updateWagePreview();
  el.wageModal.classList.add('open');
  el.wageModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeWageModal(){
  if(!el.wageModal) return;
  el.wageModal.classList.remove('open');
  el.wageModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function renderAllowances(){
  if(!el.allowList) return;
  el.allowList.innerHTML='';
  var list=wageDraft.allowances;
  if(!list.length){
    el.allowList.innerHTML='<div class="empty-tip">暂无补贴（餐补、全勤、夜班津贴…）</div>';
    return;
  }
  var frag=document.createDocumentFragment();
  list.forEach(function(a,i){
    var row=document.createElement('div');
    row.className='row-item';
    row.innerHTML='<input class="inp" style="flex:1.5" type="text" placeholder="补贴名称" value="'+escapeHtml(a.name)+'" maxlength="20"><input class="inp" style="flex:1;text-align:right" type="number" min="0" step="0.5" inputmode="decimal" placeholder="金额" value="'+escapeHtml(a.amount===''||a.amount===undefined?'':a.amount)+'"><button type="button" class="del-btn">×</button>';
    var ins=row.querySelectorAll('input');
    ins[0].addEventListener('input',function(e){ wageDraft.allowances[i].name=e.target.value; });
    ins[1].addEventListener('input',function(e){ wageDraft.allowances[i].amount=e.target.value; updateWagePreview(); });
    row.querySelector('.del-btn').addEventListener('click',function(){
      wageDraft.allowances.splice(i,1);
      renderAllowances();
      updateWagePreview();
    });
    frag.appendChild(row);
  });
  el.allowList.appendChild(frag);
}

function updateWagePreview(){
  if(!state.draft||!el.wagePreview) return;
  var tmp={work:{enabled:true,start:state.draft.work.start,end:state.draft.work.end,breaks:state.draft.work.breaks,wage:wageDraft}};
  el.wagePreview.textContent='¥'+fmtMoney(calcPay(tmp));
}

/* ============================================================
   智能分析（只对 1-31 号高亮）
   ============================================================ */
function applyAnalysisHighlight(){
  if(!el.daysGrid) return;
  var mode=state.analysisMode;
  el.daysGrid.querySelectorAll('.grid-day').forEach(function(c){
    c.classList.remove('highlight','income-hl','expense-hl');
  });
  if(!mode||!state.year||!state.month) return;
  var year=state.year, m=state.month, n=daysInMonth(year,m);
  var values=[];
  for(var d=1;d<=n;d++){
    var day=getDay(year,m,d);
    var val=mode.indexOf('income')===0?(calcPay(day)+calcIncomeTotal(day)):calcExpense(day);
    values.push({d:d,v:val});
  }
  var sum=values.reduce(function(s,x){ return s+x.v; },0);
  var avg=sum/n;
  if(avg<=0){
    if(el.analysisTip){
      el.analysisTip.textContent='本月无数据，无法分析';
      el.analysisTip.classList.add('active');
    }
    return;
  }
  var higher=mode.indexOf('high')>0;
  var pool=values.filter(function(x){ return x.v>0&&(higher?x.v>avg:x.v<avg); });
  pool.sort(function(a,b){ return higher?b.v-a.v:a.v-b.v; });
  pool=pool.slice(0,5);
  var cls=mode.indexOf('income')===0?'income-hl':'expense-hl';
  pool.forEach(function(x){
    var cell=el.daysGrid.querySelector('.grid-day[data-day="'+x.d+'"]');
    if(cell) cell.classList.add('highlight',cls);
  });
  if(el.analysisTip){
    if(!pool.length){
      el.analysisTip.textContent='本月无'+(higher?'高于':'低于')+'平均的记录';
      el.analysisTip.classList.add('active');
    }else{
      el.analysisTip.textContent='已高亮 '+pool.length+' 天 · 月平均 ¥'+fmtMoney(avg);
      el.analysisTip.classList.add('active');
    }
  }
}

/* ============================================================
   导入导出
   ============================================================ */
function exportData(){
  var data={};
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    data[k]=localStorage.getItem(k);
  }
  var json=JSON.stringify(data);
  var blob=new Blob([json],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  var stamp=new Date().toISOString().slice(0,10);
  var who=(currentUsername||'user').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g,'_');
  a.download='nova-'+who+'-'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  showToast('已导出！请到「文件」App 的「下载」里找备份文件');
}

function importData(){
  var input=document.createElement('input');
  input.type='file';
  input.accept='.json,application/json';
  input.onchange=function(e){
    var file=e.target.files[0];
    if(!file) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var data=JSON.parse(ev.target.result);
        var count=0;
        for(var k in data){
          if(Object.prototype.hasOwnProperty.call(data,k)){
            localStorage.setItem(k,data[k]);
            count++;
          }
        }
        showToast('导入成功！共恢复 '+count+' 条数据，即将刷新');
        setTimeout(function(){ location.reload(); },800);
      }catch(err){
        showToast('文件格式错误，导入失败',true);
        console.error(err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ============================================================
   报表弹窗
   ============================================================ */
function openReportModal(){
  if(!el.reportModal) return;
  el.reportModal.classList.add('open');
  el.reportModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  if(el.reportYear) el.reportYear.value=y;
  if(el.reportYearM) el.reportYearM.value=y;
  if(el.reportMonth) el.reportMonth.value=m;
  setReportMode('year');
}

function closeReportModal(){
  if(!el.reportModal) return;
  el.reportModal.classList.remove('open');
  el.reportModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function setReportMode(mode){
  if(!el.reportModeSeg) return;
  el.reportModeSeg.querySelectorAll('button').forEach(function(b){
    b.classList.toggle('active',b.dataset.v===mode);
  });
  if(el.reportYearField) el.reportYearField.hidden=mode!=='year';
  if(el.reportMonthField) el.reportMonthField.hidden=mode!=='month';
  if(el.reportDesc){
    el.reportDesc.textContent=mode==='year'
      ? '年度报表：展示 1-12 月汇总信息（不标红）'
      : '月度报表：展示当月每日明细（工资高于平均=绿，三餐超平均=红）';
  }
}

function exportWord(){
  if(!el.reportModeSeg) return;
  var activeBtn=el.reportModeSeg.querySelector('button.active');
  var mode=activeBtn?activeBtn.dataset.v:'year';
  var user=currentUsername||'用户';
  var html, filename;

  if(mode==='year'){
    var y=Number(el.reportYear.value)||new Date().getFullYear();
    html=buildYearReportHTML(y,user);
    filename='NOVA年度报表-'+user+'-'+y+'.doc';
  }else{
    var ym=Number(el.reportYearM.value)||new Date().getFullYear();
    var mm=Number(el.reportMonth.value)||1;
    html=buildMonthReportHTML(ym,mm,user);
    filename='NOVA月度报表-'+user+'-'+ym+String(mm).padStart(2,'0')+'.doc';
  }

  var blob=new Blob(['\ufeff',html],{type:'application/msword'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  showToast('已导出 Word 报表');
  closeReportModal();
}

/* --- 月度报表：工资 > 平均 = 绿色；三餐 > 平均 = 红色 --- */
function buildMonthReportHTML(y,m,user){
  var n=daysInMonth(y,m);
  var rows='';
  var totalIncome=0,totalExpense=0,days=0,totalMeal=0,totalPay=0;
  var dayList=[];

  for(var d=1;d<=n;d++){
    var k=keyOf(y,m,d);
    var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
    var day=hasData?getDay(y,m,d):null;
    var pay=day?calcPay(day):0;
    var inc=day?calcIncomeTotal(day):0;
    var exp=day?calcExpense(day):0;
    var meal=day?calcMealTotal(day):0;
    var extra=day?calcExtraTotal(day):0;
    var income=pay+inc;
    if(dayHasRecord(day)){
      days++;
      totalIncome+=income;
      totalExpense+=exp;
      totalMeal+=meal;
      totalPay+=pay;
    }
    dayList.push({d:d,pay:pay,inc:inc,meal:meal,extra:extra,exp:exp,income:income});
  }

  var avgPay=days?totalPay/days:0;
  var avgMeal=days?totalMeal/days:0;

  dayList.forEach(function(x){
    var wd=WD[new Date(y,m-1,x.d).getDay()];
    var payCls=x.pay>avgPay&&x.pay>0?' style="color:#0a8f4a;font-weight:700"':'';
    var mealCls=x.meal>avgMeal&&x.meal>0?' style="color:#e00;font-weight:700"':'';
    rows+='<tr>'
      +'<td>'+y+'-'+String(m).padStart(2,'0')+'-'+String(x.d).padStart(2,'0')+' 周'+wd+'</td>'
      +'<td'+payCls+'>'+fmtMoney(x.pay)+'</td>'
      +'<td>'+fmtMoney(x.inc)+'</td>'
      +'<td'+mealCls+'>'+fmtMoney(x.meal)+'</td>'
      +'<td>'+fmtMoney(x.extra)+'</td>'
      +'<td>'+fmtMoney(x.income-x.exp)+'</td>'
      +'</tr>';
  });

  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>NOVA 月度报表</title><style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#222}h1{font-size:22px;color:#0a4d8c}h2{font-size:15px;color:#555}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#e8f4ff;color:#0a4d8c}.sum{margin-top:14px;font-size:14px}.sum b{color:#0a4d8c}.legend{margin-top:8px;font-size:12px;color:#555}</style></head><body>'
    +'<h1>NOVA 月度财务报表</h1>'
    +'<p>用户：'+escapeHtml(user)+'</p>'
    +'<p>月份：'+y+'年'+m+'月（共 '+n+' 天）</p>'
    +'<p>生成时间：'+new Date().toLocaleString('zh-CN')+'</p>'
    +'<h2>每日明细</h2>'
    +'<table><thead><tr><th>日期</th><th>工资</th><th>其他收入</th><th>三餐</th><th>额外支出</th><th>当日结余</th></tr></thead><tbody>'
    +rows+'</tbody></table>'
    +'<div class="legend">🟢 绿色 = 当日工资高于月平均（¥'+fmtMoney(avgPay)+'）　🔴 红色 = 当日三餐高于月平均（¥'+fmtMoney(avgMeal)+'）</div>'
    +'<div class="sum"><p>记录天数：<b>'+days+' 天</b></p>'
    +'<p>月平均工资：<b>¥'+fmtMoney(avgPay)+'</b></p>'
    +'<p>月平均三餐：<b>¥'+fmtMoney(avgMeal)+'</b></p>'
    +'<p>本月总收入：<b>¥'+fmtMoney(totalIncome)+'</b></p>'
    +'<p>本月总支出：<b>¥'+fmtMoney(totalExpense)+'</b></p>'
    +'<p>本月结余：<b>¥'+fmtMoney(totalIncome-totalExpense)+'</b></p></div>'
    +'<p style="margin-top:24px;color:#888;font-size:11px">本报表由 NOVA 自动生成 · 数据仅存于本机</p>'
    +'</body></html>';
}

/* --- 年度报表：仅 1-12 月汇总，无红色字体 --- */
function buildYearReportHTML(y,user){
  var rows='';
  var totalIncome=0,totalExpense=0;
  var monthList=[];

  for(var m=1;m<=12;m++){
    var n=daysInMonth(y,m);
    var inc=0,exp=0,days=0;
    for(var d=1;d<=n;d++){
      var k=keyOf(y,m,d);
      var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
      if(!hasData) continue;
      var day=getDay(y,m,d);
      if(!dayHasRecord(day)) continue;
      days++;
      inc+=calcPay(day)+calcIncomeTotal(day);
      exp+=calcExpense(day);
    }
    totalIncome+=inc;
    totalExpense+=exp;
    monthList.push({m:m,inc:inc,exp:exp,days:days});
  }

  monthList.forEach(function(x){
    rows+='<tr>'
      +'<td>'+y+'年'+x.m+'月</td>'
      +'<td>'+x.days+' 天</td>'
      +'<td>'+fmtMoney(x.inc)+'</td>'
      +'<td>'+fmtMoney(x.exp)+'</td>'
      +'<td>'+fmtMoney(x.inc-x.exp)+'</td>'
      +'</tr>';
  });

  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>NOVA 年度报表</title><style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#222}h1{font-size:22px;color:#0a4d8c}h2{font-size:15px;color:#555}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#e8f4ff;color:#0a4d8c}.sum{margin-top:14px;font-size:14px}.sum b{color:#0a4d8c}</style></head><body>'
    +'<h1>NOVA 年度财务报表</h1>'
    +'<p>用户：'+escapeHtml(user)+'</p>'
    +'<p>年份：'+y+' 年</p>'
    +'<p>生成时间：'+new Date().toLocaleString('zh-CN')+'</p>'
    +'<h2>月度汇总</h2>'
    +'<table><thead><tr><th>月份</th><th>记录天数</th><th>收入</th><th>支出</th><th>结余</th></tr></thead><tbody>'
    +rows+'</tbody></table>'
    +'<div class="sum"><p>全年总收入：<b>¥'+fmtMoney(totalIncome)+'</b></p>'
    +'<p>全年总支出：<b>¥'+fmtMoney(totalExpense)+'</b></p>'
    +'<p>全年结余：<b>¥'+fmtMoney(totalIncome-totalExpense)+'</b></p></div>'
    +'<p style="margin-top:24px;color:#888;font-size:11px">本报表由 NOVA 自动生成 · 数据仅存于本机</p>'
    +'</body></html>';
}

/* ============================================================
   金额隐藏
   ============================================================ */
function toggleMoney(){
  state.moneyHidden=!state.moneyHidden;
  if(el.eyeBtn) el.eyeBtn.classList.toggle('hidden',state.moneyHidden);
  if(el.pwdToggle) el.pwdToggle.classList.toggle('hidden',!state.moneyHidden);
  try{ localStorage.setItem('nova_money_hidden',state.moneyHidden?'1':'0'); }catch(err){}
  refreshBalance();
  renderFunds();
  if(state.draft) refreshPayPreview();
  if(state.year&&state.month&&state.day){
    var k=keyOf(state.year,state.month,state.day);
    var hasData=(state.year===DBYear?DB[k]:readYearData(state.year)[k]);
    if(hasData) renderSummary(state.month,state.day);
  }
}

/* ============================================================
   视野范围
   ============================================================ */
function openRangeModal(){
  if(!el.rangeModal) return;
  rangeDraft=JSON.parse(JSON.stringify(state.range));
  el.rangeTabs.forEach(function(t){
    t.classList.toggle('active',t.dataset.range===rangeDraft.type);
  });
  el.rangePanelAll.hidden=rangeDraft.type!=='all';
  el.rangePanelYear.hidden=rangeDraft.type!=='year';
  el.rangePanelCust.hidden=rangeDraft.type!=='custom';
  if(el.rangeAllDesc) el.rangeAllDesc.textContent='统计 '+MIN_YEAR+' 年至今的全部记录';
  buildRangeYearPicker();
  if(rangeDraft.type==='custom'){
    el.rangeStart.value=rangeDraft.start||(MIN_YEAR+'-01');
    el.rangeEnd.value=rangeDraft.end||((state.year||MIN_YEAR)+'-12');
  }else{
    el.rangeStart.value=MIN_YEAR+'-01';
    el.rangeEnd.value=(state.year||MIN_YEAR)+'-12';
  }
  updateRangePreview();
  el.rangeModal.classList.add('open');
  el.rangeModal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
}

function closeRangeModal(){
  if(!el.rangeModal) return;
  el.rangeModal.classList.remove('open');
  el.rangeModal.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
}

function buildRangeYearPicker(){
  if(!el.rangeYearPicker) return;
  el.rangeYearPicker.innerHTML='';
  var frag=document.createDocumentFragment();
  for(var y=MIN_YEAR;y<=MAX_YEAR;y++){
    var btn=document.createElement('button');
    btn.type='button';
    btn.className='year-pick-btn'+((rangeDraft.type==='year'&&rangeDraft.year===y)?' active':'');
    btn.textContent=y;
    btn.dataset.year=y;
    btn.addEventListener('click',function(ev){
      var target=ev.currentTarget;
      rangeDraft.type='year';
      rangeDraft.year=Number(target.dataset.year);
      el.rangeYearPicker.querySelectorAll('.year-pick-btn').forEach(function(x){
        x.classList.toggle('active',x===target);
      });
      updateRangePreview();
    });
    frag.appendChild(btn);
  }
  el.rangeYearPicker.appendChild(frag);
}

function updateRangePreview(){
  var range={type:'all'};
  if(rangeDraft.type==='year'){
    range={type:'year',year:rangeDraft.year};
  }else if(rangeDraft.type==='custom'){
    var s=el.rangeStart.value||(MIN_YEAR+'-01');
    var e=el.rangeEnd.value||((state.year||MIN_YEAR)+'-12');
    if(s>e){
      el.rangeResult.textContent='—';
      el.rangeResult.classList.remove('negative');
      return;
    }
    range={type:'custom',start:s,end:e};
  }
  var t=calcRangeTotal(range);
  el.rangeResult.textContent=fmtNet(t.balance);
  el.rangeResult.classList.toggle('negative',t.balance<0);
}

function loadRange(){
  try{
    var raw=localStorage.getItem(rangeKey());
    if(raw){
      var r=JSON.parse(raw);
      if(r&&r.type) state.range=r;
    }
  }catch(e){}
}

function saveRange(){
  try{ localStorage.setItem(rangeKey(),JSON.stringify(state.range)); }catch(e){}
}

function rangeLabel(range){
  if(!range) return '全部时间';
  if(range.type==='year') return range.year+' 年';
  if(range.type==='custom') return range.start.replace('-','年')+'月 ~ '+range.end.replace('-','年')+'月';
  return '全部时间';
}

/* ============================================================
   事件绑定（全事件委托）
   ============================================================ */
function bindAll(){

  /* ---------- 点击事件 ---------- */
  document.addEventListener('click',function(e){
    var t;

    /* 登录页 */
    t=e.target.closest('.mode-tab');
    if(t){
      if(t.dataset.mode===state.authMode) return;
      setAuthMode(t.dataset.mode);
      showLoginMsg('','');
      return;
    }
    if(e.target.closest('#loginBtn')){ doAuth(); return; }
    if(e.target.closest('#pwdToggle')){
      var isPwd=el.loginPass.type==='password';
      el.loginPass.type=isPwd?'text':'password';
      el.pwdToggle.classList.toggle('hidden',!isPwd);
      return;
    }

    /* 底栏导航 */
    var nav=e.target.closest('.nav-item');
    if(nav){ switchTab(nav.dataset.tab); return; }

    /* 设置页 */
    if(e.target.closest('#logoutBtn')){ doLogout(); return; }
    if(e.target.closest('#exportBtn')){ exportData(); return; }
    if(e.target.closest('#importBtn')){ importData(); return; }
    if(e.target.closest('#reportBtn')){ openReportModal(); return; }

    /* 主页 */
    if(e.target.closest('#eyeBtn')){ e.stopPropagation(); toggleMoney(); return; }
    if(e.target.closest('#balanceCard')){ openRangeModal(); return; }

    /* 资金管理 */
    if(e.target.closest('#fundAddBtn')){ openFundModal(-1); return; }
    if(e.target.closest('#fundClose')){ closeFundModal(); return; }
    if(e.target.closest('#fundConfirm')){
      var name=(el.fundName.value||'').trim();
      var amount=Number(el.fundAmount.value)||0;
      if(!name){ showToast('请输入账户名称',true); return; }
      if(amount<0){ showToast('金额不能为负',true); return; }
      if(fundEditIndex>=0){
        fundAccounts[fundEditIndex]={name:name,amount:amount};
      }else{
        fundAccounts.push({name:name,amount:amount});
      }
      fundDirty=true;
      saveFunds();
      closeFundModal();
      renderFunds();
      showToast('已更新账户');
      return;
    }
    if(e.target.closest('#fundDelete')){
      if(fundEditIndex<0) return;
      if(!confirm('确认删除账户「'+fundAccounts[fundEditIndex].name+'」？')) return;
      fundAccounts.splice(fundEditIndex,1);
      fundDirty=true;
      saveFunds();
      closeFundModal();
      renderFunds();
      showToast('已删除账户');
      return;
    }
    if(e.target.closest('#fundSaveBtn')){
      var total=fundAccounts.reduce(function(s,a){ return s+(Number(a.amount)||0); },0);
      total=Math.round(total*100)/100;
      var balanceTotal=calcRangeTotal(state.range).balance;
      var diff=Math.round((total-balanceTotal)*100)/100;
      if(Math.abs(diff)>=0.01){
        showToast('资金总和与余额不一致，无法保存',true);
        return;
      }
      saveFunds();
      fundDirty=false;
      renderFunds();
      showToast('保存成功');
      return;
    }
    var fundItem=e.target.closest('.fund-item');
    if(fundItem){
      openFundModal(Number(fundItem.dataset.fundIndex));
      return;
    }

    /* 日期页：年份 / 月份 触发器 */
    if(e.target.closest('#yearTrigger')){ openYearModal(); return; }
    if(e.target.closest('#monthTrigger')){ openMonthModal(); return; }
    if(e.target.closest('#yearClose')){ closeYearModal(); return; }
    if(e.target.closest('#yearConfirm')){ confirmYear(); return; }
    if(e.target.closest('#monthClose')){ closeMonthModal(); return; }
    if(e.target.closest('#monthConfirm')){ confirmMonth(); return; }

    /* 日期收起 / 展开 */
    if(e.target.closest('#daysToggle')){
      var collapsed=el.daysBody.hidden;
      el.daysBody.hidden=!collapsed;
      el.daysToggle.textContent=collapsed?'收起 ▴':'展开 ▾';
      state.daysCollapsed=!collapsed;
      return;
    }

    /* 摘要卡 → 打开编辑弹窗 */
    if(e.target.closest('#summaryCard')){
      if(state.year&&state.month&&state.day) openEditModal();
      return;
    }

    /* 编辑弹窗 */
    if(e.target.closest('#editClose')){ closeEditModal(false); return; }
    var et=e.target.closest('#editTabs .tab');
    if(et){ switchTabPanel(et.dataset.tab); return; }
    if(e.target.closest('#resetBtn')){ resetCurrentTab(); return; }
    if(e.target.closest('#saveBtn')){ saveDay(); return; }

    /* 工资模板 */
    if(e.target.closest('#payBlock')){
      if(state.draft&&state.draft.work.enabled) openWageModal();
      return;
    }
    if(e.target.closest('#wageClose')){ closeWageModal(); return; }
    var wm=e.target.closest('#wageModeSeg button');
    if(wm){
      wageDraft.mode=wm.dataset.v;
      el.wageModeSeg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active',x===wm); });
      el.fieldHourly.hidden=wageDraft.mode!=='hourly';
      el.fieldBase.hidden=wageDraft.mode!=='base';
      updateWagePreview();
      return;
    }
    if(e.target.closest('#addAllow')){
      wageDraft.allowances.push({name:'',amount:''});
      renderAllowances();
      return;
    }
    if(e.target.closest('#wageConfirm')){
      var w=JSON.parse(JSON.stringify(wageDraft));
      w.hourlyRate=Number(el.hourlyRate.value)||0;
      w.baseSalary=Number(el.baseSalary.value)||0;
      w.monthDays=Number(el.monthDays.value)||21.75;
      w.stdHours=Number(el.stdHours.value)||8;
      w.allowances=wageDraft.allowances.map(function(a){ return {name:a.name||'补贴',amount:Number(a.amount)||0}; });
      state.draft.work.wage=w;
      enableWork();
      closeWageModal();
      markDirty();
      refreshPayPreview();
      showToast('工资模板已更新');
      return;
    }

    /* 添加无薪时段 */
    if(e.target.closest('#addBreak')){
      if(!state.draft.work.breaks) state.draft.work.breaks=[];
      var idx=state.draft.work.breaks.length;
      var nb={start:'12:00',end:'13:00'};
      state.draft.work.breaks.push(nb);
      if(idx===0) el.breakList.innerHTML='';
      appendBreakRow(nb,idx);
      enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
      return;
    }

    /* 添加额外支出 / 收入 */
    if(e.target.closest('#addExtra')){
      if(!state.draft.life.extras) state.draft.life.extras=[];
      var idx2=state.draft.life.extras.length;
      var ne={name:'',amount:'',photo:''};
      state.draft.life.extras.push(ne);
      if(idx2===0) el.extraList.innerHTML='';
      appendExtraItem(ne,idx2);
      enableLife(); markDirty(); updateExtraBadge(); updateLifeBalance();
      return;
    }
    if(e.target.closest('#addIncome')){
      if(!state.draft.life.incomes) state.draft.life.incomes=[];
      var idx3=state.draft.life.incomes.length;
      var ne2={name:'',amount:'',photo:''};
      state.draft.life.incomes.push(ne2);
      if(idx3===0) el.incomeList.innerHTML='';
      appendIncomeItem(ne2,idx3);
      enableLife(); markDirty(); updateIncomeBadge(); updateLifeBalance();
      return;
    }

    /* 智能分析 */
    if(e.target.closest('#analysisReset')){
      state.analysisMode=null;
      if(el.analysisTip){
        el.analysisTip.textContent='点击上方按钮，高亮当月对应日期';
        el.analysisTip.classList.remove('active');
      }
      document.querySelectorAll('.analysis-item').forEach(function(x){ x.classList.remove('active'); });
      applyAnalysisHighlight();
      return;
    }
    var ai=e.target.closest('.analysis-item');
    if(ai){
      if(!state.year||!state.month){ showToast('请先选择年月',true); return; }
      var mode=ai.dataset.mode;
      if(state.analysisMode===mode){
        state.analysisMode=null;
        ai.classList.remove('active');
        if(el.analysisTip){
          el.analysisTip.textContent='已取消高亮';
          el.analysisTip.classList.remove('active');
        }
      }else{
        state.analysisMode=mode;
        document.querySelectorAll('.analysis-item').forEach(function(x){ x.classList.toggle('active',x===ai); });
        if(el.analysisTip){
          el.analysisTip.textContent='已高亮：'+ai.querySelector('.ai-label').textContent;
          el.analysisTip.classList.add('active');
        }
      }
      applyAnalysisHighlight();
      return;
    }

    /* 报表弹窗 */
    if(e.target.closest('#reportClose')){ closeReportModal(); return; }
    var rmb=e.target.closest('#reportModeSeg button');
    if(rmb){ setReportMode(rmb.dataset.v); return; }
    if(e.target.closest('#reportConfirm')){ exportWord(); return; }

    /* 视野范围 */
    if(e.target.closest('#rangeClose')){ closeRangeModal(); return; }
    var rt=e.target.closest('.range-tab');
    if(rt){
      var type=rt.dataset.range;
      el.rangeTabs.forEach(function(x){ x.classList.toggle('active',x===rt); });
      el.rangePanelAll.hidden=type!=='all';
      el.rangePanelYear.hidden=type!=='year';
      el.rangePanelCust.hidden=type!=='custom';
      if(type==='all'){ rangeDraft={type:'all'}; }
      else if(type==='year'){ rangeDraft={type:'year',year:rangeDraft.year||state.year||MIN_YEAR}; buildRangeYearPicker(); }
      else{
        rangeDraft={type:'custom',start:rangeDraft.start||(MIN_YEAR+'-01'),end:rangeDraft.end||((state.year||MIN_YEAR)+'-12')};
        el.rangeStart.value=rangeDraft.start;
        el.rangeEnd.value=rangeDraft.end;
      }
      updateRangePreview();
      return;
    }
    if(e.target.closest('#rangeConfirm')){
      if(rangeDraft.type==='custom'){
        var s=el.rangeStart.value||(MIN_YEAR+'-01');
        var e2=el.rangeEnd.value||((state.year||MIN_YEAR)+'-12');
        if(s>e2){ showToast('开始月份不能晚于结束月份',true); return; }
        state.range={type:'custom',start:s,end:e2};
      }else if(rangeDraft.type==='year'){
        state.range={type:'year',year:rangeDraft.year||state.year||MIN_YEAR};
      }else{
        state.range={type:'all'};
      }
      saveRange();
      closeRangeModal();
      refreshBalance();
      renderFunds();
      showToast('已切换到：'+rangeLabel(state.range));
      return;
    }

    /* 点击弹窗背景关闭 */
    if(e.target.classList.contains('modal')){
      if(e.target.id==='fundModal') closeFundModal();
      else if(e.target.id==='wageModal') closeWageModal();
      else if(e.target.id==='rangeModal') closeRangeModal();
      else if(e.target.id==='reportModal') closeReportModal();
      else if(e.target.id==='yearModal') closeYearModal();
      else if(e.target.id==='monthModal') closeMonthModal();
      else if(e.target.id==='editModal') closeEditModal(false);
      return;
    }

    /* 照片相关 */
    var rmBtn=e.target.closest('.photo-remove');
    if(rmBtn){
      e.preventDefault(); e.stopPropagation();
      var box=rmBtn.closest('.photo-box');
      if(box) clearPhoto(box);
      return;
    }
    var pbox=e.target.closest('.photo-box');
    if(pbox&&state.draft){
      e.preventDefault();
      var kind=pbox.dataset.kind;
      if(!kind) return;
      if(kind==='meal') pickPhoto({kind:'meal',key:pbox.dataset.key});
      else if(kind==='extra') pickPhoto({kind:'extra',index:Number(pbox.dataset.index)});
      else if(kind==='income') pickPhoto({kind:'income',index:Number(pbox.dataset.index)});
      return;
    }
  },false);

  /* ---------- input 事件 ---------- */
  document.addEventListener('input',function(e){
    var t=e.target;
    if(!state.draft) return;
    if(t.id==='loginPass'){ showStrength(); return; }
    if(t.id==='locInput'){
      state.draft.work.location=t.value;
      enableWork(); updateLocBadge(); markDirty();
      return;
    }
    if(t.classList.contains('meal-input')){
      var key=t.dataset.meal;
      state.draft.life.meals[key].amount=t.value;
      enableLife(); markDirty(); updateMealBadge(); updateLifeBalance();
      return;
    }
    if(t.classList.contains('extra-name')||t.classList.contains('extra-amt')){
      var isName=t.classList.contains('extra-name');
      var item=t.closest('.extra-item');
      if(!item) return;
      var parent=item.parentElement;
      var idx=Array.prototype.indexOf.call(parent.children,item);
      if(parent===el.extraList&&state.draft.life.extras[idx]){
        if(isName) state.draft.life.extras[idx].name=t.value;
        else state.draft.life.extras[idx].amount=t.value;
        enableLife(); markDirty();
        if(!isName){ updateExtraBadge(); updateLifeBalance(); }
      }else if(parent===el.incomeList&&state.draft.life.incomes[idx]){
        if(isName) state.draft.life.incomes[idx].name=t.value;
        else state.draft.life.incomes[idx].amount=t.value;
        enableLife(); markDirty();
        if(!isName){ updateIncomeBadge(); updateLifeBalance(); }
      }
      return;
    }
    if(t.id==='hourlyRate'||t.id==='baseSalary'||t.id==='monthDays'||t.id==='stdHours'){
      wageDraft.hourlyRate=el.hourlyRate.value;
      wageDraft.baseSalary=el.baseSalary.value;
      wageDraft.monthDays=el.monthDays.value;
      wageDraft.stdHours=el.stdHours.value;
      updateWagePreview();
      return;
    }
  },false);

  /* ---------- change 事件 ---------- */
  document.addEventListener('change',function(e){
    var t=e.target;
    if(!state.draft) return;
    if(t.id==='startTime'){
      state.draft.work.start=t.value;
      enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
      return;
    }
    if(t.id==='endTime'){
      state.draft.work.end=t.value;
      enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
      return;
    }
    if(t.id==='rangeStart'&&rangeDraft){
      rangeDraft.type='custom'; rangeDraft.start=t.value; updateRangePreview(); return;
    }
    if(t.id==='rangeEnd'&&rangeDraft){
      rangeDraft.type='custom'; rangeDraft.end=t.value; updateRangePreview(); return;
    }
  },false);

  /* ---------- 班次切换 ---------- */
  document.addEventListener('click',function(e){
    var b=e.target.closest('#shiftSeg button');
    if(!b||!state.draft) return;
    var v=b.dataset.v;
    state.draft.work.shift=v;
    el.shiftSeg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active',x===b); });
    var toNight=v==='夜班'&&state.draft.work.start===DEFAULT_START&&state.draft.work.end===DEFAULT_END;
    var toDay=v==='白班'&&state.draft.work.start===NIGHT_START&&state.draft.work.end===NIGHT_END;
    if(toNight){ state.draft.work.start=NIGHT_START; state.draft.work.end=NIGHT_END; el.startTime.value=NIGHT_START; el.endTime.value=NIGHT_END; }
    else if(toDay){ state.draft.work.start=DEFAULT_START; state.draft.work.end=DEFAULT_END; el.startTime.value=DEFAULT_START; el.endTime.value=DEFAULT_END; }
    enableWork(); markDirty(); updateHoursBadge(); refreshPayPreview();
  },false);

  /* ---------- 照片上传 ---------- */
  if(el.photoInput) el.photoInput.addEventListener('change',async function(e){
    var file=e.target.files&&e.target.files[0];
    if(!file||!photoTarget){ photoTarget=null; return; }
    showToast('正在处理照片…');
    try{
      var dataUrl=await compressImage(file,680,0.6);
      applyPhoto(photoTarget,dataUrl);
      showToast('照片已添加 · 点击保存后生效');
    }catch(err){
      showToast(err.message||'照片处理失败',true);
    }
    photoTarget=null;
  });

  /* ---------- 键盘 ---------- */
  document.addEventListener('keydown',function(e){
    if(e.key==='Enter'){
      if(e.target.id==='loginUser'){ el.loginPass.focus(); return; }
      if(e.target.id==='loginPass'){
        if(state.authMode==='register') el.inviteCode.focus();
        else doAuth();
        return;
      }
      if(e.target.id==='inviteCode'){ doAuth(); return; }
    }
    if(e.key==='Escape'){
      if(el.wageModal&&el.wageModal.classList.contains('open')) closeWageModal();
      else if(el.rangeModal&&el.rangeModal.classList.contains('open')) closeRangeModal();
      else if(el.reportModal&&el.reportModal.classList.contains('open')) closeReportModal();
      else if(el.fundModal&&el.fundModal.classList.contains('open')) closeFundModal();
      else if(el.yearModal&&el.yearModal.classList.contains('open')) closeYearModal();
      else if(el.monthModal&&el.monthModal.classList.contains('open')) closeMonthModal();
      else if(el.editModal&&el.editModal.classList.contains('open')) closeEditModal(false);
    }
  });

  /* ---------- 大写锁定提示 ---------- */
  if(el.loginPass){
    el.loginPass.addEventListener('keyup',function(e){
      if(e.getModifierState&&e.getModifierState('CapsLock')) el.capsWarn.classList.add('show');
      else el.capsWarn.classList.remove('show');
    });
  }

  bindSessionTouch();
}

/* ============================================================
   启动
   ============================================================ */
function init(){
  try{
    cacheEls();
    bindAll();
    if(!HAS_WEB_CRYPTO) console.warn('[NOVA] 非安全上下文，已降级使用本地哈希。生产环境请部署到 HTTPS。');
    var s=getSession();
    if(s){
      currentUserKey=s.userKey;
      currentUsername=s.username;
      showApp();
      enterHome();
      startSessionWatcher();
    }else{
      showLoginScreen();
    }
  }catch(e){
    console.error('初始化失败:',e);
    showLoginScreen();
  }
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

})();

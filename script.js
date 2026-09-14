(function(){
'use strict';

/* ============================================================
   常量
   ============================================================ */
var MIN_YEAR=2026, MAX_YEAR=2040;
var DEFAULT_KEY='XIEJIAYU';
var APP_VERSION='1.0';
var KEYS={
  accessKey:'pure_access_key_v1',
  session:'pure_session_v1',
  dataPrefix:'pure_data_v1_',
  rangePrefix:'pure_range_v1_',
  fundPrefix:'pure_fund_v1_',
  theme:'pure_theme_v1',
  moneyHidden:'pure_money_hidden_v1',
  defaultWage:'pure_default_wage_v1'
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
var FUND_COLORS=['#00e5ff','#4affd4','#b18cff','#ffc94d','#4d9fff','#ff5c7c'];
var FUND_ICONS={
  wechat:'💬', alipay:'🅰️', bank:'💳', cash:'💵', other:'📦'
};
var DEDUCT_PRESETS=[
  {name:'迟到'},{name:'请假'},{name:'罚款'},{name:'其他'}
];
var FREQ_PRESETS={
  extra:['交通','购物','医疗','房租','水电','娱乐','其他'],
  income:['红包','兼职','退款','报销','其他']
};

var HAS_CRYPTO=(function(){
  try{ return !!(window.crypto && window.crypto.subtle); }
  catch(e){ return false; }
})();

function hex(arr){ return Array.from(arr).map(function(b){ return b.toString(16).padStart(2,'0'); }).join(''); }
function randomHex(bytes){
  var a=new Uint8Array(bytes);
  if(window.crypto&&window.crypto.getRandomValues) window.crypto.getRandomValues(a);
  else for(var i=0;i<bytes;i++) a[i]=Math.floor(Math.random()*256);
  return hex(a);
}
async function sha256(str){
  if(!HAS_CRYPTO) return fallbackHash(str,'pure',10000);
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return hex(new Uint8Array(buf));
}
function fallbackHash(str,salt,iters){
  var seeds=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  var outs=seeds.slice();
  var base=str+'\x1f'+salt;
  for(var i=0;i<iters;i++){
    var mix=base+'\x1f'+i;
    for(var j=0;j<4;j++){
      var h=(outs[j]^Math.imul(j+1,0x9e3779b9))>>>0;
      for(var k=0;k<mix.length;k++){ h^=mix.charCodeAt(k); h=Math.imul(h,0x01000193)>>>0; }
      outs[j]=h>>>0;
    }
  }
  return outs.map(function(x){ return x.toString(16).padStart(8,'0'); }).join('');
}

/* ============================================================
   访问密钥
   ============================================================ */
function getStoredKeyHash(){ try{ return localStorage.getItem(KEYS.accessKey)||''; }catch(e){ return ''; } }
function setStoredKeyHash(h){ try{ localStorage.setItem(KEYS.accessKey,h); }catch(e){} }
async function initAccessKey(){
  if(!getStoredKeyHash()){
    var h=await sha256(DEFAULT_KEY);
    setStoredKeyHash(h);
  }
}
async function verifyKey(input){
  var stored=getStoredKeyHash();
  if(!stored) return false;
  var h=await sha256(input);
  return h===stored;
}
async function changeKey(oldKey,newKey){
  var ok=await verifyKey(oldKey);
  if(!ok) return {ok:false,msg:'当前密钥错误'};
  var h=await sha256(newKey);
  setStoredKeyHash(h);
  return {ok:true};
}

/* ============================================================
   会话
   ============================================================ */
function createSession(){
  var sess={token:randomHex(32),createdAt:Date.now()};
  try{ localStorage.setItem(KEYS.session,JSON.stringify(sess)); }catch(e){}
  return sess;
}
function getSession(){
  try{
    var raw=localStorage.getItem(KEYS.session);
    if(!raw) return null;
    var s=JSON.parse(raw);
    if(!s||!s.token) return null;
    return s;
  }catch(e){ return null; }
}
function destroySession(){ try{ localStorage.removeItem(KEYS.session); }catch(e){} }

/* ============================================================
   主题
   ============================================================ */
function applyTheme(theme){
  document.body.classList.toggle('theme-light',theme==='light');
  document.body.classList.toggle('theme-dark',theme!=='light');
  if(el.themeSub) el.themeSub.textContent='当前：'+(theme==='light'?'浅色':'深色');
}
function loadTheme(){
  var t='dark';
  try{ t=localStorage.getItem(KEYS.theme)||'dark'; }catch(e){}
  applyTheme(t);
}
function toggleTheme(){
  var isLight=document.body.classList.contains('theme-light');
  var next=isLight?'dark':'light';
  try{ localStorage.setItem(KEYS.theme,next); }catch(e){}
  applyTheme(next);
  showToast('已切换到'+(next==='light'?'浅色':'深色')+'主题');
}

/* ============================================================
   数据存储
   ============================================================ */
var currentKeyHash='';
var DB={}, DBYear=null;
var dataKey=function(y){ return KEYS.dataPrefix+currentKeyHash+'_'+y; };
var rangeKey=function(){ return KEYS.rangePrefix+currentKeyHash; };
var fundKey=function(){ return KEYS.fundPrefix+currentKeyHash; };

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

/* ============================================================
   默认工资模板
   ============================================================ */
function getDefaultWage(){
  try{
    var raw=localStorage.getItem(KEYS.defaultWage);
    if(raw){
      var w=JSON.parse(raw);
      if(w&&w.mode) return w;
    }
  }catch(e){}
  return blankWage();
}
function saveDefaultWage(w){
  try{ localStorage.setItem(KEYS.defaultWage,JSON.stringify(w)); }catch(e){}
}

/* ============================================================
   数据模型
   ============================================================ */
var keyOf=function(y,m,d){ return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); };
var blankMeal=function(){ return {amount:'',photo:''}; };
var blankWage=function(){
  return {
    mode:'hourly',
    hourlyRate:25,
    dailyRate:200,
    baseSalary:5000,
    monthDays:21.75,
    stdHours:8,
    monthlySalary:8000,
    monthWorkDays:22,
    pieceRate:1,
    commissionSales:0,
    commissionRate:5,
    allowances:[]
  };
};
var blankWork=function(){
  return {
    enabled:false,
    rest:false,
    location:'',
    shift:'白班',
    start:DEFAULT_START,
    end:DEFAULT_END,
    breaks:[],
    overtime:{enabled:false,hours:0,rate:1.5},
    deducts:[],
    wage:getDefaultWage(),
    note:''
  };
};
var blankLife=function(){
  return {
    enabled:true,
    meals:{breakfast:blankMeal(),lunch:blankMeal(),dinner:blankMeal()},
    extras:[],
    incomes:[]
  };
};
var blankDay=function(){ return {work:blankWork(),life:blankLife()}; };

var normalizeMeal=function(m){ return {amount:m&&m.amount!=null?m.amount:'',photo:(m&&m.photo)||''}; };
var normalizeExtra=function(e){ return {name:(e&&e.name)||'',amount:e&&e.amount!=null?e.amount:'',photo:(e&&e.photo)||''}; };
var normalizeDeduct=function(d){ return {name:(d&&d.name)||'',amount:d&&d.amount!=null?d.amount:'',photo:''}; };

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

  var wage=Object.assign(blankWage(), rw.wage||getDefaultWage());
  var overtime=Object.assign({enabled:false,hours:0,rate:1.5}, rw.overtime||{});
  var deducts=Array.isArray(rw.deducts)?rw.deducts.map(normalizeDeduct):[];

  return {
    work:Object.assign(base.work, rw, {
      enabled:workEnabled,
      rest:!!rw.rest,
      wage:wage,
      overtime:overtime,
      deducts:deducts,
      note:rw.note||''
    }),
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
  if(!day.work.enabled||day.work.rest) return 0;
  var w=day.work;
  var total=durationHours(w.start,w.end);
  var unpaid=0;
  (w.breaks||[]).forEach(function(b){ unpaid+=durationHours(b.start,b.end); });
  return Math.max(0,Math.round((total-unpaid)*100)/100);
}
function calcBase(day){
  if(!day.work.enabled||day.work.rest) return 0;
  var h=calcHours(day);
  var w=day.work.wage||{};
  var base=0;
  var mode=w.mode||'hourly';

  if(mode==='daily'){
    base=Number(w.dailyRate)||0;
  }else if(mode==='monthly'){
    var mwd=Number(w.monthWorkDays)||22;
    base=(Number(w.monthlySalary)||0)/mwd;
  }else if(mode==='base'){
    var md=Number(w.monthDays)||21.75;
    var sh=Number(w.stdHours)||8;
    base=h*((Number(w.baseSalary)||0)/md/sh);
  }else if(mode==='piece'){
    base=(Number(w.pieceRate)||0)*h; /* 暂用小时数作件数占位 */
  }else if(mode==='commission'){
    base=(Number(w.commissionSales)||0)*(Number(w.commissionRate)||0)/100;
  }else{
    base=h*(Number(w.hourlyRate)||0);
  }
  return Math.round(base*100)/100;
}
function calcOvertime(day){
  var w=day.work.wage||{};
  if(day.work.rest) return 0;
  var ot=day.work.overtime||{};
  if(!ot.enabled||!ot.hours) return 0;
  var hours=Number(ot.hours)||0;
  var rate=Number(ot.rate)||1.5;

  /* 基础小时单价 */
  var unitRate=0;
  var mode=w.mode||'hourly';
  if(mode==='hourly'){
    unitRate=Number(w.hourlyRate)||0;
  }else if(mode==='daily'){
    var stdH=8;
    unitRate=(Number(w.dailyRate)||0)/stdH;
  }else if(mode==='monthly'){
    var mwd=Number(w.monthWorkDays)||22;
    unitRate=((Number(w.monthlySalary)||0)/mwd)/8;
  }else if(mode==='base'){
    var md=Number(w.monthDays)||21.75;
    var sh=Number(w.stdHours)||8;
    unitRate=(Number(w.baseSalary)||0)/md/sh;
  }else{
    unitRate=0; /* 计件/提成无加班概念 */
  }
  return Math.round(hours*unitRate*rate*100)/100;
}
function calcAllowance(day){
  if(!day.work.enabled||day.work.rest) return 0;
  var w=day.work.wage||{};
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  var dim=daysInMonth(y,m);
  var allow=(w.allowances||[]).reduce(function(s,a){
    var amt=Number(a.amount)||0;
    if(a.freq==='monthly'){
      return s + (amt/dim);
    }
    return s + amt;
  },0);
  return Math.round(allow*100)/100;
}
function calcDeduct(day){
  if(!day.work.enabled||day.work.rest) return 0;
  return (day.work.deducts||[]).reduce(function(s,d){ return s+(Number(d.amount)||0); },0);
}
function calcPay(day){
  if(!day.work.enabled||day.work.rest) return 0;
  var base=calcBase(day);
  var ot=calcOvertime(day);
  var allow=calcAllowance(day);
  var deduct=calcDeduct(day);
  return Math.round((base+ot+allow-deduct)*100)/100;
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
function fmtNetShort(n){ var r=Math.round(n); if(r===0) return '0'; return r<0?'-'+Math.abs(r):String(r); }
var daysInMonth=function(y,m){ return new Date(y,m,0).getDate(); };
var dayOfYear=function(y,m,d){ return Math.round((new Date(y,m-1,d)-new Date(y,0,1))/86400000)+1; };
var escapeHtml=function(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
};
var dayHasRecord=function(day){ return !!day&&(!!day.work.enabled||calcExpense(day)>0||calcIncomeTotal(day)>0); };

/* ============================================================
   范围统计
   ============================================================ */
function calcRangeTotal(range){
  var income=0,expense=0,days=0;
  var isCustom=range.type==='custom';
  var sArr=isCustom?range.start.split('-').map(Number):[0,0];
  var eArr=isCustom?range.end.split('-').map(Number):[0,0];
  var smVal=sArr[0]*100+sArr[1];
  var emVal=eArr[0]*100+eArr[1];

  var today=new Date();
  var weekStart=new Date(today.getTime()-(today.getDay()===0?6:today.getDay()-1)*86400000);
  var wsYear=weekStart.getFullYear();
  var wsMonth=weekStart.getMonth()+1;
  var wsDay=weekStart.getDate();
  var wsKey=wsYear*10000+wsMonth*100+wsDay;

  var years;
  if(range.type==='year') years=[range.year];
  else years=Array.from({length:MAX_YEAR-MIN_YEAR+1},function(_,i){ return MIN_YEAR+i; });

  years.forEach(function(y){
    var ydata=readYearData(y);
    for(var k in ydata){
      if(!Object.prototype.hasOwnProperty.call(ydata,k)) continue;
      var parts=k.split('-');
      if(parts.length!==3||Number(parts[0])!==y) continue;
      var m=Number(parts[1]);
      var d=Number(parts[2]);
      if(isCustom){
        var ym=y*100+m;
        if(ym<smVal||ym>emVal) continue;
      }else if(range.type==='week'){
        var ymd=y*10000+m*100+d;
        if(ymd<wsKey) continue;
      }
      var day=getDay(y,m,d);
      if(!dayHasRecord(day)) continue;
      days++;
      income+=calcPay(day)+calcIncomeTotal(day);
      expense+=calcExpense(day);
    }
  });
  income=Math.round(income*100)/100;
  expense=Math.round(expense*100)/100;
  return {income:income,expense:expense,balance:Math.round((income-expense)*100)/100,days:days};
}

function calcMonthTotal(year,m){
  var n=daysInMonth(year,m);
  var income=0,expense=0,days=0,pay=0,meal=0;
  for(var d=1;d<=n;d++){
    var k=keyOf(year,m,d);
    var hasData=(year===DBYear?DB[k]:readYearData(year)[k]);
    if(!hasData) continue;
    var day=getDay(year,m,d);
    if(!dayHasRecord(day)) continue;
    days++;
    pay+=calcPay(day);
    income+=calcPay(day)+calcIncomeTotal(day);
    expense+=calcExpense(day);
    meal+=calcMealTotal(day);
  }
  return {
    income:Math.round(income*100)/100,
    expense:Math.round(expense*100)/100,
    days:days,
    pay:Math.round(pay*100)/100,
    meal:Math.round(meal*100)/100
  };
}

function calcDateRange(startY,startM,endY,endM){
  var income=0,expense=0;
  for(var y=startY;y<=endY;y++){
    var mStart=(y===startY)?startM:1;
    var mEnd=(y===endY)?endM:12;
    for(var m=mStart;m<=mEnd;m++){
      var t=calcMonthTotal(y,m);
      income+=t.income;
      expense+=t.expense;
    }
  }
  return {income:income,expense:expense,balance:Math.round((income-expense)*100)/100};
}

/* ============================================================
   DOM 缓存
   ============================================================ */
var el={};
function cacheEls(){
  var ids=[
    'loginScreen','loginStars','loginKey','loginBtn','loginMsg','loginStatusText',
    'app','userName','userNameSettings',
    'balanceCard','balanceValue','totalIncome','totalExpense','balanceBadgeText','eyeBtn',
    'totalIncomeDaily','totalExpenseDaily','balanceRecordLine',
    'balanceCompare','bcIncome','bcExpense','recentBar','recentList',
    'insightCard','insightText',
    'trendCanvas','trendHint',
    'fundList','fundStack','fundAddBtn','fundTotal','fundDiff','fundSaveBtn','fundSummary',
    'fundZeroToggle','fundZeroBtn','fundFoot','fundLastModified',
    'todayBtn','yearTrigger','monthTrigger','yearValue','monthValue','prevMonthBtn','nextMonthBtn',
    'yearModal','yearClose','yearPicker','yearConfirm',
    'monthModal','monthClose','monthPicker','monthConfirm',
    'monthOverview','moIncome','moExpense','moBalance',
    'viewSwitch','daysSection','daysTitle','daysToggle','daysBody','daysGrid','daysWeekHeader',
    'compareBtn',
    'summaryCard','summaryHead','summaryGrid','summaryPlaceholder','summaryNote',
    'sumNum','sumDate','sumSub','sumIncome','sumExpense','sumBalance',
    'analysisCard','analysisReset','analysisTip',
    'analysisPanel','analysisPanelToggle','analysisPanelIcon','analysisPanelBody',
    'apOverview','apTrend','apAnomaly',
    'editModal','editClose','editCard','editDate','editWeek','editHeadBalance','editTabs',
    'editBody','panel-work','panel-life','restToggle',
    'locInput','locBadge','shiftSeg','startTime','endTime','hoursBadge','timeSummary',
    'addBreak','breakList','payBlock','payVal','payArrow',
    'overtimeToggle','overtimeFields','overtimeHours','overtimeRate',
    'addDeduct','deductList','deductBadge',
    'mealBadge','extraBadge','extraList','addExtra','extraFreqChips',
    'incomeList','addIncome','incomeBadge','incomeFreqChips',
    'lifeBalance','lifeDetail','copyYesterdayBtn','dayNote',
    'resetBtn','saveBtn','saveNextBtn',
    'wageModal','wageClose','wageModeSeg',
    'fieldHourly','fieldDaily','fieldBase','fieldMonthly','fieldPiece','fieldCommission',
    'hourlyRate','dailyRate','baseSalary','monthDays','stdHours',
    'monthlySalary','monthWorkDays','pieceRate','commissionSales','commissionRate',
    'addAllow','allowList','wagePreview','wageConfirm','wageConfirmOnly',
    'wpDays','wpBase','wpAllow','wpTotal',
    'rangeModal','rangeClose','rangePanel-all','rangePanel-week','rangePanel-year','rangePanel-custom',
    'rangeAllDesc','rangeWeekDesc','rangeYearPicker','rangeStart','rangeEnd','rangeResult','rangeConfirm',
    'reportModal','reportClose','reportModeSeg','reportYearField','reportMonthField',
    'reportYear','reportYearM','reportMonth','reportDesc','reportConfirm',
    'fundModal','fundClose','fundModalTitle','fundName','fundAmount','fundConfirm','fundDelete',
    'fundTypePicker',
    'encExportModal','encExportClose','encExportPwd','encExportPwd2','encExportConfirm',
    'encImportModal','encImportClose','encImportHint','encImportPwd','encImportMsg','encImportConfirm',
    'changeKeyModal','changeKeyClose','oldKey','newKey','newKey2','changeKeyMsg','changeKeyConfirm',
    'compareModal','compareClose','compareTitle','compareTable','compareConfirm',
    'clearDataModal','clearDataClose','clearDataInput','clearDataConfirm',
    'defaultWageBtn','defaultWageSub','storageSub','storageFill','recordStatsSub','settingsFoot',
    'exportBtn','importBtn','exportEncBtn','reportBtn','exportCsvBtn',
    'changeKeyBtn','changeKeySub','clearDataBtn','themeBtn','themeSub','logoutBtn',
    'photoInput','toast'
  ];
  ids.forEach(function(id){
    el[id.replace(/-([a-z])/g,function(_,c){ return c.toUpperCase(); })]=document.getElementById(id);
  });
}

/* ============================================================
   状态
   ============================================================ */
var state={
  year:null,month:null,day:null,
  draft:null,dirty:false,activeTab:'work',
  range:{type:'week'},
  analysisMode:null,
  moneyHidden:true,
  currentTab:'home',
  daysCollapsed:false,
  pendingYear:MIN_YEAR,
  pendingMonth:1,
  viewMode:'grid',
  fundEditIndex:-1,
  fundType:'other',
  showZeroFund:false,
  fundSort:'amount',
  panelOpen:false,
  prevMonthSnapshot:null
};
var photoTarget=null, wageDraft=null, rangeDraft=null;
var pendingEncImport=null;
var toastTimer=null;
var modalLockCount=0;

/* ============================================================
   Toast + 滚动锁
   ============================================================ */
function showToast(msg,isError){
  if(!el.toast) return;
  el.toast.textContent=msg;
  el.toast.classList.toggle('error',!!isError);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ el.toast.classList.remove('show'); },2200);
}
function lockScroll(){ modalLockCount++; document.body.style.overflow='hidden'; }
function unlockScroll(){ modalLockCount=Math.max(0,modalLockCount-1); if(modalLockCount===0) document.body.style.overflow=''; }

/* ============================================================
   页面切换
   ============================================================ */
function switchTab(tab){
  state.currentTab=tab;
  document.querySelectorAll('.nav-item').forEach(function(x){ x.classList.toggle('active',x.dataset.tab===tab); });
  document.querySelectorAll('#app .page').forEach(function(p){ p.classList.remove('active'); });
  var target=document.getElementById('tab-'+tab);
  if(target) target.classList.add('active');
  window.scrollTo(0,0);
  if(tab==='home') refreshHome();
  if(tab==='date') refreshDateTab();
  if(tab==='settings') refreshSettings();
}

/* ============================================================
   登录
   ============================================================ */
function showLoginScreen(){
  if(el.loginScreen) el.loginScreen.classList.add('show');
  if(el.app) el.app.classList.remove('show');
  if(el.loginKey) el.loginKey.value='';
  if(el.loginBtn){ el.loginBtn.disabled=false; el.loginBtn.textContent='进 入 系 统'; }
  if(el.loginMsg) el.loginMsg.className='login-msg';
  if(el.loginStatusText) el.loginStatusText.textContent='系统就绪 · 等待密钥';
}
function showApp(){
  if(el.loginScreen) el.loginScreen.classList.remove('show');
  if(el.app) el.app.classList.add('show');
}
async function doLogin(){
  if(!el.loginKey) return;
  var k=(el.loginKey.value||'').trim();
  if(!k){ showToast('请输入密钥',true); return; }
  el.loginBtn.disabled=true;
  el.loginBtn.textContent='验 证 中…';
  if(el.loginStatusText) el.loginStatusText.textContent='正在校验密钥…';
  try{
    var ok=await verifyKey(k);
    if(ok){
      createSession();
      currentKeyHash=(await sha256(k)).substring(0,16);
      if(el.loginStatusText) el.loginStatusText.textContent='密钥正确 · 正在进入';
      el.loginBtn.textContent='✓ 成 功';
      setTimeout(function(){ showApp(); enterHome(); },260);
    }else{
      el.loginBtn.disabled=false;
      el.loginBtn.textContent='进 入 系 统';
      if(el.loginMsg){ el.loginMsg.textContent='密钥错误，请重试'; el.loginMsg.className='login-msg error'; }
      if(el.loginStatusText) el.loginStatusText.textContent='密钥错误';
    }
  }catch(e){
    console.error(e);
    el.loginBtn.disabled=false;
    el.loginBtn.textContent='进 入 系 统';
    showToast('校验异常',true);
  }
}
function doLogout(){
  if(!confirm('确认锁定系统？需要重新输入密钥。')) return;
  destroySession();
  location.reload();
}

/* ============================================================
   主页
   ============================================================ */
function enterHome(){
  if(el.userName) el.userName.textContent='已解锁';
  if(el.userNameSettings) el.userNameSettings.textContent='已解锁';
  state.year=null; state.month=null; state.day=null;
  loadDB(null);
  loadRange();
  loadFunds();
  loadMoneyHidden();
  refreshHome();
  resetDateTab();
  switchTab('home');
}

function loadMoneyHidden(){
  try{ state.moneyHidden=localStorage.getItem(KEYS.moneyHidden)!=='0'; }
  catch(e){ state.moneyHidden=true; }
  if(el.eyeBtn) el.eyeBtn.classList.toggle('hidden',state.moneyHidden);
}

function refreshHome(){
  refreshBalance();
  renderFunds();
  renderInsight();
  drawTrend();
  renderBalanceCompare();
  renderRecent();
}

function refreshBalance(){
  var t=calcRangeTotal(state.range);
  if(state.moneyHidden){
    el.balanceValue.textContent='¥****';
    el.balanceValue.classList.remove('negative');
    el.totalIncome.textContent='¥****';
    el.totalExpense.textContent='¥****';
    el.totalIncomeDaily.textContent='日均 —';
    el.totalExpenseDaily.textContent='日均 —';
  }else{
    el.balanceValue.textContent=fmtNet(t.balance);
    el.balanceValue.classList.toggle('negative',t.balance<0);
    el.totalIncome.textContent='¥'+fmtMoney(t.income);
    el.totalExpense.textContent='¥'+fmtMoney(t.expense);
    var dAvg=t.days>0?t.income/t.days:0;
    var eAvg=t.days>0?t.expense/t.days:0;
    el.totalIncomeDaily.textContent='日均 ¥'+fmtMoney(dAvg);
    el.totalExpenseDaily.textContent='日均 ¥'+fmtMoney(eAvg);
  }
  if(el.balanceRecordLine){
    var label='';
    if(state.range.type==='week') label='本周';
    else if(state.range.type==='year') label=state.range.year+'年';
    else if(state.range.type==='custom') label='区间';
    else label='全部';
    el.balanceRecordLine.textContent=label+' · 记录 '+t.days+' 天';
  }
  el.balanceBadgeText.textContent=rangeLabel(state.range);
}

function renderBalanceCompare(){
  if(!el.balanceCompare) return;
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  var pm=m-1, py=y;
  if(pm<1){ pm=12; py=y-1; }
  if(py<MIN_YEAR){ el.balanceCompare.hidden=true; return; }
  var cur=calcMonthTotal(y,m);
  var prev=calcMonthTotal(py,pm);
  if(cur.income===0&&cur.expense===0&&prev.income===0&&prev.expense===0){ el.balanceCompare.hidden=true; return; }
  el.balanceCompare.hidden=false;
  function txt(c,p){
    if(state.moneyHidden) return {t:'已隐藏',c:'flat'};
    if(p===0&&c===0) return {t:'—',c:'flat'};
    if(p===0) return {t:'新增 ¥'+fmtMoney(c),c:'up'};
    var diff=c-p;
    var pct=Math.round((diff/p)*100);
    var sign=diff>0?'+':'';
    return {t:sign+'¥'+fmtMoney(diff)+'（'+sign+pct+'%）',c:diff>0?'up':(diff<0?'down':'flat')};
  }
  var incR=txt(cur.income,prev.income);
  var expR=txt(cur.expense,prev.expense);
  el.bcIncome.textContent=incR.t;
  el.bcIncome.className='bc-value '+incR.c;
  el.bcExpense.textContent=expR.t;
  el.bcExpense.className='bc-value '+expR.c;
}

function renderRecent(){
  if(!el.recentBar) return;
  var today=new Date();
  var items=[];
  for(var i=0;i<30 && items.length<3;i++){
    var d=new Date(today.getTime()-i*86400000);
    var y=d.getFullYear(), m=d.getMonth()+1, day=d.getDate();
    var k=keyOf(y,m,day);
    var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
    if(!hasData) continue;
    var dd=getDay(y,m,day);
    if(!dayHasRecord(dd)) continue;
    var net=calcNet(dd);
    items.push({y:y,m:m,d:day,net:net});
  }
  if(!items.length){ el.recentBar.hidden=true; return; }
  el.recentBar.hidden=false;
  el.recentList.innerHTML='';
  items.forEach(function(it){
    var span=document.createElement('span');
    span.className='recent-item';
    span.innerHTML='<span class="ri-date">'+it.m+'/'+it.d+'</span>'
      +'<span class="ri-val '+(it.net>=0?'up':'down')+'">'+(state.moneyHidden?'•••':((it.net>=0?'+':'-')+'¥'+fmtMoney(Math.abs(it.net))))+'</span>';
    span.addEventListener('click',function(){
      state.year=it.y; state.month=it.m; state.day=it.d;
      loadDB(it.y);
      state.range={type:'year',year:it.y};
      switchTab('date');
      setTimeout(function(){
        updateYMDisplay();
        refreshDateTab();
      },50);
    });
    el.recentList.appendChild(span);
  });
}

function renderInsight(){
  if(!el.insightCard) return;
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  var cur=calcMonthTotal(y,m);
  var pm=m-1, py=y;
  if(pm<1){ pm=12; py=y-1; }
  var prev=(py>=MIN_YEAR)?calcMonthTotal(py,pm):{income:0,expense:0};

  var texts=[];
  if(cur.income===0&&cur.expense===0){
    texts.push('本月暂无记录，开始记录后这里会显示智能分析。');
  }else{
    var net=Math.round((cur.income-cur.expense)*100)/100;
    if(state.moneyHidden){ texts.push(net>=0?'本月结余为正 ✓':'本月支出超过收入'); }
    else texts.push('本月结余 '+fmtNet(net));
    if(prev.income>0){
      var incDiff=Math.round((cur.income-prev.income)*100)/100;
      var incPct=Math.round((incDiff/prev.income)*100);
      if(incPct>10) texts.push('收入较上月 ↑'+incPct+'%');
      else if(incPct<-10) texts.push('收入较上月 ↓'+Math.abs(incPct)+'%');
      else texts.push('收入与上月基本持平');
    }
    if(prev.expense>0){
      var expDiff=Math.round((cur.expense-prev.expense)*100)/100;
      var expPct=Math.round((expDiff/prev.expense)*100);
      if(expPct>15) texts.push('支出增长较快，建议注意控制');
      else if(expPct<-15) texts.push('支出明显下降，保持节奏');
    }
  }
  el.insightCard.hidden=false;
  el.insightText.textContent=texts.join(' · ');
}

/* ============================================================
   趋势图
   ============================================================ */
function drawTrend(){
  if(!el.trendCanvas) return;
  var ctx=el.trendCanvas.getContext('2d');
  var W=el.trendCanvas.width, H=el.trendCanvas.height;
  ctx.clearRect(0,0,W,H);
  var today=new Date();
  var pts=[];
  for(var i=6;i>=0;i--){
    var d=new Date(today.getTime()-i*86400000);
    var y=d.getFullYear(), m=d.getMonth()+1, day=d.getDate();
    var k=keyOf(y,m,day);
    var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
    var val=0;
    if(hasData){ var dd=getDay(y,m,day); val=calcNet(dd); }
    pts.push({label:(m+'/'+day),v:val});
  }
  var maxAbs=Math.max(1,Math.max.apply(null,pts.map(function(p){ return Math.abs(p.v); })));
  var padL=8,padR=8,padT=20,padB=24;
  var graphW=W-padL-padR, graphH=H-padT-padB;
  var stepX=graphW/(pts.length-1||1);
  ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(padL,padT+graphH/2); ctx.lineTo(W-padR,padT+graphH/2); ctx.stroke();
  var coords=pts.map(function(p,i){
    var x=padL+i*stepX;
    var y=padT+graphH/2 - (p.v/maxAbs)*(graphH/2);
    return {x:x,y:y,v:p.v,label:p.label};
  });
  var grad=ctx.createLinearGradient(0,padT,0,padT+graphH);
  grad.addColorStop(0,'rgba(0,229,255,.35)');
  grad.addColorStop(1,'rgba(0,229,255,0)');
  ctx.beginPath(); ctx.moveTo(coords[0].x,padT+graphH/2);
  coords.forEach(function(c){ ctx.lineTo(c.x,c.y); });
  ctx.lineTo(coords[coords.length-1].x,padT+graphH/2);
  ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
  ctx.beginPath();
  coords.forEach(function(c,i){ if(i===0) ctx.moveTo(c.x,c.y); else ctx.lineTo(c.x,c.y); });
  ctx.strokeStyle='#00e5ff'; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.stroke();
  coords.forEach(function(c){
    ctx.beginPath(); ctx.arc(c.x,c.y,3,0,Math.PI*2);
    ctx.fillStyle=c.v>=0?'#4affd4':'#ff5c7c'; ctx.fill();
  });
  ctx.fillStyle='rgba(139,152,189,.8)';
  ctx.font='11px -apple-system, system-ui';
  ctx.textAlign='center';
  coords.forEach(function(c){ ctx.fillText(c.label,c.x,padT+graphH+16); });
  var last=coords[coords.length-1];
  if(el.trendHint){ el.trendHint.textContent=state.moneyHidden?'金额已隐藏':('今日 '+fmtNet(last.v)); }
}

/* ============================================================
   资金管理
   ============================================================ */
var fundAccounts=[];
var fundDirty=false;

function loadFunds(){
  try{
    var raw=localStorage.getItem(fundKey());
    if(raw){
      fundAccounts=JSON.parse(raw);
      if(!Array.isArray(fundAccounts)||!fundAccounts.length){
        fundAccounts=[
          {name:'微信',amount:0,type:'wechat'},
          {name:'支付宝',amount:0,type:'alipay'}
        ];
      }
    }else{
      fundAccounts=[
        {name:'微信',amount:0,type:'wechat'},
        {name:'支付宝',amount:0,type:'alipay'}
      ];
    }
    /* 兼容旧数据（无 type） */
    fundAccounts=fundAccounts.map(function(a){
      return {name:a.name||'账户',amount:Number(a.amount)||0,type:a.type||'other'};
    });
  }catch(e){
    fundAccounts=[{name:'微信',amount:0,type:'wechat'},{name:'支付宝',amount:0,type:'alipay'}];
  }
  fundDirty=false;
}

function saveFunds(){
  try{
    localStorage.setItem(fundKey(),JSON.stringify(fundAccounts));
    try{ localStorage.setItem(fundKey()+'_mod',String(Date.now())); }catch(e){}
    return true;
  }catch(e){ return false; }
}

function renderFunds(){
  if(!el.fundList) return;
  var totalAll=fundAccounts.reduce(function(s,a){ return s+(Number(a.amount)||0); },0);
  totalAll=Math.round(totalAll*100)/100;

  /* 堆叠条 */
  if(el.fundStack){
    if(totalAll<=0||state.moneyHidden){ el.fundStack.hidden=true; el.fundStack.innerHTML=''; }
    else{
      el.fundStack.hidden=false;
      el.fundStack.innerHTML='';
      fundAccounts.forEach(function(a,i){
        var v=Number(a.amount)||0;
        if(v<=0) return;
        var seg=document.createElement('div');
        seg.className='fs-seg';
        seg.style.flex=String(v);
        seg.style.background=FUND_COLORS[i%FUND_COLORS.length];
        seg.title=a.name+' ¥'+fmtMoney(v);
        seg.addEventListener('click',function(){
          var idx=fundAccounts.indexOf(a);
          if(idx>=0) openFundModal(idx);
        });
        el.fundStack.appendChild(seg);
      });
    }
  }

  /* 列表 */
  var list=fundAccounts.slice();
  if(!state.showZeroFund){
    var nonzero=list.filter(function(a){ return (Number(a.amount)||0)>0; });
    if(nonzero.length) list=nonzero;
  }
  if(state.fundSort==='amount'){
    list.sort(function(a,b){ return (Number(b.amount)||0)-(Number(a.amount)||0); });
  }else if(state.fundSort==='name'){
    list.sort(function(a,b){ return a.name.localeCompare(b.name,'zh'); });
  }

  el.fundList.innerHTML='';
  if(!list.length){
    el.fundList.innerHTML='<div class="empty-tip">暂无账户，点击上方添加</div>';
  }else{
    list.forEach(function(acc){
      var i=fundAccounts.indexOf(acc);
      if(i<0) return;
      var btn=document.createElement('button');
      btn.type='button';
      btn.className='fund-item';
      btn.dataset.fundIndex=String(i);
      var icon=FUND_ICONS[acc.type]||FUND_ICONS.other;
      var amtText=state.moneyHidden?'¥****':('¥'+fmtMoney(acc.amount||0));
      btn.innerHTML='<span class="fund-item-left">'
        +'<span class="fund-icon">'+icon+'</span>'
        +'<span class="fund-name">'+escapeHtml(acc.name)+'</span>'
        +'</span>'
        +'<span class="fund-amount">'+amtText+'</span>';
      el.fundList.appendChild(btn);
    });
  }

  /* 0 元折叠按钮 */
  var zeroCount=fundAccounts.filter(function(a){ return (Number(a.amount)||0)===0; }).length;
  if(el.fundZeroToggle){
    if(zeroCount>0){
      el.fundZeroToggle.hidden=false;
      el.fundZeroBtn.textContent=(state.showZeroFund?'隐藏 0 元账户 ▴':'显示 '+zeroCount+' 个 0 元账户 ▾');
    }else{
      el.fundZeroToggle.hidden=true;
    }
  }

  /* 总和 */
  if(el.fundTotal) el.fundTotal.textContent=state.moneyHidden?'¥****':('¥'+fmtMoney(totalAll));

  if(el.fundDiff){
    if(fundDirty){ el.fundDiff.textContent='● 未保存'; el.fundDiff.className='fs-hint dirty'; }
    else{ el.fundDiff.textContent='✓ 已保存'; el.fundDiff.className='fs-hint saved'; }
  }

  /* 上次修改 */
  try{
    var mod=Number(localStorage.getItem(fundKey()+'_mod'))||0;
    if(mod&&el.fundLastModified){
      var d=new Date(mod);
      var pad=function(n){ return String(n).padStart(2,'0'); };
      el.fundLastModified.textContent='上次修改：'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
      if(el.fundFoot) el.fundFoot.hidden=false;
    }else{
      if(el.fundFoot) el.fundFoot.hidden=true;
    }
  }catch(e){}

  if(el.fundSaveBtn) el.fundSaveBtn.hidden=!fundDirty;
}

function openFundModal(index){
  if(!el.fundModal) return;
  state.fundEditIndex=index;
  var acc=(index>=0&&fundAccounts[index])?fundAccounts[index]:null;

  if(acc){
    el.fundModalTitle.textContent='编辑账户';
    el.fundName.value=acc.name;
    el.fundAmount.value=state.moneyHidden?'':(acc.amount||'');
    el.fundDelete.hidden=false;
    state.fundType=acc.type||'other';
  }else{
    el.fundModalTitle.textContent='添加账户';
    el.fundName.value='';
    el.fundAmount.value='';
    el.fundDelete.hidden=true;
    state.fundType='wechat';
  }
  el.fundTypePicker.querySelectorAll('button').forEach(function(b){
    b.classList.toggle('active',b.dataset.type===state.fundType);
  });
  el.fundModal.classList.add('open');
  el.fundModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeFundModal(){
  if(!el.fundModal) return;
  el.fundModal.classList.remove('open');
  el.fundModal.setAttribute('aria-hidden','true');
  unlockScroll();
}

/* ============================================================
   日期页
   ============================================================ */
function resetDateTab(){
  state.year=null; state.month=null; state.day=null;
  state.analysisMode=null;
  state.daysCollapsed=false;
  state.pendingYear=MIN_YEAR;
  state.pendingMonth=1;
  state.viewMode='grid';
  state.panelOpen=false;
  document.querySelectorAll('#viewSwitch .vs-btn').forEach(function(b){
    b.classList.toggle('active',b.dataset.view==='grid');
  });
  updateYMDisplay();
  if(el.monthTrigger) el.monthTrigger.disabled=true;
  if(el.daysSection) el.daysSection.hidden=true;
  if(el.daysBody) el.daysBody.hidden=false;
  if(el.daysGrid) el.daysGrid.innerHTML='';
  if(el.summaryCard) el.summaryCard.hidden=true;
  if(el.analysisCard) el.analysisCard.hidden=true;
  if(el.monthOverview) el.monthOverview.hidden=true;
  if(el.viewSwitch) el.viewSwitch.hidden=true;
  if(el.todayBtn) el.todayBtn.hidden=true;
  if(el.daysWeekHeader) el.daysWeekHeader.hidden=true;
  if(el.analysisPanelBody) el.analysisPanelBody.hidden=true;
  if(el.analysisPanelIcon) el.analysisPanelIcon.textContent='▾';
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
    if(el.monthOverview) el.monthOverview.hidden=false;
    if(el.viewSwitch) el.viewSwitch.hidden=false;
    if(el.daysBody) el.daysBody.hidden=false;
    if(el.daysToggle) el.daysToggle.textContent='收起 ▴';
    renderMonthOverview();
    renderDays();
    renderAnalysisPanel();
    if(state.day){ showSummaryContent(); renderSummary(state.month,state.day); }
    else showSummaryPlaceholder();
    updateTodayBtn();
  }else{
    if(el.daysSection) el.daysSection.hidden=true;
    if(el.summaryCard) el.summaryCard.hidden=true;
    if(el.analysisCard) el.analysisCard.hidden=true;
    if(el.monthOverview) el.monthOverview.hidden=true;
    if(el.viewSwitch) el.viewSwitch.hidden=true;
    if(el.todayBtn) el.todayBtn.hidden=true;
  }
}

function updateTodayBtn(){
  if(!el.todayBtn) return;
  var now=new Date();
  var ty=now.getFullYear(), tm=now.getMonth()+1;
  if(state.year===ty&&state.month===tm){ el.todayBtn.hidden=true; }
  else if(state.year){ el.todayBtn.hidden=false; }
  else el.todayBtn.hidden=true;
}

function updateYMDisplay(){
  if(el.yearValue) el.yearValue.textContent=state.year?state.year+' 年':'未选择';
  if(el.monthValue) el.monthValue.textContent=state.month?MONTH_CN[state.month-1]:'未选择';
}

function renderMonthOverview(){
  if(!state.year||!state.month) return;
  var t=calcMonthTotal(state.year,state.month);
  if(state.moneyHidden){
    el.moIncome.textContent='¥****';
    el.moExpense.textContent='¥****';
    el.moBalance.textContent='¥****';
    el.moBalance.classList.remove('negative');
  }else{
    el.moIncome.textContent='¥'+fmtMoney(t.income);
    el.moExpense.textContent='¥'+fmtMoney(t.expense);
    var b=Math.round((t.income-t.expense)*100)/100;
    el.moBalance.textContent=fmtNet(b);
    el.moBalance.classList.toggle('negative',b<0);
  }
}

/* ---------- 年份弹窗 ---------- */
function openYearModal(){
  if(!el.yearModal) return;
  state.pendingYear=state.year||MIN_YEAR;
  buildYearPicker();
  el.yearModal.classList.add('open');
  el.yearModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeYearModal(){
  if(!el.yearModal) return;
  el.yearModal.classList.remove('open');
  el.yearModal.setAttribute('aria-hidden','true');
  unlockScroll();
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
      if(state.pendingYear===y&&state.year===y) state.pendingYear=null;
      else state.pendingYear=y;
      buildYearPicker();
    });
    frag.appendChild(btn);
  }
  el.yearPicker.appendChild(frag);
}
function confirmYear(){
  if(state.pendingYear==null){
    state.year=null; state.month=null; state.day=null;
    loadDB(null);
    showToast('已取消年份');
  }else{
    var y=state.pendingYear;
    if(state.year===y){
      state.year=null; state.month=null; state.day=null;
      loadDB(null);
      showToast('已取消年份');
    }else{
      state.year=y; state.month=null; state.day=null;
      loadDB(y);
      showToast('已选择 '+y+' 年');
    }
  }
  closeYearModal();
  updateYMDisplay();
  if(el.monthTrigger) el.monthTrigger.disabled=!state.year;
  if(!state.year){
    if(el.daysSection) el.daysSection.hidden=true;
    if(el.summaryCard) el.summaryCard.hidden=true;
    if(el.analysisCard) el.analysisCard.hidden=true;
    if(el.monthOverview) el.monthOverview.hidden=true;
    if(el.viewSwitch) el.viewSwitch.hidden=true;
    if(el.daysGrid) el.daysGrid.innerHTML='';
  }
}

/* ---------- 月份弹窗 ---------- */
function openMonthModal(){
  if(!el.monthModal) return;
  if(!state.year){ showToast('请先选择年份',true); return; }
  state.pendingMonth=state.month||1;
  buildMonthPicker();
  el.monthModal.classList.add('open');
  el.monthModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeMonthModal(){
  if(!el.monthModal) return;
  el.monthModal.classList.remove('open');
  el.monthModal.setAttribute('aria-hidden','true');
  unlockScroll();
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
      if(state.pendingMonth===m&&state.month===m) state.pendingMonth=null;
      else state.pendingMonth=m;
      buildMonthPicker();
    });
    frag.appendChild(btn);
  }
  el.monthPicker.appendChild(frag);
}
function confirmMonth(){
  if(!state.year){ closeMonthModal(); return; }
  if(state.pendingMonth==null){
    state.month=null; state.day=null;
    showToast('已取消月份');
  }else{
    var m=state.pendingMonth;
    if(state.month===m){ state.month=null; state.day=null; showToast('已取消月份'); }
    else{
      state.month=m; state.day=1;
      state.range={type:'year',year:state.year};
      saveRange();
      loadDB(state.year);
      showToast('已切换到 '+state.year+'年'+MONTH_CN[m-1]);
    }
  }
  closeMonthModal();
  updateYMDisplay();
  refreshDateTab();
  refreshBalance();
  renderFunds();
}
function shiftMonth(delta){
  if(!state.year) return;
  var m=(state.month||1)+delta;
  var y=state.year;
  if(m<1){ m=12; y--; }
  else if(m>12){ m=1; y++; }
  if(y<MIN_YEAR||y>MAX_YEAR) return;
  state.year=y; state.month=m; state.day=1;
  state.range={type:'year',year:y};
  saveRange();
  loadDB(y);
  updateYMDisplay();
  refreshDateTab();
  refreshBalance();
  renderFunds();
}

/* ---------- 渲染日期 ---------- */
function renderDays(){
  if(!state.year||!state.month) return;
  if(state.viewMode==='chart') renderDaysChart(state.month);
  else buildDaysGrid(state.month);
  applyAnalysisHighlight();
  if(state.day) renderSummary(state.month,state.day);
}

function buildDaysGrid(m){
  if(!el.daysGrid) return;
  el.daysGrid.innerHTML='';
  if(el.daysWeekHeader) el.daysWeekHeader.hidden=false;
  var n=daysInMonth(state.year,m);
  var frag=document.createDocumentFragment();
  for(var d=1;d<=n;d++){
    var cell=document.createElement('button');
    cell.type='button';
    cell.className='grid-day';
    cell.dataset.day=d;
    cell.innerHTML=dayCellHTML(state.year,m,d);
    var k=keyOf(state.year,m,d);
    var hasData=(state.year===DBYear?DB[k]:readYearData(state.year)[k]);
    if(hasData){
      var day=getDay(state.year,m,d);
      if(dayHasRecord(day)){
        var net=calcNet(day);
        cell.classList.add(net<0?'has-negative':'has-value');
      }
    }
    cell.addEventListener('click',function(ev){
      var target=ev.currentTarget;
      var day=Number(target.dataset.day);
      if(state.day===day){
        state.day=null;
        updateActiveCell();
        showSummaryPlaceholder();
      }else{
        selectDay(m,day);
        showSummaryContent();
      }
    });
    frag.appendChild(cell);
  }
  el.daysGrid.appendChild(frag);
  updateActiveCell();
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
      var text=state.moneyHidden?'•••':escapeHtml(fmtNetShort(net));
      moneyHTML='<span class="'+cls+'">'+text+'</span>';
    }
  }
  var dotHTML=ev?'<span class="gd-dot"></span>':'';
  return dotHTML+'<span class="gd-num">'+d+'</span>'+moneyHTML;
}

/* ---------- 图表 ---------- */
function renderDaysChart(m){
  if(!el.daysGrid) return;
  if(el.daysWeekHeader) el.daysWeekHeader.hidden=true;
  var n=daysInMonth(state.year,m);
  var days=[];
  var maxAbs=0, maxNet=-Infinity, minNet=Infinity, maxDay=0, minDay=0, hasAny=false;
  for(var d=1;d<=n;d++){
    var k=keyOf(state.year,m,d);
    var hasData=(state.year===DBYear?DB[k]:readYearData(state.year)[k]);
    var net=0, hasRec=false;
    if(hasData){
      var day=getDay(state.year,m,d);
      hasRec=dayHasRecord(day);
      if(hasRec) net=calcNet(day);
    }
    days.push({d:d, net:net, hasRec:hasRec});
    if(hasRec){
      hasAny=true;
      if(Math.abs(net)>maxAbs) maxAbs=Math.abs(net);
      if(net>maxNet){ maxNet=net; maxDay=d; }
      if(net<minNet){ minNet=net; minDay=d; }
    }
  }
  if(maxAbs<1) maxAbs=1;
  var COL_W=36;
  var innerWidth=n*COL_W;
  var H=220;
  var halfH=(H-30)/2;
  var baselineY=H/2;
  var html='';
  html+='<div class="chart-section">';
  html+='<div class="chart-head">';
  html+='<span class="chart-title">◈ '+m+'月每日结余</span>';
  if(state.moneyHidden){
    html+='<div class="chart-stats"><span class="cs-item">金额已隐藏</span></div>';
  }else{
    html+='<div class="chart-stats">';
    if(hasAny&&maxDay) html+='<span class="cs-item high">最高 <strong>'+maxDay+'日 '+fmtNet(maxNet)+'</strong></span>';
    if(hasAny&&minDay&&minDay!==maxDay&&minNet<0) html+='<span class="cs-item low">最低 <strong>'+minDay+'日 '+fmtNet(minNet)+'</strong></span>';
    html+='</div>';
  }
  html+='</div>';
  html+='<div class="chart-viewport'+(state.moneyHidden?' masked':'')+'" id="chartViewport">';
  html+='<div class="chart-canvas-wrap" style="width:'+innerWidth+'px;height:'+H+'px;">';
  html+='<div class="chart-zero-line" style="top:'+baselineY+'px"></div>';
  days.forEach(function(item,i){
    var x=i*COL_W;
    var h=0; var isNeg=item.net<0;
    if(item.hasRec&&item.net!==0) h=Math.max(3,(Math.abs(item.net)/maxAbs)*(halfH-6));
    var barCls='cc-bar';
    if(!item.hasRec) barCls+=' empty';
    else if(item.net===0) barCls+=' zero';
    else if(isNeg) barCls+=' negative';
    var colCls='chart-col'+(state.day===item.d?' selected':'');
    var barStyle;
    if(isNeg&&item.hasRec&&item.net!==0) barStyle='top:'+baselineY+'px;height:'+h+'px;';
    else if(item.hasRec&&item.net!==0) barStyle='top:'+(baselineY-h)+'px;height:'+h+'px;';
    else barStyle='top:'+(baselineY-1)+'px;height:2px;';
    /* 金额标签 */
    var labelHTML='';
    if(item.hasRec&&h>=30&&!state.moneyHidden){
      var ly=isNeg?(baselineY+h+14):(baselineY-h-6);
      labelHTML='<span class="cc-label" style="top:'+ly+'px">'+fmtNetShort(item.net)+'</span>';
    }
    html+='<div class="'+colCls+'" data-day="'+item.d+'" style="left:'+x+'px;width:'+COL_W+'px;height:'+H+'px;">';
    html+='<div class="'+barCls+'" style="'+barStyle+'"></div>';
    html+=labelHTML;
    html+='</div>';
  });
  html+='</div>';
  html+='<div class="chart-day-labels" style="width:'+innerWidth+'px;">';
  days.forEach(function(item,i){
    var x=i*COL_W;
    var date=new Date(state.year,m-1,item.d);
    var wd=date.getDay();
    var cls='cdl';
    if(wd===0||wd===6) cls+=' weekend';
    if(state.day===item.d) cls+=' selected';
    html+='<span class="'+cls+'" data-day="'+item.d+'" style="left:'+x+'px;">'+item.d+'</span>';
  });
  html+='</div>';
  html+='</div>';
  html+='<div class="chart-hint">← 左右滑动查看整月 · 点击柱子编辑当日 →</div>';
  html+='</div>';
  el.daysGrid.innerHTML=html;
  var viewport=document.getElementById('chartViewport');
  var scrollLeftCache=0;
  if(viewport){
    viewport.querySelectorAll('.chart-col').forEach(function(col){
      col.addEventListener('click',function(){
        var d=Number(col.dataset.day);
        if(state.day===d){ state.day=null; showSummaryPlaceholder(); }
        else{ selectDay(m,d); showSummaryContent(); }
        renderDaysChart(m);
        setTimeout(function(){ var vp=document.getElementById('chartViewport'); if(vp) vp.scrollLeft=scrollLeftCache; },10);
      });
    });
    viewport.querySelectorAll('.cdl').forEach(function(lbl){
      lbl.addEventListener('click',function(){
        var d=Number(lbl.dataset.day);
        if(state.day===d){ state.day=null; showSummaryPlaceholder(); }
        else{ selectDay(m,d); showSummaryContent(); }
        renderDaysChart(m);
        setTimeout(function(){ var vp=document.getElementById('chartViewport'); if(vp) vp.scrollLeft=scrollLeftCache; },10);
      });
    });
    viewport.addEventListener('scroll',function(){ scrollLeftCache=viewport.scrollLeft; },{passive:true});
    var target=state.day||1;
    var scrollTo=(target-1)*COL_W - (viewport.clientWidth/2) + (COL_W/2);
    if(scrollTo<0) scrollTo=0;
    setTimeout(function(){ viewport.scrollLeft=scrollTo; scrollLeftCache=scrollTo; },30);
  }
}

function updateActiveCell(){
  if(!el.daysGrid) return;
  el.daysGrid.querySelectorAll('.grid-day,.chart-col').forEach(function(c){
    c.classList.toggle('active',Number(c.dataset.day)===state.day);
  });
}
function selectDay(m,d){
  state.month=m; state.day=d;
  updateActiveCell();
  renderSummary(m,d);
}
function showSummaryContent(){
  if(el.summaryHead) el.summaryHead.hidden=false;
  if(el.summaryGrid) el.summaryGrid.hidden=false;
  if(el.summaryPlaceholder) el.summaryPlaceholder.hidden=true;
}
function showSummaryPlaceholder(){
  if(el.summaryHead) el.summaryHead.hidden=true;
  if(el.summaryGrid) el.summaryGrid.hidden=true;
  if(el.summaryNote) el.summaryNote.hidden=true;
  if(el.summaryPlaceholder) el.summaryPlaceholder.hidden=false;
}

function renderSummary(m,d){
  var year=state.year;
  if(!year||!d) return;
  var date=new Date(year,m-1,d);
  el.sumNum.textContent=String(d).padStart(2,'0');
  el.sumDate.textContent=year+'年'+m+'月'+d+'日 · 星期'+WD[date.getDay()];
  el.sumSub.textContent=year+' 年第 '+dayOfYear(year,m,d)+' 天';
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
    el.sumIncome.textContent='¥****';
    el.sumExpense.textContent='¥****';
    el.sumBalance.textContent='¥****';
    el.sumBalance.classList.remove('negative');
  }else{
    el.sumIncome.textContent='¥'+fmtMoney(income);
    el.sumExpense.textContent='¥'+fmtMoney(expense);
    el.sumBalance.textContent=fmtNet(balance);
    el.sumBalance.classList.toggle('negative',balance<0);
  }
  /* 备注 */
  if(el.summaryNote){
    var note='';
    if(hasData){
      var dday=getDay(year,m,d);
      note=dday.work.note||'';
    }
    if(note){
      el.summaryNote.textContent='📝 '+note;
      el.summaryNote.hidden=false;
    }else{
      el.summaryNote.hidden=true;
    }
  }
}

/* ============================================================
   智能分析
   ============================================================ */
function applyAnalysisHighlight(){
  if(!el.daysGrid) return;
  var mode=state.analysisMode;
  el.daysGrid.querySelectorAll('.grid-day,.chart-col').forEach(function(c){
    c.classList.remove('highlight','income-hl','expense-hl','highlighted');
  });
  if(!mode||!state.year||!state.month) return;
  var year=state.year,m=state.month,n=daysInMonth(year,m);
  var values=[];
  for(var d=1;d<=n;d++){
    var day=getDay(year,m,d);
    var val=mode.indexOf('income')===0?(calcPay(day)+calcIncomeTotal(day)):calcExpense(day);
    values.push({d:d,v:val});
  }
  var sum=values.reduce(function(s,x){ return s+x.v; },0);
  var avg=sum/n;
  if(avg<=0){
    if(el.analysisTip){ el.analysisTip.textContent='本月无数据，无法分析'; el.analysisTip.classList.add('active'); }
    return;
  }
  var higher=mode.indexOf('high')>0;
  var pool=values.filter(function(x){ return x.v>0&&(higher?x.v>avg:x.v<avg); });
  pool.sort(function(a,b){ return higher?b.v-a.v:a.v-b.v; });
  var totalAbove=pool.length;
  var shown=pool.slice(0,7);
  var cls=mode.indexOf('income')===0?'income-hl':'expense-hl';
  shown.forEach(function(x){
    var cell=el.daysGrid.querySelector('[data-day="'+x.d+'"]');
    if(cell){
      if(cell.classList.contains('chart-col')) cell.classList.add('highlighted',cls);
      else cell.classList.add('highlight',cls);
    }
  });
  if(el.analysisTip){
    if(!totalAbove) el.analysisTip.textContent='本月无'+(higher?'高于':'低于')+'平均的记录';
    else el.analysisTip.textContent='已高亮前 '+shown.length+' 天（共 '+totalAbove+' 天'+(higher?'高于':'低于')+'平均 ¥'+fmtMoney(avg)+'）';
    el.analysisTip.classList.add('active');
  }
}

/* ---------- 智能分析面板 ---------- */
function renderAnalysisPanel(){
  if(!state.year||!state.month) return;
  var y=state.year, m=state.month;
  var t=calcMonthTotal(y,m);
  var n=daysInMonth(y,m);

  /* 概览 */
  var ov='';
  ov+='<div class="ap-line"><span>有记录</span><strong>'+t.days+' / '+n+' 天</strong></div>';
  var avgInc=t.days>0?t.income/t.days:0;
  var avgExp=t.days>0?t.expense/t.days:0;
  var avgNet=t.days>0?(t.income-t.expense)/t.days:0;
  if(state.moneyHidden){
    ov+='<div class="ap-line"><span>平均日收入</span><strong>•••</strong></div>';
    ov+='<div class="ap-line"><span>平均日支出</span><strong>•••</strong></div>';
    ov+='<div class="ap-line"><span>平均日结余</span><strong>•••</strong></div>';
  }else{
    ov+='<div class="ap-line"><span>平均日收入</span><strong>¥'+fmtMoney(avgInc)+'</strong></div>';
    ov+='<div class="ap-line"><span>平均日支出</span><strong>¥'+fmtMoney(avgExp)+'</strong></div>';
    ov+='<div class="ap-line '+(avgNet>=0?'ok':'bad')+'"><span>平均日结余</span><strong>'+fmtNet(avgNet)+'</strong></div>';
  }
  if(el.apOverview) el.apOverview.innerHTML=ov||'<div class="ap-empty">本月暂无数据</div>';

  /* 趋势 */
  var tr='';
  if(m>1){
    var prev=calcMonthTotal(y,m-1);
    if(prev.income===0&&prev.expense===0){
      tr='<div class="ap-empty">上月无数据，无法对比</div>';
    }else{
      var incDiff=t.income-prev.income;
      var expDiff=t.expense-prev.expense;
      var incPct=prev.income>0?Math.round((incDiff/prev.income)*100):0;
      var expPct=prev.expense>0?Math.round((expDiff/prev.expense)*100):0;
      if(state.moneyHidden){
        tr='<div class="ap-line"><span>收入 vs 上月</span><strong>'+(incDiff>=0?'↑':'↓')+'</strong></div>';
        tr+='<div class="ap-line"><span>支出 vs 上月</span><strong>'+(expDiff>=0?'↑':'↓')+'</strong></div>';
      }else{
        tr='<div class="ap-line '+(incDiff>=0?'ok':'bad')+'"><span>收入 vs 上月</span><strong>'+(incDiff>=0?'+':'')+incPct+'%（'+(incDiff>=0?'+':'-')+'¥'+fmtMoney(Math.abs(incDiff))+'）</strong></div>';
        tr+='<div class="ap-line '+(expDiff<=0?'ok':'warn')+'"><span>支出 vs 上月</span><strong>'+(expDiff>=0?'+':'')+expPct+'%（'+(expDiff>=0?'+':'-')+'¥'+fmtMoney(Math.abs(expDiff))+'）</strong></div>';
      }
    }
  }else{
    tr='<div class="ap-empty">1 月无上月数据</div>';
  }
  if(el.apTrend) el.apTrend.innerHTML=tr;

  /* 异常提示 */
  var an='';
  var days=[];
  for(var d=1;d<=n;d++){
    var day=getDay(y,m,d);
    var rec=dayHasRecord(day);
    days.push({
      d:d,
      rec:rec,
      income:rec?(calcPay(day)+calcIncomeTotal(day)):0,
      expense:rec?calcExpense(day):0
    });
  }
  /* 高消费日 */
  var highExp=days.filter(function(x){ return x.rec&&avgExp>0&&x.expense>avgExp*3&&x.expense>0; });
  /* 高收入日 */
  var highInc=days.filter(function(x){ return x.rec&&avgInc>0&&x.income>avgInc*3&&x.income>0; });
  /* 连续空白段 */
  var blanks=[];
  var streak=0, streakStart=0;
  days.forEach(function(x){
    if(!x.rec){ if(!streak) streakStart=x.d; streak++; }
    else{ if(streak>=3) blanks.push(streakStart+'-'+(streakStart+streak-1)); streak=0; }
  });
  if(streak>=3) blanks.push(streakStart+'-'+(streakStart+streak-1));

  if(highExp.length&&!state.moneyHidden){
    var expText=highExp.map(function(x){ return x.d+'日'; }).join('、');
    an+='<div class="ap-line warn"><span>高消费日（>3×均值）</span><strong>'+expText+'</strong></div>';
  }
  if(highInc.length&&!state.moneyHidden){
    var incText=highInc.map(function(x){ return x.d+'日'; }).join('、');
    an+='<div class="ap-line ok"><span>高收入日（>3×均值）</span><strong>'+incText+'</strong></div>';
  }
  if(blanks.length){
    an+='<div class="ap-line warn"><span>连续空白段</span><strong>'+blanks.join('、')+'</strong></div>';
  }
  if(!an) an='<div class="ap-empty">本月无异常 ✓</div>';
  if(el.apAnomaly) el.apAnomaly.innerHTML=an;
}

/* ============================================================
   编辑弹窗
   ============================================================ */
function openEditModal(){
  if(!state.year||!state.month||!state.day) return;
  state.draft=getDay(state.year,state.month,state.day);

  /* 三餐记忆：没填过则用昨天 */
  if(!state.draft.life.meals.breakfast.amount
     && !state.draft.life.meals.lunch.amount
     && !state.draft.life.meals.dinner.amount){
    var yest=new Date(state.year,state.month-1,state.day-1);
    var yk=keyOf(yest.getFullYear(),yest.getMonth()+1,yest.getDate());
    var hasY=(yest.getFullYear()===DBYear?DB[yk]:readYearData(yest.getFullYear())[yk]);
    if(hasY){
      var yd=getDay(yest.getFullYear(),yest.getMonth()+1,yest.getDate());
      MEAL_KEYS.forEach(function(k){
        if(yd.life.meals[k].amount&&!state.draft.life.meals[k].amount){
          state.draft.life.meals[k].amount=yd.life.meals[k].amount;
        }
      });
    }
  }
  /* 无薪时段继承：没填过则用昨天 */
  if(!state.draft.work.breaks.length){
    var yest2=new Date(state.year,state.month-1,state.day-1);
    var yk2=keyOf(yest2.getFullYear(),yest2.getMonth()+1,yest2.getDate());
    var hasY2=(yest2.getFullYear()===DBYear?DB[yk2]:readYearData(yest2.getFullYear())[yk2]);
    if(hasY2){
      var yd2=getDay(yest2.getFullYear(),yest2.getMonth()+1,yest2.getDate());
      if(yd2.work.breaks&&yd2.work.breaks.length){
        state.draft.work.breaks=JSON.parse(JSON.stringify(yd2.work.breaks));
      }
    }
  }

  state.dirty=false;
  var date=new Date(state.year,state.month-1,state.day);
  el.editDate.textContent=state.month+'月'+state.day+'日';
  el.editWeek.textContent='星期'+WD[date.getDay()]+' · '+state.year+' 年第 '+dayOfYear(state.year,state.month,state.day)+' 天';

  fillWorkForm();
  fillLifeForm();
  refreshPayPreview();
  updateHeadBalance();
  setSaveState('idle');
  switchTabPanel('work');

  el.editModal.classList.add('open');
  el.editModal.setAttribute('aria-hidden','false');
  lockScroll();
}

function closeEditModal(silent){
  if(!el.editModal) return;
  if(state.dirty&&!silent) showToast('未保存的修改已丢弃');
  el.editModal.classList.remove('open');
  el.editModal.setAttribute('aria-hidden','true');
  unlockScroll();
  state.draft=null;
  state.dirty=false;
}

function switchTabPanel(tab){
  state.activeTab=tab;
  el.editTabs.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active',t.dataset.tab===tab); });
  if(el.panelWork) el.panelWork.hidden=tab!=='work';
  if(el.panelLife) el.panelLife.hidden=tab!=='life';
  if(el.resetBtn) el.resetBtn.textContent=tab==='work'?'重置工作':'重置生活';
  if(state.dirty) setSaveState('dirty');
}

function fillWorkForm(){
  var w=state.draft.work;
  if(el.restToggle) el.restToggle.checked=!!w.rest;
  el.locInput.value=w.location||'';
  updateLocBadge();
  el.shiftSeg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active',b.dataset.v===w.shift); });
  el.startTime.value=w.start||DEFAULT_START;
  el.endTime.value=w.end||DEFAULT_END;
  renderBreaks();
  updateHoursBadge();
  updateTimeSummary();
  updatePayBlockState();
  updateRestState();

  /* 加班 */
  var ot=w.overtime||{};
  if(el.overtimeToggle) el.overtimeToggle.checked=!!ot.enabled;
  if(el.overtimeHours) el.overtimeHours.value=ot.hours||'';
  if(el.overtimeRate) el.overtimeRate.value=String(ot.rate||1.5);
  if(el.overtimeFields) el.overtimeFields.hidden=!ot.enabled;

  /* 扣款 */
  renderDeducts();
}

function updateRestState(){
  var rest=state.draft.work.rest;
  document.querySelectorAll('#panel-work .panel-block').forEach(function(b){
    if(b.classList.contains('panel-rest')) return;
    b.style.opacity=rest?'.5':'';
    b.style.pointerEvents=rest?'none':'';
  });
}

function updateLocBadge(){
  if(state.draft.work.location){ el.locBadge.textContent='已填写'; el.locBadge.classList.remove('warn'); }
  else{ el.locBadge.textContent='未填写'; el.locBadge.classList.add('warn'); }
}
function updateHoursBadge(){
  if(!state.draft.work.enabled||state.draft.work.rest){
    el.hoursBadge.textContent=state.draft.work.rest?'休息日':'未启用';
    el.hoursBadge.classList.add('off');
    el.hoursBadge.classList.remove('warn');
  }else{
    el.hoursBadge.textContent=calcHours(state.draft)+' h';
    el.hoursBadge.classList.remove('off','warn');
  }
}
function updateTimeSummary(){
  if(!el.timeSummary) return;
  if(!state.draft.work.enabled||state.draft.work.rest){
    el.timeSummary.textContent=state.draft.work.rest?'今日休息':'未启用';
    return;
  }
  var s=state.draft.work.start||DEFAULT_START;
  var e=state.draft.work.end||DEFAULT_END;
  var total=durationHours(s,e);
  var unpaid=0;
  (state.draft.work.breaks||[]).forEach(function(b){ unpaid+=durationHours(b.start,b.end); });
  var net=Math.max(0,total-unpaid);
  var text=s+' → '+e+' · '+Math.round(net*100)/100+'h';
  if(unpaid>0) text+='（扣除 '+Math.round(unpaid*100)/100+'h）';
  el.timeSummary.textContent=text;
}
function updatePayBlockState(){
  if(state.draft.work.enabled&&!state.draft.work.rest){
    el.payBlock.classList.remove('disabled');
    el.payArrow.textContent='设置模板 ›';
  }else{
    el.payBlock.classList.add('disabled');
    el.payArrow.textContent=state.draft.work.rest?'休息日 ›':'编辑后自动启用 ›';
  }
}
function renderBreaks(){
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
  ins[0].addEventListener('change',function(e){ state.draft.work.breaks[i].start=e.target.value; enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview(); });
  ins[1].addEventListener('change',function(e){ state.draft.work.breaks[i].end=e.target.value; enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview(); });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.work.breaks.splice(i,1);
    enableWork(); markDirty(); renderBreaks(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview();
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

/* 扣款渲染 */
function renderDeducts(){
  el.deductList.innerHTML='';
  var list=state.draft.work.deducts||[];
  if(!list.length){
    el.deductList.innerHTML='<div class="empty-tip">暂无扣款（迟到 / 请假 / 罚款…）</div>';
    updateDeductBadge();
    return;
  }
  list.forEach(function(d,i){ appendDeductItem(d,i); });
  updateDeductBadge();
}
function appendDeductItem(d,i){
  var row=document.createElement('div');
  row.className='extra-item';
  row.innerHTML='<div class="extra-top">'
    +'<input class="inp extra-name" type="text" placeholder="扣款类目" value="'+escapeHtml(d.name)+'" maxlength="20">'
    +'<input class="inp extra-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="金额" value="'+escapeHtml(d.amount===''||d.amount===undefined?'':d.amount)+'">'
    +'<button type="button" class="del-btn">×</button>'
    +'</div>';
  var nameI=row.querySelector('.extra-name');
  var amtI=row.querySelector('.extra-amt');
  nameI.addEventListener('input',function(e){ state.draft.work.deducts[i].name=e.target.value; enableWork(); markDirty(); });
  amtI.addEventListener('input',function(e){ state.draft.work.deducts[i].amount=e.target.value; enableWork(); markDirty(); updateDeductBadge(); refreshPayPreview(); });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.work.deducts.splice(i,1);
    enableWork(); markDirty(); renderDeducts(); refreshPayPreview();
  });
  el.deductList.appendChild(row);
}
function updateDeductBadge(){
  if(!el.deductBadge) return;
  var t=(state.draft.work.deducts||[]).reduce(function(s,d){ return s+(Number(d.amount)||0); },0);
  el.deductBadge.textContent='-¥'+fmtMoney(t);
}

/* 生活表单 */
function fillLifeForm(){
  document.querySelectorAll('.meal-input').forEach(function(inp){
    inp.value=state.draft.life.meals[inp.dataset.meal].amount||'';
  });
  renderMealQuick();
  renderExtras();
  renderIncomes();
  renderPhotoBoxes();
  renderFreqChips();
  updateMealBadge();
  updateExtraBadge();
  updateIncomeBadge();
  updateLifeBalance();
  if(el.dayNote) el.dayNote.value=state.draft.work.note||'';
}
function renderMealQuick(){
  var presets=[8,10,12,15,20,25];
  document.querySelectorAll('.meal-quick').forEach(function(container){
    var key=container.dataset.meal;
    container.innerHTML='';
    presets.forEach(function(v){
      var b=document.createElement('button');
      b.type='button';
      b.textContent='¥'+v;
      b.addEventListener('click',function(){
        state.draft.life.meals[key].amount=String(v);
        var inp=document.querySelector('.meal-input[data-meal="'+key+'"]');
        if(inp) inp.value=String(v);
        enableLife(); markDirty(); updateMealBadge(); updateLifeBalance();
      });
      container.appendChild(b);
    });
  });
}
function renderFreqChips(){
  ['extra','income'].forEach(function(kind){
    var box=el[kind+'FreqChips'];
    if(!box) return;
    var list=state.draft.life[kind==='extra'?'extras':'incomes']||[];
    var used={};
    list.forEach(function(it){ if(it.name) used[it.name]=true; });
    var presets=FREQ_PRESETS[kind]||[];
    box.innerHTML='';
    presets.forEach(function(name){
      if(used[name]) return;
      var b=document.createElement('button');
      b.type='button';
      b.className='freq-chip';
      b.textContent='+ '+name;
      b.addEventListener('click',function(){
        state.draft.life[kind==='extra'?'extras':'incomes'].push({name:name,amount:'',photo:''});
        enableLife(); markDirty();
        if(kind==='extra') renderExtras(); else renderIncomes();
        renderFreqChips();
        updateLifeBalance();
      });
      box.appendChild(b);
    });
  });
}

var updateMealBadge=function(){ el.mealBadge.textContent='¥'+fmtMoney(calcMealTotal(state.draft)); };
var updateExtraBadge=function(){ el.extraBadge.textContent='¥'+fmtMoney(calcExtraTotal(state.draft)); };
var updateIncomeBadge=function(){ el.incomeBadge.textContent='¥'+fmtMoney(calcIncomeTotal(state.draft)); };

function updateLifeBalance(){
  if(!state.draft) return;
  var pay=calcPay(state.draft);
  var exp=calcExpense(state.draft);
  var inc=calcIncomeTotal(state.draft);
  var net=Math.round((pay+inc-exp)*100)/100;
  el.lifeBalance.textContent=fmtNet(net);
  el.lifeBalance.style.color=net<0?'#ff5c7c':'#4affd4';
  el.lifeDetail.textContent='工资 ¥'+fmtMoney(pay)+' ＋ 收入 ¥'+fmtMoney(inc)+' － 支出 ¥'+fmtMoney(exp);
  updateHeadBalance();
}
function updateHeadBalance(){
  if(!el.editHeadBalance||!state.draft) return;
  var net=calcNet(state.draft);
  el.editHeadBalance.textContent=fmtNet(net);
  el.editHeadBalance.classList.toggle('negative',net<0);
}
function refreshPayPreview(){
  if(!state.draft) return;
  el.payVal.textContent='¥'+fmtMoney(calcPay(state.draft));
  updateLifeBalance();
}

function renderExtras(){
  el.extraList.innerHTML='';
  var list=state.draft.life.extras||[];
  if(!list.length){
    el.extraList.innerHTML='<div class="empty-tip">暂无额外支出，点击下方按钮新增类目</div>';
    updateExtraBadge(); return;
  }
  list.forEach(function(it,i){ appendExtraItem(it,i); });
  updateExtraBadge();
}
function appendExtraItem(it,i){
  var row=document.createElement('div');
  row.className='extra-item';
  row.innerHTML='<div class="extra-top">'
    +'<input class="inp extra-name" type="text" placeholder="类目" value="'+escapeHtml(it.name)+'" maxlength="30">'
    +'<input class="inp extra-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0.00" value="'+escapeHtml(it.amount===''||it.amount===undefined?'':it.amount)+'">'
    +'<button type="button" class="del-btn">×</button></div>'
    +'<div class="extra-bottom"><div class="photo-box" id="photoBox-extra-'+i+'" data-kind="extra" data-index="'+i+'"></div><span class="extra-hint">点击拍照 / 上传凭证</span></div>';
  var nameI=row.querySelector('.extra-name');
  var amtI=row.querySelector('.extra-amt');
  nameI.addEventListener('input',function(e){ state.draft.life.extras[i].name=e.target.value; enableLife(); markDirty(); });
  amtI.addEventListener('input',function(e){ state.draft.life.extras[i].amount=e.target.value; enableLife(); markDirty(); updateExtraBadge(); updateLifeBalance(); });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.life.extras.splice(i,1);
    enableLife(); markDirty(); renderExtras(); renderPhotoBoxes(); updateLifeBalance(); renderFreqChips();
  });
  el.extraList.appendChild(row);
  var box=row.querySelector('.photo-box');
  renderPhotoBox(box,it.photo||'',{kind:'extra',index:i});
}
function renderIncomes(){
  el.incomeList.innerHTML='';
  var list=state.draft.life.incomes||[];
  if(!list.length){
    el.incomeList.innerHTML='<div class="empty-tip">暂无其他收入，点击下方按钮新增类目</div>';
    updateIncomeBadge(); return;
  }
  list.forEach(function(it,i){ appendIncomeItem(it,i); });
  updateIncomeBadge();
}
function appendIncomeItem(it,i){
  var row=document.createElement('div');
  row.className='extra-item';
  row.innerHTML='<div class="extra-top">'
    +'<input class="inp extra-name" type="text" placeholder="类目" value="'+escapeHtml(it.name)+'" maxlength="30">'
    +'<input class="inp extra-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0.00" value="'+escapeHtml(it.amount===''||it.amount===undefined?'':it.amount)+'">'
    +'<button type="button" class="del-btn">×</button></div>'
    +'<div class="extra-bottom"><div class="photo-box" id="photoBox-income-'+i+'" data-kind="income" data-index="'+i+'"></div><span class="extra-hint">点击拍照 / 上传凭证</span></div>';
  var nameI=row.querySelector('.extra-name');
  var amtI=row.querySelector('.extra-amt');
  nameI.addEventListener('input',function(e){ state.draft.life.incomes[i].name=e.target.value; enableLife(); markDirty(); });
  amtI.addEventListener('input',function(e){ state.draft.life.incomes[i].amount=e.target.value; enableLife(); markDirty(); updateIncomeBadge(); updateLifeBalance(); });
  row.querySelector('.del-btn').addEventListener('click',function(){
    state.draft.life.incomes.splice(i,1);
    enableLife(); markDirty(); renderIncomes(); renderPhotoBoxes(); updateLifeBalance(); renderFreqChips();
  });
  el.incomeList.appendChild(row);
  var box=row.querySelector('.photo-box');
  renderPhotoBox(box,it.photo||'',{kind:'income',index:i});
}
function enableLife(){ if(state.draft.life.enabled===false) state.draft.life.enabled=true; }

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
    var size=Math.round(dataUrl.length*0.75/1024);
    box.innerHTML='<img src="'+dataUrl+'" alt=""><button type="button" class="photo-remove">×</button><span class="photo-size">'+size+'KB</span>';
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
          var c=document.createElement('canvas');
          c.width=w; c.height=h;
          c.getContext('2d').drawImage(img,0,0,w,h);
          resolve(c.toDataURL('image/jpeg',quality));
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
    if(item){ item.photo=dataUrl; enableLife(); var b2=document.getElementById('photoBox-extra-'+target.index); if(b2) renderPhotoBox(b2,dataUrl,target); }
  }else if(target.kind==='income'){
    var item2=state.draft.life.incomes[target.index];
    if(item2){ item2.photo=dataUrl; enableLife(); var b3=document.getElementById('photoBox-income-'+target.index); if(b3) renderPhotoBox(b3,dataUrl,target); }
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
function markDirty(){ state.dirty=true; setSaveState('dirty'); }
function setSaveState(s){
  if(!el.saveBtn) return;
  el.saveBtn.classList.remove('dirty','saved');
  if(s==='dirty'){ el.saveBtn.textContent='保 存 修 改'; el.saveBtn.classList.add('dirty'); }
  else if(s==='saved'){ el.saveBtn.textContent='✓ 已 保 存'; el.saveBtn.classList.add('saved'); }
  else{ el.saveBtn.textContent='保 存'; }
}
function resetCurrentTab(){
  if(state.activeTab==='work'){
    state.draft.work=blankWork();
    state.draft.work.enabled=false;
    fillWorkForm(); refreshPayPreview();
    showToast('工作已重置 · 保存后生效');
  }else{
    state.draft.life=blankLife();
    state.draft.life.enabled=false;
    fillLifeForm(); refreshPayPreview();
    showToast('生活已重置 · 保存后生效');
  }
  markDirty();
}
function saveDay(nextDay){
  if(!state.draft||!state.year||!state.month||!state.day) return;
  /* 数据校验 */
  if(state.draft.work.enabled&&!state.draft.work.rest){
    var s=state.draft.work.start, e=state.draft.work.end;
    var h=calcHours(state.draft);
    if(s&&e&&durationHours(s,e)===0&&s!==e){ showToast('时间设置异常，请检查',true); return; }
    if(h>16){ if(!confirm('当日工时超过 16 小时，确认保存？')) return; }
  }

  var k=keyOf(state.year,state.month,state.day);
  DB[k]=JSON.parse(JSON.stringify(state.draft));
  var ok=saveDB();
  if(!ok){ showToast('保存失败：本地存储可能已满',true); return; }

  state.dirty=false;
  setSaveState('saved');
  showToast('已保存 · '+state.year+'年'+state.month+'月'+state.day+'日');
  renderDays();
  renderMonthOverview();
  renderSummary(state.month,state.day);
  renderAnalysisPanel();
  refreshHome();

  if(nextDay){
    /* 保存并下一天 */
    setTimeout(function(){
      closeEditModal(true);
      var y=state.year,m=state.month,d=state.day+1;
      var maxD=daysInMonth(y,m);
      if(d>maxD){ d=1; m++; if(m>12){ m=1; y++; } }
      if(y>MAX_YEAR) return;
      state.year=y; state.month=m; state.day=d;
      if(y!==DBYear) loadDB(y);
      updateYMDisplay();
      refreshDateTab();
      setTimeout(openEditModal,220);
    },300);
  }else{
    setTimeout(function(){ closeEditModal(true); },280);
  }
}

/* ============================================================
   工资模板
   ============================================================ */
function openWageModal(){
  if(!el.wageModal||!state.draft) return;
  wageDraft=JSON.parse(JSON.stringify(state.draft.work.wage||getDefaultWage()));
  var def=blankWage();
  Object.keys(def).forEach(function(k){ if(wageDraft[k]===undefined) wageDraft[k]=def[k]; });
  wageDraft.allowances=(wageDraft.allowances||[]).map(function(a){
    return {name:a.name||'',amount:a.amount===''||a.amount===undefined?'':a.amount,freq:a.freq||'daily'};
  });

  el.wageModeSeg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active',b.dataset.v===wageDraft.mode); });
  el.fieldHourly.hidden=wageDraft.mode!=='hourly';
  el.fieldDaily.hidden=wageDraft.mode!=='daily';
  el.fieldBase.hidden=wageDraft.mode!=='base';
  el.fieldMonthly.hidden=wageDraft.mode!=='monthly';
  el.fieldPiece.hidden=wageDraft.mode!=='piece';
  el.fieldCommission.hidden=wageDraft.mode!=='commission';

  el.hourlyRate.value=wageDraft.hourlyRate!=null?wageDraft.hourlyRate:25;
  el.dailyRate.value=wageDraft.dailyRate!=null?wageDraft.dailyRate:200;
  el.baseSalary.value=wageDraft.baseSalary!=null?wageDraft.baseSalary:5000;
  el.monthDays.value=wageDraft.monthDays!=null?wageDraft.monthDays:21.75;
  el.stdHours.value=wageDraft.stdHours!=null?wageDraft.stdHours:8;
  el.monthlySalary.value=wageDraft.monthlySalary!=null?wageDraft.monthlySalary:8000;
  el.monthWorkDays.value=wageDraft.monthWorkDays!=null?wageDraft.monthWorkDays:22;
  el.pieceRate.value=wageDraft.pieceRate!=null?wageDraft.pieceRate:1;
  el.commissionSales.value=wageDraft.commissionSales!=null?wageDraft.commissionSales:0;
  el.commissionRate.value=wageDraft.commissionRate!=null?wageDraft.commissionRate:5;

  renderAllowances();
  updateWagePreview();

  el.wageModal.classList.add('open');
  el.wageModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeWageModal(){
  if(!el.wageModal) return;
  el.wageModal.classList.remove('open');
  el.wageModal.setAttribute('aria-hidden','true');
  unlockScroll();
}
function renderAllowances(){
  el.allowList.innerHTML='';
  var list=wageDraft.allowances;
  if(!list.length){
    el.allowList.innerHTML='<div class="empty-tip">暂无补贴（餐补 / 全勤 / 夜班津贴…）</div>';
    return;
  }
  var frag=document.createDocumentFragment();
  list.forEach(function(a,i){
    var row=document.createElement('div');
    row.className='allow-row';
    row.innerHTML='<input class="inp allow-name" type="text" placeholder="补贴名称" value="'+escapeHtml(a.name)+'" maxlength="20">'
      +'<input class="inp allow-amt" type="number" min="0" step="0.5" inputmode="decimal" placeholder="金额" value="'+escapeHtml(a.amount===''||a.amount===undefined?'':a.amount)+'">'
      +'<select class="allow-freq">'
        +'<option value="daily"'+(a.freq!=='monthly'?' selected':'')+'>日发</option>'
        +'<option value="monthly"'+(a.freq==='monthly'?' selected':'')+'>月发</option>'
      +'</select>'
      +'<button type="button" class="del-btn">×</button>';
    var nameI=row.querySelector('.allow-name');
    var amtI=row.querySelector('.allow-amt');
    var freqS=row.querySelector('.allow-freq');
    nameI.addEventListener('input',function(e){ wageDraft.allowances[i].name=e.target.value; });
    amtI.addEventListener('input',function(e){ wageDraft.allowances[i].amount=e.target.value; updateWagePreview(); });
    freqS.addEventListener('change',function(e){ wageDraft.allowances[i].freq=e.target.value; updateWagePreview(); });
    row.querySelector('.del-btn').addEventListener('click',function(){
      wageDraft.allowances.splice(i,1);
      renderAllowances(); updateWagePreview();
    });
    frag.appendChild(row);
  });
  el.allowList.appendChild(frag);
}
function updateWagePreview(){
  if(!state.draft||!el.wagePreview) return;
  var tmp={work:{enabled:true,rest:false,start:state.draft.work.start,end:state.draft.work.end,breaks:state.draft.work.breaks,wage:wageDraft,overtime:{enabled:false},deducts:[]}};
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  var oldY=state.year, oldM=state.month;
  state.year=y; state.month=m;
  el.wagePreview.textContent='¥'+fmtMoney(calcPay(tmp));
  state.year=oldY; state.month=oldM;

  /* 月收入预览 */
  var workDays=22;
  var dailyBase=0;
  if(wageDraft.mode==='daily') dailyBase=Number(wageDraft.dailyRate)||0;
  else if(wageDraft.mode==='monthly'){ var mwd=Number(wageDraft.monthWorkDays)||22; dailyBase=(Number(wageDraft.monthlySalary)||0)/mwd; workDays=mwd; }
  else if(wageDraft.mode==='base'){ var md=Number(wageDraft.monthDays)||21.75; var sh=Number(wageDraft.stdHours)||8; dailyBase=sh*((Number(wageDraft.baseSalary)||0)/md/sh); }
  else if(wageDraft.mode==='hourly') dailyBase=8*(Number(wageDraft.hourlyRate)||0);
  else if(wageDraft.mode==='piece') dailyBase=(Number(wageDraft.pieceRate)||0)*8;
  else if(wageDraft.mode==='commission') dailyBase=(Number(wageDraft.commissionSales)||0)*(Number(wageDraft.commissionRate)||0)/100;

  var allowDaily=(wageDraft.allowances||[]).reduce(function(s,a){
    var amt=Number(a.amount)||0;
    if(a.freq==='monthly') return s + amt/30;
    return s + amt;
  },0);
  var monthBase=Math.round(dailyBase*workDays*100)/100;
  var monthAllow=Math.round(allowDaily*workDays*100)/100;
  var monthTotal=Math.round((monthBase+monthAllow)*100)/100;

  if(el.wpDays) el.wpDays.textContent=String(workDays);
  if(el.wpBase) el.wpBase.textContent='¥'+fmtMoney(monthBase);
  if(el.wpAllow) el.wpAllow.textContent='¥'+fmtMoney(monthAllow);
  if(el.wpTotal) el.wpTotal.textContent='¥'+fmtMoney(monthTotal);
}
function collectWage(){
  var w=JSON.parse(JSON.stringify(wageDraft));
  w.hourlyRate=Number(el.hourlyRate.value)||0;
  w.dailyRate=Number(el.dailyRate.value)||0;
  w.baseSalary=Number(el.baseSalary.value)||0;
  w.monthDays=Number(el.monthDays.value)||21.75;
  w.stdHours=Number(el.stdHours.value)||8;
  w.monthlySalary=Number(el.monthlySalary.value)||0;
  w.monthWorkDays=Number(el.monthWorkDays.value)||22;
  w.pieceRate=Number(el.pieceRate.value)||0;
  w.commissionSales=Number(el.commissionSales.value)||0;
  w.commissionRate=Number(el.commissionRate.value)||0;
  w.allowances=wageDraft.allowances.map(function(a){
    return {name:a.name||'补贴',amount:Number(a.amount)||0,freq:a.freq==='monthly'?'monthly':'daily'};
  });
  return w;
}

/* ============================================================
   视野范围
   ============================================================ */
function openRangeModal(){
  if(!el.rangeModal) return;
  rangeDraft=JSON.parse(JSON.stringify(state.range));
  el.rangeTabs.forEach(function(t){ t.classList.toggle('active',t.dataset.range===rangeDraft.type); });
  el.rangePanelAll.hidden=rangeDraft.type!=='all';
  el.rangePanelWeek.hidden=rangeDraft.type!=='week';
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
  lockScroll();
}
function closeRangeModal(){
  if(!el.rangeModal) return;
  el.rangeModal.classList.remove('open');
  el.rangeModal.setAttribute('aria-hidden','true');
  unlockScroll();
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
      el.rangeYearPicker.querySelectorAll('.year-pick-btn').forEach(function(x){ x.classList.toggle('active',x===target); });
      updateRangePreview();
    });
    frag.appendChild(btn);
  }
  el.rangeYearPicker.appendChild(frag);
}
function updateRangePreview(){
  var range={type:'all'};
  if(rangeDraft.type==='week'){ range={type:'week'}; }
  else if(rangeDraft.type==='year'){ range={type:'year',year:rangeDraft.year}; }
  else if(rangeDraft.type==='custom'){
    var s=el.rangeStart.value||(MIN_YEAR+'-01');
    var e=el.rangeEnd.value||((state.year||MIN_YEAR)+'-12');
    if(s>e){ el.rangeResult.textContent='—'; el.rangeResult.classList.remove('negative'); return; }
    range={type:'custom',start:s,end:e};
  }
  var t=calcRangeTotal(range);
  el.rangeResult.textContent=state.moneyHidden?'¥****':fmtNet(t.balance);
  el.rangeResult.classList.toggle('negative',!state.moneyHidden&&t.balance<0);
}
function loadRange(){
  try{
    var raw=localStorage.getItem(rangeKey());
    if(raw){ var r=JSON.parse(raw); if(r&&r.type) state.range=r; }
  }catch(e){}
}
function saveRange(){ try{ localStorage.setItem(rangeKey(),JSON.stringify(state.range)); }catch(e){} }
function rangeLabel(range){
  if(!range) return '全部时间';
  if(range.type==='week') return '本周';
  if(range.type==='year') return range.year+' 年';
  if(range.type==='custom') return range.start.replace('-','年')+'月 ~ '+range.end.replace('-','年')+'月';
  return '全部时间';
}

/* ============================================================
   金额隐藏
   ============================================================ */
function toggleMoney(){
  state.moneyHidden=!state.moneyHidden;
  if(el.eyeBtn) el.eyeBtn.classList.toggle('hidden',state.moneyHidden);
  try{ localStorage.setItem(KEYS.moneyHidden,state.moneyHidden?'1':'0'); }catch(e){}
  refreshBalance();
  renderFunds();
  renderInsight();
  drawTrend();
  renderBalanceCompare();
  renderRecent();
  if(state.year&&state.month){
    renderMonthOverview();
    renderDays();
    renderAnalysisPanel();
    if(state.day) renderSummary(state.month,state.day);
  }
}

/* ============================================================
   修改密钥
   ============================================================ */
function openChangeKeyModal(){
  if(!el.changeKeyModal) return;
  el.oldKey.value=''; el.newKey.value=''; el.newKey2.value='';
  if(el.changeKeyMsg) el.changeKeyMsg.className='login-msg';
  el.changeKeyModal.classList.add('open');
  el.changeKeyModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeChangeKeyModal(){
  if(!el.changeKeyModal) return;
  el.changeKeyModal.classList.remove('open');
  el.changeKeyModal.setAttribute('aria-hidden','true');
  unlockScroll();
}
async function doChangeKey(){
  var oldK=(el.oldKey.value||'').trim();
  var newK=(el.newKey.value||'').trim();
  var newK2=(el.newKey2.value||'').trim();
  if(!oldK){ if(el.changeKeyMsg){ el.changeKeyMsg.textContent='请输入当前密钥'; el.changeKeyMsg.className='login-msg error'; } return; }
  if(!newK||newK.length<6){ if(el.changeKeyMsg){ el.changeKeyMsg.textContent='新密钥至少 6 位'; el.changeKeyMsg.className='login-msg error'; } return; }
  if(newK!==newK2){ if(el.changeKeyMsg){ el.changeKeyMsg.textContent='两次新密钥不一致'; el.changeKeyMsg.className='login-msg error'; } return; }
  var r=await changeKey(oldK,newK);
  if(r.ok){
    if(el.changeKeyMsg){ el.changeKeyMsg.textContent='修改成功，即将锁定系统'; el.changeKeyMsg.className='login-msg ok'; }
    showToast('密钥已修改，请用新密钥登录');
    setTimeout(function(){ closeChangeKeyModal(); destroySession(); location.reload(); },1000);
  }else{
    if(el.changeKeyMsg){ el.changeKeyMsg.textContent=r.msg||'修改失败'; el.changeKeyMsg.className='login-msg error'; }
  }
}

/* ============================================================
   清空数据
   ============================================================ */
function openClearDataModal(){
  if(!el.clearDataModal) return;
  el.clearDataInput.value='';
  el.clearDataModal.classList.add('open');
  el.clearDataModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeClearDataModal(){
  if(!el.clearDataModal) return;
  el.clearDataModal.classList.remove('open');
  el.clearDataModal.setAttribute('aria-hidden','true');
  unlockScroll();
}
function doClearData(){
  if((el.clearDataInput.value||'').trim().toUpperCase()!=='DELETE'){
    showToast('请输入 DELETE 确认',true); return;
  }
  var keys=[];
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k.indexOf(KEYS.dataPrefix)===0) keys.push(k);
  }
  keys.forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
  showToast('已清空 '+keys.length+' 组数据，即将刷新');
  setTimeout(function(){ location.reload(); },800);
}

/* ============================================================
   设置页统计
   ============================================================ */
function refreshSettings(){
  refreshStorage();
  refreshRecordStats();
  refreshDefaultWageSub();
  try{ el.settingsFoot.textContent='PURE v'+APP_VERSION+' · 本机存储 · 不上传服务器'; }catch(e){}
}
function refreshDefaultWageSub(){
  if(!el.defaultWageSub) return;
  var w=getDefaultWage();
  var modeText={hourly:'小时工',daily:'日结',base:'底薪',monthly:'月结',piece:'计件',commission:'提成'}[w.mode]||'小时工';
  el.defaultWageSub.textContent='当前：'+modeText;
}
function refreshStorage(){
  if(!el.storageSub) return;
  var total=0;
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k.indexOf(KEYS.dataPrefix)===0||k.indexOf(KEYS.fundPrefix)===0||k.indexOf(KEYS.rangePrefix)===0){
      var v=localStorage.getItem(k)||'';
      total+=k.length+v.length;
    }
  }
  /* 按 UTF-16 计，1 字符 = 2 字节 */
  var bytes=total*2;
  var kb=bytes/1024;
  var mb=kb/1024;
  /* localStorage 限额约 5MB */
  var limit=5*1024*1024;
  var pct=Math.min(100,Math.round(bytes/limit*100));
  var text=mb>=1?(mb.toFixed(2)+' MB'):(kb.toFixed(1)+' KB');
  el.storageSub.textContent='已用 '+text+' / 约 5 MB（'+pct+'%）';
  if(el.storageFill){
    el.storageFill.style.width=pct+'%';
    el.storageFill.classList.toggle('warn',pct>=80&&pct<95);
    el.storageFill.classList.toggle('danger',pct>=95);
  }
}
function refreshRecordStats(){
  if(!el.recordStatsSub) return;
  var days=0;
  var first=null, last=null;
  for(var y=MIN_YEAR;y<=MAX_YEAR;y++){
    var ydata=readYearData(y);
    for(var k in ydata){
      if(!Object.prototype.hasOwnProperty.call(ydata,k)) continue;
      var parts=k.split('-');
      if(parts.length!==3) continue;
      var day=getDay(y,Number(parts[1]),Number(parts[2]));
      if(!dayHasRecord(day)) continue;
      days++;
      if(!first||k<first) first=k;
      if(!last||k>last) last=k;
    }
  }
  if(days===0){ el.recordStatsSub.textContent='暂无记录'; return; }
  el.recordStatsSub.textContent='共 '+days+' 天，从 '+first+' 到 '+last;
}

/* ============================================================
   导入导出
   ============================================================ */
function exportData(){
  var data={};
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k===KEYS.session) continue;
    data[k]=localStorage.getItem(k);
  }
  var json=JSON.stringify(data);
  var blob=new Blob([json],{type:'application/json'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  var stamp=new Date().toISOString().slice(0,10);
  a.download='pure-'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  showToast('已导出 JSON 备份');
}
function importData(){
  var input=document.createElement('input');
  input.type='file';
  input.accept='.json,application/json';
  input.onchange=function(e){
    var f=e.target.files[0];
    if(!f) return;
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var parsed=JSON.parse(ev.target.result);
        if(parsed&&parsed.v===1&&parsed.cipher&&parsed.salt){
          pendingEncImport=parsed;
          openEncImportModal();
          return;
        }
        var count=0;
        for(var k in parsed){
          if(!Object.prototype.hasOwnProperty.call(parsed,k)) continue;
          if(k===KEYS.session) continue;
          localStorage.setItem(k,parsed[k]);
          count++;
        }
        showToast('导入成功 · '+count+' 条，即将刷新');
        setTimeout(function(){ location.reload(); },800);
      }catch(err){ showToast('文件格式错误',true); }
    };
    reader.readAsText(f);
  };
  input.click();
}
async function deriveAesKey(password,salt,iterations){
  var enc=new TextEncoder();
  var km=await crypto.subtle.importKey('raw',enc.encode(password),{name:'PBKDF2'},false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:enc.encode(salt),iterations:iterations,hash:'SHA-256'},
    km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']
  );
}
async function encryptJSON(plain,password){
  var salt=randomHex(16);
  var ivBytes=new Uint8Array(12);
  if(window.crypto&&window.crypto.getRandomValues) window.crypto.getRandomValues(ivBytes);
  else for(var i=0;i<12;i++) ivBytes[i]=Math.floor(Math.random()*256);
  var key=await deriveAesKey(password,salt,150000);
  var cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv:ivBytes},key,new TextEncoder().encode(plain));
  return {v:1,algo:'AES-GCM/PBKDF2-SHA256',salt:salt,iv:hex(ivBytes),iterations:150000,cipher:hex(new Uint8Array(cipher))};
}
async function decryptJSON(pkg,password){
  var key=await deriveAesKey(password,pkg.salt,pkg.iterations||150000);
  var ivB=new Uint8Array(pkg.iv.match(/.{2}/g).map(function(x){ return parseInt(x,16); }));
  var cb=new Uint8Array(pkg.cipher.match(/.{2}/g).map(function(x){ return parseInt(x,16); }));
  var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:ivB},key,cb);
  return new TextDecoder().decode(plain);
}
function openEncExportModal(){
  if(!el.encExportModal) return;
  el.encExportPwd.value=''; el.encExportPwd2.value='';
  el.encExportModal.classList.add('open');
  el.encExportModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeEncExportModal(){
  if(!el.encExportModal) return;
  el.encExportModal.classList.remove('open');
  el.encExportModal.setAttribute('aria-hidden','true');
  unlockScroll();
}
async function doEncryptedExport(){
  var p1=el.encExportPwd.value;
  var p2=el.encExportPwd2.value;
  if(!p1||p1.length<6){ showToast('密码至少 6 位',true); return; }
  if(p1!==p2){ showToast('两次密码不一致',true); return; }
  if(!HAS_CRYPTO){ showToast('当前环境不支持加密',true); return; }
  var data={};
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k===KEYS.session) continue;
    data[k]=localStorage.getItem(k);
  }
  try{
    var pkg=await encryptJSON(JSON.stringify(data),p1);
    var blob=new Blob([JSON.stringify(pkg)],{type:'application/json'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    var stamp=new Date().toISOString().slice(0,10);
    a.download='pure-enc-'+stamp+'.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
    closeEncExportModal();
    showToast('加密导出成功');
  }catch(e){ console.error(e); showToast('加密失败',true); }
}
function openEncImportModal(){
  if(!el.encImportModal) return;
  el.encImportPwd.value='';
  if(el.encImportMsg) el.encImportMsg.className='login-msg';
  el.encImportModal.classList.add('open');
  el.encImportModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeEncImportModal(){
  if(!el.encImportModal) return;
  el.encImportModal.classList.remove('open');
  el.encImportModal.setAttribute('aria-hidden','true');
  pendingEncImport=null;
  unlockScroll();
}
async function doEncryptedImport(){
  if(!pendingEncImport) return;
  var pwd=el.encImportPwd.value;
  if(!pwd){ showToast('请输入密码',true); return; }
  try{
    var plain=await decryptJSON(pendingEncImport,pwd);
    var data=JSON.parse(plain);
    var count=0;
    for(var k in data){
      if(!Object.prototype.hasOwnProperty.call(data,k)) continue;
      if(k===KEYS.session) continue;
      localStorage.setItem(k,data[k]);
      count++;
    }
    showToast('解密成功 · '+count+' 条');
    setTimeout(function(){ location.reload(); },900);
  }catch(e){
    if(el.encImportMsg){ el.encImportMsg.textContent='密码错误或文件损坏'; el.encImportMsg.className='login-msg error'; }
  }
}

/* ============================================================
   CSV 导出
   ============================================================ */
function exportCsv(){
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  var n=daysInMonth(y,m);
  var rows=[['日期','星期','工资','其他收入','三餐','额外支出','扣款','当日结余','备注']];
  for(var d=1;d<=n;d++){
    var k=keyOf(y,m,d);
    var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
    var day=hasData?getDay(y,m,d):null;
    var wd=WD[new Date(y,m-1,d).getDay()];
    var pay=day?calcPay(day):0;
    var inc=day?calcIncomeTotal(day):0;
    var meal=day?calcMealTotal(day):0;
    var extra=day?calcExtraTotal(day):0;
    var deduct=day?calcDeduct(day):0;
    var net=day?calcNet(day):0;
    var note=day?day.work.note:'';
    rows.push([y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'),wd,
      fmtMoney(pay),fmtMoney(inc),fmtMoney(meal),fmtMoney(extra),fmtMoney(deduct),fmtMoney(net),note]);
  }
  var csv='\ufeff'; /* BOM for Excel */
  rows.forEach(function(row){
    csv+=row.map(function(c){
      var s=String(c==null?'':c);
      if(s.indexOf(',')>=0||s.indexOf('"')>=0||s.indexOf('\n')>=0){
        s='"'+s.replace(/"/g,'""')+'"';
      }
      return s;
    }).join(',')+'\r\n';
  });
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;
  a.download='PURE-'+y+String(m).padStart(2,'0')+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  showToast('CSV 已导出');
}

/* ============================================================
   月度对比
   ============================================================ */
function openCompareModal(){
  if(!el.compareModal) return;
  if(!state.year||!state.month){ showToast('请先选择年月',true); return; }
  var y=state.year, m=state.month;
  var pm=m-1, py=y;
  if(pm<1){ pm=12; py=y-1; }
  var cur=calcMonthTotal(y,m);
  var prev=(py>=MIN_YEAR)?calcMonthTotal(py,pm):{income:0,expense:0,days:0,pay:0,meal:0};

  el.compareTitle.textContent=y+'年'+m+'月 vs '+(pm===12?py:y)+'年'+pm+'月';

  function row(label,c,p,higherBetter){
    var diff=c-p;
    var cls='flat', sym='—';
    if(Math.abs(diff)<0.01){ cls='flat'; sym='—'; }
    else if(diff>0){ cls=higherBetter?'up':'down'; sym='+¥'+fmtMoney(diff); }
    else{ cls=higherBetter?'down':'up'; sym='-¥'+fmtMoney(Math.abs(diff)); }
    var cText=state.moneyHidden?'****':'¥'+fmtMoney(c);
    var pText=state.moneyHidden?'****':'¥'+fmtMoney(p);
    return '<div class="compare-row">'
      +'<div class="cr-label">'+label+'</div>'
      +'<div class="cr-cur">'+cText+'</div>'
      +'<div class="cr-prev">'+pText+'</div>'
      +'<div class="cr-diff '+cls+'">'+(state.moneyHidden?'•••':sym)+'</div>'
      +'</div>';
  }

  var html='';
  html+='<div class="compare-row head">'
    +'<div>指标</div><div>本月</div><div>上月</div><div>变化</div>'
    +'</div>';
  html+=row('总收入',cur.income,prev.income,true);
  html+=row('总支出',cur.expense,prev.expense,false);
  html+=row('结余',cur.income-cur.expense,prev.income-prev.expense,true);
  html+='<div class="compare-row">'
    +'<div class="cr-label">记录天数</div>'
    +'<div class="cr-cur">'+cur.days+' 天</div>'
    +'<div class="cr-prev">'+prev.days+' 天</div>'
    +'<div class="cr-diff flat">—</div>'
    +'</div>';

  /* 找最高收入日 / 最高支出日 */
  var n=daysInMonth(y,m);
  var maxInc={d:0,v:0}, maxExp={d:0,v:0};
  for(var d=1;d<=n;d++){
    var k=keyOf(y,m,d);
    var hasData=(y===DBYear?DB[k]:readYearData(y)[k]);
    if(!hasData) continue;
    var day=getDay(y,m,d);
    if(!dayHasRecord(day)) continue;
    var inc=calcPay(day)+calcIncomeTotal(day);
    var exp=calcExpense(day);
    if(inc>maxInc.v){ maxInc={d:d,v:inc}; }
    if(exp>maxExp.v){ maxExp={d:d,v:exp}; }
  }
  if(maxInc.d){
    html+='<div class="compare-row">'
      +'<div class="cr-label">最高收入日</div>'
      +'<div class="cr-cur">'+maxInc.d+'日 '+((state.moneyHidden)?'****':'¥'+fmtMoney(maxInc.v))+'</div>'
      +'<div class="cr-prev">—</div>'
      +'<div class="cr-diff flat">—</div>'
      +'</div>';
  }
  if(maxExp.d){
    html+='<div class="compare-row">'
      +'<div class="cr-label">最高支出日</div>'
      +'<div class="cr-cur">'+maxExp.d+'日 '+((state.moneyHidden)?'****':'¥'+fmtMoney(maxExp.v))+'</div>'
      +'<div class="cr-prev">—</div>'
      +'<div class="cr-diff flat">—</div>'
      +'</div>';
  }

  el.compareTable.innerHTML=html;
  el.compareModal.classList.add('open');
  el.compareModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeCompareModal(){
  if(!el.compareModal) return;
  el.compareModal.classList.remove('open');
  el.compareModal.setAttribute('aria-hidden','true');
  unlockScroll();
}

/* ============================================================
   报表
   ============================================================ */
function openReportModal(){
  if(!el.reportModal) return;
  var y=state.year||new Date().getFullYear();
  var m=state.month||(new Date().getMonth()+1);
  el.reportYear.value=y;
  el.reportYearM.value=y;
  el.reportMonth.value=m;
  setReportMode('year');
  el.reportModal.classList.add('open');
  el.reportModal.setAttribute('aria-hidden','false');
  lockScroll();
}
function closeReportModal(){
  if(!el.reportModal) return;
  el.reportModal.classList.remove('open');
  el.reportModal.setAttribute('aria-hidden','true');
  unlockScroll();
}
function setReportMode(mode){
  el.reportModeSeg.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active',b.dataset.v===mode); });
  el.reportYearField.hidden=mode!=='year';
  el.reportMonthField.hidden=mode!=='month';
  el.reportDesc.textContent=mode==='year'
    ? '年度报表：1-12 月汇总 + 全年智能洞察'
    : '月度报表：每日明细 + 智能分析（工资高于均值=绿，三餐超均值=红）';
}
function exportWord(){
  var active=el.reportModeSeg.querySelector('button.active');
  var mode=active?active.dataset.v:'year';
  var html,filename;
  if(mode==='year'){
    var y=Number(el.reportYear.value)||new Date().getFullYear();
    html=buildYearReport(y);
    filename='PURE年度报表-'+y+'.doc';
  }else{
    var ym=Number(el.reportYearM.value)||new Date().getFullYear();
    var mm=Number(el.reportMonth.value)||1;
    html=buildMonthReport(ym,mm);
    filename='PURE月度报表-'+ym+String(mm).padStart(2,'0')+'.doc';
  }
  var blob=new Blob(['\ufeff',html],{type:'application/msword'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  showToast('智能报表已导出');
  closeReportModal();
}
function buildMonthReport(y,m){
  var n=daysInMonth(y,m);
  var rows='';
  var totalIncome=0,totalExpense=0,days=0,totalMeal=0,totalPay=0;
  var list=[];
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
    if(dayHasRecord(day)){ days++; totalIncome+=income; totalExpense+=exp; totalMeal+=meal; totalPay+=pay; }
    list.push({d:d,pay:pay,inc:inc,meal:meal,extra:extra,exp:exp,income:income});
  }
  var payDays=0,mealDays=0;
  list.forEach(function(x){ if(x.pay>0) payDays++; if(x.meal>0) mealDays++; });
  var avgPay=payDays?totalPay/payDays:0;
  var avgMeal=mealDays?totalMeal/mealDays:0;
  var maxDay=null,minDay=null,maxInc=-1,minExp=Infinity;
  list.forEach(function(x){
    if(x.income>maxInc){ maxInc=x.income; maxDay=x; }
    if(x.exp>0&&x.exp<minExp){ minExp=x.exp; minDay=x; }
  });
  list.forEach(function(x){
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
  var net=Math.round((totalIncome-totalExpense)*100)/100;
  var insights=[];
  insights.push('本月共记录 '+days+' 天，总收入 ¥'+fmtMoney(totalIncome)+'，总支出 ¥'+fmtMoney(totalExpense)+'，结余 ¥'+fmtMoney(net)+'。');
  if(payDays) insights.push('平均工资 ¥'+fmtMoney(avgPay)+'（共 '+payDays+' 天有工资记录）。');
  if(mealDays) insights.push('平均三餐 ¥'+fmtMoney(avgMeal)+'（共 '+mealDays+' 天有三餐记录）。');
  if(maxDay&&maxDay.income>0) insights.push('收入最高的是 '+maxDay.d+' 日，收入 ¥'+fmtMoney(maxDay.income)+'。');
  if(minDay) insights.push('支出最低的是 '+minDay.d+' 日，支出 ¥'+fmtMoney(minDay.exp)+'。');
  if(net<0) insights.push('⚠ 本月结余为负，建议检查支出结构。');
  else if(totalIncome>0&&net/totalIncome>0.5) insights.push('✓ 本月结余率超过 50%，储蓄状况良好。');
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>PURE 月度智能报表</title><style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#222;line-height:1.6}h1{font-size:22px;color:#0a4d8c}h2{font-size:15px;color:#555;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:10px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#e8f4ff;color:#0a4d8c}.sum{margin-top:14px;font-size:14px}.sum b{color:#0a4d8c}.insight{margin-top:16px;padding:12px 16px;background:#f4f8ff;border-left:4px solid #0a4d8c;border-radius:6px;font-size:13px;line-height:1.9}.legend{margin-top:8px;font-size:12px;color:#555}</style></head><body>'
    +'<h1>PURE 月度智能报表</h1>'
    +'<p>月份：'+y+'年'+m+'月（共 '+n+' 天）</p>'
    +'<p>生成时间：'+new Date().toLocaleString('zh-CN')+'</p>'
    +'<h2>每日明细</h2>'
    +'<table><thead><tr><th>日期</th><th>工资</th><th>其他收入</th><th>三餐</th><th>额外支出</th><th>当日结余</th></tr></thead><tbody>'+rows+'</tbody></table>'
    +'<div class="legend">🟢 绿色 = 工资高于有工资日均值（¥'+fmtMoney(avgPay)+'）　🔴 红色 = 三餐高于有三餐日均值（¥'+fmtMoney(avgMeal)+'）</div>'
    +'<div class="sum"><p>本月总收入：<b>¥'+fmtMoney(totalIncome)+'</b></p><p>本月总支出：<b>¥'+fmtMoney(totalExpense)+'</b></p><p>本月结余：<b>¥'+fmtMoney(net)+'</b></p></div>'
    +'<h2>◈ 智能洞察</h2>'
    +'<div class="insight">'+insights.map(function(t){ return '· '+t; }).join('<br>')+'</div>'
    +'<p style="margin-top:24px;color:#888;font-size:11px">本报表由 PURE 自动生成 · 数据仅存于本机</p></body></html>';
}
function buildYearReport(y){
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
    rows+='<tr><td>'+y+'年'+x.m+'月</td><td>'+x.days+' 天</td><td>'+fmtMoney(x.inc)+'</td><td>'+fmtMoney(x.exp)+'</td><td>'+fmtMoney(x.inc-x.exp)+'</td></tr>';
  });
  var net=Math.round((totalIncome-totalExpense)*100)/100;
  var active=monthList.filter(function(x){ return x.days>0; });
  var insights=[];
  if(!active.length){ insights.push('全年暂无记录。'); }
  else{
    insights.push('全年共 '+active.length+' 个月有记录，总收入 ¥'+fmtMoney(totalIncome)+'，总支出 ¥'+fmtMoney(totalExpense)+'，结余 ¥'+fmtMoney(net)+'。');
    var best=active.slice().sort(function(a,b){ return (b.inc-b.exp)-(a.inc-a.exp); })[0];
    var worst=active.slice().sort(function(a,b){ return (a.inc-a.exp)-(b.inc-b.exp); })[0];
    if(best) insights.push('最佳月份：'+best.m+'月，结余 ¥'+fmtMoney(best.inc-best.exp)+'。');
    if(worst&&worst!==best) insights.push('最差月份：'+worst.m+'月，结余 ¥'+fmtMoney(worst.inc-worst.exp)+'。');
    var avgInc=totalIncome/active.length;
    var avgExp=totalExpense/active.length;
    insights.push('月均收入 ¥'+fmtMoney(avgInc)+'，月均支出 ¥'+fmtMoney(avgExp)+'。');
    if(net<0) insights.push('⚠ 全年结余为负，需要调整收支结构。');
    else if(totalIncome>0&&net/totalIncome>0.4) insights.push('✓ 全年储蓄率高于 40%，财务状态稳健。');
  }
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>PURE 年度智能报表</title><style>body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#222;line-height:1.6}h1{font-size:22px;color:#0a4d8c}h2{font-size:15px;color:#555;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:13px;margin-top:10px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#e8f4ff;color:#0a4d8c}.sum{margin-top:14px;font-size:14px}.sum b{color:#0a4d8c}.insight{margin-top:16px;padding:12px 16px;background:#f4f8ff;border-left:4px solid #0a4d8c;border-radius:6px;font-size:13px;line-height:1.9}</style></head><body>'
    +'<h1>PURE 年度智能报表</h1><p>年份：'+y+' 年</p><p>生成时间：'+new Date().toLocaleString('zh-CN')+'</p>'
    +'<h2>月度汇总</h2>'
    +'<table><thead><tr><th>月份</th><th>记录天数</th><th>收入</th><th>支出</th><th>结余</th></tr></thead><tbody>'+rows+'</tbody></table>'
    +'<div class="sum"><p>全年总收入：<b>¥'+fmtMoney(totalIncome)+'</b></p><p>全年总支出：<b>¥'+fmtMoney(totalExpense)+'</b></p><p>全年结余：<b>¥'+fmtMoney(net)+'</b></p></div>'
    +'<h2>◈ 全年智能洞察</h2>'
    +'<div class="insight">'+insights.map(function(t){ return '· '+t; }).join('<br>')+'</div>'
    +'<p style="margin-top:24px;color:#888;font-size:11px">本报表由 PURE 自动生成 · 数据仅存于本机</p></body></html>';
}

/* ============================================================
   键盘自适应
   ============================================================ */
function setupKeyboardAdapt(){
  if(!window.visualViewport||!el.editBody) return;
  var vp=window.visualViewport;
  var baseH=0;
  var update=function(){
    if(!el.editModal||!el.editModal.classList.contains('open')) return;
    var modalH=window.innerHeight - vp.height;
    if(modalH>80){
      /* 键盘弹出 */
      var bodyH=Math.max(180, vp.height - 220);
      el.editBody.style.maxHeight=bodyH+'px';
    }else{
      el.editBody.style.maxHeight='';
    }
  };
  vp.addEventListener('resize',update);
  vp.addEventListener('scroll',update);
}

/* ============================================================
   事件绑定
   ============================================================ */
function bindAll(){
  if(el.loginBtn) el.loginBtn.addEventListener('click',doLogin);
  if(el.loginKey) el.loginKey.addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });

  document.querySelectorAll('.nav-item').forEach(function(item){
    item.addEventListener('click',function(){ switchTab(item.dataset.tab); });
  });

  /* ============ 点击委托 ============ */
  document.addEventListener('click',function(e){

    /* 设置页 */
    if(e.target.closest('#logoutBtn')){ doLogout(); return; }
    if(e.target.closest('#exportBtn')){ exportData(); return; }
    if(e.target.closest('#importBtn')){ importData(); return; }
    if(e.target.closest('#exportEncBtn')){ openEncExportModal(); return; }
    if(e.target.closest('#reportBtn')){ openReportModal(); return; }
    if(e.target.closest('#exportCsvBtn')){ exportCsv(); return; }
    if(e.target.closest('#changeKeyBtn')){ openChangeKeyModal(); return; }
    if(e.target.closest('#clearDataBtn')){ openClearDataModal(); return; }
    if(e.target.closest('#clearDataClose')){ closeClearDataModal(); return; }
    if(e.target.closest('#clearDataConfirm')){ doClearData(); return; }
    if(e.target.closest('#themeBtn')){ toggleTheme(); return; }
    if(e.target.closest('#defaultWageBtn')){
      if(!state.draft){
        var now=new Date();
        state.draft=getDay(state.year||now.getFullYear(),state.month||(now.getMonth()+1),state.day||now.getDate());
      }
      openWageModal();
      return;
    }

    /* 主页 */
    if(e.target.closest('#eyeBtn')){ e.stopPropagation(); toggleMoney(); return; }
    if(e.target.closest('#balanceCard')){ openRangeModal(); return; }

    /* 资金管理 */
    if(e.target.closest('#fundAddBtn')){ openFundModal(-1); return; }
    if(e.target.closest('#fundClose')){ closeFundModal(); return; }
    if(e.target.closest('#fundZeroBtn')){
      state.showZeroFund=!state.showZeroFund;
      renderFunds();
      return;
    }
    if(e.target.closest('#fundConfirm')){
      var name=(el.fundName.value||'').trim();
      var amount=Number(el.fundAmount.value)||0;
      if(!name){ showToast('请输入账户名称',true); return; }
      if(amount<0){ showToast('金额不能为负',true); return; }
      var newAcc={name:name,amount:amount,type:state.fundType};
      if(state.fundEditIndex>=0) fundAccounts[state.fundEditIndex]=newAcc;
      else fundAccounts.push(newAcc);
      fundDirty=true;
      closeFundModal();
      renderFunds();
      showToast('账户已更新，记得点保存');
      return;
    }
    if(e.target.closest('#fundDelete')){
      if(state.fundEditIndex<0) return;
      if(!confirm('确认删除账户「'+fundAccounts[state.fundEditIndex].name+'」？')) return;
      fundAccounts.splice(state.fundEditIndex,1);
      fundDirty=true;
      closeFundModal();
      renderFunds();
      showToast('已删除账户，记得点保存');
      return;
    }
    if(e.target.closest('#fundSaveBtn')){
      saveFunds();
      fundDirty=false;
      renderFunds();
      showToast('保存完成 ✓');
      return;
    }
    var ft=e.target.closest('#fundTypePicker button');
    if(ft){
      state.fundType=ft.dataset.type;
      el.fundTypePicker.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active',b===ft); });
      return;
    }
    var fi=e.target.closest('.fund-item');
    if(fi){ openFundModal(Number(fi.dataset.fundIndex)); return; }

    /* 日期页 */
    if(e.target.closest('#todayBtn')){
      var now=new Date();
      state.year=now.getFullYear(); state.month=now.getMonth()+1; state.day=now.getDate();
      loadDB(state.year);
      state.range={type:'year',year:state.year};
      saveRange();
      updateYMDisplay();
      refreshDateTab();
      refreshBalance();
      renderFunds();
      return;
    }
    if(e.target.closest('#prevMonthBtn')){ shiftMonth(-1); return; }
    if(e.target.closest('#nextMonthBtn')){ shiftMonth(1); return; }
    if(e.target.closest('#yearTrigger')){ openYearModal(); return; }
    if(e.target.closest('#monthTrigger')){ openMonthModal(); return; }
    if(e.target.closest('#yearClose')){ closeYearModal(); return; }
    if(e.target.closest('#yearConfirm')){ confirmYear(); return; }
    if(e.target.closest('#monthClose')){ closeMonthModal(); return; }
    if(e.target.closest('#monthConfirm')){ confirmMonth(); return; }
    if(e.target.closest('#compareBtn')){ openCompareModal(); return; }
    if(e.target.closest('#compareClose')){ closeCompareModal(); return; }
    if(e.target.closest('#compareConfirm')){ closeCompareModal(); return; }

    /* 视图切换 */
    var vs=e.target.closest('#viewSwitch .vs-btn');
    if(vs){
      state.viewMode=vs.dataset.view;
      document.querySelectorAll('#viewSwitch .vs-btn').forEach(function(b){ b.classList.toggle('active',b===vs); });
      renderDays();
      return;
    }

    /* 日期收起 */
    if(e.target.closest('#daysToggle')){
      var collapsed=el.daysBody.hidden;
      el.daysBody.hidden=!collapsed;
      el.daysToggle.textContent=collapsed?'收起 ▴':'展开 ▾';
      state.daysCollapsed=!collapsed;
      return;
    }

    /* 摘要卡 → 编辑 */
    if(e.target.closest('#summaryCard')){
      if(state.year&&state.month&&state.day) openEditModal();
      return;
    }

    /* 编辑弹窗 */
    if(e.target.closest('#editClose')){ closeEditModal(false); return; }
    var et=e.target.closest('#editTabs .tab');
    if(et){ switchTabPanel(et.dataset.tab); return; }
    if(e.target.closest('#resetBtn')){ resetCurrentTab(); return; }
    if(e.target.closest('#saveBtn')){ saveDay(false); return; }
    if(e.target.closest('#saveNextBtn')){ saveDay(true); return; }
    if(e.target.closest('#copyYesterdayBtn')){
      var yest=new Date(state.year,state.month-1,state.day-1);
      var yk=keyOf(yest.getFullYear(),yest.getMonth()+1,yest.getDate());
      var hasY=(yest.getFullYear()===DBYear?DB[yk]:readYearData(yest.getFullYear())[yk]);
      if(!hasY){ showToast('昨天没有记录',true); return; }
      var yd=getDay(yest.getFullYear(),yest.getMonth()+1,yest.getDate());
      MEAL_KEYS.forEach(function(k){
        if(yd.life.meals[k].amount) state.draft.life.meals[k].amount=yd.life.meals[k].amount;
      });
      state.draft.life.extras=JSON.parse(JSON.stringify(yd.life.extras.map(function(x){ return {name:x.name,amount:x.amount,photo:''}; })));
      state.draft.life.incomes=JSON.parse(JSON.stringify(yd.life.incomes.map(function(x){ return {name:x.name,amount:x.amount,photo:''}; })));
      enableLife(); markDirty();
      fillLifeForm();
      refreshPayPreview();
      showToast('已复制昨天的三餐和收支（金额）');
      return;
    }
    if(e.target.closest('#addDeduct')){
      if(!state.draft.work.deducts) state.draft.work.deducts=[];
      state.draft.work.deducts.push({name:'',amount:''});
      enableWork(); markDirty(); renderDeducts();
      return;
    }
    if(e.target.closest('#addExtra')){
      if(!state.draft.life.extras) state.draft.life.extras=[];
      state.draft.life.extras.push({name:'',amount:'',photo:''});
      enableLife(); markDirty(); renderExtras(); renderPhotoBoxes(); updateLifeBalance(); renderFreqChips();
      return;
    }
    if(e.target.closest('#addIncome')){
      if(!state.draft.life.incomes) state.draft.life.incomes=[];
      state.draft.life.incomes.push({name:'',amount:'',photo:''});
      enableLife(); markDirty(); renderIncomes(); renderPhotoBoxes(); updateLifeBalance(); renderFreqChips();
      return;
    }
    if(e.target.closest('#addBreak')){
      if(!state.draft.work.breaks) state.draft.work.breaks=[];
      var idx=state.draft.work.breaks.length;
      var nb={start:'12:00',end:'13:00'};
      state.draft.work.breaks.push(nb);
      if(idx===0) el.breakList.innerHTML='';
      appendBreakRow(nb,idx);
      enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview();
      return;
    }

    /* 工资模板 */
    if(e.target.closest('#payBlock')){
      if(state.draft&&state.draft.work.enabled&&!state.draft.work.rest) openWageModal();
      return;
    }
    if(e.target.closest('#wageClose')){ closeWageModal(); return; }
    var wm=e.target.closest('#wageModeSeg button');
    if(wm){
      wageDraft.mode=wm.dataset.v;
      el.wageModeSeg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active',x===wm); });
      el.fieldHourly.hidden=wageDraft.mode!=='hourly';
      el.fieldDaily.hidden=wageDraft.mode!=='daily';
      el.fieldBase.hidden=wageDraft.mode!=='base';
      el.fieldMonthly.hidden=wageDraft.mode!=='monthly';
      el.fieldPiece.hidden=wageDraft.mode!=='piece';
      el.fieldCommission.hidden=wageDraft.mode!=='commission';
      updateWagePreview();
      return;
    }
    if(e.target.closest('#addAllow')){
      wageDraft.allowances.push({name:'',amount:'',freq:'daily'});
      renderAllowances(); updateWagePreview();
      return;
    }
    if(e.target.closest('#wageConfirmOnly')){
      state.draft.work.wage=collectWage();
      enableWork(); closeWageModal(); markDirty(); refreshPayPreview();
      showToast('工资模板已更新（仅本日）');
      return;
    }
    if(e.target.closest('#wageConfirm')){
      var w=collectWage();
      state.draft.work.wage=w;
      saveDefaultWage(w);
      enableWork(); closeWageModal(); markDirty(); refreshPayPreview();
      refreshDefaultWageSub();
      showToast('已更新并设为默认模板');
      return;
    }

    /* 智能分析 */
    if(e.target.closest('#analysisReset')){
      state.analysisMode=null;
      if(el.analysisTip){ el.analysisTip.textContent='点击上方按钮，高亮当月对应日期'; el.analysisTip.classList.remove('active'); }
      document.querySelectorAll('.analysis-item').forEach(function(x){ x.classList.remove('active'); });
      applyAnalysisHighlight();
      return;
    }
    var ai=e.target.closest('.analysis-item');
    if(ai){
      if(!state.year||!state.month){ showToast('请先选择年月',true); return; }
      var mode=ai.dataset.mode;
      if(state.analysisMode===mode){
        state.analysisMode=null; ai.classList.remove('active');
        if(el.analysisTip){ el.analysisTip.textContent='已取消高亮'; el.analysisTip.classList.remove('active'); }
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
    if(e.target.closest('#analysisPanelToggle')){
      state.panelOpen=!state.panelOpen;
      el.analysisPanelBody.hidden=!state.panelOpen;
      el.analysisPanelIcon.textContent=state.panelOpen?'▴':'▾';
      if(state.panelOpen) renderAnalysisPanel();
      return;
    }

    /* 报表弹窗 */
    if(e.target.closest('#reportClose')){ closeReportModal(); return; }
    var rmb=e.target.closest('#reportModeSeg button');
    if(rmb){ setReportMode(rmb.dataset.v); return; }
    if(e.target.closest('#reportConfirm')){ exportWord(); return; }

    /* 范围弹窗 */
    if(e.target.closest('#rangeClose')){ closeRangeModal(); return; }
    var rt=e.target.closest('.range-tab');
    if(rt){
      var type=rt.dataset.range;
      el.rangeTabs.forEach(function(x){ x.classList.toggle('active',x===rt); });
      el.rangePanelAll.hidden=type!=='all';
      el.rangePanelWeek.hidden=type!=='week';
      el.rangePanelYear.hidden=type!=='year';
      el.rangePanelCust.hidden=type!=='custom';
      if(type==='all'){ rangeDraft={type:'all'}; }
      else if(type==='week'){ rangeDraft={type:'week'}; }
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
      }else if(rangeDraft.type==='week'){
        state.range={type:'week'};
      }else{
        state.range={type:'all'};
      }
      saveRange();
      closeRangeModal();
      refreshBalance();
      renderFunds();
      renderBalanceCompare();
      showToast('已切换到：'+rangeLabel(state.range));
      return;
    }

    /* 加密 */
    if(e.target.closest('#encExportClose')){ closeEncExportModal(); return; }
    if(e.target.closest('#encExportConfirm')){ doEncryptedExport(); return; }
    if(e.target.closest('#encImportClose')){ closeEncImportModal(); return; }
    if(e.target.closest('#encImportConfirm')){ doEncryptedImport(); return; }

    /* 修改密钥 */
    if(e.target.closest('#changeKeyClose')){ closeChangeKeyModal(); return; }
    if(e.target.closest('#changeKeyConfirm')){ doChangeKey(); return; }

    /* 点击背景关闭 */
    if(e.target.classList.contains('modal')){
      var id=e.target.id;
      if(id==='fundModal') closeFundModal();
      else if(id==='wageModal') closeWageModal();
      else if(id==='rangeModal') closeRangeModal();
      else if(id==='reportModal') closeReportModal();
      else if(id==='yearModal') closeYearModal();
      else if(id==='monthModal') closeMonthModal();
      else if(id==='editModal') closeEditModal(false);
      else if(id==='encExportModal') closeEncExportModal();
      else if(id==='encImportModal') closeEncImportModal();
      else if(id==='changeKeyModal') closeChangeKeyModal();
      else if(id==='compareModal') closeCompareModal();
      else if(id==='clearDataModal') closeClearDataModal();
      return;
    }

    /* 照片 */
    var rm=e.target.closest('.photo-remove');
    if(rm){
      e.preventDefault(); e.stopPropagation();
      var box=rm.closest('.photo-box');
      if(box) clearPhoto(box);
      return;
    }
    var pb=e.target.closest('.photo-box');
    if(pb&&state.draft){
      e.preventDefault();
      var kind=pb.dataset.kind;
      if(!kind) return;
      if(kind==='meal') pickPhoto({kind:'meal',key:pb.dataset.key});
      else if(kind==='extra') pickPhoto({kind:'extra',index:Number(pb.dataset.index)});
      else if(kind==='income') pickPhoto({kind:'income',index:Number(pb.dataset.index)});
      return;
    }
  },false);

  /* ============ 输入事件 ============ */
  document.addEventListener('input',function(e){
    var t=e.target;
    if(!state.draft) return;

    if(t.id==='locInput'){ state.draft.work.location=t.value; enableWork(); updateLocBadge(); markDirty(); return; }
    if(t.id==='dayNote'){ state.draft.work.note=t.value; markDirty(); return; }
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
      }else if(parent===el.deductList&&state.draft.work.deducts[idx]){
        if(isName) state.draft.work.deducts[idx].name=t.value;
        else state.draft.work.deducts[idx].amount=t.value;
        enableWork(); markDirty();
        if(!isName){ updateDeductBadge(); refreshPayPreview(); }
      }
      return;
    }
    if(t.id==='hourlyRate'||t.id==='dailyRate'||t.id==='baseSalary'||t.id==='monthDays'||t.id==='stdHours'
       ||t.id==='monthlySalary'||t.id==='monthWorkDays'||t.id==='pieceRate'||t.id==='commissionSales'||t.id==='commissionRate'){
      wageDraft.hourlyRate=el.hourlyRate.value;
      wageDraft.dailyRate=el.dailyRate.value;
      wageDraft.baseSalary=el.baseSalary.value;
      wageDraft.monthDays=el.monthDays.value;
      wageDraft.stdHours=el.stdHours.value;
      wageDraft.monthlySalary=el.monthlySalary.value;
      wageDraft.monthWorkDays=el.monthWorkDays.value;
      wageDraft.pieceRate=el.pieceRate.value;
      wageDraft.commissionSales=el.commissionSales.value;
      wageDraft.commissionRate=el.commissionRate.value;
      updateWagePreview();
      return;
    }
  },false);

  /* ============ change 事件 ============ */
  document.addEventListener('change',function(e){
    var t=e.target;
    if(!state.draft) return;
    if(t.id==='startTime'){ state.draft.work.start=t.value; enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview(); return; }
    if(t.id==='endTime'){ state.draft.work.end=t.value; enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview(); return; }
    if(t.id==='restToggle'){
      state.draft.work.rest=t.checked;
      if(t.checked) state.draft.work.enabled=true;
      updateRestState(); updateHoursBadge(); updateTimeSummary(); updatePayBlockState(); refreshPayPreview(); markDirty();
      return;
    }
    if(t.id==='overtimeToggle'){
      state.draft.work.overtime.enabled=t.checked;
      if(el.overtimeFields) el.overtimeFields.hidden=!t.checked;
      markDirty(); refreshPayPreview();
      return;
    }
    if(t.id==='overtimeHours'){ state.draft.work.overtime.hours=t.value; markDirty(); refreshPayPreview(); return; }
    if(t.id==='overtimeRate'){ state.draft.work.overtime.rate=Number(t.value)||1.5; markDirty(); refreshPayPreview(); return; }
    if(t.id==='rangeStart'&&rangeDraft){ rangeDraft.type='custom'; rangeDraft.start=t.value; updateRangePreview(); return; }
    if(t.id==='rangeEnd'&&rangeDraft){ rangeDraft.type='custom'; rangeDraft.end=t.value; updateRangePreview(); return; }
  },false);

  /* ============ 班次 ============ */
  document.addEventListener('click',function(e){
    var b=e.target.closest('#shiftSeg button');
    if(!b||!state.draft) return;
    var v=b.dataset.v;
    state.draft.work.shift=v;
    el.shiftSeg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active',x===b); });
    var toN=v==='夜班'&&state.draft.work.start===DEFAULT_START&&state.draft.work.end===DEFAULT_END;
    var toD=v==='白班'&&state.draft.work.start===NIGHT_START&&state.draft.work.end===NIGHT_END;
    if(toN){ state.draft.work.start=NIGHT_START; state.draft.work.end=NIGHT_END; el.startTime.value=NIGHT_START; el.endTime.value=NIGHT_END; }
    else if(toD){ state.draft.work.start=DEFAULT_START; state.draft.work.end=DEFAULT_END; el.startTime.value=DEFAULT_START; el.endTime.value=DEFAULT_END; }
    enableWork(); markDirty(); updateHoursBadge(); updateTimeSummary(); refreshPayPreview();
  },false);

  /* ============ 照片上传 ============ */
  if(el.photoInput) el.photoInput.addEventListener('change',async function(ev){
    var f=ev.target.files&&ev.target.files[0];
    if(!f||!photoTarget){ photoTarget=null; return; }
    showToast('正在处理照片…');
    try{
      var url=await compressImage(f,680,0.6);
      applyPhoto(photoTarget,url);
      showToast('照片已添加');
    }catch(err){ showToast(err.message||'处理失败',true); }
    photoTarget=null;
  });

  /* ============ ESC ============ */
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      if(el.editModal&&el.editModal.classList.contains('open')) closeEditModal(false);
      else if(el.wageModal&&el.wageModal.classList.contains('open')) closeWageModal();
      else if(el.rangeModal&&el.rangeModal.classList.contains('open')) closeRangeModal();
      else if(el.reportModal&&el.reportModal.classList.contains('open')) closeReportModal();
      else if(el.fundModal&&el.fundModal.classList.contains('open')) closeFundModal();
      else if(el.yearModal&&el.yearModal.classList.contains('open')) closeYearModal();
      else if(el.monthModal&&el.monthModal.classList.contains('open')) closeMonthModal();
      else if(el.encExportModal&&el.encExportModal.classList.contains('open')) closeEncExportModal();
      else if(el.encImportModal&&el.encImportModal.classList.contains('open')) closeEncImportModal();
      else if(el.changeKeyModal&&el.changeKeyModal.classList.contains('open')) closeChangeKeyModal();
      else if(el.compareModal&&el.compareModal.classList.contains('open')) closeCompareModal();
      else if(el.clearDataModal&&el.clearDataModal.classList.contains('open')) closeClearDataModal();
    }
  });

  var resizeTimer=null;
  window.addEventListener('resize',function(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(function(){ if(state.currentTab==='home') drawTrend(); },200);
  });

  setupKeyboardAdapt();
}

/* ============================================================
   星空
   ============================================================ */
function initStars(){
  var box=el.loginStars;
  if(!box) return;
  var frag=document.createDocumentFragment();
  for(var i=0;i<60;i++){
    var s=document.createElement('span');
    s.className='star';
    var size=Math.random()*1.8+0.5;
    s.style.width=size+'px';
    s.style.height=size+'px';
    s.style.left=(Math.random()*100)+'%';
    s.style.top=(Math.random()*100)+'%';
    s.style.animationDuration=(2.8+Math.random()*4)+'s';
    s.style.animationDelay=(-Math.random()*7)+'s';
    frag.appendChild(s);
  }
  box.appendChild(frag);
}

/* ============================================================
   启动
   ============================================================ */
async function init(){
  try{
    cacheEls();
    initStars();
    loadTheme();
    await initAccessKey();
    bindAll();
    var s=getSession();
    if(s){
      var raw='';
      try{ raw=localStorage.getItem(KEYS.accessKey)||''; }catch(e){}
      currentKeyHash=raw.substring(0,16);
      showApp();
      enterHome();
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

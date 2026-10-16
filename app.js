/* ============================================================
   聚神阁 · 应用逻辑 v3.0.0
   中性靛蓝 + 玻璃拟态 + 完整功能
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     常量 & 默认账号
     ============================================================ */
  const DEFAULT_ACCOUNT = {
    username: 'admin',
    password: 'jsg@1234'
  };

  const STORAGE_KEY = 'jsg_data_v3';
  const SESSION_KEY = 'jsg_session_v3';
  const ACCOUNT_KEY = 'jsg_account_v3';
  const SETTINGS_KEY = 'jsg_settings_v3';
  const ENCRYPT_CHECK_KEY = 'jsg_encrypted_v3';

  const STATUS_META = {
    pending: { text: '待开始', cls: 'gray' },
    ongoing: { text: '进行中', cls: 'gold' },
    done:    { text: '已完成', cls: 'green' }
  };

  const PAGE_TITLES = {
    home: '首页概览',
    stats: '数据统计',
    funds: '资金管理',
    tasks: '任务中心',
    messages: '消息通知',
    calendar: '日历视图',
    settings: '系统设置',
    data: '数据管理',
    report: '报表管理'
  };

  /* ============================================================
     全局状态
     ============================================================ */
  let ACCOUNT = { ...DEFAULT_ACCOUNT };
  let FUND_RECORDS = [];
  let TASKS = [];
  let COUNTDOWNS = [
    { id: 1, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
    { id: 2, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
    { id: 3, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
    { id: 4, title: '点击设置', date: '2025-12-31', note: '点击可修改' }
  ];
  let ACTION_LOGS = [];
  let MESSAGES = [];
  let BASE_DEPOSIT = 0;
  let AVATAR = null;
  let FOCUS = { mode: 'auto', manual: '' };
  let SETTINGS = {
    theme: 'dark',
    tabBarMode: 'auto',
    autoLock: true,
    encrypt: false,
    warnExpense: null,
    warnDeposit: null,
    monthlyBudget: null
  };

  let currentFile = null;
  let reportFile = null;
  let selectedYear = null;
  let selectedMonth = null;

  let taskFilter = 'all';
  let taskSearchText = '';
  let fundSearchText = '';
  let fundTypeFilter = 'all';
  let fundRangeMin = null;
  let fundRangeMax = null;
  let fundDateFrom = null;
  let fundDateTo = null;
  let msgFilter = 'all';

  let statsPeriod = 'today';
  let calendarYear = new Date().getFullYear();
  let calendarMonth = new Date().getMonth();
  let calendarSelectedDate = null;

  let editingFundIndex = -1;
  let editingTaskActionIndex = -1;
  let editingTaskIndex = -1;
  let editingStatus = 'pending';
  let editingProgress = 0;
  let editingCountdownIndex = -1;
  let tempAvatarData = null;

  let lastActiveTime = Date.now();
  let lockCheckTimer = null;
  let lastFocusCardClick = 0;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const loginScreen = $('#loginScreen');
  const app = $('#app');
  const sidebar = $('#sidebar');
  const overlay = $('#overlay');
  const content = $('#content');
  const mainEl = $('#main');

  /* ============================================================
     工具函数
     ============================================================ */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function formatDateTime(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fileTimestamp() {
    const d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function isSameDay(timeStr, target) {
    const d = new Date(String(timeStr).replace(/-/g, '/').replace('T', ' '));
    if (isNaN(d.getTime())) return false;
    return d.getFullYear() === target.getFullYear() &&
           d.getMonth() === target.getMonth() &&
           d.getDate() === target.getDate();
  }

  function isToday(timeStr) { return isSameDay(timeStr, new Date()); }

  function isYesterday(timeStr) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return isSameDay(timeStr, y);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toLocalDateTimeInput(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
           'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function parseDateTimeInput(str) {
    if (!str) return new Date();
    return new Date(str.replace('T', ' ') + ':00');
  }

  /* ============================================================
     Toast
     ============================================================ */
  let toastTimer = null;
  function showToast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ============================================================
     通知条
     ============================================================ */
  let notifyTimer = null;
  function showNotify(msg) {
    const bar = $('#notifyBar');
    const text = $('#notifyText');
    if (!bar || !text) return;
    text.textContent = msg;
    bar.classList.add('show');
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(function () { bar.classList.remove('show'); }, 5000);
  }

  const notifyCloseBtn = $('#notifyClose');
  if (notifyCloseBtn) {
    notifyCloseBtn.addEventListener('click', function () {
      $('#notifyBar').classList.remove('show');
    });
  }

  /* ============================================================
     通用确认弹窗
     ============================================================ */
  let confirmResolve = null;

  function showConfirm(title, message) {
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      $('#confirmTitle').textContent = title || '确认操作';
      $('#confirmMessage').textContent = message || '确定要执行此操作吗？';
      openModal('confirmModal');
    });
  }

  $('#confirmOkBtn').addEventListener('click', function () {
    closeModal('confirmModal');
    if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
  });

  $('#confirmCancelBtn').addEventListener('click', function () {
    closeModal('confirmModal');
    if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
  });

  /* ============================================================
     数据加密（可选）
     ============================================================ */
  function simpleEncrypt(text, password) {
    if (!password) return text;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
  }

  function simpleDecrypt(cipher, password) {
    if (!password) return cipher;
    try {
      const text = decodeURIComponent(escape(atob(cipher)));
      let result = '';
      for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
      }
      return result;
    } catch (e) {
      return null;
    }
  }

  function getEncryptPassword() {
    return sessionStorage.getItem('jsg_encrypt_pwd') || '';
  }

  /* ============================================================
     持久化
     ============================================================ */
  function saveAll() {
    const data = {
      account: ACCOUNT,
      fundRecords: FUND_RECORDS,
      tasks: TASKS,
      countdowns: COUNTDOWNS,
      actionLogs: ACTION_LOGS,
      messages: MESSAGES,
      baseDeposit: BASE_DEPOSIT,
      avatar: AVATAR,
      focus: FOCUS,
      settings: SETTINGS,
      lastSave: formatDateTime(new Date())
    };

    const json = JSON.stringify(data);
    const pwd = SETTINGS.encrypt ? getEncryptPassword() : '';

    try {
      if (SETTINGS.encrypt && pwd) {
        localStorage.setItem(STORAGE_KEY, simpleEncrypt(json, pwd));
        localStorage.setItem(ENCRYPT_CHECK_KEY, '1');
      } else {
        localStorage.setItem(STORAGE_KEY, json);
        localStorage.removeItem(ENCRYPT_CHECK_KEY);
      }
    } catch (e) {
      console.error('保存失败', e);
    }
  }

  function loadAll() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;

    let json = raw;
    if (localStorage.getItem(ENCRYPT_CHECK_KEY) === '1') {
      const pwd = getEncryptPassword();
      if (!pwd) {
        window.__needDecryptPwd = true;
        return false;
      }
      json = simpleDecrypt(raw, pwd);
      if (!json) {
        window.__needDecryptPwd = true;
        return false;
      }
    }

    try {
      const data = JSON.parse(json);
      ACCOUNT = data.account || { ...DEFAULT_ACCOUNT };
      FUND_RECORDS = data.fundRecords || [];
      TASKS = data.tasks || [];
      COUNTDOWNS = data.countdowns || COUNTDOWNS;
      ACTION_LOGS = data.actionLogs || [];
      MESSAGES = data.messages || [];
      BASE_DEPOSIT = typeof data.baseDeposit === 'number' ? data.baseDeposit : 0;
      AVATAR = data.avatar || null;
      FOCUS = data.focus || { mode: 'auto', manual: '' };
      SETTINGS = Object.assign({}, SETTINGS, data.settings || {});
      return true;
    } catch (e) {
      console.error('加载失败', e);
      return true;
    }
  }

  /* ============================================================
     登录 / 退出 / 锁屏
     ============================================================ */
  function refreshAccountUI() {
    $('#displayAccount').textContent = ACCOUNT.username;
    $('#displayPassword').textContent = '••••••••';
    $('#sideUserName').textContent = ACCOUNT.username === 'admin' ? '管理员' : ACCOUNT.username;

    const initial = (ACCOUNT.username || '管').trim().charAt(0).toUpperCase();
    ['sideAvatar', 'topAvatar'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (AVATAR) {
        el.style.backgroundImage = 'url(' + AVATAR + ')';
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = '';
        el.textContent = initial;
      }
    });

    const preview = $('#avatarPreview');
    if (preview) {
      if (AVATAR) {
        preview.style.backgroundImage = 'url(' + AVATAR + ')';
        preview.textContent = '';
      } else {
        preview.style.backgroundImage = '';
        preview.textContent = initial;
      }
    }
  }

  function doLogin() {
    loginScreen.classList.add('hide');
    app.classList.add('active');
    lastActiveTime = Date.now();
    setPage('home');
    buildMessages();
    renderCompare();
    renderTrendChart();
    renderCountdowns();
    renderHomeActivity();
    showToast('欢迎回来，' + ACCOUNT.username);
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const u = $('#username').value.trim();
    const p = $('#password').value;

    if (u === ACCOUNT.username && p === ACCOUNT.password) {
      $('#loginError').classList.remove('show');
      doLogin();
    } else {
      const el = $('#loginError');
      el.textContent = '账号或密码不正确';
      el.classList.add('show');
    }
  });

  ['#username', '#password'].forEach(function (sel) {
    $(sel).addEventListener('input', function () {
      $('#loginError').classList.remove('show');
    });
  });

  $('#eyeBtn').addEventListener('click', function () {
    const pwd = $('#password');
    const isPwd = pwd.type === 'password';
    pwd.type = isPwd ? 'text' : 'password';
    this.style.color = isPwd ? 'var(--accent-l)' : '';
  });

  $('#logoutBtn').addEventListener('click', async function () {
    const ok = await showConfirm('退出登录', '确定要退出吗？');
    if (!ok) return;
    app.classList.remove('active');
    closeSidebar();
    loginScreen.classList.remove('hide');
    $('#loginForm').reset();
    $('#loginError').classList.remove('show');
    $('#username').value = '';
    $('#password').value = '';
    logAction('退出登录');
    saveAll();
  });

  function checkAutoLock() {
    if (!SETTINGS.autoLock) return;
    if (!app.classList.contains('active')) return;
    const idle = Date.now() - lastActiveTime;
    if (idle > 30 * 60 * 1000) {
      app.classList.remove('active');
      closeSidebar();
      loginScreen.classList.remove('hide');
      $('#loginForm').reset();
      $('#username').value = '';
      $('#password').value = '';
      showToast('已自动锁定，请重新登录');
    }
  }

  ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      lastActiveTime = Date.now();
    }, { passive: true });
  });

  lockCheckTimer = setInterval(checkAutoLock, 60 * 1000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      checkAutoLock();
    }
  });

  /* ============================================================
     操作日志
     ============================================================ */
  function logAction(text) {
    ACTION_LOGS.unshift({ time: formatDateTime(new Date()), text: text });
    if (ACTION_LOGS.length > 50) ACTION_LOGS.length = 50;
    renderHomeActivity();
    saveAll();
  }

  /* ============================================================
     资金
     ============================================================ */
  function calcTotalDeposit() {
    let balance = BASE_DEPOSIT;
    FUND_RECORDS.forEach(function (r) {
      if (r.type === 'in') balance += Number(r.amount);
      else balance -= Number(r.amount);
    });
    return Math.round(balance * 100) / 100;
  }

  function calcTodayExpense() {
    return FUND_RECORDS
      .filter(function (item) { return item.type === 'out' && isToday(item.time); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
  }

  function calcTodayIncome() {
    return FUND_RECORDS
      .filter(function (item) { return item.type === 'in' && isToday(item.time); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
  }

  function calcMonthExpense(year, month) {
    return FUND_RECORDS
      .filter(function (item) {
        if (item.type !== 'out') return false;
        const d = new Date(String(item.time).replace(/-/g, '/').replace('T', ' '));
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
  }

  function calcMonthIncome(year, month) {
    return FUND_RECORDS
      .filter(function (item) {
        if (item.type !== 'in') return false;
        const d = new Date(String(item.time).replace(/-/g, '/').replace('T', ' '));
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
  }

  function renderFundList() {
    const listEl = $('#fundList');
    if (!listEl) return;

    const filtered = FUND_RECORDS.filter(function (r) {
      if (fundSearchText) {
        const t = fundSearchText.toLowerCase();
        if (r.title.toLowerCase().indexOf(t) < 0 && r.desc.toLowerCase().indexOf(t) < 0) return false;
      }
      if (fundTypeFilter !== 'all' && r.type !== fundTypeFilter) return false;
      if (fundRangeMin != null && Number(r.amount) < fundRangeMin) return false;
      if (fundRangeMax != null && Number(r.amount) > fundRangeMax) return false;
      if (fundDateFrom || fundDateTo) {
        const d = new Date(String(r.time).replace(/-/g, '/').replace('T', ' '));
        if (fundDateFrom) {
          const from = new Date(fundDateFrom + ' 00:00:00');
          if (d < from) return false;
        }
        if (fundDateTo) {
          const to = new Date(fundDateTo + ' 23:59:59');
          if (d > to) return false;
        }
      }
      return true;
    });

    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-tip">' +
        (FUND_RECORDS.length === 0 ? '暂无资金记录<br>点击下方按钮开始记账' : '没有匹配的记录') +
        '</div>';
    } else {
      listEl.innerHTML = filtered.map(function (item) {
        const origIdx = FUND_RECORDS.indexOf(item);
        const isIn = item.type === 'in';
        const avatarChar = isIn ? '入' : '出';
        const avatarStyle = isIn
          ? 'color:#5ecb99; background:rgba(94,203,153,.14); border:1px solid rgba(94,203,153,.25)'
          : 'color:#e07a7a; background:rgba(224,122,122,.12); border:1px solid rgba(224,122,122,.25)';
        const amountText = (isIn ? '+ ' : '- ') + '¥' + Number(item.amount).toLocaleString('zh-CN');
        const badgeClass = isIn ? 'green' : 'gray';

        return (
          '<div class="row">' +
            '<div class="avatar-sm" style="' + avatarStyle + '">' + avatarChar + '</div>' +
            '<div class="row-main">' +
              '<strong>' + escapeHtml(item.title) + '</strong>' +
              '<span>' + escapeHtml(item.desc) + ' · ' + item.time + '</span>' +
            '</div>' +
            '<span class="badge ' + badgeClass + '">' + amountText + '</span>' +
            '<button class="row-more-btn" data-fund-index="' + origIdx + '" aria-label="更多">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>' +
              '</svg>' +
            '</button>' +
          '</div>'
        );
      }).join('');
    }

    const countEl = $('#fundCount');
    if (countEl) countEl.textContent = FUND_RECORDS.length;
  }

  function renderFundStats() {
    const total = calcTotalDeposit();
    const el = $('#totalDepositValue');
    if (el) el.textContent = total.toLocaleString('zh-CN');

    const todayEl = $('#todayExpense');
    if (todayEl) todayEl.textContent = calcTodayExpense().toLocaleString('zh-CN');

    const incomeEl = $('#todayIncome');
    if (incomeEl) incomeEl.textContent = calcTodayIncome().toLocaleString('zh-CN');
  }

  function renderTrendChart() {
    const chart = $('#trendChart');
    if (!chart) return;

    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({
        date: d,
        label: (d.getMonth() + 1) + '/' + d.getDate(),
        balance: BASE_DEPOSIT
      });
    }

    const sorted = FUND_RECORDS.slice().sort(function (a, b) {
      return new Date(a.time.replace(/-/g, '/').replace('T', ' ')) -
             new Date(b.time.replace(/-/g, '/').replace('T', ' '));
    });

    days.forEach(function (day) {
      const endOfDay = new Date(day.date);
      endOfDay.setHours(23, 59, 59, 999);
      let balance = BASE_DEPOSIT;
      sorted.forEach(function (r) {
        const t = new Date(r.time.replace(/-/g, '/').replace('T', ' '));
        if (t <= endOfDay) {
          if (r.type === 'in') balance += Number(r.amount);
          else balance -= Number(r.amount);
        }
      });
      day.balance = balance;
    });

    const allZero = days.every(function (d) { return d.balance === 0; });
    if (allZero) {
      chart.innerHTML = '<div class="chart-empty" style="height:140px">暂无余额数据</div>';
      return;
    }

    const maxBal = Math.max.apply(null, days.map(function (d) { return d.balance; }));
    const minBal = Math.min.apply(null, days.map(function (d) { return d.balance; }));
    const range = (maxBal - minBal) || 1;

    chart.innerHTML = days.map(function (d) {
      const pct = 15 + ((d.balance - minBal) / range) * 75;
      return (
        '<div class="trend-col">' +
          '<span class="trend-val">' + (d.balance / 1000).toFixed(1) + 'k</span>' +
          '<div class="trend-bar" style="height:' + pct + '%"></div>' +
          '<span class="trend-label">' + d.label + '</span>' +
        '</div>'
      );
    }).join('');
  }

  /* ============================================================
     任务
     ============================================================ */
  function renderTaskList() {
    const listEl = $('#taskList');
    if (!listEl) return;

    let filtered = TASKS;
    if (taskFilter !== 'all') {
      filtered = filtered.filter(function (t) { return t.status === taskFilter; });
    }
    if (taskSearchText) {
      const t = taskSearchText.toLowerCase();
      filtered = filtered.filter(function (task) {
        return task.name.toLowerCase().indexOf(t) >= 0 ||
               task.owner.toLowerCase().indexOf(t) >= 0;
      });
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-tip">' +
        (TASKS.length === 0 ? '暂无任务<br>点击下方按钮添加' : '没有匹配的任务') +
        '</div>';
    } else {
      listEl.innerHTML = filtered.map(function (t) {
        const origIdx = TASKS.indexOf(t);
        const meta = STATUS_META[t.status] || STATUS_META.pending;
        const doneCls = t.status === 'done' ? ' done' : '';
        const progress = typeof t.progress === 'number' ? t.progress : (t.status === 'done' ? 100 : 0);
        const progressCls = t.status === 'done' ? 'done' : (t.status === 'pending' ? 'pending' : '');
        return (
          '<div class="task' + doneCls + '" data-task-index="' + origIdx + '">' +
            '<div class="row-main">' +
              '<strong>' + escapeHtml(t.name) + '</strong>' +
              '<span>截止 ' + t.deadline + ' · ' + escapeHtml(t.owner) + '</span>' +
              '<div class="task-progress"><div class="task-progress-inner ' + progressCls + '" style="width:' + progress + '%"></div></div>' +
            '</div>' +
            '<span class="badge ' + meta.cls + '">' + meta.text + '</span>' +
            '<button class="row-more-btn" data-task-more="' + origIdx + '" aria-label="更多">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
                '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>' +
              '</svg>' +
            '</button>' +
          '</div>'
        );
      }).join('');
    }

    const countEl = $('#taskCount');
    if (countEl) countEl.textContent = filtered.length + ' 项';

    const activeCount = TASKS.filter(function (t) { return t.status !== 'done'; }).length;
    ['taskBadgeSide', 'tabTaskBadge'].forEach(function (id) {
      const b = document.getElementById(id);
      if (!b) return;
      b.textContent = activeCount;
      b.style.display = activeCount > 0 ? 'grid' : 'none';
    });
  }

  /* ============================================================
     倒数日
     ============================================================ */
  function renderCountdowns() {
    const grid = $('#countdownGrid');
    if (!grid) return;

    grid.innerHTML = COUNTDOWNS.map(function (item, idx) {
      const target = new Date(item.date.replace(/-/g, '/'));
      const now = new Date();
      const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
      let remain = '', cls = '';
      if (diffDays < 0) { remain = '已过期 ' + Math.abs(diffDays) + ' 天'; cls = 'expired'; }
      else if (diffDays === 0) { remain = '今天'; cls = 'urgent'; }
      else if (diffDays <= 3) { remain = '还剩 ' + diffDays + ' 天'; cls = 'urgent'; }
      else { remain = '还剩 ' + diffDays + ' 天'; }

      return (
        '<div class="glass-card countdown-card ' + cls + '" data-countdown-index="' + idx + '">' +
          '<span class="stat-label">' + escapeHtml(item.title) + '</span>' +
          '<div class="stat-value">' + item.date.slice(5).replace('-', '/') + '</div>' +
          '<span class="stat-delta ' + (cls === 'expired' ? 'down' : (cls === 'urgent' ? 'warn' : '')) + '">' + remain + '</span>' +
        '</div>'
      );
    }).join('');

    grid.querySelectorAll('.countdown-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const idx = parseInt(this.dataset.countdownIndex, 10);
        openCountdownModal(idx);
      });
    });
  }

  /* ============================================================
     今日焦点
     ============================================================ */
  function renderFocus() {
    const el = $('#focusText');
    if (!el) return;

    if (FOCUS.mode === 'manual' && FOCUS.manual) {
      el.textContent = FOCUS.manual;
      return;
    }

    const now = new Date();
    const activeTasks = TASKS.filter(function (t) {
      return t.status !== 'done' && t.deadline;
    });

    if (!activeTasks.length) {
      el.textContent = '今天暂无待办，去添加一个任务吧';
      return;
    }

    activeTasks.sort(function (a, b) {
      return new Date(a.deadline) - new Date(b.deadline);
    });

    const t = activeTasks[0];
    const dl = new Date(t.deadline.replace(/-/g, '/'));
    const diffDays = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      el.textContent = '「' + t.name + '」已逾期 ' + Math.abs(diffDays) + ' 天，请尽快处理';
    } else if (diffDays === 0) {
      el.textContent = '「' + t.name + '」今天截止，记得完成';
    } else if (diffDays === 1) {
      el.textContent = '「' + t.name + '」明天截止';
    } else {
      el.textContent = '「' + t.name + '」将在 ' + diffDays + ' 天后截止';
    }
  }

  /* ============================================================
     最近动态
     ============================================================ */
  function renderHomeActivity() {
    const list = $('#homeActivity');
    if (!list) return;
    if (!ACTION_LOGS.length) {
      list.innerHTML = '<li style="color:var(--dimmer);font-size:12.5px;padding:12px 0">暂无动态</li>';
      return;
    }
    list.innerHTML = ACTION_LOGS.slice(0, 6).map(function (log) {
      return '<li><span class="dot"></span><div><p>' + escapeHtml(log.text) + '</p><time>' + log.time + '</time></div></li>';
    }).join('');
  }

  /* ============================================================
     首页统计
     ============================================================ */
  function renderHomeStats() {
    const total = calcTotalDeposit();
    const homeTotal = $('#homeTotalDeposit');
    if (homeTotal) homeTotal.textContent = '¥ ' + total.toLocaleString('zh-CN');

    const todayExpense = calcTodayExpense();
    const homeToday = $('#homeTodayExpense');
    if (homeToday) homeToday.textContent = '¥ ' + todayExpense.toLocaleString('zh-CN');

    const now = new Date();
    const monthIncome = calcMonthIncome(now.getFullYear(), now.getMonth());
    const monthExpense = calcMonthExpense(now.getFullYear(), now.getMonth());
    const monthBalance = monthIncome - monthExpense;
    const homeBalance = $('#homeMonthBalance');
    if (homeBalance) homeBalance.textContent = '¥ ' + monthBalance.toLocaleString('zh-CN');

    const homeTotalDelta = $('#homeTotalDelta');
    if (homeTotalDelta) {
      homeTotalDelta.textContent = FUND_RECORDS.length > 0 ? '基于 ' + FUND_RECORDS.length + ' 条记录' : '暂无记录';
      homeTotalDelta.classList.toggle('flat', FUND_RECORDS.length === 0);
    }

    const homeMonthDelta = $('#homeMonthDelta');
    if (homeMonthDelta) {
      homeMonthDelta.textContent = '收入 ¥' + monthIncome.toLocaleString('zh-CN') + ' · 支出 ¥' + monthExpense.toLocaleString('zh-CN');
    }

    const homeTodayDelta = $('#homeTodayExpenseDelta');
    if (homeTodayDelta) {
      const yesterday = FUND_RECORDS
        .filter(function (item) { return item.type === 'out' && isYesterday(item.time); })
        .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);
      const diff = todayExpense - yesterday;
      if (diff > 0) {
        homeTodayDelta.textContent = '较昨日 ↑ ¥' + diff.toLocaleString('zh-CN');
        homeTodayDelta.classList.add('down');
        homeTodayDelta.classList.remove('flat');
      } else if (diff < 0) {
        homeTodayDelta.textContent = '较昨日 ↓ ¥' + Math.abs(diff).toLocaleString('zh-CN');
        homeTodayDelta.classList.remove('down');
        homeTodayDelta.classList.remove('flat');
      } else {
        homeTodayDelta.textContent = '与昨日持平';
        homeTodayDelta.classList.add('flat');
        homeTodayDelta.classList.remove('down');
      }
    }

    const totalTasks = TASKS.length;
    const doneTasks = TASKS.filter(function (t) { return t.status === 'done'; }).length;
    const rate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const homeTaskRate = $('#homeTaskRate');
    if (homeTaskRate) homeTaskRate.textContent = rate + '%';
    const homeTaskRateDelta = $('#homeTaskRateDelta');
    if (homeTaskRateDelta) {
      homeTaskRateDelta.textContent = totalTasks > 0 ? doneTasks + ' / ' + totalTasks + ' 项' : '暂无任务';
      homeTaskRateDelta.classList.toggle('flat', totalTasks === 0);
    }
  }

  /* ============================================================
     月度预算
     ============================================================ */
  function renderBudget() {
    const now = new Date();
    const monthExpense = calcMonthExpense(now.getFullYear(), now.getMonth());
    const budget = SETTINGS.monthlyBudget;

    const percent = budget ? Math.min(100, Math.round((monthExpense / budget) * 100)) : 0;
    const barCls = percent >= 100 ? 'danger' : (percent >= 80 ? 'warn' : '');

    ['budgetUsed', 'fundBudgetUsed'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = budget
        ? '¥' + monthExpense.toLocaleString('zh-CN') + ' / ¥' + budget.toLocaleString('zh-CN')
        : '¥' + monthExpense.toLocaleString('zh-CN') + ' / 未设置';
    });

    ['budgetPercent', 'fundBudgetPercent'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = percent + '%';
    });

    ['budgetBar', 'fundBudgetBar'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.width = percent + '%';
      el.classList.remove('warn', 'danger');
      if (barCls) el.classList.add(barCls);
    });

    const hint = $('#budgetHint');
    if (hint) {
      if (!budget) {
        hint.textContent = '去系统设置里设置本月预算';
      } else if (percent >= 100) {
        hint.textContent = '⚠️ 本月预算已超支 ¥' + (monthExpense - budget).toLocaleString('zh-CN');
      } else {
        hint.textContent = '剩余 ¥' + (budget - monthExpense).toLocaleString('zh-CN');
      }
    }
  }

  /* ============================================================
     数据统计
     ============================================================ */
  function getPeriodRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let current = new Date(today);
    let previous = new Date(today);

    if (period === 'today') {
      current = new Date(today);
      previous = new Date(today);
      previous.setDate(previous.getDate() - 1);
    } else if (period === 'week') {
      const dayOfWeek = today.getDay() || 7;
      current = new Date(today);
      current.setDate(today.getDate() - dayOfWeek + 1);
      previous = new Date(current);
      previous.setDate(current.getDate() - 7);
    } else if (period === 'month') {
      current = new Date(today.getFullYear(), today.getMonth(), 1);
      previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    } else if (period === 'year') {
      current = new Date(today.getFullYear(), 0, 1);
      previous = new Date(today.getFullYear() - 1, 0, 1);
    }

    let currentEnd = new Date(current);
    let previousEnd = new Date(previous);

    if (period === 'today') {
      currentEnd = new Date(today);
      previousEnd = new Date(previous);
    } else if (period === 'week') {
      currentEnd = new Date(current);
      currentEnd.setDate(current.getDate() + 6);
      previousEnd = new Date(previous);
      previousEnd.setDate(previous.getDate() + 6);
    } else if (period === 'month') {
      currentEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      previousEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (period === 'year') {
      currentEnd = new Date(today.getFullYear(), 11, 31);
      previousEnd = new Date(today.getFullYear() - 1, 11, 31);
    }

    return { currentStart: current, currentEnd: currentEnd, previousStart: previous, previousEnd: previousEnd };
  }

  function inRange(timeStr, start, end) {
    const d = new Date(String(timeStr).replace(/-/g, '/').replace('T', ' '));
    if (isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  }

  function getCompareData(period) {
    const r = getPeriodRange(period);

    const currentTasks = TASKS.filter(function (t) {
      if (!t.completedAt) return false;
      return inRange(t.completedAt, r.currentStart, r.currentEnd);
    }).length;

    const previousTasks = TASKS.filter(function (t) {
      if (!t.completedAt) return false;
      return inRange(t.completedAt, r.previousStart, r.previousEnd);
    }).length;

    const currentExpense = FUND_RECORDS
      .filter(function (item) { return item.type === 'out' && inRange(item.time, r.currentStart, r.currentEnd); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);

    const previousExpense = FUND_RECORDS
      .filter(function (item) { return item.type === 'out' && inRange(item.time, r.previousStart, r.previousEnd); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);

    const currentIncome = FUND_RECORDS
      .filter(function (item) { return item.type === 'in' && inRange(item.time, r.currentStart, r.currentEnd); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);

    const previousIncome = FUND_RECORDS
      .filter(function (item) { return item.type === 'in' && inRange(item.time, r.previousStart, r.previousEnd); })
      .reduce(function (sum, item) { return sum + Number(item.amount); }, 0);

    return {
      taskCompletion: { current: currentTasks, previous: previousTasks },
      expense: { current: currentExpense, previous: previousExpense },
      income: { current: currentIncome, previous: previousIncome }
    };
  }

  function getPeriodLabel(period) {
    return { today: '今日 vs 昨日', week: '本周 vs 上周', month: '本月 vs 上月', year: '本年 vs 去年' }[period] || '今日 vs 昨日';
  }

  function renderCompare() {
    const data = getCompareData(statsPeriod);

    const periodLabel = $('#periodLabel');
    if (periodLabel) periodLabel.textContent = getPeriodLabel(statsPeriod);

    const compareLabel = $('#compareLabel');
    if (compareLabel) {
      const map = { today: '今日与昨日对比', week: '本周与上周对比', month: '本月与上月对比', year: '本年与去年对比' };
      compareLabel.textContent = map[statsPeriod];
    }

    const chart = $('#compareChart');
    if (chart) {
      const maxVal = Math.max(
        data.taskCompletion.current, data.taskCompletion.previous,
        data.expense.current, data.expense.previous,
        data.income.current, data.income.previous,
        0
      );

      if (maxVal === 0) {
        chart.innerHTML = '<div class="chart-empty">' +
          '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3.4" height="6.5" rx="1.2"/><rect x="10.3" y="7.5" width="3.4" height="11" rx="1.2"/><rect x="15.6" y="3.5" width="3.4" height="15" rx="1.2"/>' +
          '</svg>' +
          '<div>暂无数据，去记一笔吧</div>' +
        '</div>';
      } else {
        const groups = [
          { label: '完成', current: data.taskCompletion.current, previous: data.taskCompletion.previous },
          { label: '消费', current: data.expense.current, previous: data.expense.previous },
          { label: '收入', current: data.income.current, previous: data.income.previous }
        ];
        chart.innerHTML = groups.map(function (g) {
          const hC = Math.round((g.current / maxVal) * 100);
          const hP = Math.round((g.previous / maxVal) * 100);
          return (
            '<div class="compare-group">' +
              '<div class="compare-bar-wrap">' +
                '<span class="compare-bar-value">' + g.current + '</span>' +
                '<div class="compare-bar today" style="height:' + Math.max(hC, 2) + '%"></div>' +
              '</div>' +
              '<div class="compare-bar-wrap">' +
                '<span class="compare-bar-value">' + g.previous + '</span>' +
                '<div class="compare-bar yesterday" style="height:' + Math.max(hP, 2) + '%"></div>' +
              '</div>' +
              '<span class="compare-label">' + g.label + '</span>' +
            '</div>'
          );
        }).join('');
      }
    }

    const list = $('#compareList');
    if (list) {
      const rows = [
        {
          icon: '<path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/>',
          title: '任务完成情况',
          current: data.taskCompletion.current,
          previous: data.taskCompletion.previous,
          unit: '项',
          isMoney: false
        },
        {
          icon: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
          title: '消费',
          current: data.expense.current,
          previous: data.expense.previous,
          unit: '元',
          isMoney: true
        },
        {
          icon: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
          title: '收入',
          current: data.income.current,
          previous: data.income.previous,
          unit: '元',
          isMoney: true
        }
      ];

      const prevLabel = { today: '昨日', week: '上周', month: '上月', year: '去年' }[statsPeriod];
      const currLabel = { today: '今日', week: '本周', month: '本月', year: '本年' }[statsPeriod];

      list.innerHTML = rows.map(function (r) {
        const diff = r.current - r.previous;
        let deltaCls = 'flat', deltaSign = '—';
        if (diff > 0) { deltaCls = 'up'; deltaSign = '↑'; }
        else if (diff < 0) { deltaCls = 'down'; deltaSign = '↓'; }
        const deltaAbs = Math.abs(diff);

        const fmt = function (v) {
          return r.isMoney ? '¥' + v.toLocaleString('zh-CN') : v + ' ' + r.unit;
        };

        return (
          '<div class="compare-row">' +
            '<div class="compare-icon">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
                r.icon +
              '</svg>' +
            '</div>' +
            '<div class="compare-main">' +
              '<strong>' + r.title + '</strong>' +
              '<span class="sub">较' + prevLabel + '</span>' +
            '</div>' +
            '<div class="compare-values">' +
              '<div class="compare-val"><span class="lbl">' + currLabel + '</span><span class="num">' + fmt(r.current) + '</span></div>' +
              '<div class="compare-val"><span class="lbl">' + prevLabel + '</span><span class="num">' + fmt(r.previous) + '</span></div>' +
              '<span class="compare-delta ' + deltaCls + '">' + deltaSign + ' ' + (r.isMoney ? '¥' + deltaAbs.toLocaleString('zh-CN') : deltaAbs + ' ' + r.unit) + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    renderTopLists();
  }

  function renderTopLists() {
    const now = new Date();
    const thisMonth = FUND_RECORDS.filter(function (r) {
      const d = new Date(String(r.time).replace(/-/g, '/').replace('T', ' '));
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });

    const topIncome = thisMonth
      .filter(function (r) { return r.type === 'in'; })
      .sort(function (a, b) { return Number(b.amount) - Number(a.amount); })
      .slice(0, 5);

    const topExpense = thisMonth
      .filter(function (r) { return r.type === 'out'; })
      .sort(function (a, b) { return Number(b.amount) - Number(a.amount); })
      .slice(0, 5);

    const renderTop = function (list, listId) {
      const el = document.getElementById(listId);
      if (!el) return;
      if (!list.length) {
        el.innerHTML = '<div class="empty-tip" style="padding:20px 0;font-size:12.5px">本月暂无记录</div>';
        return;
      }
      const max = Number(list[0].amount) || 1;
      el.innerHTML = list.map(function (r, i) {
        const pct = Math.round((Number(r.amount) / max) * 100);
        return (
          '<div class="compare-row" style="padding:10px 0">' +
            '<div class="compare-icon" style="width:30px;height:30px;border-radius:9px;font-size:12px;font-weight:600;color:var(--accent-l)">' + (i + 1) + '</div>' +
            '<div class="compare-main">' +
              '<strong>' + escapeHtml(r.title) + '</strong>' +
              '<div class="task-progress" style="margin-top:5px">' +
                '<div class="task-progress-inner" style="width:' + pct + '%"></div>' +
              '</div>' +
            '</div>' +
            '<span class="badge ' + (r.type === 'in' ? 'green' : 'gray') + '">' +
              (r.type === 'in' ? '+' : '-') + '¥' + Number(r.amount).toLocaleString('zh-CN') +
            '</span>' +
          '</div>'
        );
      }).join('');
    };

    renderTop(topIncome, 'topIncomeList');
    renderTop(topExpense, 'topExpenseList');
  }

  /* ============================================================
     消息通知
     ============================================================ */
  function buildMessages() {
    const msgs = [];
    const now = new Date();

    TASKS.forEach(function (t) {
      if (t.createdAt && isToday(t.createdAt)) {
        msgs.push({
          type: 'task',
          title: '新任务发布',
          content: '任务「' + t.name + '」已发布，负责人：' + t.owner + '，截止 ' + t.deadline + '。',
          time: t.createdAt,
          unread: true
        });
      }
    });

    TASKS.forEach(function (t) {
      if (t.status === 'done' || !t.deadline) return;
      const dl = new Date(String(t.deadline).replace(/-/g, '/'));
      if (isNaN(dl.getTime())) return;
      const diffDays = Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 3) {
        msgs.push({
          type: 'task',
          title: '任务即将截止',
          content: '任务「' + t.name + '」将在 ' + diffDays + ' 天后截止。',
          time: t.createdAt || formatDateTime(now),
          unread: true
        });
      } else if (diffDays < 0) {
        msgs.push({
          type: 'task',
          title: '任务已逾期',
          content: '任务「' + t.name + '」已逾期 ' + Math.abs(diffDays) + ' 天，请尽快处理。',
          time: t.createdAt || formatDateTime(now),
          unread: true
        });
      }
    });

    const todayExpense = calcTodayExpense();
    if (SETTINGS.warnExpense && todayExpense > SETTINGS.warnExpense) {
      msgs.push({
        type: 'fund',
        title: '今日支出预警',
        content: '今日支出 ¥' + todayExpense.toLocaleString('zh-CN') + '，已超过预警值 ¥' + SETTINGS.warnExpense.toLocaleString('zh-CN') + '。',
        time: formatDateTime(now),
        unread: true
      });
    }

    const total = calcTotalDeposit();
    if (SETTINGS.warnDeposit && total < SETTINGS.warnDeposit) {
      msgs.push({
        type: 'fund',
        title: '存款预警',
        content: '当前总存款 ¥' + total.toLocaleString('zh-CN') + '，已低于预警值 ¥' + SETTINGS.warnDeposit.toLocaleString('zh-CN') + '。',
        time: formatDateTime(now),
        unread: true
      });
    }

    if (SETTINGS.monthlyBudget) {
      const monthExpense = calcMonthExpense(now.getFullYear(), now.getMonth());
      if (monthExpense > SETTINGS.monthlyBudget) {
        msgs.push({
          type: 'fund',
          title: '月度预算超支',
          content: '本月支出 ¥' + monthExpense.toLocaleString('zh-CN') + '，已超预算 ¥' + SETTINGS.monthlyBudget.toLocaleString('zh-CN') + '。',
          time: formatDateTime(now),
          unread: true
        });
      }
    }

    const hasFundToday = FUND_RECORDS.some(function (r) { return isToday(r.time); });
    const hasTaskToday = TASKS.some(function (t) { return (t.createdAt && isToday(t.createdAt)) || (t.deadline && isToday(t.deadline)); });
    if (!hasFundToday && !hasTaskToday && (FUND_RECORDS.length || TASKS.length)) {
      msgs.push({
        type: 'system',
        title: '今日暂无记录',
        content: '今日尚无资金记录与任务更新，记得及时处理阁中事务。',
        time: formatDateTime(now),
        unread: true
      });
    }

    msgs.forEach(function (m) {
      const existing = MESSAGES.find(function (old) {
        return old.title === m.title && old.content === m.content;
      });
      if (existing) m.unread = existing.unread;
    });

    MESSAGES = msgs;
    renderMessages();
  }

  function renderMessages() {
    const listEl = $('#messageList');
    if (!listEl) return;

    let filtered = MESSAGES;
    if (msgFilter === 'unread') filtered = filtered.filter(function (m) { return m.unread; });
    else if (msgFilter === 'task' || msgFilter === 'fund' || msgFilter === 'system') {
      filtered = filtered.filter(function (m) { return m.type === msgFilter; });
    }

    if (!filtered.length) {
      listEl.innerHTML = '<div class="notice-empty">' +
        (MESSAGES.length === 0 ? '暂无消息通知' : '没有匹配的消息') +
        '</div>';
    } else {
      listEl.innerHTML = filtered.map(function (m) {
        const unreadCls = m.unread ? ' unread' : '';
        return (
          '<div class="notice' + unreadCls + '" data-msg-idx="' + MESSAGES.indexOf(m) + '">' +
            '<span class="notice-dot"></span>' +
            '<div class="row-main">' +
              '<strong>' + escapeHtml(m.title) + '</strong>' +
              '<p>' + escapeHtml(m.content) + '</p>' +
              '<time>' + m.time + '</time>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    const unreadCount = MESSAGES.filter(function (m) { return m.unread; }).length;
    ['msgBadgeSide', 'tabMsgBadge'].forEach(function (id) {
      const b = document.getElementById(id);
      if (!b) return;
      b.textContent = unreadCount;
      b.style.display = unreadCount > 0 ? 'grid' : 'none';
    });

    const countLabel = $('#messageCountLabel');
    if (countLabel) countLabel.textContent = MESSAGES.length + ' 条';
  }

  $('#messageList').addEventListener('click', function (e) {
    const notice = e.target.closest('.notice');
    if (!notice) return;
    const idx = parseInt(notice.dataset.msgIdx, 10);
    if (isNaN(idx) || !MESSAGES[idx]) return;
    if (MESSAGES[idx].unread) {
      MESSAGES[idx].unread = false;
      renderMessages();
      saveAll();
    }
  });

  $('#markAllReadBtn').addEventListener('click', function () {
    let changed = false;
    MESSAGES.forEach(function (m) {
      if (m.unread) { m.unread = false; changed = true; }
    });
    renderMessages();
    saveAll();
    showToast(changed ? '已全部标记为已读' : '没有未读消息');
  });

  $('#clearMessagesBtn').addEventListener('click', async function () {
    if (!MESSAGES.length) { showToast('暂无消息'); return; }
    const ok = await showConfirm('清空消息', '确定要清空所有消息历史吗？');
    if (!ok) return;
    MESSAGES = [];
    renderMessages();
    saveAll();
    showToast('消息已清空');
  });

  /* ============================================================
     日历视图
     ============================================================ */
  function renderCalendar() {
    const grid = $('#calendarGrid');
    const title = $('#calTitle');
    if (!grid || !title) return;

    title.textContent = calendarYear + ' 年 ' + (calendarMonth + 1) + ' 月';

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

    const today = new Date();
    const todayStr = formatDate(today);
    const selectedStr = calendarSelectedDate;

    let cells = [];

    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({
        day: daysInPrevMonth - i,
        other: true,
        dateStr: formatDate(new Date(calendarYear, calendarMonth - 1, daysInPrevMonth - i))
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        other: false,
        dateStr: formatDate(new Date(calendarYear, calendarMonth, d))
      });
    }

    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        day: i,
        other: true,
        dateStr: formatDate(new Date(calendarYear, calendarMonth + 1, i))
      });
    }

    grid.innerHTML = cells.map(function (c) {
      const cls = [];
      if (c.other) cls.push('other');
      if (c.dateStr === todayStr) cls.push('today');
      if (c.dateStr === selectedStr) cls.push('selected');

      const hasTask = TASKS.some(function (t) { return t.deadline === c.dateStr; });
      const hasFund = FUND_RECORDS.some(function (r) { return r.time.slice(0, 10) === c.dateStr; });

      let indicators = '';
      if (hasTask || hasFund) {
        indicators = '<div class="dot-indicator">';
        if (hasTask) indicators += '<span class="dot-task"></span>';
        if (hasFund) indicators += '<span class="dot-fund"></span>';
        indicators += '</div>';
      }

      return '<div class="cal-day ' + cls.join(' ') + '" data-date="' + c.dateStr + '">' +
        c.day + indicators +
      '</div>';
    }).join('');

    grid.querySelectorAll('.cal-day').forEach(function (cell) {
      cell.addEventListener('click', function () {
        const dateStr = this.dataset.date;
        calendarSelectedDate = dateStr;
        renderCalendar();
        renderCalendarDetail(dateStr);
      });
    });
  }

  function renderCalendarDetail(dateStr) {
    const detail = $('#calendarDetail');
    const label = $('#calDateLabel');
    if (!detail) return;

    if (!dateStr) {
      if (label) label.textContent = '—';
      detail.innerHTML = '<div class="cal-detail-empty">选择日期查看详情</div>';
      return;
    }

    if (label) label.textContent = dateStr;

    const dayTasks = TASKS.filter(function (t) { return t.deadline === dateStr; });
    const dayFunds = FUND_RECORDS.filter(function (r) { return r.time.slice(0, 10) === dateStr; });

    if (!dayTasks.length && !dayFunds.length) {
      detail.innerHTML = '<div class="cal-detail-empty">当日暂无记录</div>';
      return;
    }

    let html = '';

    if (dayTasks.length) {
      html += '<div class="cal-detail-group">';
      html += '<div class="cal-detail-title">任务 · ' + dayTasks.length + ' 项</div>';
      html += dayTasks.map(function (t) {
        const meta = STATUS_META[t.status] || STATUS_META.pending;
        return '<div class="row"><div class="row-main"><strong>' + escapeHtml(t.name) + '</strong><span>' + escapeHtml(t.owner) + '</span></div><span class="badge ' + meta.cls + '">' + meta.text + '</span></div>';
      }).join('');
      html += '</div>';
    }

    if (dayFunds.length) {
      html += '<div class="cal-detail-group">';
      html += '<div class="cal-detail-title">资金 · ' + dayFunds.length + ' 条</div>';
      html += dayFunds.map(function (r) {
        const isIn = r.type === 'in';
        return '<div class="row"><div class="row-main"><strong>' + escapeHtml(r.title) + '</strong><span>' + r.time.slice(11) + '</span></div><span class="badge ' + (isIn ? 'green' : 'gray') + '">' + (isIn ? '+' : '-') + '¥' + Number(r.amount).toLocaleString('zh-CN') + '</span></div>';
      }).join('');
      html += '</div>';
    }

    detail.innerHTML = html;
  }

  $('#calPrev').addEventListener('click', function () {
    calendarMonth--;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    renderCalendar();
  });

  $('#calNext').addEventListener('click', function () {
    calendarMonth++;
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar();
  });

  /* ============================================================
     弹窗控制
     ============================================================ */
  function openModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('show');
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('show');
  }

  document.querySelectorAll('.modal-mask').forEach(function (mask) {
    mask.addEventListener('click', function (e) {
      if (e.target === mask) mask.classList.remove('show');
    });
  });

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(this.dataset.close); });
  });

  /* ============================================================
     总存款编辑
     ============================================================ */
  $('#totalDeposit').addEventListener('click', function () {
    $('#depositInput').value = calcTotalDeposit();
    openModal('depositModal');
    setTimeout(function () { $('#depositInput').focus(); }, 200);
  });

  $('#depositSaveBtn').addEventListener('click', function () {
    const val = parseFloat($('#depositInput').value);
    if (isNaN(val) || val < 0) { $('#depositInput').focus(); return; }

    let delta = 0;
    FUND_RECORDS.forEach(function (r) {
      if (r.type === 'in') delta += Number(r.amount);
      else delta -= Number(r.amount);
    });
    BASE_DEPOSIT = Math.round((val - delta) * 100) / 100;

    closeModal('depositModal');
    renderFundStats();
    renderHomeStats();
    renderTrendChart();
    renderBudget();
    logAction('修改总存款为 ¥' + val.toLocaleString('zh-CN'));
    showToast('总存款已更新');
  });

  /* ============================================================
     记一笔
     ============================================================ */
  let recordType = 'in';

  document.querySelectorAll('#recordTypeSwitch .type-opt').forEach(function (opt) {
    opt.addEventListener('click', function () {
      document.querySelectorAll('#recordTypeSwitch .type-opt').forEach(function (o) { o.classList.remove('active'); });
      this.classList.add('active');
      recordType = this.dataset.type;
    });
  });

  function openRecordModal() {
    $('#recordModalTitle').textContent = '记一笔';
    $('#recordRemark').value = '';
    $('#recordAmount').value = '';
    $('#recordTime').value = toLocalDateTimeInput(new Date());
    recordType = 'in';
    document.querySelectorAll('#recordTypeSwitch .type-opt').forEach(function (o) {
      o.classList.toggle('active', o.dataset.type === 'in');
    });
    $('#recordSaveBtn').dataset.mode = 'add';
    $('#recordSaveBtn').textContent = '记录';
    openModal('recordModal');
    setTimeout(function () { $('#recordRemark').focus(); }, 200);
  }

  $('#addRecordBtn').addEventListener('click', openRecordModal);

  $('#recordSaveBtn').addEventListener('click', function () {
    const remark = $('#recordRemark').value.trim();
    const amount = parseFloat($('#recordAmount').value);
    const timeStr = $('#recordTime').value;

    if (!remark) { $('#recordRemark').focus(); return; }
    if (isNaN(amount) || amount <= 0) { $('#recordAmount').focus(); return; }

    const d = parseDateTimeInput(timeStr);
    const mode = this.dataset.mode || 'add';

    if (mode === 'edit' && editingFundIndex >= 0 && FUND_RECORDS[editingFundIndex]) {
      const item = FUND_RECORDS[editingFundIndex];
      item.type = recordType;
      item.title = remark;
      item.amount = amount;
      item.time = formatDateTime(d);
      logAction('编辑资金记录：' + remark);
      showToast('记录已更新');
    } else {
      FUND_RECORDS.unshift({
        type: recordType,
        title: remark,
        desc: '来自 · ' + ACCOUNT.username,
        amount: amount,
        time: formatDateTime(d)
      });
      logAction((recordType === 'in' ? '新增收入：' : '新增支出：') + remark + ' ¥' + amount.toLocaleString('zh-CN'));
      showToast(recordType === 'in' ? '收入已记录' : '支出已记录');
    }

    closeModal('recordModal');
    refreshAll();
  });

  /* ============================================================
     资金编辑/删除
     ============================================================ */
  $('#fundList').addEventListener('click', function (e) {
    const btn = e.target.closest('.row-more-btn');
    if (!btn) return;
    e.stopPropagation();
    editingFundIndex = parseInt(btn.dataset.fundIndex, 10);
    if (isNaN(editingFundIndex) || !FUND_RECORDS[editingFundIndex]) return;
    openModal('fundActionModal');
  });

  $('#fundEditBtn').addEventListener('click', function () {
    closeModal('fundActionModal');
    const item = FUND_RECORDS[editingFundIndex];
    if (!item) return;
    $('#recordModalTitle').textContent = '编辑记录';
    $('#recordRemark').value = item.title;
    $('#recordAmount').value = item.amount;
    $('#recordTime').value = toLocalDateTimeInput(new Date(item.time.replace(/-/g, '/').replace('T', ' ')));
    recordType = item.type;
    document.querySelectorAll('#recordTypeSwitch .type-opt').forEach(function (o) {
      o.classList.toggle('active', o.dataset.type === item.type);
    });

    const saveBtn = $('#recordSaveBtn');
    saveBtn.textContent = '保存';
    saveBtn.dataset.mode = 'edit';

    openModal('recordModal');
  });

  $('#fundDeleteBtn').addEventListener('click', async function () {
    const item = FUND_RECORDS[editingFundIndex];
    if (!item) return;
    closeModal('fundActionModal');
    const ok = await showConfirm('删除记录', '确定要删除「' + item.title + '」吗？此操作不可恢复。');
    if (!ok) return;
    FUND_RECORDS.splice(editingFundIndex, 1);
    editingFundIndex = -1;
    refreshAll();
    logAction('删除资金记录：' + item.title);
    showToast('记录已删除');
  });

  /* ============================================================
     任务
     ============================================================ */
  function openTaskModal() {
    $('#taskModalTitle').textContent = '新增任务';
    $('#taskName').value = '';
    $('#taskDeadline').value = '';
    $('#taskOwner').value = '';
    $('#taskSaveBtn').dataset.mode = 'add';
    $('#taskSaveBtn').textContent = '保存';
    openModal('taskModal');
    setTimeout(function () { $('#taskName').focus(); }, 200);
  }

  $('#addTaskBtn').addEventListener('click', openTaskModal);

  $('#taskSaveBtn').addEventListener('click', function () {
    const name = $('#taskName').value.trim();
    const deadline = $('#taskDeadline').value;
    const owner = $('#taskOwner').value.trim();

    if (!name) { $('#taskName').focus(); return; }
    if (!deadline) { $('#taskDeadline').focus(); return; }
    if (!owner) { $('#taskOwner').focus(); return; }

    const mode = this.dataset.mode || 'add';

    if (mode === 'edit' && editingTaskActionIndex >= 0 && TASKS[editingTaskActionIndex]) {
      const t = TASKS[editingTaskActionIndex];
      t.name = name;
      t.deadline = deadline;
      t.owner = owner;
      logAction('编辑任务：' + name);
      showToast('任务已更新');
    } else {
      TASKS.push({
        name: name,
        deadline: deadline,
        owner: owner,
        status: 'pending',
        progress: 0,
        createdAt: formatDateTime(new Date()),
        completedAt: null
      });
      logAction('新增任务：' + name);
      showToast('任务已添加');
    }

    closeModal('taskModal');
    refreshAll();
  });

  $('#taskList').addEventListener('click', function (e) {
    const moreBtn = e.target.closest('[data-task-more]');
    if (moreBtn) {
      e.stopPropagation();
      editingTaskActionIndex = parseInt(moreBtn.dataset.taskMore, 10);
      if (isNaN(editingTaskActionIndex) || !TASKS[editingTaskActionIndex]) return;
      openModal('taskActionModal');
      return;
    }
    const taskEl = e.target.closest('.task');
    if (!taskEl) return;
    const idx = parseInt(taskEl.dataset.taskIndex, 10);
    if (isNaN(idx) || !TASKS[idx]) return;
    editingTaskIndex = idx;
    editingProgress = typeof TASKS[idx].progress === 'number' ? TASKS[idx].progress : (TASKS[idx].status === 'done' ? 100 : 0);
    selectStatus(TASKS[idx].status);
    openModal('statusModal');
  });

  $('#taskEditBtn').addEventListener('click', function () {
    closeModal('taskActionModal');
    const t = TASKS[editingTaskActionIndex];
    if (!t) return;
    $('#taskModalTitle').textContent = '编辑任务';
    $('#taskName').value = t.name;
    $('#taskDeadline').value = t.deadline;
    $('#taskOwner').value = t.owner;
    $('#taskSaveBtn').dataset.mode = 'edit';
    $('#taskSaveBtn').textContent = '保存';
    openModal('taskModal');
  });

  $('#taskStatusBtn').addEventListener('click', function () {
    closeModal('taskActionModal');
    const idx = editingTaskActionIndex;
    if (idx < 0 || !TASKS[idx]) return;
    editingTaskIndex = idx;
    editingProgress = typeof TASKS[idx].progress === 'number' ? TASKS[idx].progress : (TASKS[idx].status === 'done' ? 100 : 0);
    selectStatus(TASKS[idx].status);
    openModal('statusModal');
  });

  $('#taskDeleteBtn').addEventListener('click', async function () {
    const t = TASKS[editingTaskActionIndex];
    if (!t) return;
    closeModal('taskActionModal');
    const ok = await showConfirm('删除任务', '确定要删除「' + t.name + '」吗？此操作不可恢复。');
    if (!ok) return;
    TASKS.splice(editingTaskActionIndex, 1);
    editingTaskActionIndex = -1;
    refreshAll();
    logAction('删除任务：' + t.name);
    showToast('任务已删除');
  });

  function selectStatus(status) {
    editingStatus = status;
    document.querySelectorAll('#statusOpts .status-opt').forEach(function (o) {
      o.classList.toggle('active', o.dataset.status === status);
    });
    if (status === 'done') editingProgress = 100;
    if (status === 'pending') editingProgress = 0;
    renderStatusProgress();
  }

  function renderStatusProgress() {
    const wrap = $('#statusProgressWrap');
    if (!wrap) return;
    wrap.style.display = editingStatus === 'ongoing' ? 'block' : 'none';
    const slider = $('#statusProgressSlider');
    const val = $('#statusProgressValue');
    if (slider) slider.value = editingProgress;
    if (val) val.textContent = editingProgress + '%';
  }

  document.querySelectorAll('#statusOpts .status-opt').forEach(function (opt) {
    opt.addEventListener('click', function () { selectStatus(this.dataset.status); });
  });

  $('#statusProgressSlider').addEventListener('input', function () {
    editingProgress = parseInt(this.value, 10);
    $('#statusProgressValue').textContent = editingProgress + '%';
  });

  $('#statusSaveBtn').addEventListener('click', function () {
    if (editingTaskIndex < 0 || !TASKS[editingTaskIndex]) return;
    const task = TASKS[editingTaskIndex];
    const wasDone = task.status === 'done';
    task.status = editingStatus;
    task.progress = editingProgress;

    if (editingStatus === 'done' && !wasDone) {
      task.completedAt = formatDateTime(new Date());
    } else if (editingStatus !== 'done') {
      task.completedAt = null;
    }

    closeModal('statusModal');
    refreshAll();
    logAction('任务「' + task.name + '」状态更新为 ' + STATUS_META[editingStatus].text);
    showToast('任务状态已更新');
  });

  /* ============================================================
     倒数日编辑
     ============================================================ */
  function openCountdownModal(idx) {
    editingCountdownIndex = idx;
    const item = COUNTDOWNS[idx];
    if (!item) return;
    $('#cdTitle').value = item.title;
    $('#cdDate').value = item.date;
    $('#cdNote').value = item.note || '';
    openModal('countdownModal');
    setTimeout(function () { $('#cdTitle').focus(); }, 200);
  }

  $('#cdSaveBtn').addEventListener('click', function () {
    const title = $('#cdTitle').value.trim();
    const date = $('#cdDate').value;
    const note = $('#cdNote').value.trim();
    if (!title || !date) { showToast('请填写标题和日期'); return; }
    if (editingCountdownIndex < 0 || !COUNTDOWNS[editingCountdownIndex]) return;
    COUNTDOWNS[editingCountdownIndex] = {
      id: COUNTDOWNS[editingCountdownIndex].id,
      title: title,
      date: date,
      note: note
    };
    closeModal('countdownModal');
    renderCountdowns();
    saveAll();
    logAction('更新倒数日：' + title);
    showToast('倒数日已保存');
  });

  /* ============================================================
     账号密码修改
     ============================================================ */
  $('#editAccountBtn').addEventListener('click', function () {
    $('#oldAccountInput').value = '';
    $('#oldAccountPwd').value = '';
    $('#newAccountInput').value = '';
    openModal('accountModal');
  });

  $('#accountSaveBtn').addEventListener('click', function () {
    const oldAcc = $('#oldAccountInput').value.trim();
    const oldPwd = $('#oldAccountPwd').value;
    const newAcc = $('#newAccountInput').value.trim();

    if (oldAcc !== ACCOUNT.username || oldPwd !== ACCOUNT.password) {
      showToast('原账号或原密码不正确');
      return;
    }
    if (!newAcc) { $('#newAccountInput').focus(); return; }
    if (newAcc === ACCOUNT.username) { showToast('新账号与当前账号相同'); return; }
    if (newAcc.length < 2) { showToast('账号至少 2 位'); return; }

    const oldName = ACCOUNT.username;
    ACCOUNT.username = newAcc;
    refreshAccountUI();
    saveAll();
    closeModal('accountModal');
    logAction('账号由 ' + oldName + ' 修改为 ' + newAcc);
    showToast('账号修改成功');
  });

  $('#editPasswordBtn').addEventListener('click', function () {
    $('#pwdOldAccount').value = '';
    $('#pwdOldPwd').value = '';
    $('#pwdNew').value = '';
    $('#pwdNewConfirm').value = '';
    openModal('passwordModal');
  });

  $('#passwordSaveBtn').addEventListener('click', function () {
    const oldAcc = $('#pwdOldAccount').value.trim();
    const oldPwd = $('#pwdOldPwd').value;
    const newPwd = $('#pwdNew').value;
    const newPwd2 = $('#pwdNewConfirm').value;

    if (oldAcc !== ACCOUNT.username || oldPwd !== ACCOUNT.password) {
      showToast('原账号或原密码不正确');
      return;
    }
    if (!newPwd) { $('#pwdNew').focus(); return; }
    if (newPwd.length < 6) { showToast('新密码至少 6 位'); return; }
    if (newPwd !== newPwd2) { showToast('两次输入的密码不一致'); return; }

    ACCOUNT.password = newPwd;
    saveAll();
    closeModal('passwordModal');
    logAction('登录密码已修改');
    showToast('密码修改成功');
  });

  /* ============================================================
     主题
     ============================================================ */
  function applyTheme(isLight) {
    document.body.classList.toggle('light', isLight);
    const sw = $('#themeSwitch');
    const label = $('#themeModeLabel');
    if (sw) sw.classList.toggle('on', !isLight);
    if (label) label.textContent = isLight ? '浅色主题' : '深色主题';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isLight ? '#f5f7fc' : '#0a0d18');
    SETTINGS.theme = isLight ? 'light' : 'dark';
    saveAll();
  }

  $('#themeSwitch').addEventListener('click', function () {
    const willBeLight = !document.body.classList.contains('light');
    applyTheme(willBeLight);
    showToast(willBeLight ? '已切换浅色主题' : '已切换深色主题');
  });

  /* ============================================================
     底部 Tab Bar 模式
     ============================================================ */
  function applyTabBarMode(mode) {
    const tabBar = $('#tabBar');
    if (!tabBar) return;

    tabBar.classList.remove('mobile-only', 'always-show', 'always-hide');
    mainEl.classList.remove('has-tabbar');

    let visible = false;
    if (mode === 'auto') {
      tabBar.classList.add('mobile-only');
      visible = window.innerWidth <= 900;
    } else if (mode === 'always') {
      tabBar.classList.add('always-show');
      visible = true;
    } else {
      tabBar.classList.add('always-hide');
      visible = false;
    }

    if (visible) mainEl.classList.add('has-tabbar');

    document.querySelectorAll('#tabBarSeg .seg-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.mode === mode);
    });

    SETTINGS.tabBarMode = mode;
    saveAll();
  }

  $('#tabBarSeg').addEventListener('click', function (e) {
    const item = e.target.closest('.seg-item');
    if (!item) return;
    applyTabBarMode(item.dataset.mode);
    const map = { auto: '跟随设备', always: '始终显示', never: '始终隐藏' };
    showToast('底部菜单：' + map[item.dataset.mode]);
  });

  window.addEventListener('resize', function () {
    if (SETTINGS.tabBarMode === 'auto') applyTabBarMode('auto');
  });

  /* ============================================================
     资金预警 / 预算 / 自动锁屏 / 加密
     ============================================================ */
  $('#warnExpenseInput').addEventListener('blur', function () {
    const v = parseFloat(this.value);
    SETTINGS.warnExpense = isNaN(v) || v <= 0 ? null : v;
    saveAll();
    buildMessages();
  });

  $('#warnDepositInput').addEventListener('blur', function () {
    const v = parseFloat(this.value);
    SETTINGS.warnDeposit = isNaN(v) || v <= 0 ? null : v;
    saveAll();
    buildMessages();
  });

  $('#monthlyBudgetInput').addEventListener('blur', function () {
    const v = parseFloat(this.value);
    SETTINGS.monthlyBudget = isNaN(v) || v <= 0 ? null : v;
    saveAll();
    renderBudget();
    buildMessages();
  });

  $('#autoLockSwitch').addEventListener('click', function () {
    this.classList.toggle('on');
    SETTINGS.autoLock = this.classList.contains('on');
    saveAll();
    showToast(SETTINGS.autoLock ? '自动锁屏已开启' : '自动锁屏已关闭');
  });

  $('#encryptSwitch').addEventListener('click', async function () {
    if (!SETTINGS.encrypt) {
      if (!getEncryptPassword()) {
        $('#encryptCurrentPwd').value = '';
        $('#encryptNewPwd').value = '';
        $('#encryptNewPwdConfirm').value = '';
        openModal('encryptPwdModal');
        return;
      }
      SETTINGS.encrypt = true;
      this.classList.add('on');
      $('#encryptPwdRow').style.display = 'flex';
      updateEncryptPwdStatus();
      saveAll();
      showToast('数据加密已开启');
    } else {
      const ok = await showConfirm('关闭数据加密', '关闭后本地数据将以明文保存，确定吗？');
      if (!ok) return;
      SETTINGS.encrypt = false;
      this.classList.remove('on');
      $('#encryptPwdRow').style.display = 'none';
      sessionStorage.removeItem('jsg_encrypt_pwd');
      saveAll();
      showToast('数据加密已关闭');
    }
  });

  function updateEncryptPwdStatus() {
    const el = $('#encryptPwdStatus');
    if (el) el.textContent = getEncryptPassword() ? '已设置' : '未设置';
  }

  $('#setEncryptPwdBtn').addEventListener('click', function () {
    $('#encryptCurrentPwd').value = '';
    $('#encryptNewPwd').value = '';
    $('#encryptNewPwdConfirm').value = '';
    openModal('encryptPwdModal');
  });

  $('#encryptPwdSaveBtn').addEventListener('click', function () {
    const cur = $('#encryptCurrentPwd').value;
    const n1 = $('#encryptNewPwd').value;
    const n2 = $('#encryptNewPwdConfirm').value;

    if (cur !== ACCOUNT.password) { showToast('当前登录密码不正确'); return; }
    if (!n1 || n1.length < 6) { showToast('加密密码至少 6 位'); return; }
    if (n1 !== n2) { showToast('两次输入的密码不一致'); return; }

    sessionStorage.setItem('jsg_encrypt_pwd', n1);
    SETTINGS.encrypt = true;
    $('#encryptSwitch').classList.add('on');
    $('#encryptPwdRow').style.display = 'flex';
    updateEncryptPwdStatus();
    saveAll();
    closeModal('encryptPwdModal');
    showToast('加密密码已设置');
  });

  /* ============================================================
     头像上传
     ============================================================ */
  $('#topChip').addEventListener('click', function () {
    tempAvatarData = AVATAR;
    updateAvatarPreview();
    openModal('avatarModal');
  });

  function updateAvatarPreview() {
    const preview = $('#avatarPreview');
    if (!preview) return;
    const initial = (ACCOUNT.username || '管').trim().charAt(0).toUpperCase();
    if (tempAvatarData) {
      preview.style.backgroundImage = 'url(' + tempAvatarData + ')';
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.textContent = initial;
    }
  }

  $('#avatarUploadBtn').addEventListener('click', function () {
    $('#avatarFileInput').click();
  });

  $('#avatarFileInput').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast('请选择图片文件'); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('图片不能超过 2MB'); return; }

    const reader = new FileReader();
    reader.onload = function (evt) {
      const img = new Image();
      img.onload = function () {
        const canvas = document.createElement('canvas');
        const size = 200;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        tempAvatarData = canvas.toDataURL('image/jpeg', 0.85);
        updateAvatarPreview();
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('#avatarResetBtn').addEventListener('click', function () {
    tempAvatarData = null;
    updateAvatarPreview();
  });

  $('#avatarSaveBtn').addEventListener('click', function () {
    AVATAR = tempAvatarData;
    refreshAccountUI();
    saveAll();
    closeModal('avatarModal');
    logAction(AVATAR ? '更新头像' : '重置头像');
    showToast('头像已更新');
  });

  /* ============================================================
     今日焦点
     ============================================================ */
  $('#focusCard').addEventListener('click', function () {
    const now = Date.now();
    if (now - lastFocusCardClick < 300) return;
    lastFocusCardClick = now;

    document.querySelectorAll('.focus-option').forEach(function (o) {
      o.classList.toggle('active', o.dataset.mode === FOCUS.mode);
    });
    $('#focusManualField').style.display = FOCUS.mode === 'manual' ? 'block' : 'none';
    $('#focusManualInput').value = FOCUS.manual || '';
    openModal('focusModal');
  });

  document.querySelectorAll('.focus-option').forEach(function (opt) {
    opt.addEventListener('click', function () {
      document.querySelectorAll('.focus-option').forEach(function (o) { o.classList.remove('active'); });
      this.classList.add('active');
      $('#focusManualField').style.display = this.dataset.mode === 'manual' ? 'block' : 'none';
    });
  });

  $('#focusSaveBtn').addEventListener('click', function () {
    const active = document.querySelector('.focus-option.active');
    if (!active) return;
    FOCUS.mode = active.dataset.mode;
    if (FOCUS.mode === 'manual') {
      const v = $('#focusManualInput').value.trim();
      if (!v) { showToast('请输入内容'); return; }
      FOCUS.manual = v;
    }
    closeModal('focusModal');
    renderFocus();
    saveAll();
    logAction('更新今日焦点');
    showToast('今日焦点已保存');
  });

  /* ============================================================
     快捷操作
     ============================================================ */
  document.querySelectorAll('.quick-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const action = this.dataset.quick;
      if (action === 'record') openRecordModal();
      else if (action === 'task') openTaskModal();
      else if (action === 'report') setPage('report');
      else if (action === 'export') {
        setPage('data');
        setTimeout(function () { $('#exportBtn').click(); }, 200);
      }
    });
  });

  /* ============================================================
     FAB
     ============================================================ */
  $('#fabBtn').addEventListener('click', function () {
    this.classList.toggle('rotate');
    $('#fabMenu').classList.toggle('show');
  });

  document.querySelectorAll('.fab-menu-item').forEach(function (item) {
    item.addEventListener('click', function () {
      const action = this.dataset.action;
      $('#fabBtn').classList.remove('rotate');
      $('#fabMenu').classList.remove('show');
      if (action === 'record') openRecordModal();
      else if (action === 'task') openTaskModal();
      else if (action === 'focus') { lastFocusCardClick = 0; $('#focusCard').click(); }
    });
  });

  /* ============================================================
     页面切换
     ============================================================ */
  function setPage(key) {
    document.querySelectorAll('.page').forEach(function (p) {
      p.classList.toggle('active', p.dataset.page === key);
    });
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.page === key);
    });
    document.querySelectorAll('.tab-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.page === key);
    });
    const title = $('#pageTitle');
    if (title) title.textContent = PAGE_TITLES[key] || '聚神阁';
    content.scrollTop = 0;
    closeSidebar();

    if (key === 'stats') renderCompare();
    if (key === 'messages') renderMessages();
    if (key === 'funds') { renderTrendChart(); renderFundStats(); renderBudget(); }
    if (key === 'home') { renderCountdowns(); renderHomeActivity(); renderHomeStats(); renderBudget(); renderFocus(); }
    if (key === 'calendar') renderCalendar();
  }

  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () { setPage(this.dataset.page); });
  });

  document.querySelectorAll('.tab-item').forEach(function (item) {
    item.addEventListener('click', function () { setPage(this.dataset.page); });
  });

  /* ============================================================
     移动端抽屉
     ============================================================ */
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('show');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  $('#menuBtn').addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);

  window.addEventListener('resize', function () {
    if (window.innerWidth > 900) closeSidebar();
  });

  /* ============================================================
     筛选
     ============================================================ */
  document.querySelectorAll('#taskFilters .filter-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#taskFilters .filter-tab').forEach(function (t) { t.classList.remove('active'); });
      this.classList.add('active');
      taskFilter = this.dataset.filter;
      renderTaskList();
    });
  });

  document.querySelectorAll('#msgFilters .filter-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#msgFilters .filter-tab').forEach(function (t) { t.classList.remove('active'); });
      this.classList.add('active');
      msgFilter = this.dataset.filter;
      renderMessages();
    });
  });

  document.querySelectorAll('#fundFilters .filter-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const filter = this.dataset.filter;
      if (filter === 'range') {
        $('#rangePanel').style.display = $('#rangePanel').style.display === 'none' ? 'block' : 'none';
        $('#datePanel').style.display = 'none';
        return;
      }
      if (filter === 'date') {
        $('#datePanel').style.display = $('#datePanel').style.display === 'none' ? 'block' : 'none';
        $('#rangePanel').style.display = 'none';
        return;
      }
      document.querySelectorAll('#fundFilters .filter-chip').forEach(function (c) { c.classList.remove('active'); });
      this.classList.add('active');
      fundTypeFilter = filter;
      renderFundList();
    });
  });

  $('#rangeApply').addEventListener('click', function () {
    const min = parseFloat($('#rangeMin').value);
    const max = parseFloat($('#rangeMax').value);
    fundRangeMin = isNaN(min) ? null : min;
    fundRangeMax = isNaN(max) ? null : max;
    renderFundList();
    showToast('已应用金额筛选');
  });

  $('#dateApply').addEventListener('click', function () {
    fundDateFrom = $('#dateFrom').value || null;
    fundDateTo = $('#dateTo').value || null;
    renderFundList();
    showToast('已应用日期筛选');
  });

  $('#fundSearch').addEventListener('input', function () {
    fundSearchText = this.value.trim();
    renderFundList();
  });

  $('#taskSearch').addEventListener('input', function () {
    taskSearchText = this.value.trim();
    renderTaskList();
  });

  document.querySelectorAll('#periodTabs .period-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#periodTabs .period-tab').forEach(function (t) { t.classList.remove('active'); });
      this.classList.add('active');
      statsPeriod = this.dataset.period;
      renderCompare();
    });
  });

  /* ============================================================
     下拉刷新
     ============================================================ */
  let pullStartY = 0;
  let pulling = false;
  content.addEventListener('touchstart', function (e) {
    if (content.scrollTop <= 0) {
      pullStartY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });
  content.addEventListener('touchmove', function (e) {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 60 && content.scrollTop <= 0) {
      $('#pullRefresh').classList.add('show');
    }
  }, { passive: true });
  content.addEventListener('touchend', function () {
    if (pulling && $('#pullRefresh').classList.contains('show')) {
      setTimeout(function () {
        $('#pullRefresh').classList.remove('show');
        refreshAll();
        showToast('已刷新');
      }, 400);
    }
    pulling = false;
  });

  /* ============================================================
     数据管理
     ============================================================ */
  function renderFileList() {
    const box = $('#fileListBox');
    const label = $('#fileCountLabel');
    if (!box) return;

    if (!currentFile) {
      box.innerHTML = '<div class="empty-tip" style="padding:20px 0;font-size:12.5px">暂无文件</div>';
      if (label) label.textContent = '暂无文件';
      return;
    }

    const typeMap = { import: '导入文件', export: '导出文件', csv: 'CSV 文件' };
    const typeText = typeMap[currentFile.type] || '文件';

    box.innerHTML =
      '<div class="file-item">' +
        '<div class="file-icon">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
          '</svg>' +
        '</div>' +
        '<div class="file-main">' +
          '<strong>' + escapeHtml(currentFile.name) + '</strong>' +
          '<span>' + typeText + ' · ' + currentFile.createdAt + '</span>' +
        '</div>' +
        '<div class="file-actions">' +
          '<button class="file-dl-btn ripple" id="downloadFileBtn">下载</button>' +
        '</div>' +
      '</div>';

    if (label) label.textContent = '1 个文件';

    const dlBtn = $('#downloadFileBtn');
    if (dlBtn) {
      dlBtn.addEventListener('click', function () {
        const mime = currentFile.type === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
        const blob = new Blob(['\ufeff' + currentFile.content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('文件已开始下载');
      });
    }
  }

  function collectAllData() {
    return {
      appName: '聚神阁',
      version: '3.0.0',
      exportTime: formatDateTime(new Date()),
      account: ACCOUNT.username,
      baseDeposit: BASE_DEPOSIT,
      fundRecords: FUND_RECORDS,
      tasks: TASKS,
      countdowns: COUNTDOWNS,
      actionLogs: ACTION_LOGS,
      avatar: AVATAR,
      focus: FOCUS,
      settings: SETTINGS
    };
  }

  function validateDataFile(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.appName !== '聚神阁') return false;
    if (!Array.isArray(obj.fundRecords)) return false;
    if (!Array.isArray(obj.tasks)) return false;
    return true;
  }

  function applyImportedData(data) {
    if (data.account) ACCOUNT = data.account;
    FUND_RECORDS = data.fundRecords || [];
    TASKS = data.tasks || [];
    COUNTDOWNS = data.countdowns || COUNTDOWNS;
    ACTION_LOGS = data.actionLogs || [];
    BASE_DEPOSIT = typeof data.baseDeposit === 'number' ? data.baseDeposit : 0;
    AVATAR = data.avatar || null;
    FOCUS = data.focus || { mode: 'auto', manual: '' };
    if (data.settings) SETTINGS = Object.assign({}, SETTINGS, data.settings);
    refreshAll();
  }

  $('#importBtn').addEventListener('click', function () {
    $('#fileInput').accept = '.json';
    $('#fileInput').dataset.mode = 'import';
    $('#fileInput').click();
  });

  $('#exportBtn').addEventListener('click', function () {
    if (currentFile) { showToast('请先清空当前文件'); return; }
    const data = collectAllData();
    currentFile = {
      name: '聚神阁数据_' + fileTimestamp() + '.json',
      type: 'export',
      content: JSON.stringify(data, null, 2),
      createdAt: formatDateTime(new Date())
    };
    renderFileList();
    logAction('导出 JSON 数据');
    showToast('已生成导出文件');
  });

  $('#exportCsvBtn').addEventListener('click', function () {
    if (currentFile) { showToast('请先清空当前文件'); return; }
    if (!FUND_RECORDS.length) { showToast('暂无资金记录可导出'); return; }

    const headers = ['时间', '类型', '标题', '来源', '金额'];
    const rows = FUND_RECORDS.map(function (r) {
      return [
        r.time,
        r.type === 'in' ? '收入' : '支出',
        '"' + String(r.title).replace(/"/g, '""') + '"',
        '"' + String(r.desc).replace(/"/g, '""') + '"',
        (r.type === 'in' ? '+' : '-') + r.amount
      ].join(',');
    });

    currentFile = {
      name: '聚神阁资金明细_' + fileTimestamp() + '.csv',
      type: 'csv',
      content: headers.join(',') + '\n' + rows.join('\n'),
      createdAt: formatDateTime(new Date())
    };
    renderFileList();
    logAction('导出 CSV 数据');
    showToast('已生成 CSV 文件');
  });

  $('#clearFileBtn').addEventListener('click', function () {
    if (!currentFile) { showToast('当前没有文件'); return; }
    currentFile = null;
    renderFileList();
    showToast('文件已清空');
  });

  $('#fileInput').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const mode = this.dataset.mode || 'import';

    const reader = new FileReader();
    reader.onload = function (evt) {
      const content = String(evt.target.result || '');

      if (mode === 'import') {
        let parsed;
        try { parsed = JSON.parse(content); }
        catch (err) { showToast('文件格式错误，无法解析'); return; }
        if (!validateDataFile(parsed)) { showToast('文件不是聚神阁的数据格式'); return; }

        showConfirm('导入数据', '导入后将覆盖当前所有数据，确定吗？').then(function (ok) {
          if (!ok) return;
          applyImportedData(parsed);
          currentFile = null;
          renderFileList();
          logAction('导入数据成功');
          showToast('数据已导入');
        });
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  /* ============================================================
     清空所有数据
     ============================================================ */
  $('#clearAllDataBtn').addEventListener('click', async function () {
    const ok1 = await showConfirm('清空所有数据', '⚠️ 这会删除资金、任务、倒数日、日志等所有数据，且不可恢复。\n\n建议先导出备份。\n\n确定要继续吗？');
    if (!ok1) return;
    const ok2 = await showConfirm('再次确认', '真的要清空所有数据吗？此操作不可撤销。');
    if (!ok2) return;

    FUND_RECORDS = [];
    TASKS = [];
    ACTION_LOGS = [];
    MESSAGES = [];
    COUNTDOWNS = [
      { id: 1, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
      { id: 2, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
      { id: 3, title: '点击设置', date: '2025-12-31', note: '点击可修改' },
      { id: 4, title: '点击设置', date: '2025-12-31', note: '点击可修改' }
    ];
    BASE_DEPOSIT = 0;
    FOCUS = { mode: 'auto', manual: '' };
    currentFile = null;
    reportFile = null;

    refreshAll();
    logAction('清空所有数据');
    showToast('所有数据已清空');
  });

  /* ============================================================
     报表
     ============================================================ */
  function updateReportGenerateState() {
    const btn = $('#reportGenerateBtn');
    if (btn) btn.disabled = !selectedYear;
  }

  function renderReportFile() {
    const box = $('#reportFileBox');
    const label = $('#reportFileLabel');
    const clearBtn = $('#reportClearBtn');
    const sendBtn = $('#reportSendBtn');
    if (!box) return;

    if (!reportFile) {
      box.innerHTML =
        '<div class="empty-tip">' +
          '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
          '</svg>' +
          '<div>暂无报表</div>' +
        '</div>';
      if (label) label.textContent = '暂无报表';
      if (clearBtn) clearBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'none';
      return;
    }

    box.innerHTML =
      '<div class="file-item">' +
        '<div class="file-icon">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 3v5h5"/><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
            '<path d="M9 13h6M9 17h4"/>' +
          '</svg>' +
        '</div>' +
        '<div class="file-main">' +
          '<strong>' + escapeHtml(reportFile.name) + '</strong>' +
          '<span>Word 报表 · ' + reportFile.label + '</span>' +
        '</div>' +
        '<div class="file-actions">' +
          '<button class="file-dl-btn ripple" id="downloadReportBtn">下载</button>' +
        '</div>' +
      '</div>';

    if (label) label.textContent = '1 个报表';
    if (clearBtn) clearBtn.style.display = 'flex';
    if (sendBtn) sendBtn.style.display = 'flex';

    const dlBtn = $('#downloadReportBtn');
    if (dlBtn) {
      dlBtn.addEventListener('click', function () {
        const blob = new Blob([reportFile.content], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = reportFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('报表已开始下载');
      });
    }
  }

  function buildReportData(year, month) {
    const isMonth = month != null;

    const inRange = function (timeStr) {
      const d = new Date(String(timeStr).replace(/-/g, '/').replace('T', ' '));
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== year) return false;
      if (isMonth && (d.getMonth() + 1) !== month) return false;
      return true;
    };

    const fundRecords = FUND_RECORDS.filter(function (r) { return inRange(r.time); });
    const tasks = TASKS.filter(function (t) {
      if (!t.deadline) return false;
      const d = new Date(String(t.deadline).replace(/-/g, '/'));
      if (isNaN(d.getTime())) return false;
      if (d.getFullYear() !== year) return false;
      if (isMonth && (d.getMonth() + 1) !== month) return false;
      return true;
    });

    let income = 0, expense = 0;
    fundRecords.forEach(function (r) {
      if (r.type === 'in') income += Number(r.amount);
      else expense += Number(r.amount);
    });

    return {
      year: year,
      month: isMonth ? month : null,
      generatedAt: formatDateTime(new Date()),
      incomeTotal: income,
      expenseTotal: expense,
      netTotal: income - expense,
      fundRecords: fundRecords,
      tasks: tasks
    };
  }

  function buildWordHtml(data) {
    const isMonth = data.month != null;
    const title = isMonth
      ? '聚神阁 ' + data.year + ' 年 ' + data.month + ' 月 月度报表'
      : '聚神阁 ' + data.year + ' 年 年度报表';

    const fmtMoney = function (v) {
      return '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const fundRows = data.fundRecords.length
      ? data.fundRecords.map(function (r) {
          const isIn = r.type === 'in';
          return (
            '<tr>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + (isIn ? '收入' : '支出') + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + r.title + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + r.desc + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;text-align:right;color:' + (isIn ? '#2fa96e' : '#e05a5a') + ';">' +
                (isIn ? '+' : '-') + fmtMoney(r.amount) +
              '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + r.time + '</td>' +
            '</tr>'
          );
        }).join('')
      : '<tr><td colspan="5" style="padding:12px;text-align:center;color:#999;">暂无记录</td></tr>';

    const taskRows = data.tasks.length
      ? data.tasks.map(function (t) {
          const map = { pending: '待开始', ongoing: '进行中', done: '已完成' };
          return (
            '<tr>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + t.name + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + t.deadline + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + t.owner + '</td>' +
              '<td style="padding:6px 10px;border:1px solid #ddd;">' + (map[t.status] || '未知') + '</td>' +
            '</tr>'
          );
        }).join('')
      : '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;">暂无记录</td></tr>';

    return (
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
            'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
            'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>' + title + '</title>' +
      '<style>' +
      'body{font-family:"Microsoft YaHei",sans-serif;color:#2a3142;padding:28px;}' +
      'h1{font-size:22px;border-bottom:2px solid #6d8bff;padding-bottom:12px;}' +
      'h2{font-size:16px;margin-top:26px;margin-bottom:12px;}' +
      'table{border-collapse:collapse;width:100%;font-size:13px;}' +
      'th{background:#eef2ff;padding:8px 10px;border:1px solid #ddd;text-align:left;}' +
      '.summary{display:flex;flex-wrap:wrap;gap:14px;margin:18px 0;}' +
      '.box{flex:1;min-width:150px;padding:14px 16px;background:#f7f9ff;border:1px solid #dde5ff;border-radius:8px;}' +
      '.lbl{font-size:12px;color:#6d8bff;}' +
      '.val{font-size:20px;font-weight:700;margin-top:6px;}' +
      '.meta{font-size:12px;color:#999;margin-bottom:20px;}' +
      '</style></head><body>' +
      '<h1>' + title + '</h1>' +
      '<div class="meta">生成时间：' + data.generatedAt + '</div>' +
      '<h2>一、数据汇总</h2>' +
      '<div class="summary">' +
        '<div class="box"><div class="lbl">收入合计</div><div class="val" style="color:#2fa96e;">' + fmtMoney(data.incomeTotal) + '</div></div>' +
        '<div class="box"><div class="lbl">支出合计</div><div class="val" style="color:#e05a5a;">' + fmtMoney(data.expenseTotal) + '</div></div>' +
        '<div class="box"><div class="lbl">净收入</div><div class="val">' + fmtMoney(data.netTotal) + '</div></div>' +
        '<div class="box"><div class="lbl">资金记录</div><div class="val">' + data.fundRecords.length + ' 条</div></div>' +
        '<div class="box"><div class="lbl">任务数量</div><div class="val">' + data.tasks.length + ' 项</div></div>' +
      '</div>' +
      '<h2>二、资金明细</h2>' +
      '<table><thead><tr><th>类型</th><th>标题</th><th>来源</th><th style="text-align:right;">金额</th><th>时间</th></tr></thead><tbody>' +
      fundRows + '</tbody></table>' +
      '<h2>三、任务明细</h2>' +
      '<table><thead><tr><th>任务名称</th><th>截止日期</th><th>负责人</th><th>状态</th></tr></thead><tbody>' +
      taskRows + '</tbody></table>' +
      '<p style="margin-top:30px;font-size:12px;color:#999;text-align:center;">—— 聚神阁 · 汇聚精英 神驰天下 ——</p>' +
      '</body></html>'
    );
  }

  $('#reportGenerateBtn').addEventListener('click', function () {
    if (!selectedYear) { showToast('请先选择年份'); return; }
    if (reportFile) { showToast('请先清空当前报表'); return; }

    const data = buildReportData(selectedYear, selectedMonth);
    const isMonth = selectedMonth != null;
    const name = isMonth
      ? '月度报表_' + selectedYear + pad(selectedMonth) + '_' + fileTimestamp() + '.doc'
      : '年度报表_' + selectedYear + '_' + fileTimestamp() + '.doc';
    const label = isMonth ? selectedYear + ' 年 ' + selectedMonth + ' 月' : selectedYear + ' 年';

    reportFile = {
      name: name,
      content: buildWordHtml(data),
      label: label
    };

    renderReportFile();
    logAction('生成报表：' + name);
    showToast('报表已生成');
  });

  $('#reportClearBtn').addEventListener('click', function () {
    if (!reportFile) { showToast('当前没有报表'); return; }
    reportFile = null;
    renderReportFile();
    showToast('报表已清空');
  });

  $('#reportSendBtn').addEventListener('click', function () {
    if (!reportFile) { showToast('请先生成报表'); return; }
    $('#sendEmailSubject').value = reportFile.name;
    $('#sendEmailInput').value = '';
    openModal('sendEmailModal');
  });

  $('#sendEmailBtn').addEventListener('click', function () {
    const email = $('#sendEmailInput').value.trim();
    if (!email) { $('#sendEmailInput').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('请输入正确的邮箱'); return; }
    closeModal('sendEmailModal');
    logAction('报表已发送至 ' + email);
    showToast('报表已发送至 ' + email + '（演示）');
  });

  function renderYearGrid() {
    const grid = $('#yearGrid');
    if (!grid) return;
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= currentYear - 11; y--) years.push(y);

    grid.innerHTML = years.map(function (y) {
      return '<div class="picker-cell' + (selectedYear === y ? ' active' : '') + '" data-year="' + y + '">' + y + '</div>';
    }).join('');

    grid.querySelectorAll('[data-year]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        selectedYear = parseInt(this.dataset.year, 10);
        selectedMonth = null;
        updateYearPickerUI();
        updateMonthPickerUI();
        updateReportGenerateState();
        closeModal('yearModal');
      });
    });
  }

  function updateYearPickerUI() {
    const picker = $('#yearPicker');
    const text = $('#yearPickerText');
    if (!picker || !text) return;
    if (selectedYear) {
      picker.classList.remove('placeholder');
      picker.classList.add('filled');
      text.textContent = selectedYear + ' 年';
    } else {
      picker.classList.add('placeholder');
      picker.classList.remove('filled');
      text.textContent = '请选择年份';
    }
  }

  $('#yearPicker').addEventListener('click', function () {
    renderYearGrid();
    openModal('yearModal');
  });

  function renderMonthGrid() {
    const grid = $('#monthGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
      const div = document.createElement('div');
      div.className = 'picker-cell' + (selectedMonth === m ? ' active' : '');
      div.dataset.month = m;
      div.textContent = m + ' 月';
      div.addEventListener('click', function () {
        selectedMonth = m;
        updateMonthPickerUI();
        closeModal('monthModal');
      });
      grid.appendChild(div);
    }
  }

  function updateMonthPickerUI() {
    const picker = $('#monthPicker');
    const text = $('#monthPickerText');
    if (!picker || !text) return;
    if (selectedMonth) {
      picker.classList.remove('placeholder');
      picker.classList.add('filled');
      text.textContent = selectedMonth + ' 月';
    } else {
      picker.classList.add('placeholder');
      picker.classList.remove('filled');
      text.textContent = '请选择月份（可选）';
    }
  }

  $('#monthPicker').addEventListener('click', function () {
    if (!selectedYear) { showToast('请先选择年份'); return; }
    renderMonthGrid();
    openModal('monthModal');
  });

  $('#clearMonthBtn').addEventListener('click', function () {
    selectedMonth = null;
    updateMonthPickerUI();
    closeModal('monthModal');
  });

  /* ============================================================
     全局刷新
     ============================================================ */
  function refreshAll() {
    renderFundList();
    renderFundStats();
    renderTrendChart();
    renderTaskList();
    renderCountdowns();
    renderHomeActivity();
    renderHomeStats();
    renderBudget();
    renderFocus();
    renderCalendar();
    buildMessages();
    renderCompare();
    refreshAccountUI();
    saveAll();
  }

  /* ============================================================
     初始化
     ============================================================ */
  function initSettingsUI() {
    applyTheme(SETTINGS.theme === 'light');
    applyTabBarMode(SETTINGS.tabBarMode || 'auto');
    $('#warnExpenseInput').value = SETTINGS.warnExpense || '';
    $('#warnDepositInput').value = SETTINGS.warnDeposit || '';
    $('#monthlyBudgetInput').value = SETTINGS.monthlyBudget || '';
    $('#autoLockSwitch').classList.toggle('on', SETTINGS.autoLock !== false);
    const encSwitch = $('#encryptSwitch');
    if (SETTINGS.encrypt) {
      encSwitch.classList.add('on');
      $('#encryptPwdRow').style.display = 'flex';
    } else {
      encSwitch.classList.remove('on');
      $('#encryptPwdRow').style.display = 'none';
    }
    updateEncryptPwdStatus();
  }

  function init() {
    const loaded = loadAll();

    if (!loaded && window.__needDecryptPwd) {
      const pwd = prompt('请输入加密密码以解锁数据：');
      if (pwd) {
        sessionStorage.setItem('jsg_encrypt_pwd', pwd);
        loadAll();
      } else {
        showToast('未输入密码，数据将以初始状态显示');
      }
      window.__needDecryptPwd = false;
    }

    initSettingsUI();
    refreshAccountUI();
    refreshAll();

    setTimeout(checkAutoLock, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ============================================================
     防止 iOS 双击缩放
     ============================================================ */
  let lastTouch = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouch <= 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  /* ============================================================
     键盘快捷键（桌面端）
     ============================================================ */
  document.addEventListener('keydown', function (e) {
    if (!app.classList.contains('active')) return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(e.target.tagName) >= 0) return;

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openRecordModal();
    } else if (e.key === 'Escape') {
      document.querySelectorAll('.modal-mask.show').forEach(function (m) { m.classList.remove('show'); });
    }
  });

})();

// 自动挂账去重与同步快照：使用真实插件，API 由可控 Promise 替代。
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(r => setTimeout(r, ms));
let count = 0;
const watchdog = setTimeout(() => { console.error("test timed out"); process.exit(1); }, 15000);
function check(value, label) { assert.ok(value, label); console.log('✓ ' + label); count++; }
(async () => {
 const {w, tavern, F} = boot(2);
 try {
  const settings = tavern.extensionSettings[F('EXT_NAME')];
  settings.ledgerAutoRun = true;
  w.eval(`window.calls = 0; window.reply = null;
    ipeLedgerCallAPI = function(){ window.calls++; return new Promise(r => window.reply = r); };
    window.syncLedger = ipeLedgerSync;
    window.freshReads = 0;
    var originalFresh = ipeLedgerReadFresh;
    ipeLedgerReadFresh = function(){ window.freshReads++; return originalFresh(); };`);
  const run = F('ipeLedgerRun');
  const answer = '<ledger>有效的账本内容，记录当前剧情以及人物状态，保留全部重要事件。</ledger>';
  const finish = async promise => { w.reply(answer); await promise; };
  let request = run(null, true);
  await run(null, true); await run(null, true);
  check(w.calls === 1, '运行中的同正文重复通知只请求一次');
  await finish(request); await delay(120);
  await run(null, true);
  check(w.calls === 1, '已完成的同正文通知不再重跑');
  request = run(null, false); await finish(request);
  check(w.calls === 2, '手动重挂同正文仍可运行');
  tavern.chat[1].mes += '修改后的剧情';
  request = run(null, true); await finish(request);
  check(w.calls === 3, '同楼正文修改仍可自动挂账');
  tavern.chat[1].swipe_id = 1;
  request = run(null, true); await finish(request);
  check(w.calls === 4, '同文字的新 swipe 仍可挂账');
  F('ipeLedgerSave')({...F('ipeLedgerRead')(), current: '手动更改的账本'});
  request = run(null, true); await finish(request);
  check(w.calls === 5, '账本手动修改后不会被旧的完成标记拦住');
  tavern.chat[1].mes += '再次修改';
  request = run(null, true);
  tavern.chat.push({is_user:false, mes:'新楼的完整正文'});
  await run(null, true); await run(null, true);
  await finish(request); await delay(120);
  check(w.calls === 7, '忙碌时新楼仍排队，重复通知合并');
  w.reply(answer); await delay(20);
  await run(null, true);
  check(w.calls === 7, '补挂成功后重复通知不重跑');
  tavern.chat[2].mes += '下一版';
  request = run(null, true);
  tavern.getCurrentChatId = () => 'another-chat'; tavern.chatMetadata = {};
  await finish(request);
  check(!F('ipeLedgerRead')().current, '旧聊天返回不能写入新聊天');
  request = run(null, true); await finish(request);
  check(w.calls === 9, '新聊天同楼同正文仍正常挂账');
  // 一次 sync: 对账独立读取一次，后续贴耳/UI/展示共读一次。
  w.freshReads = 0; w.syncLedger();
  check(w.freshReads === 2, '同步中对账后仅再读取一次账本');
  F('ipeLedgerCommit')('第二次同步必须读到这份新账本。', 3);
  w.syncLedger();
  check(Object.values(tavern.extensionPrompts).some(p => p.value.includes('第二次同步')), '下一次同步贴耳立即获得新账本');
  const before = w.freshReads; F('ipeLedgerRead')(); F('ipeLedgerRead')();
  check(w.freshReads === before + 2, '同步结束即释放快照，普通读取不使用旧缓存');
 } finally { w.close(); }
 // 失败与 NO_CHANGE 分开检查，失败不得锁死自动重试。
 const b = boot(2);
 try {
  b.w.eval(`window.calls=0; ipeLedgerCallAPI=async function(){ window.calls++; throw new Error('test'); };`);
  await b.F('ipeLedgerRun')(null,true); await b.F('ipeLedgerRun')(null,true);
  check(b.w.calls === 2, '失败不标记完成，后续尝试仍可运行');
  b.w.eval(`ipeLedgerCallAPI=async function(){ window.calls++; return '<ledger>'+IPE_LEDGER_SENTINEL+'</ledger>'; };`);
  await b.F('ipeLedgerRun')(null,true); await b.F('ipeLedgerRun')(null,true);
  check(b.w.calls === 3, '无变化哨兵也会合并重复通知');
 } finally { b.w.close(); }
 // 真正的消息事件入口与延迟重试，防止只验证函数而漏掉调度层。
 const c = boot(2);
 try {
  const settings = c.tavern.extensionSettings[c.F('EXT_NAME')];
  settings.enabled = false; settings.ledgerAutoRun = true;
  c.w.eval(`window.calls=0; ipeLedgerCallAPI=async function(){ window.calls++; return '<ledger>事件入口的完整账本，记录本轮剧情与人物关系。</ledger>'; };`);
  await c.tavern.eventSource.emit('MESSAGE_RECEIVED', 1);
  await c.tavern.eventSource.emit('MESSAGE_RECEIVED', 1);
  await delay(650);
  check(c.w.calls === 1, '真实 MESSAGE_RECEIVED 重复事件只挂一次');
  c.tavern.chat[1].mes += '新的正文';
  settings.ledgerRetryOnce = true; settings.ledgerRetryDelayMs = 40;
  c.w.eval(`window.calls=0; ipeLedgerCallAPI=async function(){ window.calls++; if(window.calls===1) throw new Error('API 503'); return '<ledger>重试后成功返回的完整账本，保留本轮的重要记录。</ledger>'; };`);
  await c.F('ipeLedgerRun')(null, true); await delay(120);
  check(c.w.calls === 2 && c.F('ipeLedgerRead')().current.includes('重试后'), '自动挂账失败后的延迟重试仍可落账');
  c.tavern.chat[1].mes += '下一轮';
  c.w.eval(`window.calls=0; ipeLedgerCallAPI=async function(){ window.calls++; throw new Error('API 503'); };`);
  await c.F('ipeLedgerRun')(null, true);
  c.tavern.getCurrentChatId = () => 'switched-before-retry';
  c.tavern.chatMetadata = {};
  await delay(120);
  check(c.w.calls === 1, '切聊天后旧的延迟重试不再发请求');
 } finally { c.w.close(); }
 console.log('通过 ' + count + ' 项挂账减负回归'); clearTimeout(watchdog);
})().catch(e => { console.error(e); clearTimeout(watchdog); process.exitCode = 1; });

// 收尾负载回归：真实 DOM 观察器 + 模拟酒馆，不请求外部 API。
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let count = 0;
function check(ok, message) { assert.ok(ok, message); console.log('✓ ' + message); count++; }

(async () => {
    const { w, tavern } = boot(100);
    try {
        w.eval(`window.perf = { createPanel, createDrawer, bindAll, ipeLedgerSync, ipeToggleMiniPanel,
            ipeSetActiveTab, ipeLedgerCommit, ipeLedgerRenderInline, ipeLedgerReadStream,
            ipeInstallMesButtonsObserver, ipeRememberInjectTag, ipeLedgerScheduleEstimate };
            window.refreshes = 0; window.estimates = 0; window.epUpdates = 0; window.rowBatches = [];
            var oldBot = ipeLedgerRefreshBotEditors;
            ipeLedgerRefreshBotEditors = function(){ window.refreshes++; return oldBot(); };
            var oldEstimate = ipeLedgerEstimateChars;
            ipeLedgerEstimateChars = function(){ window.estimates++; return oldEstimate(); };
            var oldEP = ipeLedgerApplyEP;
            ipeLedgerApplyEP = function(){ window.epUpdates++; return oldEP(); };
            var oldButtons = ipeInstallMesButtons;
            ipeInstallMesButtons = function(rows){ window.rowBatches.push(rows ? rows.length : 'all'); return oldButtons(rows); };`);
        const p = w.perf, d = w.document;
        d.body.insertAdjacentHTML('beforeend', '<div id="extensions_settings2"></div>');
        w.jQuery = selector => { const el = d.querySelector(selector); return { length: el ? 1 : 0, append: html => el.insertAdjacentHTML('beforeend', html) }; };
        p.createPanel(); p.createDrawer(); w.jQuery = undefined; p.bindAll();
        const settings = tavern.extensionSettings['image-prompt-extractor'];
        settings.ledgerAutoRun = false; settings.enabled = false;
        const drawer = d.querySelector('#ipe-drawer .inline-drawer-content');
        d.querySelector('#ipe-panel').style.display = 'none'; // fixture 不加载外部 CSS
        drawer.style.display = 'none';
        p.ipeSetActiveTab('ledger');
        p.ipeLedgerCommit('新的账本正文，应当保存并贴耳，隐藏面板不计算。', 100);
        await delay(250);
        const refreshes = w.refreshes, estimates = w.estimates, epUpdates = w.epUpdates;
        p.ipeLedgerSync(); p.ipeLedgerScheduleEstimate(); await delay(500);
        check(w.refreshes === refreshes && w.estimates === estimates, '两处面板隐藏时，同步不刷新配置、不重拼字数');
        check(w.epUpdates > epUpdates, '隐藏面板不影响真实贴耳更新');
        p.ipeToggleMiniPanel(); await delay(150);
        check(d.querySelector('#ipe-ledger-text').value.includes('新的账本正文'), '打开面板立即显示最新账本');
        check(w.refreshes > refreshes, '打开面板补齐配置刷新');
        p.ipeToggleMiniPanel();
        p.ipeLedgerCommit('两处面板都关闭之后才写入的账本。', 100); p.ipeLedgerSync();
        drawer.style.display = 'block'; await delay(300);
        check(d.querySelector('#iped-ledger-text').value.includes('两处面板都关闭之后'), '酒馆抽屉打开时也刷新最新账本');
        // 字数区所在 details 真正展开才计算；排队后关闭时不再计算。
        const size = d.querySelector('#iped-ledger-size');
        for (let el = size; el; el = el.parentElement) if (el.tagName === 'DETAILS') el.open = true;
        await delay(700);
        const beforeVisibleEstimate = w.estimates;
        p.ipeLedgerScheduleEstimate(); await delay(500);
        check(w.estimates > beforeVisibleEstimate, '字数区可见时仍正常计算');
        const beforeClose = w.estimates;
        p.ipeLedgerScheduleEstimate(); drawer.style.display = 'none'; await delay(500);
        check(w.estimates === beforeClose, '排队后关面板，取消无用字数计算');

        d.body.insertAdjacentHTML('beforeend', '<div id="chat">' + tavern.chat.map((m, i) =>
            '<div class="mes" mesid="' + i + '"><div class="mes_text">正文</div><div class="mes_buttons"><span class="extraMesButtonsHint"></span></div></div>').join('') + '</div>');
        p.ipeLedgerRenderInline();
        const box = d.querySelector('.ipe-ledger-inline'); box.open = true;
        let mutations = 0;
        const obs = new w.MutationObserver(rs => mutations += rs.length);
        obs.observe(d.querySelector('#chat'), { childList: true, subtree: true, characterData: true });
        p.ipeLedgerRenderInline(); p.ipeLedgerRenderInline(); await delay(20);
        check(d.querySelector('.ipe-ledger-inline') === box && box.open && mutations === 0, '同内容反复同步不修改正文 DOM，保留展开状态');
        p.ipeLedgerCommit('更新后的账本内容，仍需保持同一个折叠壳。', 100); p.ipeLedgerRenderInline(); await delay(20);
        check(d.querySelector('.ipe-ledger-inline') === box && box.textContent.includes('更新后的账本') && box.open, '新内容原位更新，不拆掉账本节点');
        settings.ledgerInlineShow = false; p.ipeLedgerRenderInline();
        check(!d.querySelector('.ipe-ledger-inline'), '关闭楼内展示仍会移除旧节点'); obs.disconnect();

        p.ipeInstallMesButtonsObserver(); w.rowBatches.length = 0;
        const last = d.querySelector('.mes[mesid="99"]');
        for (let i = 0; i < 20; i++) last.querySelector('.mes_text').textContent = '流式正文' + i;
        await delay(350);
        check(w.rowBatches.length === 0, '100 楼聊天内的正文流式变化不启动按钮扫描');
        p.ipeRememberInjectTag(tavern.chat[99], '<draw>画</draw>', '画', null);
        last.querySelector('.mes_buttons').insertAdjacentHTML('beforeend', '<span>其他扩展按钮</span>');
        await delay(350);
        check(!!last.querySelector('.ipe-mes-reinject') && w.rowBatches.every(n => n === 1), '操作栏变化只检查该楼，按钮仍正常补齐');
        w.rowBatches.length = 0;
        last.querySelector('.ipe-mes-reinject').remove(); await delay(350);
        check(!!last.querySelector('.ipe-mes-reinject'), '按钮被其他扩展删掉后仍可修复');
        tavern.chat.push({is_user:false, mes:'新 AI 楼'});
        p.ipeRememberInjectTag(tavern.chat[100], '<draw>新画</draw>', '新画', null);
        d.querySelector('#chat').insertAdjacentHTML('beforeend', '<div class="mes" mesid="100"><div class="mes_text">新楼</div><div class="mes_buttons"></div></div>');
        await delay(350);
        check(!!d.querySelector('.mes[mesid="100"] .ipe-mes-reinject') && !w.rowBatches.includes('all'), '新增楼安装按钮，全程没有扫描历史全部楼');

        function response(chunks) {
            let i = 0;
            return { body: { getReader: () => ({ read: async () => i < chunks.length ?
                { done:false, value:new TextEncoder().encode(chunks[i++]) } : {done:true} }) } };
        }
        // 仅在测试副本记录内部兜底缓冲长度，确认不会随着思考流增长。
        w.eval('window.rawSizes = []; window.measuredStream = ' + p.ipeLedgerReadStream.toString().replace('report(false);', 'window.rawSizes.push(allText.length); report(false);'));
        const reasoning = 'data: ' + JSON.stringify({choices:[{delta:{reasoning_content:'思考'.repeat(500)}}]}) + '\n\n';
        const out = await w.measuredStream(response([reasoning, reasoning, 'data: {"choices":[{"delta":{"content":"账本"}}]}\n', 'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\ndata: [DONE]\n']));
        check(out.text === '账本' && out.reasonChars === 2000 && out.finish === 'stop', '释放原始响应不影响正文、思考字数和结束原因');
        check(w.rawSizes.every(n => n === 0), '每块已识别 SSE 处理后，原始响应缓冲均为空');
        const json = JSON.stringify({choices:[{message:{content:'非流式兜底'}, finish_reason:'stop'}]});
        const fallback = await p.ipeLedgerReadStream(response([json.slice(0, 13), json.slice(13)]));
        check(fallback.text === '非流式兜底', '中转返回分块普通 JSON 时仍正确兜底');
        const split = await p.ipeLedgerReadStream(response(['data: {"choices":[{"delta":', '{"content":"跨块"}}]}\n\n']));
        check(split.text === '跨块', '跨网络块的 SSE 行正常解析');
        console.log('通过 ' + count + ' 项收尾负载回归');
    } finally { w.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

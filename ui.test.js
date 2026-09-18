// UI-only regression checks reuse the fake SillyTavern fixture from the ledger suite.
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = fs.readFileSync(__dirname + '/ledger.test.js', 'utf8').split('\nconsole.log(')[0];
const boot = new Function('require', '__dirname', fixture + '\nreturn boot;')(require, __dirname);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
    const { w, tavern } = boot(10);
    let count = 0, requests = 0;
    const check = (yes, label) => { assert.ok(yes, label); console.log('✓ ' + label); count++; };
    try {
        w.fetch = async () => { requests++; throw Error('UI must not call API'); };
        w.eval('window.ui = { createPanel, createDrawer, ipeArrangeUI, bindAll, ipeSetActiveTab, ipeFoldStates, ipeInstallZoomButtons, ipeZoomOpen, ipeZoomClose };');
        const d = w.document;
        d.body.insertAdjacentHTML('beforeend', '<div id="extensions_settings2"></div>');
        w.jQuery = selector => { const el = d.querySelector(selector); return { length: el ? 1 : 0, append: html => el.insertAdjacentHTML('beforeend', html) }; };
        w.ui.createPanel(); w.ui.createDrawer();
        w.jQuery = undefined;
        const beforeIDs = [...d.querySelectorAll('#ipe-panel [id], #ipe-drawer [id]')].map(el => el.id).sort();
        w.ui.ipeArrangeUI(); w.ui.bindAll(); await delay(200);
        const panel = d.querySelector('#ipe-panel'), drawer = d.querySelector('#ipe-drawer');
        check(JSON.stringify(beforeIDs) === JSON.stringify([...d.querySelectorAll('#ipe-panel [id], #ipe-drawer [id]')].map(el => el.id).sort()), '整理前后所有控件 ID 原样保留');
        check(new Set(beforeIDs).size === beforeIDs.length, '两处入口没有重复控件 ID');
        check(panel.querySelector('.ipe-sections').firstElementChild.id === 'ipe-section-preview', '浮窗预览在生图配置之前');
        check(drawer.querySelector('[data-ipe-tab="image"]').firstElementChild.dataset.ipeFold === 'drawer-image-preview', '抽屉预览在生图配置之前');
        check(drawer.querySelector('.inline-drawer-content').firstElementChild.classList.contains('ipe-tabs'), '抽屉导航置顶');
        for (const key of ['api', 'system', 'template', 'anchors', 'rules']) check(!drawer.querySelector('[data-ipe-fold="drawer-image-' + key + '"]').open, '抽屉 ' + key + ' 默认收起');
        for (const prefix of ['ipe', 'iped']) {
            const auto = d.querySelector('#' + prefix + '-ledger-auto');
            const text = d.querySelector('#' + prefix + '-ledger-text');
            check(!!(auto.compareDocumentPosition(text) & w.Node.DOCUMENT_POSITION_FOLLOWING), prefix + '自动挂账在账本前');
            check(!auto.closest('details'), prefix + '自动挂账无需展开设置');
            const api = d.querySelector('#' + prefix + '-ledger-api').closest('details');
            check(api && !api.open, prefix + '副 AI 配置折叠');
            check(!d.querySelector('#' + prefix + '-ledger-prompt').closest('details').open, prefix + '挂账规则折叠');
            check(!text.closest('details'), prefix + '账本编辑保持直接可见');
        }
        for (const prefix of ['ipe', 'iped']) {
            const el = suffix => d.querySelector('#' + prefix + '-ledger-' + suffix);
            check(!!el('text').closest('.ipe-desk-record') && !!el('save').closest('.ipe-desk-record'), prefix + '账本与保存位于当前账本卡');
            check(!!el('order').closest('.ipe-desk-request') && !!el('extra').closest('.ipe-desk-request'), prefix + '长期指令与一次性补充位于本次挂账卡');
            for (const suffix of ['run', 'preview-box', 'stop', 'force']) check(!!el(suffix).closest('.ipe-desk-request') && !el(suffix).closest('details'), prefix + suffix + '不会被低频折叠隐藏');
            check(!!el('export').closest('.ipe-desk-tools') && !!el('inherit').closest('.ipe-desk-tools') && !!el('age').closest('.ipe-desk-tools'), prefix + '备份继承历史集中收纳');
            check(!!el('api').closest('.ipe-desk-settings') && !!el('prompt').closest('.ipe-desk-settings'), prefix + '规则与连接集中在底部');
            check(!!el('inline').closest('.ipe-desk-display') && !!el('ep-enabled').closest('.ipe-desk-display'), prefix + '显示设置集中收起');
        }
        const header = panel.querySelector('#ipe-section-api-config > .ipe-section-header');
        check(header.tagName === 'BUTTON' && header.type === 'button', '配置标题是可键盘操作的按钮');
        header.click();
        check(header.getAttribute('aria-expanded') === 'true', '展开时辅助状态同步');
        const apiFold = drawer.querySelector('[data-ipe-fold="drawer-image-api"]'); apiFold.open = true;
        await delay(30);
        w.ui.ipeArrangeUI();
        check(apiFold.open && header.getAttribute('aria-expanded') === 'true', '重复整理不覆盖用户开合状态');
        check(w.ui.ipeFoldStates()['drawer-image-api'] === true, '抽屉开合状态已记住');
        const endpoint = d.querySelector('#ipe-api-endpoint');
        endpoint.value = 'https://example.org/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true })); endpoint.dispatchEvent(new w.Event('change', { bubbles: true }));
        await delay(100);
        check(tavern.extensionSettings['image-prompt-extractor'].apiEndpoint === 'https://example.org/v1', '整理后的 API 字段仍正常保存');
        w.ui.ipeSetActiveTab('ledger');
        check(panel.querySelector('#ipe-section-ledger').style.display !== 'none' && drawer.querySelector('[data-ipe-tab="image"]').style.display === 'none', '挂账切页在两处入口正常');
        w.ui.ipeInstallZoomButtons();
        const rule = d.querySelector('#ipe-ledger-prompt');
        check(!!rule.parentElement.querySelector('.ipe-zoom-btn'), '收起的规则仍可放大编辑');
        check(requests === 0, '整理与保存没有发送 API 请求');

        // 2.19.4 拉模型说清楚：新增预设后不挂旧列表；拉取失败清空旧列表、按钮旁报错、弹卡
        w.eval('window.ui.ipeGetApiProfiles = ipeGetApiProfiles; window.ui.ipeGetActiveApiProfileId = ipeGetActiveApiProfileId;');
        const settings = tavern.extensionSettings['image-prompt-extractor'];
        const modelSel = d.querySelector('#ipe-model'), modelSelDrawer = d.querySelector('#iped-model');
        const options = sel => [...sel.options].map(o => o.value);
        const calls = [];
        w.fetch = async (url, opts) => {
            calls.push({ url, auth: (opts && opts.headers && opts.headers.Authorization) || '' });
            if (url.indexOf('broken') >= 0) return { ok: false, status: 404, text: async () => '<html>not found</html>' };
            return { ok: true, status: 200, text: async () => JSON.stringify({ data: url.indexOf('old.example') >= 0 ? [{ id: 'old-a' }, { id: 'old-b' }] : [{ id: 'new-x' }] }) };
        };
        const key = d.querySelector('#ipe-api-key');
        endpoint.value = 'https://old.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        key.value = 'sk-old'; key.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['', 'old-a', 'old-b']), '旧预设拉到列表');
        const oldProfile = w.ui.ipeGetActiveApiProfileId();
        d.querySelector('#ipe-api-profile-add').click(); await delay(30);
        check(w.ui.ipeGetActiveApiProfileId() !== oldProfile, '新增后切到新预设');
        check(settings.model === '' && JSON.stringify(options(modelSel)) === JSON.stringify(['']) && modelSel.options[0].textContent === '请先加载模型', '新增预设不沿用旧模型，下拉只剩「请先加载模型」');
        check(JSON.stringify(options(modelSelDrawer)) === JSON.stringify(['']), '抽屉的下拉同样清空');
        endpoint.value = 'https://broken.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        key.value = 'sk-new'; key.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        const last = calls[calls.length - 1];
        check(last.url === 'https://broken.example/v1/models' && last.auth === 'Bearer sk-new', '请求打到新地址并带新 key');
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['']) && modelSel.options[0].textContent.indexOf('拉取失败') === 0, '拉取失败：下拉不再挂旧列表，占位写明失败');
        const ms = d.querySelector('#ipe-models-status');
        check(ms.style.display !== 'none' && ms.textContent.indexOf('拉取失败') === 0 && ms.textContent.indexOf('404') >= 0, '按钮下方直接写失败原因');
        check(!!ms.closest('#ipe-section-api-config'), '失败原因就在 API 配置区，不用往上翻');
        const cardTitles = [...d.querySelectorAll('#ipe-notice-stack .ipe-notice-title')].map(el => el.textContent);
        const cardBody = [...d.querySelectorAll('#ipe-notice-stack .ipe-notice-body')].map(el => el.textContent).join('\n');
        check(cardTitles.indexOf('小海螺 · 拉取模型失败') >= 0 && cardBody.indexOf('https://broken.example/v1/models') >= 0, '弹了错误卡并写明请求地址');
        endpoint.value = 'https://new.example/v1'; endpoint.dispatchEvent(new w.Event('input', { bubbles: true }));
        d.querySelector('#ipe-btn-models').click(); await delay(50);
        check(JSON.stringify(options(modelSel)) === JSON.stringify(['', 'new-x']) && settings.model === 'new-x', '换对地址后拉到新列表并选中');
        const profileSel = d.querySelector('#ipe-api-profile');
        profileSel.value = oldProfile; profileSel.dispatchEvent(new w.Event('change', { bubbles: true })); await delay(30);
        check(settings.model === 'old-a' && JSON.stringify(options(modelSel)) === JSON.stringify(['', 'old-a']) && modelSel.value === 'old-a', '切回旧预设：只留它已保存的模型，不显示新预设的列表');

        // 2.19.5/2.19.6 iOS 减负：观察器防乒乓；镜像只在写过时重读；浮标原样保留
        w.eval('window.ui.createChatQuickButton = createChatQuickButton; window.ui.ipeLedgerCommit = ipeLedgerCommit; window.ui.ipeLedgerRenderInline = ipeLedgerRenderInline; window.ui.ipeLedgerInstallInlineObserver = ipeLedgerInstallInlineObserver; window.ui.ipeLedgerSync = ipeLedgerSync; window.ui.ipeLedgerRefreshInherit = ipeLedgerRefreshInherit; window.ui.ipeLedgerSave = ipeLedgerSave; window.ui.ipeLedgerRead = ipeLedgerRead;');
        settings.showQuickEntry = true;
        w.ui.createChatQuickButton();
        const cap = d.querySelector('#ipe-chat-quick-entry');
        check(!!cap && !!cap.querySelector('animate') && String(cap.getAttribute('style') || '').includes('drop-shadow'), '浮标波纹动画与阴影滤镜按作者要求原样保留（2.19.6）');
        // 楼内展示：装一个「看到就抹掉」的敌对观察器，模拟别的扩展整楼重画
        d.body.insertAdjacentHTML('beforeend', '<div id="chat">' + tavern.chat.map((m, i) => '<div class="mes" mesid="' + i + '"' + (m.is_user ? ' is_user="true"' : '') + '><div class="mes_text">第 ' + (i + 1) + ' 楼</div></div>').join('') + '</div>');
        w.ui.ipeLedgerCommit('账本正文，够长够长够长够长够长够长够长够长。', tavern.chat.length);
        let wiped = 0;
        const hostile = new w.MutationObserver(recs => { recs.forEach(r => r.addedNodes.forEach(n => { if (n.classList && n.classList.contains('ipe-ledger-inline')) { wiped++; n.remove(); } })); });
        hostile.observe(d.querySelector('#chat'), { childList: true, subtree: true });
        w.ui.ipeLedgerInstallInlineObserver();
        w.ui.ipeLedgerRenderInline();
        await delay(3200);
        const wipedAt3s = wiped;
        check(wipedAt3s >= 2 && wipedAt3s <= 8, '楼内块被反复抹掉时补块有上限（3 秒内 ' + wipedAt3s + ' 次），不会无限乒乓');
        await delay(1200);
        check(wiped === wipedAt3s, '进入冷却后不再跟着别人的变动补块');
        w.ui.ipeLedgerSync(); await delay(30);
        check(wiped === wipedAt3s + 1, '冷却期间自己的落账 / 同步照常重绘楼内块');
        hostile.disconnect();
        // 继承列表：没写镜像就不重读 localStorage
        w.eval('window.ui.LSK = IPE_LEDGER_LS_KEY;');
        let lsReads = 0;
        const rawGet = w.Storage.prototype.getItem;   // jsdom 的 Storage 实例上赋值会变成存一个键，得改原型
        w.Storage.prototype.getItem = function(k){ if (k === w.ui.LSK) lsReads++; return rawGet.call(this, k); };
        w.ui.ipeLedgerRefreshInherit(); w.ui.ipeLedgerRefreshInherit(); w.ui.ipeLedgerRefreshInherit();
        const readsBefore = lsReads;
        w.ui.ipeLedgerSave(w.ui.ipeLedgerRead());
        const readsAfterSave = lsReads;
        w.ui.ipeLedgerRefreshInherit();
        check(readsBefore <= 1 && lsReads > readsAfterSave, '「继承账本」列表只在镜像写过之后才重读（连刷三次只读 ' + readsBefore + ' 次）');
        w.Storage.prototype.getItem = rawGet;
        check(!!d.querySelector('#ipe-ledger-size'), '字数估算灰字仍然存在（改为空闲时算）');

        // 2.19.12 粉蓝海滩：配色按钮五档循环，海滩叠在浅色皮上
        w.eval('window.ui.ipeApplyTheme = ipeApplyTheme;');
        settings.mistTheme = false; settings.apricotTheme = false; settings.jadeTheme = false; settings.beachTheme = false; w.ui.ipeApplyTheme();
        const tt = d.querySelector('#ipe-theme-toggle');
        const modeOf = () => ['beach','jade','apricot','mist'].find(k => panel.classList.contains('ipe-' + k)) || 'night';
        const seq = [modeOf() + tt.textContent];
        for (let i = 0; i < 5; i++) { tt.click(); seq.push(modeOf() + tt.textContent); }
        check(seq.join(' ') === 'night🌙 mist☀️ apricot🌅 jade🌊 beach🏝️ night🌙', '配色五档循环：月潮 → 海雾 → 杏岸 → 碧岸 → 粉蓝海滩 → 月潮（' + seq.join(' ') + '）');
        for (let i = 0; i < 4; i++) tt.click();
        check(settings.mistTheme === true && settings.beachTheme === true && settings.jadeTheme === false && settings.apricotTheme === false && panel.classList.contains('ipe-mist') && panel.classList.contains('ipe-beach') && !panel.classList.contains('ipe-jade'), '粉蓝海滩 = 浅色皮 + ipe-beach，杏岸 / 碧岸标记都清掉');
        check(fs.readFileSync(__dirname + '/style.css', 'utf8').includes('html body:has(#ipe-panel.ipe-beach) #ipe-chat-quick-entry svg stop:first-child'), '浮标有海滩配色规则');
        console.log('通过 ' + count + ' 项');
    } finally { w.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });

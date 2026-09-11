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
        console.log('通过 ' + count + ' 项');
    } finally { w.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });

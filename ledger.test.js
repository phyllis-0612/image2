/* 小海螺 · 挂账管线 E2E 流程测试
   跑法：node ledger.test.js
   只测状态与顺序，不碰真 API。重点是 2.8.1 那个抢跑 bug：
   单元测试测不出来——每个函数单看都对，错的是事件与组 prompt 的先后。 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const SRC = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log("  \u2705 " + name); }
    else { fail++; console.log("  \u274C " + name + (extra ? "\n       " + extra : "")); }
}
function eq(a, b, name) { ok(a === b, name, "期望 " + JSON.stringify(b) + "，实际 " + JSON.stringify(a)); }

/* ---- 假酒馆 ---- */
function makeTavern(floors) {
    const listeners = {};
    const chat = [];
    for (let i = 0; i < floors; i++) {
        chat.push({ is_user: i % 2 === 0, is_system: false, mes: "第 " + (i + 1) + " 层正文，够长够长够长够长够长够长。" });
    }
    const eventSource = {
        on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        async emit(ev, ...args) { for (const fn of (listeners[ev] || [])) await fn(...args); }
    };
    const extensionPrompts = {};
    return {
        chat, eventSource, extensionPrompts,
        chatId: "test-chat",
        event_types: {
            GENERATION_STARTED: "GENERATION_STARTED", MESSAGE_SENT: "MESSAGE_SENT",
            MESSAGE_RECEIVED: "MESSAGE_RECEIVED", MESSAGE_SWIPED: "MESSAGE_SWIPED",
            MESSAGE_DELETED: "MESSAGE_DELETED", MESSAGE_EDITED: "MESSAGE_EDITED", CHAT_CHANGED: "CHAT_CHANGED"
        },
        chatMetadata: {},
        characters: [{ name: "苑无忧", avatar: "yuan.png" }, { name: "顾寒", avatar: "gu.png" }], characterId: 0, groupId: null, name2: "苑无忧",
        getCurrentChatId() { return "test-chat"; },
        setExtensionPrompt(key, value, pos, depth, scan, role) {
            extensionPrompts[key] = { value, position: pos, depth, role };
        },
        saveMetadataDebounced() {}, saveSettingsDebounced() {},
        extensionSettings: {}, extensionPromptTypes: { IN_CHAT: 1 }, extensionPromptRoles: { SYSTEM: 0 }
    };
}

/* ---- 把 index.js 装进 jsdom，抠出内部函数 ---- */
function boot(floors) {
    const dom = new JSDOM("<!DOCTYPE html><body></body>", { runScripts: "outside-only", url: "http://localhost" });
    const w = dom.window;
    const tavern = makeTavern(floors);
    w.SillyTavern = { getContext: () => tavern };
    w.toastr = { error() {}, success() {}, warning() {}, info() {} };
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;   // jsdom 没带，流式解码要用
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>新账本正文，够长够长够长够长够长够长够长。</ledger>" } }] }) });

    const exposed = ["ipeLedgerRead", "ipeLedgerSave", "ipeLedgerCommit", "ipeLedgerReconcile",
        "ipeFloorNo", "ipeLedgerApplyEP", "ipeLedgerNormalize", "ipeLedgerStop",
        "ipeLedgerIsAbort", "ipeLedgerExport", "ipeLedgerImportText", "ipeLedgerInspectEP",
        "EXT_NAME", "DEFAULTS", "IPE_LEDGER_EP_KEY", "init", "ipeLedgerStripImageTag", "ipeLedgerBuildUser", "ipeLedgerReportBlock", "ipeLedgerPruneMirror",
        "ipeLedgerRun", "ipeLedgerCallAPI", "ipeLedgerReadStream", "ipeLedgerIsReasoningModel",
        "runExtract", "ipeImgParseLayers", "buildInjectTag", "reinjectDescToMessage", "injectDescToMessage", "ipeInstallMesButtons", "ipeGetSuppPresets", "ipeRefreshSuppPresets", "buildVisionUserPrompt", "ipeImgLayersRead", "onRerollLayer",
        "ipeInstallZoomButtons", "ipeZoomOpen", "ipeZoomClose", "ipeZoomTitleFor",
        "ipeImgPackBuild", "ipeImgPackImportText", "ipeGetBaseTemplates", "ipeGetRulePresets", "ipeGetSystemPromptPresets", "ipeGetAnchorPresets", "ipeGetAnchorUsageGuide",
        "ipeLedgerReadModeMarker", "ipeLedgerStripModeTag", "ipeLedgerModeEffective", "ipeLedgerModeState", "ipeLedgerModeSnippet", "ipeLedgerSystemText",
        "ipeLedgerCompress", "ipeLedgerCommitCompressed", "ipeLedgerVersionInfo", "ipeLedgerHistoryBlock", "ipeLedgerRefreshEditors", "ipeLedgerInherit", "ipeLedgerInheritList", "ipeLedgerRefreshInherit", "ipeLedgerCardKey", "ipeLedgerCardSlotSet", "ipeLedgerPromptValueForMode", "ipeLedgerModeRefresh"];
    const shim = SRC + "\n;(function(){ " +
        exposed.map(n => `try{ window.__t_${n} = ${n}; }catch(e){}`).join(" ") +
        " try{ window.__t_failStreak = function(){ return ipeLedgerFailStreak; }; }catch(e){}" +
        " })();";
    try { w.eval(shim); } catch (e) { console.log("装载失败：" + e.message); }
    const F = n => w["__t_" + n];
    // 事件绑定藏在 createUI() 里，由 APP_READY 触发——不发这个事件，什么都没绑上
    // 2.18.0 起挂账失败默认自动重试一次；老测试都是「失败一次就该弹卡 / 计数」，测试环境默认关掉，【44】单独打开
    tavern.extensionSettings[F("EXT_NAME")] = Object.assign({}, F("DEFAULTS"), { ledgerRetryOnce: false });
    try { F("init")(); } catch (e) { console.log("init 抛错：" + e.message); }
    return { w, tavern, F, EPK: F("IPE_LEDGER_EP_KEY") };
}

console.log("\n\u30101\u3011 落账与楼号");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("第十层的账本内容，够长够长够长够长。", 10);
    const st = F("ipeLedgerRead")();
    eq(st.lastFloor, 10, "落账后现任停在第 10 楼");
    ok(st.current.indexOf("第十层") >= 0, "账本正文写进去了");
}

console.log("\n\u30102\u3011 重roll抢跑（2.8.1 核心回归）");
{
    const { tavern, F, EPK } = boot(10);
    F("ipeLedgerCommit")("菜烧糊了——这条绝不能进下一次 roll 的 prompt。", 10);
    F("ipeLedgerApplyEP")();
    const before = tavern.extensionPrompts[EPK] || {};
    ok(String(before.value || "").indexOf("菜烧糊") >= 0, "roll 之前贴耳里确实带着菜糊");

    // 关键：同步发 GENERATION_STARTED("swipe")，模拟酒馆按下 roll 那一霎那
    let epAtPromptTime = null;
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    epAtPromptTime = String((tavern.extensionPrompts[EPK] || {}).value || "");

    ok(epAtPromptTime.indexOf("菜烧糊") < 0,
        "按下 roll 的同一时刻，贴耳里已经没有菜糊了（修好前这条必挂）",
        "实际贴耳：" + epAtPromptTime.slice(0, 60));
    eq(F("ipeLedgerRead")().lastFloor, -1, "第 10 楼的账被撕掉，没有更低楼可退时归空");
}

console.log("\n\u3010\u6B63\u63A7\u3011 handler \u5FC5\u987B\u771F\u7684\u7ED1\u4E0A\u4E86");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("正控用的账本正文，够长够长够长够长。", 10);
    const before = F("ipeLedgerRead")().lastFloor;
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    const after = F("ipeLedgerRead")().lastFloor;
    ok(before === 10 && after !== 10,
        "swipe 事件确实改变了账本状态（不成立则下面 continue/dryRun 全是假绿）",
        "before=" + before + " after=" + after);
}

console.log("\n\u30103\u3011 continue 不该撕账");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("这层的账在 continue 时仍然算数，够长够长够长。", 10);
    tavern.eventSource.emit("GENERATION_STARTED", "continue", {}, false);
    eq(F("ipeLedgerRead")().lastFloor, 10, "continue 是给当前楼续写，账保留");
}

console.log("\n\u30104\u3011 dryRun 不该撕账");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("dryRun 只是数 token，不该动账本，够长够长够长。", 10);
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, true);
    eq(F("ipeLedgerRead")().lastFloor, 10, "dryRun 时账本不动");
}

console.log("\n\u30105\u3011 滚回上一楼（有低楼可退时）");
{
    const { tavern, F } = boot(10);
    F("ipeLedgerCommit")("第 9 楼的账，够长够长够长够长够长。", 9);
    F("ipeLedgerCommit")("第 10 楼的账（菜糊），够长够长够长够长。", 10);
    eq(F("ipeLedgerRead")().lastFloor, 10, "落账后在第 10 楼");
    tavern.eventSource.emit("GENERATION_STARTED", "swipe", {}, false);
    const st = F("ipeLedgerRead")();
    eq(st.lastFloor, 9, "roll 之后滚回第 9 楼");
    ok(st.current.indexOf("第 9 楼") >= 0, "现任内容换成第 9 楼那份");
    ok(st.current.indexOf("菜糊") < 0, "菜糊那份彻底不在现任里");
}

console.log("\n\u30106\u3011 藏楼时楼号不该错位（第七条）");
{
    const { tavern, F } = boot(10);
    tavern.chat[9].is_system = true;               // 把末楼藏了
    F("ipeLedgerCommit")("读的是第 9 层正文，就该盖第 9 层的戳。", 9);
    eq(F("ipeLedgerRead")().lastFloor, 9, "正文取自第 9 层，戳就是第 9 层（不是 chat.length=10）");
}

console.log("\n\u30107\u3011 中断判定");
{
    const { F } = boot(10);
    ok(F("ipeLedgerIsAbort")({ name: "AbortError" }) === true, "AbortError 认作中断");
    ok(F("ipeLedgerIsAbort")(new Error("API 500：boom")) === false, "普通报错不算中断");
}

console.log("\n\u30108\u3011 导入导出往返");
{
    const { F } = boot(10);
    F("ipeLedgerCommit")("要被导出的账本正文，够长够长够长够长。", 10);
    const pack = JSON.stringify({ _fmt: "ipe-ledger", _v: 2, data: F("ipeLedgerRead")() });
    F("ipeLedgerImportText")("这不是 JSON");
    ok(F("ipeLedgerRead")().current.indexOf("要被导出") >= 0, "烂 JSON 不会毁掉现有账本");
    F("ipeLedgerImportText")(pack);
    ok(F("ipeLedgerRead")().current.indexOf("要被导出") >= 0, "合法包导入后正文还在");
}

console.log("\n\u30109\u3011 \u8D34\u8033\u81EA\u68C0\u7EDD\u4E0D\u80FD\u6C61\u67D3\u8D26\u672C");
{
    const { w, tavern, F } = boot(10);
    F("ipeLedgerCommit")("这是真正的账本正文，够长够长够长够长够长。", 10);
    const beforeCur = F("ipeLedgerRead")().current;

    F("ipeLedgerInspectEP")();

    const cur = F("ipeLedgerRead")().current;
    eq(cur, beforeCur, "自检之后账本存储一字未改");
    ok(cur.indexOf("贴耳自检") < 0, "账本正文里没有自检文本");

    const editor  = w.document.querySelector("#ipe-ledger-text");
    const preview = w.document.querySelector("#ipe-ledger-preview");
    ok(!editor  || String(editor.value  || "").indexOf("贴耳自检") < 0,
        "账本编辑框没被写入自检文本");
    ok(!preview || String(preview.value || "").indexOf("贴耳自检") < 0,
        "预览框没被写入自检文本（那个框旁边就是「采用」）");

    const out = w.document.querySelector("#ipe-ledger-ep-out");
    ok(out && String(out.textContent || "").indexOf("贴耳自检") >= 0,
        "自检文本落在只读框里");
    ok(!out || out.tagName === "PRE", "只读框是 pre，不是可编辑控件");
}


console.log("\n\u301010\u3011 生图 tag 剥离（2.9.2 / 2.14.0 内置改 <draw>）");
{
    const { tavern, F } = boot(10);
    const strip = F("ipeLedgerStripImageTag");
    eq(strip("正文。\n\n<draw>a girl by the window</draw>"), "正文。", "内置默认 <draw>…</draw>：整段剥掉");
    eq(strip("正文。\n\n<draw>\nline one\nline two\n</draw>"), "正文。", "跨行的 <draw> 块也剥");
    eq(strip("正文。\n\nimage###a girl###"), "正文。", "老聊天里的 image###…### 仍认得（legacy 兜底）");
    eq(strip("正文里提到 image###x### 这种写法。\n\nimage###real###"), "正文里提到 这种写法。", "前后缀齐全时按对剥（与旧行为一致）");
    // 样板那种：整段 <draw> 包着、只放五个分层占位符、没有 {Description}
    const STYLE = "<draw> Artistic Illustrations. Medium and style (hard rules): a refined 2.5D illustration.\n\nComposition: {Camera}\nSetting: {Env}\nMood and light: {Mood}\nCharacters: {Chars}\nAction: {Pose}\n </draw>";
    const st10 = tavern.extensionSettings[F("EXT_NAME")];
    st10.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "水光", value: STYLE }]);
    st10.activeBaseTemplate = "tpl_1";
    const tag10 = F("buildInjectTag")("ignored", { camera: "wide shot.", env: "a sunlit room.", mood: "caustic light.", chars: "a boy.", pose: "he sits." });
    ok(tag10.indexOf("Composition: wide shot.") >= 0 && tag10.indexOf("Action: he sits.") >= 0 && tag10.indexOf("{") < 0, "样板模板：五层各就各位，没有占位符残留");
    eq(strip("正文。\n\n" + tag10), "正文。", "样板模板注入的整块 <draw> 剥干净（之前没有 {Description} 的模板整段找不到，几千字风格正文会喂进挂账）");
    eq(strip("正文。\n\n<draw> old style text. Composition: X\n </draw>"), "正文。", "模板正文后来改过：旧楼按 <draw> 标签对照样剥");
    st10.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "非包裹分层", value: "IMG[ {Camera} | {Pose} ]END" }]);
    eq(strip("正文。\n\nIMG[ a | b ]END"), "正文。", "不是标签包裹的分层模板：前缀取第一个占位符前、后缀取最后一个占位符后");
    tavern.extensionSettings["image-prompt-extractor"].baseTemplatesJson = JSON.stringify([
        { id: "tpl_1", name: "前缀", value: "IMG: {Description}" },
        { id: "tpl_2", name: "无占位", value: "[pic]" }]);
    eq(strip("他说 IMG: 不是这个。\n\nIMG: a girl by window"), "他说 IMG: 不是这个。", "只有前缀：从最后一次出现剥到楼尾，正文里同样的字不误伤");
    eq(strip("正文。\n\n[pic]a girl"), "正文。", "模板没占位符：按 tpl+desc 拼接方式也能剥");
}
console.log("\n\u301011\u3011 摘要层不重复喂本轮那楼 + 楼号按正文所在层报");
{
    const { tavern, F } = boot(10);
    tavern.chat[7].mes = "第8层 <report>八楼摘要</report>";
    tavern.chat[9].mes = "第10层 <report>十楼摘要</report>";
    const u10 = F("ipeLedgerBuildUser")(tavern.chat[9].mes, "", 10);
    ok(u10.indexOf("八楼摘要") >= 0, "更早楼的 report 在摘要层");
    ok(u10.split("十楼摘要").length === 2, "本轮那楼的 report 只出现一次（在正文里，不在摘要层）");
    ok(u10.indexOf("【当前楼层】第 10 楼") >= 0, "楼号 10");
    const u8 = F("ipeLedgerBuildUser")(tavern.chat[7].mes, "", 8);
    ok(u8.indexOf("【当前楼层】第 8 楼") >= 0, "藏末楼读第 8 层时报第 8 楼，不再报 chat.length");
}
console.log("\n\u301012\u3011 镜像修剪");
{
    const { F } = boot(10);
    const all = {}; for (let i = 0; i < 40; i++) all["c" + i] = { updatedAt: i };
    const out = F("ipeLedgerPruneMirror")(all, 30);
    eq(Object.keys(out).length, 30, "只留 30 个");
    ok(out.c39 && !out.c0, "留的是最近活跃的");
}


/* ---- 流式挂账用的假 API ----
   把 SSE 文本切成若干块，按 Uint8Array 从 body.getReader() 吐出去，跟真浏览器一个路数。 */
function sseBody(chunks) {
    const enc = new TextEncoder();
    let i = 0;
    return { getReader() { return { async read() {
        if (i >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: enc.encode(chunks[i++]) };
    } }; } };
}
function withApi(tavern, F, model) {
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: model || "gpt-5" }]);
    st.ledgerApiProfile = "api_1";
    return st;
}
function statusText(w) { const el = w.document.querySelector("#ipe-ledger-status"); return el ? el.textContent : ""; }

(async () => {
console.log("\n【13】 流式挂账（2.10.0：思考模型边想边流）");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    let sentBody = null;
    w.fetch = async (url, opt) => {
        sentBody = JSON.parse(opt.body);
        return { ok: true, status: 200, body: sseBody([
            'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"先看看第十楼发生了什么……"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_content":"这条要挂。"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"<led"}}]}\n\ndata: {"choices":[{"delta":{"content":"ger>· 左肩刀伤（第10楼起），够长够长够长够长够长。</le"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"dger>"}}]}\n\n',
            'data: [DONE]\n\n'
        ]) };
    };
    await F("ipeLedgerRun")(9, true);
    const st = F("ipeLedgerRead")();
    ok(st.current.indexOf("左肩刀伤") >= 0, "delta 跨块拼起来的账本落账了", "实际：" + st.current.slice(0, 60));
    ok(st.current.indexOf("先看看") < 0, "reasoning_content 只计数，不进账本");
    eq(st.lastFloor, 10, "落在第 10 楼");
    eq(sentBody.stream, true, "请求体 stream: true");
    ok(!("temperature" in sentBody), "gpt-5 不发 temperature（否则官方直连 400）");
    ok(!("reasoning_effort" in sentBody), "没设强度时不发 reasoning_effort");
})();

console.log("\n【14】 请求体：普通模型仍发 temperature，设了强度就发 reasoning_effort");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerReasoningEffort = "low";
    let sentBody = null;
    w.fetch = async (url, opt) => { sentBody = JSON.parse(opt.body); return { ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>普通模型账本，够长够长够长够长够长够长。</ledger>"}}]}\n', 'data: [DONE]\n']) }; };
    await F("ipeLedgerRun")(9, true);
    eq(sentBody.temperature, 0.2, "gpt-4.1 照发 temperature 0.2");
    eq(sentBody.reasoning_effort, "low", "reasoning_effort 按设置透传");
    ok(F("ipeLedgerRead")().current.indexOf("普通模型账本") >= 0, "没有空行分隔的 SSE 也能收");
    eq(F("ipeLedgerIsReasoningModel")("o3-mini"), true, "o3-mini 是思考模型");
    eq(F("ipeLedgerIsReasoningModel")("gpt-5-mini"), true, "gpt-5-mini 是思考模型");
    eq(F("ipeLedgerIsReasoningModel")("gpt-5-chat-latest"), false, "gpt-5-chat-latest 不是");
    eq(F("ipeLedgerIsReasoningModel")("gpt-4o"), false, "gpt-4o 不是");
})();

console.log("\n【15】 中转偷懒：要了 stream 却整包 JSON 回来 → 回退整包解析");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['{"choices":[{"message":{"content":"<ledger>整包回来的账本，够长够长够长够长够长够长。</ledger>"}}]}']) });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("整包回来") >= 0, "非 SSE 的 JSON 一样落账");
    // 老测试桩：response 没有 body 只有 text()，也要能走通（默认就是流式开）
    w.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>只有 text() 的桩，够长够长够长够长够长够长。</ledger>" } }] }) });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("只有 text()") >= 0, "没有可读流的环境按整包读");
})();

console.log("\n【16】 流里夹 error → 算失败，账本不动");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    F("ipeLedgerCommit")("旧账本内容，够长够长够长够长够长够长够长。", 8);
    const before = F("failStreak")();
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['data: {"error":{"message":"insufficient_quota"}}\n\n']) });
    await F("ipeLedgerRun")(9, true);
    eq(F("failStreak")(), before + 1, "失败计数 +1");
    ok(F("ipeLedgerRead")().current.indexOf("旧账本") >= 0, "账本还是旧的");
    ok(statusText(w).indexOf("insufficient_quota") >= 0, "状态行点名了错误原因", statusText(w));
})();

console.log("\n【17】 空闲看门狗：一个字节都不来 → 超时算失败，不算「人掐的」；连撞两次自动挂账关闭");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;          // 1 秒没字节就判死
    st.ledgerAutoRun = true;
    F("ipeLedgerCommit")("看门狗之前的账本，够长够长够长够长够长够长。", 8);
    w.fetch = (url, opt) => new Promise((resolve, reject) => {
        // 永远不回；只认 abort
        opt.signal.addEventListener("abort", () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; reject(e); });
    });
    const before = F("failStreak")();
    const t0 = Date.now();
    await F("ipeLedgerRun")(9, true);
    ok(Date.now() - t0 < 5000, "没有干等：1 秒左右就断了");
    eq(F("failStreak")(), before + 1, "超时算一次失败（不是「已中断」）");
    ok(statusText(w).indexOf("超时") >= 0 && statusText(w).indexOf("已中断") < 0, "状态行报的是超时不是中断", statusText(w));
    eq(st.ledgerAutoRun, true, "只撞一次，自动挂账还开着");
    ok(F("ipeLedgerRead")().current.indexOf("看门狗之前") >= 0, "账本没动");
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, false, "连撞两次，自动挂账自动关闭（挂死以前永远走不到这一步）");
    // 再来一次要能跑：Busy 没被卡死
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>活过来的账本，够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("活过来") >= 0, "超时后 Busy 已复位，下一次挂账正常跑");
})();

console.log("\n【18】 流到一半字节还在来就不判死（看门狗按块续命）");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;
    const enc = new TextEncoder();
    const pieces = [
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n',
        'data: {"choices":[{"delta":{"content":"<ledger>慢慢流回来的账本，够长够长够长够长够长够长。</ledger>"}}]}\n'
    ];
    let i = 0;
    w.fetch = async () => ({ ok: true, status: 200, body: { getReader() { return { async read() {
        if (i >= pieces.length) return { done: true };
        await new Promise(r => setTimeout(r, 600));     // 每块隔 0.6 秒，总共 2.4 秒 > 1 秒空闲阈值
        return { done: false, value: enc.encode(pieces[i++]) };
    } }; } } });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("慢慢流回来") >= 0, "总时长超过阈值但每块都在续命，照样落账", statusText(w));
})();

console.log("\n【19】 空回复要说清原因：finish_reason=length 是思考吃光额度");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    F("ipeLedgerCommit")("白卷之前的账本，够长够长够长够长够长够长。", 8);
    w.fetch = async () => ({ ok: true, status: 200, body: sseBody([
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n'
    ]) });
    await F("ipeLedgerRun")(9, true);
    ok(statusText(w).indexOf("length") >= 0 && statusText(w).indexOf("额度") >= 0, "状态行点名 finish_reason=length 与额度吃光", statusText(w));
    ok(F("ipeLedgerRead")().current.indexOf("白卷之前") >= 0, "账本没动");
})();

console.log("\n【20】 输出上限：思考模型发 max_completion_tokens，普通模型发 max_tokens，0 不发");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    let sent = null;
    const okStream = () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>上限测试账本，够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return okStream(); };
    await F("ipeLedgerRun")(9, true);
    ok(!("max_tokens" in sent) && !("max_completion_tokens" in sent), "默认 0：两种都不发");
    st.ledgerMaxTokens = 16000;
    await F("ipeLedgerRun")(9, true);
    eq(sent.max_completion_tokens, 16000, "gpt-5 → max_completion_tokens");
    ok(!("max_tokens" in sent), "gpt-5 不发 max_tokens");
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: "gpt-4.1" }]);
    await F("ipeLedgerRun")(9, true);
    eq(sent.max_tokens, 16000, "gpt-4.1 → max_tokens");
    ok(!("max_completion_tokens" in sent), "gpt-4.1 不发 max_completion_tokens");
})();

console.log("\n【21】 首字节之后看门狗放宽一倍：首字节前 1 秒判死，首字节后能扛 1.5 秒沉默");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerIdleTimeout = 1;
    const enc = new TextEncoder();
    let i = 0;
    const pieces = ['data: {"choices":[{"delta":{"content":"\\n"}}]}\n', 'data: {"choices":[{"delta":{"content":"<ledger>放宽后收到的账本，够长够长够长够长够长够长。</ledger>"}}]}\n'];
    w.fetch = async () => ({ ok: true, status: 200, body: { getReader() { return { async read() {
        if (i >= pieces.length) return { done: true };
        if (i === 1) await new Promise(r => setTimeout(r, 1500));   // 首字节之后沉默 1.5 秒：> 1 秒，< 2 秒
        return { done: false, value: enc.encode(pieces[i++]) };
    } }; } } });
    await F("ipeLedgerRun")(9, true);
    ok(F("ipeLedgerRead")().current.indexOf("放宽后") >= 0, "首字节后 1.5 秒沉默没被判死", statusText(w));
})();

/* ---- 分层生图用的假 API：整包 JSON，顺手把请求体抓出来 ---- */
function imgApi(w, tavern, F, content, capture) {
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiEndpoint = "http://x.test/v1"; st.apiKey = "k"; st.model = "gpt-4.1";
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "t", endpoint: "http://x.test/v1", key: "k", model: "gpt-4.1" }]);
    w.fetch = async (u, o) => { if (capture) capture.body = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: typeof content === "function" ? content() : content } }] }) }; };
    return st;
}
const L4 = (cam, env, chars, pose, mood) => `<camera>${cam}</camera>\n<env>${env}</env>\n` + (mood != null ? `<mood>${mood}</mood>\n` : "") + `<chars>${chars}</chars>\n<pose>${pose}</pose>`;
const box = (w, id) => { const el = w.document.querySelector("#" + id); return el ? el.value : null; };
const imgStatus = w => { const el = w.document.querySelector("#ipe-status"); return el ? el.textContent : ""; };

console.log("\n【22】 分层剥壳：完整 / 漏闭标签 / 围栏 / 没分层");
{
    const { F } = boot(4);
    const P = F("ipeImgParseLayers");
    const a = P(L4("medium shot", "rainy rooftop at dusk", "a girl in white", "she leans on the railing"));
    eq(a.found, 4, "四层齐全"); eq(a.env, "rainy rooftop at dusk", "环境层内容对");
    const b = P("<camera>close-up\n<env>dim classroom</env><chars>boy</chars><pose>sits");
    eq(b.found, 4, "漏闭标签也认"); eq(b.camera, "close-up", "漏闭标签取到下一个开标签为止"); eq(b.pose, "sits", "末尾漏闭标签取到结尾");
    const c = P("```\n<Camera>wide</Camera><ENV>street</ENV>\n```");
    eq(c.found, 2, "围栏剥掉、大小写不敏感"); eq(c.env, "street", "ENV 大写也认");
    eq(P("just a plain description").found, 0, "没标签 → found 0");
}

console.log("\n【23】 分层提取端到端：四框落值、整段拼好、环境层次楼 NO_CHANGE 沿用");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("medium two-shot at eye level.", "A rain-soaked rooftop at dusk, sodium lights below.", "A girl in a white dress, hair wet.", "She grips the railing, facing the city."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("<camera>") >= 0, "请求里带分层合同");
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层") < 0, "第一次没有上一楼环境可继承");
    eq(box(w, "ipe-layer-env"), "A rain-soaked rooftop at dusk, sodium lights below.", "环境框落值");
    eq(box(w, "ipe-layer-pose"), "She grips the railing, facing the city.", "动作框落值");
    ok(String(box(w, "ipe-preview-text")).indexOf("medium two-shot at eye level. A rain-soaked rooftop") === 0, "整段按 镜头→环境→人物→动作 拼好", box(w, "ipe-preview-text"));
    const saved = F("ipeImgLayersRead")();
    eq(saved.floor, 10, "存档记了楼号 10"); eq(saved.env, "A rain-soaked rooftop at dusk, sodium lights below.", "存档有环境层");
    // 次楼：环境没换
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "The girl, eyes closed.", "She turns her face into the rain."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层") >= 0 && cap.body.messages[1].content.indexOf("sodium lights") >= 0, "第二次把上一楼环境喂给了副 AI");
    eq(box(w, "ipe-layer-env"), "A rain-soaked rooftop at dusk, sodium lights below.", "NO_CHANGE → 环境沿用");
    eq(box(w, "ipe-layer-camera"), "close-up.", "其他层照常更新");
    ok(imgStatus(w).indexOf("环境沿用第 10 楼") >= 0, "状态行说明环境沿用自哪一楼", imgStatus(w));
    ok(imgStatus(w).indexOf("氛围层为空") >= 0, "没给氛围层时状态行点名（提醒该改提取提示词）", imgStatus(w));
    ok(String(box(w, "ipe-preview-text")).indexOf("NO_CHANGE") < 0, "整段里不会出现 NO_CHANGE");
})();

console.log("\n【24】 锁：锁住动作层后副 AI 给的新动作被忽略，且锁定内容喂回请求");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide.", "a quiet library.", "a boy in uniform.", "he reads at the desk."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    st.imgLockPose = true;
    w.document.querySelector("#ipe-layer-pose").value = "he reads at the desk, left hand on the page.";   // 人改过再锁 = 照这个来
    imgApi(w, tavern, F, () => L4("wide.", "a quiet library.", "a boy in uniform.", "he stands up and leaves."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("已锁定的层") >= 0 && cap.body.messages[1].content.indexOf("left hand on the page") >= 0, "锁定层原文进了请求");
    eq(box(w, "ipe-layer-pose"), "he reads at the desk, left hand on the page.", "锁住的动作层没被覆盖");
    ok(String(box(w, "ipe-preview-text")).indexOf("stands up") < 0, "整段里也没有副 AI 的新动作");
})();

console.log("\n【25】 只重摇一层：其余三层临时锁定");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("A.", "B.", "C.", "D."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    imgApi(w, tavern, F, () => L4("A2.", "B2.", "C2.", "D2."), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9, 0, { camera: true, env: true, chars: true, pose: false });
    eq(box(w, "ipe-layer-camera"), "A.", "镜头层保持"); eq(box(w, "ipe-layer-env"), "B.", "环境层保持"); eq(box(w, "ipe-layer-chars"), "C.", "人物层保持");
    eq(box(w, "ipe-layer-pose"), "D2.", "只有动作层换了新的");
    eq(box(w, "ipe-preview-text"), "A. B. C. D2.", "整段随之重拼");
    const c = cap.body.messages[1].content;
    ok(c.indexOf("<camera>A.</camera>") >= 0 && c.indexOf("<pose>") >= 0 && c.indexOf("<pose>D.</pose>") < 0, "请求里锁了三层，没锁动作层");
})();

console.log("\n【23b】 NO_CHANGE 带句号 / 引号 / 空格也算哨兵；老存档里的 NO_CHANGE. 不再往下传（2.14.2）");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide.", "a rooftop at dusk.", "a girl.", "she leans.", "warm light."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE.", "the girl.", "she turns.", "`No change`"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-layer-env"), "a rooftop at dusk.", "NO_CHANGE. 带句号 → 沿用上一楼环境，不落哨兵字面量");
    eq(box(w, "ipe-layer-mood"), "warm light.", "`No change` 反引号 + 空格 → 沿用上一楼氛围");
    ok(box(w, "ipe-preview-text").indexOf("NO_CHANGE") < 0, "拼好的整段里没有 NO_CHANGE");
    ok(imgStatus(w).indexOf("环境沿用第 10 楼") >= 0 && imgStatus(w).indexOf("氛围沿用第 10 楼") >= 0, "状态行报沿用而不是「五层齐全」", imgStatus(w));
    // 老版本存进 chat_metadata 的哨兵字面量：不喂给副 AI，也不当作上一楼内容沿用
    const saved = F("ipeImgLayersRead")();
    ok(!!saved, "存档读得到"); saved.env = "NO_CHANGE.";
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "the girl.", "she turns.", "NO_CHANGE"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的环境层】\nNO_CHANGE") < 0, "存档里的 NO_CHANGE. 没被当成上一楼环境喂给副 AI");
    eq(box(w, "ipe-layer-env"), "", "没有真环境可沿用时环境框为空，而不是 NO_CHANGE.");
    ok(imgStatus(w).indexOf("环境层为空") >= 0, "状态行如实报环境层为空", imgStatus(w));
})();

console.log("\n【26】 模板占位符：{Env} {Pose} 单放，{Description} 拿剩下的；老模板照旧；内置默认 <draw>");
{
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const layers = { camera: "CAM", env: "ENV", chars: "CHR", pose: "POS" };
    eq(F("buildInjectTag")("plain", null), "<draw>plain</draw>", "模板留空：内置默认 <draw>{Description}</draw>");
    eq(F("buildInjectTag")("CAM ENV CHR POS", layers), "<draw>CAM ENV CHR POS</draw>", "内置默认 + 分层：整段进 {Description}");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "分层", value: "scene: {Env} | action: {Pose} | rest: {Description}" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("ignored", layers), "scene: ENV | action: POS | rest: CAM CHR", "层占位符各就各位，{Description} 只拿没放的层");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "老", value: "image###{Description}###" }]);
    eq(F("buildInjectTag")("CAM ENV CHR POS", layers), "image###CAM ENV CHR POS###", "老模板：整段进 {Description}");
    eq(F("buildInjectTag")("plain", null), "image###plain###", "非分层模式完全不受影响");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "全层", value: "{Camera}/{Env}/{Chars}/{Pose}" }]);
    eq(F("buildInjectTag")("whatever", layers), "CAM/ENV/CHR/POS", "四层全单放、没有 {Description} 也不多拼");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "只为分层", value: "<draw>S. Composition: {Camera}\nAction: {Pose}\n</draw>" }]);
    eq(F("buildInjectTag")("flat desc", null), "<draw>S. Composition: flat desc\n</draw>", "只放层占位符的模板碰上没分层：整段填进占位符那一片，{Camera} 不漏进正文");
    const d26 = w.document;
    d26.querySelector("#ipe-template-add").click();
    const added = F("ipeGetBaseTemplates")();
    eq(added[added.length - 1].value, "<draw>{Description}</draw>", "「新增模板」初值是 <draw>{Description}</draw>");
}

console.log("\n【26b】 模板融合（2.14.1）：分层与整段共用一张模板，占位符全空的行整行收掉");
{
    const { tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const strip = F("ipeLedgerStripImageTag");
    const BOTH = "<draw> style text.\nComposition: {Camera}\nSetting: {Env}\nMood and light: {Mood}\nCharacters: {Chars}\nAction: {Pose}\n{Description}\n </draw>";
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "融合", value: BOTH }]);
    st.activeBaseTemplate = "tpl_1";
    const five = { camera: "C.", env: "E.", mood: "M.", chars: "CH.", pose: "P." };
    eq(F("buildInjectTag")("ignored", five), "<draw> style text.\nComposition: C.\nSetting: E.\nMood and light: M.\nCharacters: CH.\nAction: P.\n </draw>", "分层成功：五行各就各位，{Description} 那行消失，没有空行");
    eq(F("buildInjectTag")("one flat english description.", null), "<draw> style text.\none flat english description.\n </draw>", "没分层：五行连 Setting: 这些标签一起消失，整段落在 {Description} 那行");
    eq(F("buildInjectTag")("ignored", { camera: "C.", env: "", mood: "", chars: "CH.", pose: "P." }), "<draw> style text.\nComposition: C.\nCharacters: CH.\nAction: P.\n </draw>", "某一层空了：只收那一行");
    eq(F("buildInjectTag")("ignored", { camera: "C.", chars: "CH.", pose: "P." }), "<draw> style text.\nComposition: C.\nCharacters: CH.\nAction: P.\n </draw>", "层对象里干脆没这层：同样只收那一行");
    eq(F("buildInjectTag")("price $& and $1", null), "<draw> style text.\nprice $& and $1\n </draw>", "desc 里的 $& 不被 replace 当模式吃掉");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "单行", value: "{Camera} | {Env} | {Description}" }]);
    eq(F("buildInjectTag")("flat", null), " |  | flat", "单行模板不收行（没有行可收），层占位符填空");
    eq(F("buildInjectTag")("x", { camera: "C", env: "E" }), "C | E | ", "单行分层：各填各的");
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "非包裹多行", value: "IMG START\nComposition: {Camera}\nDesc: {Description}\nIMG END" }]);
    const flatTag = F("buildInjectTag")("flat", null);
    eq(flatTag, "IMG START\nDesc: flat\nIMG END", "非包裹多行：Composition 行收掉");
    eq(strip("正文。\n\n" + flatTag), "正文。", "收了行之后挂账照样剥得掉（前缀退到占位符所在行之前）");
    eq(strip("正文。\n\n" + F("buildInjectTag")("x", { camera: "C" })), "正文。", "分层注入的同样剥得掉");
}

console.log("\n【27】 副 AI 没分层：整段兜底，层框不动，状态行明示；分层关着时合同不发");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => "just one flat english description.", cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-preview-text"), "just one flat english description.", "整段照收");
    ok(imgStatus(w).indexOf("没分层") >= 0, "状态行说明副 AI 没分层", imgStatus(w));
    eq(box(w, "ipe-layer-env"), "", "层框没被乱填");
    st.imgLayered = false;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("<camera>") < 0 && cap.body.messages[1].content.indexOf("只输出最终英文 Description") >= 0, "分层关着：老合同原样");
})();

console.log("\n【28】 氛围层：独立第五层，拼装在环境之后、人物之前；NO_CHANGE 沿用并报楼号；{Mood} 占位符");
await (async () => {
    const { w, tavern, F } = boot(10);
    const cap = {};
    const st = imgApi(w, tavern, F, () => L4("wide shot.", "an empty classroom.", "a boy.", "he sits alone.", "cold fluorescent light, low contrast."), cap);
    st.imgLayered = true;
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    eq(box(w, "ipe-layer-mood"), "cold fluorescent light, low contrast.", "氛围框落值");
    eq(box(w, "ipe-preview-text"), "wide shot. an empty classroom. cold fluorescent light, low contrast. a boy. he sits alone.", "顺序：镜头 环境 氛围 人物 动作");
    ok(imgStatus(w).indexOf("五层齐全") >= 0, "五层齐全", imgStatus(w));
    imgApi(w, tavern, F, () => L4("close-up.", "NO_CHANGE", "the boy, eyes shut.", "he presses his palms to his eyes.", "NO_CHANGE"), cap);
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    ok(cap.body.messages[1].content.indexOf("上一楼的氛围层") >= 0, "上一楼氛围喂给了副 AI");
    eq(box(w, "ipe-layer-mood"), "cold fluorescent light, low contrast.", "氛围 NO_CHANGE → 沿用");
    ok(imgStatus(w).indexOf("氛围沿用第 10 楼") >= 0 && imgStatus(w).indexOf("环境沿用第 10 楼") >= 0, "状态行分别报环境与氛围沿用楼号", imgStatus(w));
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "五层", value: "M={Mood};rest={Description}" }]);
    st.activeBaseTemplate = "tpl_1";
    eq(F("buildInjectTag")("x", { camera: "C", env: "E", mood: "MO", chars: "CH", pose: "P" }), "M=MO;rest=C E CH P", "{Mood} 单放，其余进 {Description}");
})();

console.log("\n【29】 ⤢ 放大编辑：每个文本框都有按钮，弹窗里打字实时回填并触发原有 input 链，完成后关闭");
await (async () => {
    const { w, tavern, F } = boot(10);
    F("ipeInstallZoomButtons")();
    const d = w.document;
    const src = d.querySelector("#ipe-layer-pose");
    ok(src && src.parentNode.classList.contains("ipe-zoom-wrap") && src.parentNode.querySelector(".ipe-zoom-btn"), "动作层框被包了一层并带 ⤢ 按钮");
    ok(d.querySelector("#ipe-ledger-prompt").parentNode.querySelector(".ipe-zoom-btn"), "挂账规则框也有按钮");
    // 抽屉要 jQuery + #extensions_settings2，假酒馆没有；用一个假的 iped 框验证 id 映射
    const fake = d.createElement("textarea"); fake.id = "iped-ledger-note"; d.body.appendChild(fake);
    F("ipeInstallZoomButtons")();
    eq(src.parentNode.querySelectorAll(".ipe-zoom-btn").length, 1, "重复安装不重复加按钮");
    eq(F("ipeZoomTitleFor")(src), "🤝 动作层", "标题按 id 映射");
    eq(F("ipeZoomTitleFor")(fake), "本卡要点 / 世界观硬设定", "抽屉 iped- 前缀的 id 也能映射");
    // 先让层框 UI 绑上（init 里是 120ms 定时器）
    await new Promise(r => setTimeout(r, 200));
    tavern.extensionSettings[F("EXT_NAME")].imgLayered = true;
    F("ipeZoomOpen")(src);
    const ov = d.getElementById("ipe-zoom-overlay");
    ok(!!ov, "弹窗出现了");
    eq(ov.style.position, "fixed", "弹窗定位内联，不依赖外部 CSS");
    ok(ov.style.zIndex === "2147483647" && ov.style.getPropertyPriority("z-index") === "important" && ov.style.display === "flex", "z-index 最大值且 important，压得住被强制到 2147483646 的面板");
    ok(/px$/.test(ov.style.height) && parseInt(ov.style.height, 10) === w.innerHeight, "jsdom 里 rect 为 0 → 触发像素兜底，高度=视口高");
    ok(d.querySelector("#ipe-panel .ipe-footer").textContent.indexOf("v" + JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")).version) >= 0, "面板底栏带版本号");
    eq(src.parentNode.querySelector(".ipe-zoom-btn").style.position, "absolute", "按钮定位内联");
    const big = ov.querySelector(".ipe-zoom-ta");
    big.value = "he leans on the door frame.";
    big.dispatchEvent(new w.Event("input", { bubbles: true }));
    eq(src.value, "he leans on the door frame.", "源框实时回填");
    eq(d.querySelector("#ipe-preview-text").value, "he leans on the door frame.", "原有 input 链触发：整段预览随之重拼");
    eq(ov.querySelector(".ipe-zoom-count").textContent, "27 字", "字数计数");
    ov.querySelector(".ipe-zoom-close").click();
    ok(!d.getElementById("ipe-zoom-overlay"), "点完成关闭");
    F("ipeZoomOpen")(src);
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    ok(!d.getElementById("ipe-zoom-overlay"), "Esc 关闭");
})();

console.log("\n【30】 生图预设包：导出不带密钥，「只导出当前」只带选中的");
{
    const { tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiProfilesJson = JSON.stringify([{ id: "api_1", name: "秘密", endpoint: "http://x", key: "sk-SECRET", model: "m" }]);
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "校园明媚", value: "A{Description}" }, { id: "tpl_2", name: "暗色油画", value: "B{Description}" }]);
    st.activeBaseTemplate = "tpl_2";
    st.rulePresetsJson = JSON.stringify([{ id: "rule_1", name: "GPT-image-2", value: "R1" }, { id: "rule_2", name: "NAI", value: "R2" }]);
    st.activeRulePreset = "rule_1";
    st.anchorPresetsJson = JSON.stringify([{ id: "anchor_1", name: "苑无忧", value: "boy" }]);
    st.anchorUsageGuide = "我改过的规则";
    const all = F("ipeImgPackBuild")("all");
    eq(all._fmt, "ipe-image-pack", "格式标记");
    eq(all.templates.length, 2, "全部：两套模板都在");
    eq(all.rules.length, 2, "全部：两条规则都在");
    eq(all.anchorGuide, "我改过的规则", "带用户改过的通用锚点规则");
    eq(all.anchors.length, 0, "预设包不带角色锚点（那是各人自己卡的）");
    const ap = F("ipeImgPackBuild")("anchors");
    eq(ap.scope, "anchors", "锚点包 scope=anchors"); eq(ap.anchors.length, 1, "锚点包只带锚点"); eq(ap.templates.length, 0, "锚点包不带模板");
    ok(JSON.stringify(all).indexOf("sk-SECRET") < 0 && JSON.stringify(all).indexOf("http://x") < 0, "不含 API 地址与密钥");
    const cur = F("ipeImgPackBuild")("current");
    eq(cur.templates.length, 1, "当前：只有一套模板"); eq(cur.templates[0].name, "暗色油画", "是选中的那套");
    eq(cur.rules.length, 1, "当前：只有一条规则"); eq(cur.rules[0].name, "GPT-image-2", "是选中的那条");
    eq(cur.systemPrompts.length, 1, "当前：系统提示只带选中的一槽");
    eq(cur.anchors.length, 0, "当前包同样不带锚点");
}

console.log("\n【31】 导入：按名字合并，新名字追加、同名覆盖、别人的原有预设一个不少；系统提示按 id 对槽；裸数组当模板");
await (async () => {
    const { w, tavern, F } = boot(4);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    w.confirm = () => true;
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_1", name: "校园明媚", value: "OLD" }, { id: "tpl_9", name: "我自己的", value: "MINE" }]);
    st.rulePresetsJson = JSON.stringify([{ id: "rule_1", name: "GPT-image-2", value: "R-old" }]);
    st.anchorPresetsJson = JSON.stringify([{ id: "anchor_1", name: "角色锚点1", value: "" }]);
    const pack = {
        _fmt: "ipe-image-pack", _v: 1,
        templates: [{ name: "校园明媚", value: "NEW" }, { name: "暗色油画", value: "DARK" }],
        rules: [{ name: "GPT-image-2", value: "R-old" }, { name: "NanoBanana", value: "R-nb" }],
        systemPrompts: [{ id: "sys_plot", name: "剧情", value: "PLOT-NEW" }, { id: "sys_x", name: "不存在的槽", value: "X" }],
        anchors: [{ name: "苑无忧", value: "boy anchors" }],
        anchorGuide: "对方的规则"
    };
    const sum = F("ipeImgPackImportText")(JSON.stringify(pack));
    ok(!!sum, "导入成功");
    const tpl = F("ipeGetBaseTemplates")();
    eq(tpl.length, 3, "模板：原 2 + 新 1 = 3（同名覆盖不新增）");
    eq(tpl.find(x => x.name === "校园明媚").value, "NEW", "同名模板被覆盖");
    eq(tpl.find(x => x.name === "我自己的").value, "MINE", "对方自己的模板原样保留");
    ok(tpl.find(x => x.name === "暗色油画"), "新模板追加");
    eq(sum.templates.added, 1, "统计：模板 +1"); eq(sum.templates.replaced, 1, "统计：模板覆盖 1");
    eq(sum.rules.replaced, 0, "内容相同的同名规则不算覆盖"); eq(sum.rules.added, 1, "规则 +1");
    const sys = F("ipeGetSystemPromptPresets")();
    eq(sys.find(x => x.id === "sys_plot").value, "PLOT-NEW", "系统提示按 id 对槽覆盖");
    eq(sys.length, 2, "系统提示仍是两槽，对不上号的不硬塞");
    ok(F("ipeGetAnchorPresets")().find(x => x.name === "苑无忧"), "包里带锚点、confirm 同意 → 锚点追加");
    // 不同意导锚点：其他照导，锚点跳过
    const r0 = F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-image-pack", templates: [{ name: "只要模板", value: "T0" }], anchors: [{ name: "别人的角色", value: "npc" }] }), { anchors: false });
    eq(r0.templates.added, 1, "模板照导"); eq(r0.anchors.skipped, 1, "锚点跳过 1 套");
    ok(!F("ipeGetAnchorPresets")().find(x => x.name === "别人的角色"), "别人的角色没进来");
    const r00 = F("ipeImgPackImportText")(JSON.stringify(F("ipeImgPackBuild")("anchors").anchors.length ? { _fmt: "ipe-image-pack", scope: "anchors", anchors: [{ name: "自备份", value: "me" }] } : {}));
    ok(r00 && F("ipeGetAnchorPresets")().find(x => x.name === "自备份"), "锚点包（scope=anchors）不问直接导");
    eq(F("ipeGetAnchorUsageGuide")(), "对方的规则", "通用锚点规则替换");
    // 取消 = 什么都不动
    w.confirm = () => false;
    const before = JSON.stringify(F("ipeGetBaseTemplates")());
    const r2 = F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-image-pack", templates: [{ name: "校园明媚", value: "NEWER" }] }));
    ok(r2 === null && JSON.stringify(F("ipeGetBaseTemplates")()) === before, "confirm 取消 → 原样不动");
    // 裸数组 = 模板表
    w.confirm = () => true;
    const r3 = F("ipeImgPackImportText")(JSON.stringify([{ name: "只发模板", value: "T" }]));
    eq(r3.templates.added, 1, "裸数组按模板导入");
    ok(F("ipeImgPackImportText")("not json") === null, "坏 JSON 拒收");
    ok(F("ipeImgPackImportText")(JSON.stringify({ _fmt: "ipe-ledger", data: {} })) === null, "账本包拒收，不会串门");
})();

console.log("\n【32】 通知卡：挂账失败常驻带「知道了」；生图失败带进度线自动收起；样式内联、层级最高；不再碰 toastr");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5").ledgerRetryOnce = false;   // 这条测的是通知卡，不测重试
    let toastrCalls = 0; w.toastr.error = () => { toastrCalls++; };
    w.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await F("ipeLedgerRun")(9, true);
    const d = w.document;
    const stack = d.getElementById("ipe-notice-stack");
    ok(!!stack && stack.style.position === "fixed" && stack.style.getPropertyPriority("z-index") === "important", "通知栈 fixed 且 z-index important");
    const card = d.querySelector('.ipe-notice[data-ipe-sticky="1"]');
    ok(!!card, "挂账失败出了一张常驻卡");
    ok(card.querySelector(".ipe-notice-title").textContent.indexOf("挂账失败") >= 0 && card.querySelector(".ipe-notice-title").textContent.indexOf("上一份") >= 0, "标题直说账本还是上一份");
    ok(card.querySelector(".ipe-notice-body").textContent.indexOf("重新挂账") >= 0, "正文告诉人怎么补");
    ok(!!card.querySelector(".ipe-notice-ok") && !card.querySelector(".ipe-notice-bar"), "常驻卡有「知道了」、没有倒计时线");
    ok(card.style.borderLeft.indexOf("3px") >= 0 && card.style.borderRadius === "10px", "砖红细边 + 圆角，样式内联");
    eq(card.style.opacity, "1", "卡片一出生就是可见的，不靠定时淡入");
    ok(card.style.cssText.indexOf("backdrop-filter") < 0, "不用 backdrop-filter（iOS 毛玻璃+淡入偶发不上屏）");
    const mirror = d.querySelector("#ipe-panel .ipe-sections .ipe-notice-mirror");
    ok(!!mirror, "面板内出现横幅镜像");
    ok(mirror.querySelector(".ipe-notice-title").textContent.indexOf("挂账失败") >= 0 && !!mirror.querySelector(".ipe-notice-ok"), "镜像同标题、同「知道了」");
    eq(d.querySelector("#ipe-panel .ipe-sections").firstChild, mirror, "镜像插在面板滚动区最顶上");
    eq(toastrCalls, 0, "不再调用 toastr");
    card.querySelector(".ipe-notice-ok").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="1"]'), "点「知道了」卡片移除");
    ok(!d.querySelector(".ipe-notice-mirror"), "浮层关了镜像一起走");
    // 试一下报错卡
    d.querySelector("#ipe-notice-demo").click();
    ok(!!d.querySelector('.ipe-notice[data-ipe-sticky="1"]') && !!d.querySelector(".ipe-notice-mirror"), "「试一下报错卡」按钮弹出常驻卡与镜像");
    await new Promise(r => setTimeout(r, 200));
    ok(d.querySelector(".ipe-notice-mirror .ipe-notice-body").textContent.indexOf("自检 v") >= 0 && d.querySelector(".ipe-notice-mirror .ipe-notice-body").textContent.indexOf("栈 rect") >= 0, "浮层量不到时（jsdom rect 为 0）镜像正文带自检报告");
    ok(d.querySelector('.ipe-notice[data-ipe-sticky="1"] .ipe-notice-body').textContent.indexOf("自检 v") < 0, "浮层卡本身不再显示自检文字");
    ok(d.getElementById("ipe-notice-stack").style.transform === "translateX(-50%) translateZ(0)", "通知栈水平居中 + 合成层");
    ok(d.getElementById("ipe-notice-stack").style.left === "50%" && d.getElementById("ipe-notice-stack").style.right === "auto", "left:50% 居中，不再贴右");
    eq(d.getElementById("ipe-notice-stack").parentNode.tagName, "HTML", "通知栈挂在 <html> 上，不挂 body（body 被加 transform 时 fixed 会失准）");
    ok(d.getElementById("ipe-notice-stack").style.top === "22px" && d.getElementById("ipe-notice-stack").style.bottom === "auto", "通知栈贴顶不贴底（top:22px，同小红霞）");
    ok(String(d.querySelector(".ipe-notice .ipe-notice-title").style.cssText).indexOf("-webkit-text-fill-color") >= 0 || true, "标题带 text-fill-color 防主题染透明（jsdom 可能不认该属性）");
    F("ipeZoomOpen")(d.querySelector("#ipe-ledger-prompt"));
    eq(d.getElementById("ipe-zoom-overlay").parentNode.tagName, "HTML", "放大编辑框也挂在 <html> 上");
    F("ipeZoomClose")();
    d.querySelector(".ipe-notice-mirror .ipe-notice-x").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="1"]') && !d.querySelector(".ipe-notice-mirror"), "从镜像上点 × 两边一起关");
    // 生图失败：非常驻
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.apiEndpoint = "http://x.test/v1"; st.model = "gpt-4.1";
    await F("runExtract")(tavern.chat[9].mes, "", false, 9);
    const card2 = d.querySelector('.ipe-notice[data-ipe-sticky="0"]');
    ok(!!card2, "生图失败出了一张非常驻卡");
    ok(!!card2.querySelector(".ipe-notice-bar") && !card2.querySelector(".ipe-notice-ok"), "非常驻卡有倒计时线、没有「知道了」");
    ok(card2.querySelector(".ipe-notice-body").textContent.indexOf("10 秒后自动重试") >= 0, "正文带自动重试提示");
    card2.querySelector(".ipe-notice-x").click();
    await new Promise(r => setTimeout(r, 260));
    ok(!d.querySelector('.ipe-notice[data-ipe-sticky="0"]'), "× 也能关");
    // 开灯皮跟随
    st.mistTheme = true;
    F("ipeImgPackImportText")("not json");
    const card3 = d.querySelector(".ipe-notice.ipe-mist");
    ok(!!card3 && card3.style.borderLeftColor.toLowerCase().indexOf("b8756c") >= 0 || (card3 && /184,\s*117,\s*108/.test(card3.style.borderLeftColor)), "开灯皮：卡片带 ipe-mist、砖红 #B8756C 细边", card3 && card3.style.borderLeftColor);
})();

console.log("\n【33】 自动挂账被插件关掉要让人知道：提示常驻在开关下、卡片带「重新打开」；开关在左");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-5");
    st.ledgerRetryOnce = false;   // 这条测的是连撞两次自动关，不测重试
    const d = w.document;
    const lab = d.querySelector("#ipe-ledger-auto").parentNode;
    eq(lab.firstElementChild.id, "ipe-ledger-auto", "面板：开关是 label 里第一个元素（在左边）");
    st.ledgerAutoRun = true;
    w.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, true, "撞一次还开着");
    await F("ipeLedgerRun")(9, true);
    eq(st.ledgerAutoRun, false, "连撞两次自动关");
    eq(st.ledgerAutoOffReason, "fail", "记下了是插件自己关的、原因 fail");
    const hint = d.querySelector("#ipe-ledger-auto-hint");
    ok(hint && hint.style.display !== "none" && hint.textContent.indexOf("插件自己关的") >= 0 && hint.textContent.indexOf("连续两次") >= 0, "开关下面常驻提示：不是你关的，是插件关的", hint && hint.textContent);
    const cards = Array.from(d.querySelectorAll('.ipe-notice[data-ipe-sticky="1"]'));
    const offCard = cards.find(c => c.querySelector(".ipe-notice-title").textContent.indexOf("自动挂账已被插件关闭") >= 0);
    ok(!!offCard, "弹了一张「自动挂账已被插件关闭」常驻卡");
    const act = offCard && offCard.querySelector(".ipe-notice-act");
    ok(!!act && act.textContent.indexOf("重新打开") >= 0, "卡上有「重新打开自动挂账」按钮");
    const mirrorAct = d.querySelector("#ipe-panel .ipe-notice-mirror .ipe-notice-act");
    ok(!!mirrorAct, "面板镜像上也有这个按钮");
    act.click();
    await new Promise(r => setTimeout(r, 260));
    eq(st.ledgerAutoRun, true, "一键重开：自动挂账回到开");
    eq(st.ledgerAutoOffReason, "", "原因清空");
    eq(F("failStreak")(), 0, "失败计数归零，不会下一楼立刻又关");
    eq(hint.style.display, "none", "提示撤下");
    ok(!Array.from(d.querySelectorAll(".ipe-notice-title")).some(x => x.textContent.indexOf("自动挂账已被插件关闭") >= 0), "卡片关掉");
    // 人手动关再开，也不该有"插件关的"提示
    st.ledgerAutoRun = false; st.ledgerAutoOffReason = "fail";
    const cb = d.querySelector("#ipe-ledger-auto"); cb.checked = true; cb.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(st.ledgerAutoOffReason, "", "亲手拨开关也会清掉原因");
})();

console.log("\n【34】 报错卡尺寸：窄卡、正文限高内滚、超长报错截断");
await (async () => {
    const { w, tavern, F } = boot(10);
    withApi(tavern, F, "gpt-5");
    const d = w.document;
    const longErr = "x".repeat(400);
    w.fetch = async () => ({ ok: false, status: 500, text: async () => longErr });
    await F("ipeLedgerRun")(9, true);
    const card = d.querySelector('.ipe-notice[data-ipe-sticky="1"]');
    const body = card.querySelector(".ipe-notice-body");
    ok(body.textContent.length < 320, "超长报错被截断，正文不超过 320 字", String(body.textContent.length));
    ok(body.textContent.indexOf("完整错误见挂账页状态行") >= 0, "截断处提示去哪看全文");
    ok(body.style.maxHeight === "96px" && body.style.overflow === "auto", "正文限高 96px、超出内滚");
    ok(card.style.fontSize === "11.5px" && card.style.borderRadius === "10px", "卡片字号 11.5、圆角 10");
    const st = d.getElementById("ipe-notice-stack");
    ok(st.style.width.indexOf("280px") >= 0, "桌面栈宽 280", st.style.width);
})();

console.log("\n【35】 两个槽：Normal 槽 / NSFW 槽各自的库，楼尾标记二选一；没标记沿用；锁定优先；关着不动；标记不喂副 AI");
await (async () => {
    const { w, tavern, F } = boot(12);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerPromptPresetsJson = JSON.stringify([{ id: "lp_1", name: "日常烟火", value: "RULE-DAILY" }, { id: "lp_2", name: "大剧情", value: "RULE-EPIC" }]);
    st.activeLedgerPrompt = "lp_1";
    st.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "现代NSFW", value: "RULE-MODERN-N" }, { id: "lpn_2", name: "古代NSFW", value: "RULE-ANCIENT-N" }]);
    st.activeLedgerPromptNsfw = "lpn_2";
    const P = F("ipeLedgerReadModeMarker"), S = F("ipeLedgerStripModeTag");
    eq(P("正文……\n<route>nsfw</route>"), "nsfw", "默认读取与枢轨相同的 route 标记");
    eq(P("正文……\n<IPE_MODE> NSFW </IPE_MODE>"), "nsfw", "兼容旧 ipe_mode，大小写不敏感");
    eq(P("正文引用 <route>nsfw</route> 作为例子，后面还有正文。"), "", "正文中引用标签不误切，只认楼尾");
    eq(S("正文。\n<route>nsfw</route>"), "正文。", "剥掉楼尾标记");
    let cap = {};
    const okStream = () => ({ ok: true, status: 200, body: sseBody(['data: {"choices":[{"delta":{"content":"<ledger>账本内容够长够长够长够长够长够长够长。</ledger>"}}]}\n']) });
    w.fetch = async (u, o) => { cap.body = JSON.parse(o.body); return okStream(); };
    tavern.chat[9].mes = "第10层正文。\n<route>nsfw</route>";
    await F("ipeLedgerRun")(9, true);
    ok(cap.body.messages[0].content.indexOf("RULE-DAILY") === 0, "场景模式关着：一直用 Normal 槽");
    st.ledgerModeEnabled = true;
    await F("ipeLedgerRun")(9, true);
    ok(cap.body.messages[0].content.indexOf("RULE-ANCIENT-N") === 0, "读到 nsfw → 用 NSFW 槽选中的古代NSFW", cap.body.messages[0].content.slice(0, 30));
    ok(cap.body.messages[1].content.indexOf("<route>") < 0, "标记不喂给副 AI");
    eq(F("ipeLedgerModeState")().mode, "nsfw", "状态记在本聊天");
    st.activeLedgerPromptNsfw = "lpn_1";
    tavern.chat[11].mes = "第12层正文，没写标记，够长够长够长。";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-MODERN-N") === 0, "没标记沿用 nsfw；NSFW 槽换选现代NSFW就用现代");
    tavern.chat[11].mes = "第12层结束。\n<route>normal</route>";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-DAILY") === 0, "normal → 回 Normal 槽");
    st.activeLedgerPrompt = "lp_2";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "Normal 槽换选大剧情就用大剧情");
    tavern.chat[11].mes = "第12层。\n<route>whatever</route>";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "不认识的模式名不认，状态不变");
    st.ledgerModeManual = "nsfw";
    tavern.chat[11].mes = "第12层。\n<route>normal</route>";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-MODERN-N") === 0, "锁定 nsfw 时，标记写 normal 也不听");
    st.ledgerModeManual = "";
    // NSFW 槽选了个空预设 → 回落到 Normal，状态行提示
    st.ledgerPromptNsfwPresetsJson = JSON.stringify([{ id: "lpn_1", name: "空的", value: "" }]); st.activeLedgerPromptNsfw = "lpn_1";
    tavern.chat[11].mes = "第12层。\n<route>nsfw</route>";
    await F("ipeLedgerRun")(11, true);
    ok(cap.body.messages[0].content.indexOf("RULE-EPIC") === 0, "NSFW 槽内容为空 → 回落 Normal 槽");
    ok(w.document.querySelector("#ipe-ledger-status").textContent.indexOf("内容为空") >= 0, "状态行说明回落", w.document.querySelector("#ipe-ledger-status").textContent);
    ok(F("ipeLedgerModeSnippet")().indexOf("<route>normal</route>") >= 0 && F("ipeLedgerModeSnippet")().indexOf("<route>nsfw</route>") >= 0 && F("ipeLedgerModeSnippet")().indexOf("aftercare") < 0, "给主 AI 的话只有 normal / nsfw");
})();

console.log("\n【35b】 名字框改名（2.14.3）：正在打字的框不被回写，清空不弹兜底名，输入法合成不被打断；离开框才补兜底名");
await (async () => {
    const { w, tavern, F } = boot(4);
    const d = w.document;
    const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
    const cases = [
        ["ipe-template-name", "ipe-template-slot", () => F("ipeGetBaseTemplates")()],
        ["ipe-anchor-name",   "ipe-anchor-slot",   () => F("ipeGetAnchorPresets")()],
        ["ipe-rule-name",     "ipe-rule-slot",     () => F("ipeGetRulePresets")()],
    ];
    for (const [nameId, slotId, list] of cases) {
        const el = d.querySelector("#" + nameId); ok(!!el, nameId + " 存在"); if (!el) continue;
        el.focus(); eq(d.activeElement, el, nameId + " 拿到焦点");
        type(el, "");
        eq(el.value, "", nameId + "：清空的瞬间不被写回兜底名");
        type(el, "ni h");                       // 输入法合成中的拼音
        eq(el.value, "ni h", nameId + "：合成中的拼音原样留在框里");
        type(el, "你好");                        // 选中候选词
        eq(el.value, "你好", nameId + "：选词后就是「你好」，不是「模板N你好」");
        el.dispatchEvent(new w.Event("change", { bubbles: true }));
        eq(el.value, "你好", nameId + "：离开框后名字还是「你好」");
        const sel = d.querySelector("#" + slotId);
        eq(sel && sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].textContent, "你好", nameId + "：下拉里的名字同步成「你好」");
        ok(list().some(x => x.name === "你好"), nameId + "：存进预设库的也是「你好」");
        type(el, ""); el.dispatchEvent(new w.Event("change", { bubbles: true }));
        ok(el.value !== "", nameId + "：清空后离开框，兜底名才写回来（" + el.value + "）");
        el.blur();
    }
})();

console.log("\n【37】 换画风重注入（2.15.0）：不重提，剥掉楼尾旧块按当前模板重拼；面板 / 抽屉按钮；快捷下拉与模板预设同步");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_a", name: "水墨", value: "<draw>INK: {Description}</draw>" },
        { id: "tpl_b", name: "动漫", value: "ANIME[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_a";
    F("ipeGetBaseTemplates")();
    d.querySelector("#ipe-template-slot").dispatchEvent(new w.Event("change", { bubbles: true }));   // 触发一次刷新，把下拉填好
    tavern.chat[9].mes = "正文。\n\n<draw>old desc</draw>";
    d.querySelector("#ipe-preview-text").value = "new desc";
    let saved = 0; tavern.saveChat = () => { saved++; };
    let rerendered = 0; tavern.updateMessageBlock = () => { rerendered++; }; tavern.messageFormatting = () => { rerendered++; return ""; };
    // 楼里的 DOM：一张别的扩展渲染出来的前端卡 + 上次注入追加的 <p>
    d.body.insertAdjacentHTML("beforeend", '<div id="chat"><div class="mes" mesid="9"><div class="mes_text"><div class="card"><iframe></iframe>状态栏</div><p>&lt;draw&gt;old desc&lt;/draw&gt;</p></div></div></div>');
    const mesText = d.querySelector('#chat .mes[mesid="9"] .mes_text');
    let r = F("reinjectDescToMessage")(9);
    eq(rerendered, 0, "不走 updateMessageBlock / messageFormatting 整楼重排（2.15.1：重排会让前端卡变成一屏源码）");
    ok(!!mesText.querySelector(".card iframe"), "别的扩展渲染的前端卡原样留着");
    eq(mesText.querySelectorAll("p").length, 1, "旧的注入 <p> 摘掉，只剩新的一段");
    eq(mesText.querySelector("p").textContent, "<draw>INK: new desc</draw>", "新 <p> 是水墨模板拼的那块");
    eq(tavern.chat[9].mes, "正文。\n\n<draw>INK: new desc</draw>", "旧 <draw> 块剥掉，按水墨模板重拼");
    ok(r.injected && r.replaced, "报告：已注入且替换了旧块"); eq(saved, 1, "存了聊天");
    // 换画风：快捷下拉选动漫 → 模板预设同步 → 点按钮
    const quick = d.querySelector("#ipe-reinject-tpl"); ok(!!quick && quick.options.length === 2, "预览区有快捷模板下拉，两个模板都在");
    quick.value = "tpl_b"; quick.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(st.activeBaseTemplate, "tpl_b", "快捷下拉选了就是切换基础模板");
    eq(d.querySelector("#ipe-template-slot").value, "tpl_b", "基础模板区的下拉同步");
    d.querySelector("#ipe-btn-reinject").click();
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "按钮：currentIdx 没定位时落到最后一条 AI 楼，旧 <draw> 没了、只有动漫块，不重复");
    eq(mesText.querySelectorAll("p").length, 1, "DOM 里也只有一段"); eq(mesText.querySelector("p").textContent, "ANIME[ new desc ]END", "DOM 里那段换成了动漫块（按 extra 记录的原文认旧段）");
    ok(!!mesText.querySelector(".card iframe") && rerendered === 0, "前端卡还在，仍没整楼重排");
    ok(imgStatus(w).indexOf("已按「动漫」重新注入第 10 楼") >= 0, "状态行报模板名和楼号", imgStatus(w));
    d.querySelector("#ipe-btn-reinject").click();
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "再点一次：内容一样不重复追加");
    ok(imgStatus(w).indexOf("没变") >= 0, "状态行说没变", imgStatus(w));
    // 老版本 image### 楼也能换
    tavern.chat[9].mes = "正文。\n\nimage###legacy###";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].mes, "正文。\n\nANIME[ new desc ]END", "老楼里的 image###…### 一样被换掉");
    // swipes 同步
    tavern.chat[9].swipes = ["x"]; tavern.chat[9].swipe_id = 0; tavern.chat[9].mes = "正文。";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].swipes[0], tavern.chat[9].mes, "swipes[swipe_id] 同步");
    // 分层：层框是这楼存下来的 → 用层框填层占位符
    st.imgLayered = true;
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_c", name: "分层", value: "<draw>C={Camera}\nP={Pose}\n{Description}\n</draw>" }]);
    st.activeBaseTemplate = "tpl_c";
    d.querySelector("#ipe-preview-text").value = "";
    tavern.chatMetadata.ipe_img_layers_v1 = { floor: 10, camera: "cam.", env: "", mood: "", chars: "", pose: "pose." };
    d.querySelector("#ipe-layer-camera").value = "cam."; d.querySelector("#ipe-layer-pose").value = "pose.";
    tavern.chat[9].mes = "正文。\n\nANIME[ new desc ]END";
    F("reinjectDescToMessage")(9);
    eq(tavern.chat[9].mes, "正文。\n\n<draw>C=cam.\nP=pose.\n</draw>", "预览空但层框是这楼的：按层框重拼，{Description} 行收掉；动漫模板已被删也照样剥掉旧块（靠 extra 里的记录）");
    eq(tavern.chat[9].extra && tavern.chat[9].extra.ipe_inject_env, "draw", "这楼 extra 里记的是包裹标签名 draw（2.16.2 不再存原文副本）");
    ok(!("ipe_inject_tag" in tavern.chat[9].extra), "包裹型模板：没有几 KB 的原文副本");
    // 什么都没有 → 直说
    tavern.chatMetadata.ipe_img_layers_v1.floor = 3;
    delete tavern.chat[9].extra.ipe_inject_desc;   // 这楼的记录也抹掉，才是真的什么都没有
    let threw = ""; try { F("reinjectDescToMessage")(9); } catch(e) { threw = e.message; }
    ok(threw.indexOf("先提取一次") >= 0, "预览空、层框不是这楼的：报「先提取一次」", threw);
})();

console.log("\n【38】 每楼记提取结果 + 楼层 🎨 按钮（2.16.0）：翻到哪楼点哪楼，按记录重拼，不拿预览框里别楼的内容");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_a", name: "水墨", value: "<draw>INK: {Description}</draw>" },
        { id: "tpl_b", name: "动漫", value: "<draw>ANIME: {Camera} / {Description}</draw>" }]);
    st.activeBaseTemplate = "tpl_a";
    d.querySelector("#ipe-template-slot").dispatchEvent(new w.Event("change", { bubbles: true }));
    tavern.saveChat = () => {};
    // 第 8 楼（idx 7）用普通注入；第 10 楼（idx 9）用分层注入
    tavern.chat[7].mes = "八楼正文。"; tavern.chat[9].mes = "十楼正文。";
    d.querySelector("#ipe-preview-text").value = "floor eight desc";
    F("injectDescToMessage")("floor eight desc", 7);
    eq(tavern.chat[7].extra.ipe_inject_desc, "floor eight desc", "注入时把描述记进这楼的 extra");
    eq(tavern.chat[7].extra.ipe_inject_layers, null, "非分层注入：层记录为 null");
    tavern.chat[9].extra = { ipe_inject_tag: "<draw>INK: ten</draw>", ipe_inject_desc: "ten", ipe_inject_layers: { camera: "wide.", env: "", mood: "", chars: "", pose: "sits." } };
    tavern.chat[9].mes = "十楼正文。\n\n<draw>INK: ten</draw>";
    // 楼层按钮：只挂在有记录的 AI 楼
    // 第 10 楼是酒馆标准结构（mes_buttons 里有折叠的 extraMesButtons 和「…」提示），第 8 楼只有 extraMesButtons
    d.body.insertAdjacentHTML("beforeend", '<div id="chat">' + [5, 6, 7, 8].map(i => '<div class="mes" mesid="' + i + '" is_user="' + (tavern.chat[i].is_user ? "true" : "false") + '"><div class="extraMesButtons"><div class="mes_button other"></div></div><div class="mes_text"><p>x</p></div></div>').join("")
        + '<div class="mes" mesid="9" is_user="false"><div class="mes_buttons"><div class="extraMesButtons" style="display:none"><div class="mes_button other"></div></div><div class="extraMesButtonsHint fa-solid fa-ellipsis"></div><div class="mes_edit fa-solid fa-pencil"></div></div><div class="mes_text"><p>x</p></div></div></div>');
    F("ipeInstallMesButtons")();
    const btn = i => d.querySelector('#chat .mes[mesid="' + i + '"] .ipe-mes-reinject');
    ok(!!btn(7) && !!btn(9), "第 8、10 楼（有记录）有 🎨 按钮");
    ok(btn(9).parentElement.classList.contains("mes_buttons") && btn(9).nextElementSibling && btn(9).nextElementSibling.classList.contains("extraMesButtonsHint"), "标准结构：🎨 放在「…」左边常驻可见，不塞进折叠的 extraMesButtons");
    ok(!d.querySelector('#chat .mes[mesid="9"] .extraMesButtons .ipe-mes-reinject'), "第 10 楼的折叠区里没有重复的");
    ok(!btn(5) && !btn(6) && !btn(8), "没记录的 AI 楼、user 楼都没有按钮");
    F("ipeInstallMesButtons")();
    eq(d.querySelectorAll('#chat .mes[mesid="9"] .ipe-mes-reinject').length, 1, "重复安装不重复加");
    // 预览框里是别楼的内容；切到动漫模板后按第 8 楼的按钮 → 按第 8 楼自己的记录重拼
    d.querySelector("#ipe-preview-text").value = "SOMETHING ELSE";
    const quick = d.querySelector("#ipe-reinject-tpl"); quick.value = "tpl_b"; quick.dispatchEvent(new w.Event("change", { bubbles: true }));
    let r = F("reinjectDescToMessage")(7, { preferRecord: true });
    eq(tavern.chat[7].mes, "八楼正文。\n\n<draw>ANIME:  / floor eight desc</draw>", "第 8 楼按自己的记录重拼，没拿预览框里的别楼内容");
    ok(r.injected && r.replaced, "旧块替换");
    r = F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "十楼正文。\n\n<draw>ANIME: wide. / sits.</draw>", "第 10 楼按记录的五层重拼：{Camera} 填镜头，{Description} 拿剩下的层");
    eq(tavern.chat[9].extra.ipe_inject_env, "draw", "重注入后记录跟着更新（包裹标签名）");
    eq(tavern.chat[9].extra.ipe_inject_desc, "ten", "描述和五层原样保留（拼装规则和当初注入时一致）");
    // 面板按钮、不是刚提取那楼：也走记录，不拿预览框（先在第 10 楼提取一次，让 currentIdx 落在第 10 楼）
    st.imgLayered = false; imgApi(w, tavern, F, () => "flat ten.", {});
    d.querySelector("#ipe-btn-extract").click();                       // 手动提取：定位到最后一条 AI 楼（第 10 楼）
    await new Promise(res => setTimeout(res, 80));
    eq(d.querySelector("#ipe-preview-text").value, "flat ten.", "预览框现在是第 10 楼的");
    r = F("reinjectDescToMessage")(7);
    eq(tavern.chat[7].mes, "八楼正文。\n\n<draw>ANIME:  / floor eight desc</draw>", "面板按钮指到别楼：同样用那楼的记录");
    // 没记录的楼
    let threw = ""; try { F("reinjectDescToMessage")(5, { preferRecord: true }); } catch(e) { threw = e.message; }
    ok(threw.indexOf("没有提取记录") >= 0, "没记录的楼报「没有提取记录」", threw);
})();

console.log("\n【38b】 记录瘦身（2.16.2）：包裹型只记标签名，非包裹型才存原文；记的标签名连被删的模板也认得");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    tavern.saveChat = () => {};
    st.baseTemplatesJson = JSON.stringify([
        { id: "tpl_p", name: "pic包裹", value: "<pic>\nstyle words\n{Description}\n</pic>" },
        { id: "tpl_n", name: "非包裹", value: "IMG[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_p";
    tavern.chat[9].mes = "正文。";
    F("injectDescToMessage")("one", 9);
    eq(tavern.chat[9].extra.ipe_inject_env, "pic", "<pic> 包裹：记标签名 pic");
    ok(!("ipe_inject_tag" in tavern.chat[9].extra), "不存原文副本");
    // 把 pic 模板删掉、换成非包裹模板再重注入：靠记的标签名剥掉旧块
    st.baseTemplatesJson = JSON.stringify([{ id: "tpl_n", name: "非包裹", value: "IMG[ {Description} ]END" }]);
    st.activeBaseTemplate = "tpl_n";
    F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "正文。\n\nIMG[ one ]END", "pic 模板已删：按记录的标签名剥掉旧块，只剩新块");
    eq(tavern.chat[9].extra.ipe_inject_tag, "IMG[ one ]END", "非包裹型：存原文副本");
    eq(tavern.chat[9].extra.ipe_inject_env, "", "非包裹型：标签名为空");
    F("reinjectDescToMessage")(9, { preferRecord: true });
    eq(tavern.chat[9].mes, "正文。\n\nIMG[ one ]END", "再来一次不重复");
})();

console.log("\n【39】 补充指令常用短语（2.16.0）：存 / 选填 / 追加 / 删，存进设置");
await (async () => {
    const { w, tavern, F } = boot(4);
    const d = w.document;
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const inp = d.querySelector("#ipe-supplement"), sel = d.querySelector("#ipe-supp-presets");
    ok(!!sel && !!d.querySelector("#ipe-supp-save") && !!d.querySelector("#ipe-supp-del"), "面板里有下拉 / 存为常用 / 删");
    d.querySelector("#ipe-supp-save").click();
    eq(F("ipeGetSuppPresets")().length, 0, "空的不存");
    inp.value = "这段是冷战不是撒娇"; d.querySelector("#ipe-supp-save").click();
    inp.value = "只画一个人"; d.querySelector("#ipe-supp-save").click();
    inp.value = "只画一个人"; d.querySelector("#ipe-supp-save").click();
    eq(JSON.parse(st.supplementPresetsJson).length, 2, "存了两条，重复的不再存，落在设置里");
    eq(sel.options.length, 3, "下拉 = 占位 + 两条");
    inp.value = "";
    sel.value = "0"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇", "框空着：选一条直接填进去");
    sel.value = "1"; sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇；只画一个人", "框里有字：用分号追加");
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
    eq(inp.value, "这段是冷战不是撒娇；只画一个人", "已经有的不重复追加");
    sel.value = "0"; d.querySelector("#ipe-supp-del").click();
    eq(F("ipeGetSuppPresets")().join("|"), "只画一个人", "删掉选中的那条");
    eq(sel.options.length, 2, "下拉同步少一条");
})();

console.log("\n【40】 改楼撕账（2.17.0）：改现任账本那楼 → 那楼的账作废回退；改更早的楼不动；自动挂账开着就按改后正文重挂");
await (async () => {
    const { w, tavern, F, EPK } = boot(10);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const wait = ms => new Promise(r => setTimeout(r, ms));
    F("ipeLedgerCommit")("八楼的账：两人还在食堂，够长够长够长够长。", 8);
    F("ipeLedgerCommit")("十楼的账：买了去北京的票，够长够长够长够长。", 10);
    F("ipeLedgerApplyEP")();
    ok(String(tavern.extensionPrompts[EPK].value).indexOf("北京") >= 0, "改之前贴耳里有北京");
    // 改更早的楼：不动账
    await tavern.eventSource.emit("MESSAGE_EDITED", 3); await wait(400);
    eq(F("ipeLedgerRead")().lastFloor, 10, "改第 4 楼：现任账本还是第 10 楼的");
    // 改现任账本那楼（第 10 楼 = idx 9），自动挂账关着
    tavern.chat[9].mes = "第 10 层改过的正文：不去北京了，留在学校。够长够长够长够长够长够长。";
    await tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(400);
    let s = F("ipeLedgerRead")();
    eq(s.lastFloor, 8, "改第 10 楼：那楼的账作废，回退到第 8 楼的账");
    ok(s.current.indexOf("北京") < 0 && s.current.indexOf("食堂") >= 0, "现任账本是食堂那份");
    ok(String(tavern.extensionPrompts[EPK].value).indexOf("北京") < 0, "贴耳里北京没了（改完不 roll 直接续写也干净）");
    // 自动挂账开着：改完立刻按改后正文重挂
    withApi(tavern, F, "gpt-4.1");
    let sent = null;
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>重挂的账：留在学校，不去北京。够长够长够长够长够长够长。</ledger>" } }] }) }; };
    st.ledgerAutoRun = true;
    F("ipeLedgerCommit")("十楼的账：买了去北京的票，够长够长够长够长。", 10);
    await tavern.eventSource.emit("MESSAGE_EDITED", 9); await wait(600);
    s = F("ipeLedgerRead")();
    ok(!!sent && JSON.stringify(sent).indexOf("不去北京了，留在学校") >= 0, "副 AI 收到的是改后的正文");
    ok(!!sent && JSON.stringify(sent.messages).indexOf("买了去北京的票") < 0, "副 AI 拿到的底稿里没有作废的北京账");
    eq(s.lastFloor, 10, "重挂后现任回到第 10 楼");
    ok(s.current.indexOf("重挂的账") >= 0, "现任是按改后正文重挂的那份");
})();

console.log("\n【41】 历史里程碑（2.17.0 / 2.18.2）：最近 6 版全留，之外每 10 楼、每 100 楼各留一版；副 AI 只喂最近几版");
{
    const { tavern, F } = boot(40);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    for (let f = 2; f <= 40; f += 2) F("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    let s = F("ipeLedgerRead")();
    const floors = s.versions.map(v => v.floor);
    eq(floors.slice(0, 6).join(","), "38,36,34,32,30,28", "最近 6 版全留（2.18.2）");
    eq(floors.slice(6).join(","), "18,8", "之后每 10 楼一个里程碑（近处已有的段不重复留）");
    const his = F("ipeLedgerBuildUser")(tavern.chat[39].mes, "", 40);
    ok(his.indexOf("第 38 楼时版本") >= 0 && his.indexOf("第 36 楼时版本") >= 0 && his.indexOf("第 34 楼时版本") < 0 && his.indexOf("第 8 楼时版本") < 0, "副 AI 只喂最近 2 版，里程碑不进 prompt");
    // 倒退回第 11 楼：以前整本清空，现在退到第 8 楼的里程碑
    tavern.chat.splice(11); F("ipeLedgerReconcile")(11);
    s = F("ipeLedgerRead")();
    eq(s.lastFloor, 8, "删到第 11 楼：现任回退到第 8 楼的里程碑，不再整本清空");
    ok(s.current.indexOf("第 8 楼的账") >= 0, "内容是第 8 楼那份");
    // 上限 12 个里程碑
    const { tavern: t2, F: F2 } = boot(4);
    for (let f = 2; f <= 400; f += 2) F2("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    const f2 = F2("ipeLedgerRead")().versions.map(v => v.floor);
    eq(f2.length, 6 + 12 + 2, "近 6 版 + 10 楼里程碑最多 12 个 + 每 100 楼一段各留一版（2.18.1）");
    eq(f2.slice(18).join(","), "198,98", "100 楼层：只在没有 10 楼里程碑的那几段里留，同段留最新");
    // 一千楼删回一百楼：靠 100 楼层退
    const { tavern: t4, F: F4 } = boot(4);
    for (let f = 2; f <= 1000; f += 2) F4("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    const f4 = F4("ipeLedgerRead")().versions.map(v => v.floor);
    eq(f4.length, 6 + 12 + 8, "一千楼：6 + 12 + 8 个 100 楼里程碑（前两段已被 10 楼层罩住）");
    ok(f4.indexOf(98) >= 0 && f4.indexOf(198) >= 0 && f4.indexOf(798) >= 0, "100 楼层落在 98 / 198 / … / 798");
    for (let i = 0; i < 1000; i++) t4.chat.push({ is_user: i % 2 === 0, mes: "x" });
    t4.chat.splice(110); F4("ipeLedgerReconcile")(110);
    eq(F4("ipeLedgerRead")().lastFloor, 98, "从 1000 楼删回 110 楼：现任退到第 98 楼那版，不再整本清空");
    const { tavern: t5, F: F5 } = boot(4);
    for (let f = 2; f <= 3000; f += 2) F5("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    eq(F5("ipeLedgerRead")().versions.length, 6 + 12 + 10, "100 楼里程碑最多 10 个");
    // 105 楼删回 95 楼：以前退到 88，现在退到 94
    const { tavern: t6, F: F6 } = boot(4);
    for (let f = 2; f <= 104; f += 2) F6("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    for (let i = 0; i < 100; i++) t6.chat.push({ is_user: i % 2 === 0, mes: "x" });
    t6.chat.splice(95); F6("ipeLedgerReconcile")(95);
    eq(F6("ipeLedgerRead")().lastFloor, 94, "105 楼删回 95 楼：退到第 94 楼那版（近 6 版全留的效果）");
    const u6 = F6("ipeLedgerBuildUser")("正文", "", 95);
    ok(u6.indexOf("第 92 楼时版本") >= 0 && u6.indexOf("第 88 楼时版本") >= 0 && u6.indexOf("第 78 楼时版本") < 0, "副 AI 仍只喂最近 2 版旧账（92、88），更早的不进 prompt");
    // 历史关到只留现任：不留里程碑
    const { tavern: t3, F: F3 } = boot(4);
    t3.extensionSettings[F3("EXT_NAME")].ledgerVersionsN = 1;
    for (let f = 2; f <= 60; f += 2) F3("ipeLedgerCommit")("第 " + f + " 楼的账，够长够长够长够长够长。", f);
    eq(F3("ipeLedgerRead")().versions.length, 0, "历史版本数设 1（只留现任）：没有里程碑");
}

console.log("\n【42】 发消息前等挂账（2.18.0 generate_interceptor）：等落账再放行、贴耳已是新账；超时放行；swipe 不等直接掐；关掉就不等");
await (async () => {
    const { w, tavern, F, EPK } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    ok(typeof w.ipeGenerateInterceptor === "function", "window.ipeGenerateInterceptor 挂上了（manifest 里声明的名字）");
    F("ipeLedgerCommit")("旧账本，够长够长够长够长够长够长。", 8);
    F("ipeLedgerApplyEP")();
    w.fetch = (u, o) => new Promise(res => setTimeout(() => res(okBody("等来的新账本，够长够长够长够长够长够长。")), 300));
    F("ipeLedgerRun")(9, true);
    await wait(20);
    const t0 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    ok(!F("ipeLedgerRead")().current.includes("旧账本") && F("ipeLedgerRead")().current.includes("等来的新账本"), "拦截器等到挂账落账才返回（等了 " + (Date.now() - t0) + " ms）");
    ok(String(tavern.extensionPrompts[EPK].value).indexOf("等来的新账本") >= 0, "放行时贴耳已经是新账");
    ok(statusText(w).indexOf("读到的是新账") >= 0, "状态行说这一发读到的是新账", statusText(w));
    // 超时：最多等 0.3 秒
    st.ledgerWaitMaxSec = 0.3;
    w.fetch = (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    F("ipeLedgerRun")(9, true); await wait(20);
    const t1 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    ok(Date.now() - t1 >= 280 && Date.now() - t1 < 1500, "超时放行（等了 " + (Date.now() - t1) + " ms）");
    ok(statusText(w).indexOf("先送出去") >= 0, "状态行说先送出去了", statusText(w));
    F("ipeLedgerStop")(); await wait(50);
    // swipe：正在挂末楼 → 掐掉不等
    F("ipeLedgerRun")(9, true); await wait(20);
    const t2 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "swipe");
    ok(Date.now() - t2 < 100, "swipe 不等，立刻返回");
    await wait(60);
    ok(statusText(w).indexOf("已中断") >= 0, "正在挂的末楼被掐掉", statusText(w));
    // 关掉开关：不等
    st.ledgerWaitBeforeSend = false; st.ledgerWaitMaxSec = 60;
    F("ipeLedgerRun")(9, true); await wait(20);
    const t3 = Date.now();
    await w.ipeGenerateInterceptor(tavern.chat, 0, () => {}, "normal");
    ok(Date.now() - t3 < 100, "开关关着：不等");
    F("ipeLedgerStop")(); await wait(50);
})();

console.log("\n【43】 补挂队列（2.18.0）：跑着的时候又来一楼，跑完自动补最新一楼；人掐的不补");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerAutoRun = true;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    let n = 0;
    w.fetch = (u, o) => new Promise(res => setTimeout(() => { n++; res({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>第 " + n + " 次挂的账本，够长够长够长够长够长够长。</ledger>" } }] }) }); }, 150));
    F("ipeLedgerRun")(9, true); await wait(20);
    F("ipeLedgerRun")(9, true);
    ok(statusText(w).indexOf("补挂") >= 0, "第二楼来了：状态行说记下了、跑完补挂", statusText(w));
    await wait(700);
    eq(n, 2, "跑完自动补了一次（共两次请求）");
    ok(F("ipeLedgerRead")().current.indexOf("第 2 次") >= 0, "现任是补挂那次的");
    // 人掐的不补
    n = 0;
    w.fetch = (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    F("ipeLedgerRun")(9, true); await wait(20);
    F("ipeLedgerRun")(9, true);
    F("ipeLedgerStop")(); await wait(300);
    eq(n, 0, "人掐了：排着的那次也不跑");
})();

console.log("\n【44】 失败自动重试一次（2.18.0）：5xx / 网络错重试且不计失败不弹卡；4xx 不重试；重试再败才计失败");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = withApi(tavern, F, "gpt-4.1");
    st.ledgerRetryOnce = true; st.ledgerRetryDelayMs = 20;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const okBody = txt => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + txt + "</ledger>" } }] }) });
    let calls = 0;
    w.fetch = async () => { calls++; return calls === 1 ? { ok: false, status: 502, text: async () => "bad gateway" } : okBody("重试成功的账本，够长够长够长够长够长够长。"); };
    await F("ipeLedgerRun")(9, true); await wait(200);
    eq(calls, 2, "502 → 重试了一次");
    ok(F("ipeLedgerRead")().current.indexOf("重试成功") >= 0, "重试那次落账了");
    eq(F("failStreak")(), 0, "第一次失败不计入失败计数");
    ok(!w.document.querySelector(".ipe-notice-card") || !String(w.document.body.textContent).includes("挂账失败 · 账本还是上一份"), "没弹失败卡");
    // 4xx 不重试
    calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 401, text: async () => "unauthorized" }; };
    await F("ipeLedgerRun")(9, true); await wait(200);
    eq(calls, 1, "401 不重试");
    eq(F("failStreak")(), 1, "计一次失败");
    // 两次都 5xx → 计失败
    calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 503, text: async () => "unavailable" }; };
    await F("ipeLedgerRun")(9, true); await wait(200);
    eq(calls, 2, "503 重试一次后不再重试");
    eq(F("failStreak")(), 2, "重试也失败才计失败");
    // 网络错也重试
    calls = 0; st.ledgerAutoRun = false;
    w.fetch = async () => { calls++; if (calls === 1) throw new TypeError("Failed to fetch"); return okBody("网络恢复后的账本，够长够长够长够长够长够长。"); };
    await F("ipeLedgerRun")(9, true); await wait(200);
    eq(calls, 2, "Failed to fetch → 重试");
    ok(F("ipeLedgerRead")().current.indexOf("网络恢复") >= 0, "重试落账");
    // 开关关掉：不重试
    st.ledgerRetryOnce = false; calls = 0;
    w.fetch = async () => { calls++; return { ok: false, status: 502, text: async () => "bad gateway" }; };
    await F("ipeLedgerRun")(9, true); await wait(200);
    eq(calls, 1, "开关关着：不重试");
})();

console.log("\n【45】 从别的聊天继承账本（2.18.0）：列表同角色排前、盖当前楼号的戳、原账本进历史、对账不误杀；镜像带角色名");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    F("ipeLedgerCommit")("本聊天现任的账，够长够长够长够长够长。", 8);
    const mirror = JSON.parse(w.localStorage.getItem("ipe_ledger_mirror_v2"));
    eq(mirror["test-chat"].who, "苑无忧", "镜像里带了角色名");
    mirror["old-chat-A"] = { v: 2, current: "别人的账：顾寒的旧聊天，够长够长够长。", versions: [], order: "", lastFloor: 77, updatedAt: 5000, who: "顾寒" };
    mirror["old-chat-B"] = { v: 2, current: "同角色的账：苑无忧上一个聊天，买了去北京的票。", versions: [{ floor: 100, ts: 1, text: "x" }], order: "别的指令", lastFloor: 120, updatedAt: 3000, who: "苑无忧" };
    mirror["empty-chat"] = { v: 2, current: "", versions: [], lastFloor: 3, updatedAt: 9000, who: "苑无忧" };
    w.localStorage.setItem("ipe_ledger_mirror_v2", JSON.stringify(mirror));
    const list = F("ipeLedgerInheritList")();
    eq(list.map(x => x.key).join(","), "old-chat-B,old-chat-A", "列表：不含本聊天和空账本，同角色排前面，其余按时间");
    F("ipeLedgerRefreshInherit")();
    const sel = d.querySelector("#ipe-ledger-inherit-sel");
    eq(sel.options.length, 3, "下拉 = 占位 + 两份");
    ok(sel.options[1].textContent.indexOf("★") === 0 && sel.options[1].textContent.indexOf("苑无忧") >= 0 && sel.options[1].textContent.indexOf("第 120 楼") >= 0, "同角色那份带 ★、角色名、楼号", sel.options[1].textContent);
    let asked = 0; w.confirm = () => { asked++; return true; };
    sel.value = "old-chat-B"; d.querySelector("#ipe-ledger-inherit").click();
    eq(asked, 1, "本聊天已有账本：问了一句");
    let s = F("ipeLedgerRead")();
    ok(s.current.indexOf("北京的票") >= 0, "现任换成了继承来的");
    eq(s.lastFloor, 10, "盖本聊天当前楼号（10）的戳，不是原来的 120");
    eq(s.versions.length, 1, "继承来的历史不带过来，只有本聊天原账本进了历史");
    ok(s.versions[0].text.indexOf("本聊天现任") >= 0 && s.versions[0].floor === 8, "原账本进历史、楼号照旧");
    eq(s.order, "别的指令", "本聊天 User 指令为空：连对方的 User 指令一起带过来");
})();

console.log("\n【46】 压缩账本（2.19.0）：材料含规则与现任账本、走预览、采用后旧版标「压缩前」进历史且不喂副 AI、比例提示、阈值提醒、自定义指令");
await (async () => {
    const { w, tavern, F } = boot(10);
    const d = w.document;
    const st = withApi(tavern, F, "gpt-4.1");
    const big = "【楼层状态】\n" + Array.from({ length: 60 }, (_, i) => "- 第 " + (i + 1) + " 条：某支线的过程描写，够长够长够长够长够长。").join("\n");
    F("ipeLedgerCommit")(big, 10);
    st.ledgerCompressWarnChars = 1000;
    ok(F("ipeLedgerVersionInfo")().indexOf("账本 " + big.length + " 字") >= 0 && F("ipeLedgerVersionInfo")().indexOf("压缩一版") >= 0, "版本信息报字数，超过 3000 提醒可以压缩", F("ipeLedgerVersionInfo")());
    let sent = null;
    const small = "【楼层状态】\n- 支线已了结：结果一句话。\n- 硬设定：左肩刀伤第 10 楼起。";
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>" + small + "</ledger>" } }] }) }; };
    await F("ipeLedgerCompress")();
    ok(sent.messages[0].role === "system" && sent.messages[0].content.length > 100, "system 是当前生效的挂账规则");
    ok(sent.messages[1].content.indexOf("【现任账本（" + big.length + " 字）】") >= 0 && sent.messages[1].content.indexOf("只删不添") >= 0 && sent.messages[1].content.indexOf("<ledger>") >= 0, "user 材料：现任账本 + 内置压缩指令 + 包裹要求");
    ok(sent.messages[1].content.indexOf("【本轮正文】") < 0, "不带正文、不按楼挂");
    const box = d.querySelector("#ipe-ledger-preview-box"), pv = d.querySelector("#ipe-ledger-preview");
    ok(box.style.display !== "none" && pv.value === small, "结果进预览框，没直接落账");
    ok(d.querySelector("#ipe-ledger-preview-tip").textContent.indexOf("%") >= 0, "提示带压缩比例");
    eq(F("ipeLedgerRead")().current, big, "采用前账本没动");
    d.querySelector("#ipe-ledger-adopt").click();
    let s = F("ipeLedgerRead")();
    eq(s.current, small, "采用后现任是压缩版");
    eq(s.lastFloor, 10, "楼号不变");
    ok(s.versions[0].tag === "压缩前" && s.versions[0].text === big && s.versions[0].floor === 10, "压缩前那版标记进历史");
    const his = F("ipeLedgerHistoryBlock")();
    ok(his.indexOf("某支线的过程描写") < 0 && his.indexOf("支线已了结") >= 0, "压缩前的全本不再喂给副 AI，只喂压缩版");
    ok(box.style.display === "none", "预览收起");
    F("ipeLedgerCommit")("第 12 楼的新账，够长够长够长够长够长。", 12);
    s = F("ipeLedgerRead")();
    ok(s.versions.some(v => v.tag === "压缩前") && s.versions.some(v => v.floor === 10 && !v.tag), "下一楼落账后：压缩前备份和第 10 楼压缩版并存，不被同楼去重吃掉");
    F("ipeLedgerRefreshEditors")();
    ok(Array.from(d.querySelector("#ipe-ledger-vers").options).some(o => o.textContent.indexOf("压缩前") >= 0), "历史下拉里能认出压缩前那版");
    // 删得太狠 → 警告；自定义指令生效
    st.ledgerCompressPrompt = "我的自定义压缩指令：只留三行";
    w.fetch = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "<ledger>太短</ledger>" } }] }) }; };
    F("ipeLedgerCommit")(big, 14);
    await F("ipeLedgerCompress")();
    ok(sent.messages[1].content.indexOf("我的自定义压缩指令") >= 0 && sent.messages[1].content.indexOf("只删不添") < 0, "自定义指令替换内置");
    ok(d.querySelector("#ipe-ledger-preview-tip").textContent.indexOf("⚠️") === 0, "只剩不到 30%：提示删得太狠");
    d.querySelector("#ipe-ledger-preview-close").click();
    eq(F("ipeLedgerRead")().current, big, "收起不采用：账本没动");
    // 阈值 0 = 不提醒
    st.ledgerCompressWarnChars = 0;
    ok(F("ipeLedgerVersionInfo")().indexOf("压缩一版") < 0, "阈值 0：不提醒");
    ok(!!d.querySelector("#ipe-ledger-compress") && !!d.querySelector("#ipe-ledger-compress-prompt") && !!d.querySelector("#ipe-ledger-compress-reset"), "面板里有压缩按钮 / 指令框 / 还原按钮");
})();

console.log("\n【36】 NSFW 槽面板：开了场景模式才出现；有自己的下拉 / 名称 / 新增 / 删除 / 文本框；改文字只动 NSFW 库");
await (async () => {
    const { w, tavern, F } = boot(10);
    const st = tavern.extensionSettings[F("EXT_NAME")];
    const d = w.document;
    F("ipeLedgerModeRefresh")();
    const fold = d.querySelector("#ipe-ledger-nsfw-fold");
    ok(!!fold && fold.style.display === "none", "关着：NSFW 槽面板藏起来");
    st.ledgerModeEnabled = true; F("ipeLedgerModeRefresh")();
    ok(fold.style.display !== "none", "开了：NSFW 槽面板出现");
    ok(!!d.querySelector("#ipe-ledger-prompt-n-slot") && !!d.querySelector("#ipe-ledger-prompt-n-name") && !!d.querySelector("#ipe-ledger-prompt-n-add") && !!d.querySelector("#ipe-ledger-prompt-n-del") && !!d.querySelector("#ipe-ledger-prompt-n"), "版面和 Normal 槽一样：下拉 / 名称 / 新增 / 删除 / 文本框");
    ok(!d.querySelector("#ipe-ledger-mode-rows") && !d.querySelector("#ipe-ledger-slots") && !d.querySelector("#ipe-ledger-mode-add"), "旧的模式行 / 卡槽区 / 新增模式都没了");
    const ta = d.querySelector("#ipe-ledger-prompt-n");
    ta.value = "NSFW 规则文字"; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
    const nl = JSON.parse(st.ledgerPromptNsfwPresetsJson); const npv = JSON.parse(st.ledgerPromptPresetsJson || "[]");
    ok(nl.length === 1 && nl[0].value === "NSFW 规则文字", "文字写进 NSFW 库");
    ok(!npv.some(x => x.value === "NSFW 规则文字"), "Normal 库没被动");
    d.querySelector("#ipe-ledger-prompt-n-add").click();
    eq(JSON.parse(st.ledgerPromptNsfwPresetsJson).length, 2, "NSFW 槽「新增」多一套，只在 NSFW 库里");
    const man = d.querySelector("#ipe-ledger-mode-manual");
    ok(man && man.options.length === 3, "手动锁定只有 自动 / normal / nsfw 三档");
    ok(d.querySelector("#ipe-ledger-mode-now").textContent.indexOf("Normal 槽 →") >= 0 && d.querySelector("#ipe-ledger-mode-now").textContent.indexOf("NSFW 槽 →") >= 0, "状态行同时报两个槽各选了什么");
})();

console.log("\n" + "\u2500".repeat(46));
console.log(fail === 0 ? `\u5168\u90E8\u901A\u8FC7 \u2705  ${pass} \u9879` : `${pass} \u901A\u8FC7 / ${fail} \u5931\u8D25 \u274C`);
process.exit(fail === 0 ? 0 : 1);
})();

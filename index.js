/*
 *  Image Prompt Extractor v1.8.7
 *  SillyTavern 1.18 — SillyTavern.getContext() + fetch API
 */

const EXT_NAME = "image-prompt-extractor";
const DEFAULTS = {
    enabled: true,
    mistTheme: false,   // v1.8.7 开灯：莫兰迪雾蓝浅色皮，默认关（暗色）
    autoInject: false,
    autoInjectDelay: 1800,
    requestTimeout: 0,
    apiEndpoint: "", apiKey: "", model: "",
    apiProfilesJson: "", activeApiProfile: "api_1",
    systemPrompt: "", baseTemplate: "", characterAnchors: "", extractionRules: "", anchorUsageGuide: "",
    activeBaseTemplate: "tpl_1",
    quickEntryLeft: "",
    quickEntryTop: "",
    baseTemplatesJson: "",
    anchorPresetsJson: "",
    activeAnchorPreset: "anchor_1",
    rulePresetsJson: "",
    activeRulePreset: "rule_1",
    systemPromptPresetsJson: "",
    activeSystemPromptPreset: "sys_emo",
    showQuickEntry: true,
    baseTemplateSlot1: "",
    baseTemplateSlot2: "",
    baseTemplateSlot3: "",
    baseTemplateSlot4: "",
    baseTemplateName1: "预设1",
    baseTemplateName2: "预设2",
    baseTemplateName3: "预设3",
    baseTemplateName4: "预设4",
    activeTab: "image",
    ledgerEpEnabled: true,
    ledgerEpDepth: 2,
    ledgerApiProfile: "",
    ledgerReportFloors: 10, ledgerReportOpen: "<report>", ledgerReportClose: "</report>",
    ledgerVersionsN: 3,
    ledgerTagOpen: "<ledger>", ledgerTagClose: "</ledger>",
    ledgerAllowNoChange: false,
    ledgerInlineShow: true,
    ledgerPromptPresetsJson: "", activeLedgerPrompt: "lp_1",
    ledgerNotePresetsJson: "",   activeLedgerNote: "ln_1",
    ledgerAutoRun: false
};
let currentDesc = "", currentIdx = -1, processing = false, initialized = false;
let ipeAbortController = null;
let ipeUserAbortRequested = false;
let ipeRetryTimer = null;
let autoTimer = null, pendingAutoIdx = -1;

const IPE_CREDITS = "ripple & GPT & Claude";
const IPE_DEFAULT_ANCHOR_USAGE_GUIDE = [
    "以下角色锚点仅为候选资料库，不是强制全部使用。提取时请严格根据正文当前场景按需调用：",
    "1. 只调用正文中明确出场、且当前画面确实需要入镜的角色。",
    "2. 未出场、仅被提及、仅存在于回忆/对话/电话/聊天记录中的角色，不要加入当前画面。",
    "3. 单人场景只输出单人描述，双人场景只输出双人描述；只有正文明确存在多人同场互动时，才输出多人描述。若多个主角并不处于同一场景、同一空间或同一时间片段，不需要强行生成同框互动图，此时可根据正文内容选择单人图，或输出拼图/分镜图。",
    "4. 若正文只出现某一个角色，例如只出char，则只调用char锚点；其他角色（包括NPC、{{user}}）若未实际出场，一律忽略。",
    "5. 这些角色锚点只用于校准已出场角色的外貌，不用于凭空增加角色，不用于强行拼成双人图或多人图。",
    "6. 如果当前段落没有明确描写某个角色的入镜需求，就不要因为锚点里有这个人而主动生成他/她。"
].join("\n");

function ipeGetAnchorUsageGuide() {
    var c = cfg();
    var custom = String((c && c.anchorUsageGuide) || "").trim();
    return custom || IPE_DEFAULT_ANCHOR_USAGE_GUIDE;
}

function ipeSetAnchorUsageGuide(val) {
    save("anchorUsageGuide", String(val || ""));
}

function ipeResetAnchorUsageGuide() {
    save("anchorUsageGuide", "");
    ["ipe-anchor-guide-editor","iped-anchor-guide-editor"].forEach(function(id){
        var el = q("#" + id);
        if (el) el.value = IPE_DEFAULT_ANCHOR_USAGE_GUIDE;
    });
    setStatus("已恢复默认通用锚点规则", "#62c073");
    ipeSaveNow();
}

function ipeToggleAnchorGuideEditor() {
    ["ipe-anchor-guide-editor-wrap","iped-anchor-guide-editor-wrap"].forEach(function(id){
        var el = q("#" + id);
        if (!el) return;
        if (el.style.display === "none" || !el.style.display) {
            el.style.display = "block";
        } else {
            el.style.display = "none";
        }
    });
}

function ipeStripBuiltInAnchorGuide(text) {
    var s = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!s) return "";
    var currentGuide = ipeGetAnchorUsageGuide();
    var patterns = [
        currentGuide + "\n【角色锚点】",
        currentGuide,
        IPE_DEFAULT_ANCHOR_USAGE_GUIDE + "\n【角色锚点】",
        IPE_DEFAULT_ANCHOR_USAGE_GUIDE
    ];
    for (var i = 0; i < patterns.length; i++) {
        var p = String(patterns[i] || "").trim();
        if (p && s.indexOf(p) === 0) {
            s = s.slice(p.length).trim();
        }
    }
    return s;
}

function ctx() { return SillyTavern.getContext(); }

// 参考“小酒悬浮窗”的方式：优先把悬浮 UI 挂到顶层 SillyTavern 页面，而不是脚本 iframe 内。
function ipeRootWindow() {
    try {
        if (window.top && window.top.document) return window.top;
    } catch(e) {}
    return window;
}
function ipeRootDocument() {
    try {
        var w = ipeRootWindow();
        if (w && w.document) return w.document;
    } catch(e) {}
    return document;
}

// v1.8.7 开灯：莫兰迪雾蓝浅色皮。仅在 .ipe-panel 上挂/摘 ipe-mist 类，
// 全部配色交给 style.css 级联；不动任何功能逻辑。
function ipeApplyTheme() {
    try {
        var p = ipeRootDocument().getElementById("ipe-panel");
        if (!p) return;
        var mist = cfg().mistTheme === true;
        p.classList.toggle("ipe-mist", mist);
        var tg = ipeRootDocument().getElementById("ipe-theme-toggle");
        if (tg) tg.textContent = mist ? "\u2600\uFE0F" : "\uD83C\uDF19";
    } catch(e) {}
}

function loadSettings() {
    try {
        const es = ctx().extensionSettings;
        if (!es[EXT_NAME]) es[EXT_NAME] = {};
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (es[EXT_NAME][k] === undefined) es[EXT_NAME][k] = v;
        }

        var st = es[EXT_NAME];

        // V1.8 迁移：四槽位基础模板 -> 无限模板列表
        if (!st.baseTemplatesJson) {
            var list = [];
            for (var i = 1; i <= 4; i++) {
                var name = st["baseTemplateName" + i] || ("预设" + i);
                var value = st["baseTemplateSlot" + i] || "";
                if (i === 1 && !value && st.baseTemplate) value = st.baseTemplate;
                list.push({
                    id: "tpl_" + i,
                    name: name,
                    value: value
                });
            }
            st.baseTemplatesJson = JSON.stringify(list);
        }

        // V1.8 迁移：单一角色锚点 -> 角色锚点预设列表
        if (!st.anchorPresetsJson) {
            st.anchorPresetsJson = JSON.stringify([{
                id: "anchor_1",
                name: "角色锚点1",
                value: st.characterAnchors || ""
            }]);
        }

        // V1.8.5 迁移：单一提取规则 -> 提取规则预设列表
        if (!st.rulePresetsJson) {
            st.rulePresetsJson = JSON.stringify([{
                id: "rule_1",
                name: "GPT-image-2",
                value: st.extractionRules || ""
            }, {
                id: "rule_2",
                name: "NanoBanana",
                value: ""
            }, {
                id: "rule_3",
                name: "NAI",
                value: ""
            }]);
        }

        // V1.8.5 迁移：单一系统提示 -> 两套系统提示预设
        if (!st.systemPromptPresetsJson) {
            st.systemPromptPresetsJson = JSON.stringify([{
                id: "sys_emo",
                name: "情感",
                value: st.systemPrompt || "You extract concise visual image-generation descriptions from Chinese roleplay text. Focus on visible emotion, relationship tension, micro-expressions, body language, atmosphere, lighting, and cinematic mood. Output only the final English Description. Do not think aloud. Do not explain."
            }, {
                id: "sys_plot",
                name: "剧情",
                value: "You extract concise visual image-generation descriptions from Chinese roleplay text. Focus on visible plot actions, scene composition, character placement, objects, environment, time, lighting, camera distance, and narrative context. Output only the final English Description. Do not think aloud. Do not explain."
            }]);
        }

        // V1.8.6 迁移：单一 API 配置 -> 可切换 API 预设列表
        if (!st.apiProfilesJson) {
            st.apiProfilesJson = JSON.stringify([{
                id: "api_1",
                name: "默认 API",
                endpoint: st.apiEndpoint || "",
                key: st.apiKey || "",
                model: st.model || ""
            }]);
        }

        if (!st.activeBaseTemplate || String(st.activeBaseTemplate).indexOf("slot") === 0) {
            var n = String(st.activeBaseTemplate || "slot1").replace(/^slot/, "") || "1";
            st.activeBaseTemplate = "tpl_" + n;
        }
        try {
            var cleanedSingleAnchor = ipeStripBuiltInAnchorGuide(st.characterAnchors || "");
            if (cleanedSingleAnchor !== String(st.characterAnchors || "")) st.characterAnchors = cleanedSingleAnchor;

            var anchorPresetList = ipeSafeJsonParse(st.anchorPresetsJson, null);
            if (Array.isArray(anchorPresetList) && anchorPresetList.length) {
                var changed = false;
                for (var ai = 0; ai < anchorPresetList.length; ai++) {
                    if (!anchorPresetList[ai]) continue;
                    var rawVal = String(anchorPresetList[ai].value || "");
                    var cleanedVal = ipeStripBuiltInAnchorGuide(rawVal);
                    if (cleanedVal !== rawVal) {
                        anchorPresetList[ai].value = cleanedVal;
                        changed = true;
                    }
                }
                if (changed) st.anchorPresetsJson = JSON.stringify(anchorPresetList);
            }
        } catch (_e) {}

        if (!st.activeAnchorPreset) st.activeAnchorPreset = "anchor_1";
        if (!st.activeRulePreset) st.activeRulePreset = "rule_1";
        if (!st.activeSystemPromptPreset) st.activeSystemPromptPreset = "sys_emo";
        if (!st.activeApiProfile) st.activeApiProfile = "api_1";
        if (typeof st.anchorUsageGuide !== "string") st.anchorUsageGuide = "";
    } catch(e) { console.error("[IPE] loadSettings:", e); }
}
function cfg() {
    try { return ctx().extensionSettings[EXT_NAME]; }
    catch(e) { return {...DEFAULTS}; }
}
function ipeSaveNow() {
    try {
        var c = ctx();
        if (c && typeof c.saveSettings === "function") {
            c.saveSettings();
        } else if (c && typeof c.saveSettingsDebounced === "function") {
            c.saveSettingsDebounced();
        }
    } catch(e) {}
}

function save(key, val) {
    try {
        var c = ctx();
        c.extensionSettings[EXT_NAME][key] = val;
        if (typeof c.saveSettingsDebounced === "function") c.saveSettingsDebounced();
        else ipeSaveNow();
    } catch(e) {}
}

function saveCritical(key, val) {
    try {
        var c = ctx();
        c.extensionSettings[EXT_NAME][key] = val;
        ipeSaveNow();
    } catch(e) {}
}

function esc(s) {
    if (!s) return "";
    var d = ipeRootDocument().createElement("div"); d.textContent = s; return d.innerHTML;
}
function q(s) {
    var rd = ipeRootDocument();
    try {
        var a = rd.querySelector(s);
        if (a) return a;
    } catch(e) {}
    try { return document.querySelector(s); } catch(e) { return null; }
}

function ipeSafeJsonParse(text, fallback) {
    try {
        var v = JSON.parse(String(text || ""));
        return v;
    } catch(e) {
        return fallback;
    }
}

function ipeMakeId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/* ============================================================
   🐚 挂账 v2.0 · 账本失格化
   总纲：代码只认定界符和楼层数，语义一概不碰。
   账本是一整块不透明文本；分几层、怎么写、几楼算拖，全归预设。
   安全不靠格式校验，靠版本管理 + 事故保底。
   ============================================================ */

// 铁则：与 ARREBOL_D_DIRECTOR_FLOAT / ARREBOL_D_CARD_DRAWER 互异
var IPE_LEDGER_EP_KEY    = "IPE_LEDGER_FLOAT";
var IPE_LEDGER_META_KEY  = "ipe_ledger_v2";
var IPE_LEDGER_META_V1   = "ipe_ledger_v1";      // 保留不删，回滚保险
var IPE_LEDGER_LS_KEY    = "ipe_ledger_mirror_v2";
var IPE_LEDGER_LS_V1     = "ipe_ledger_mirror_v1";
var IPE_LEDGER_VER_MAX   = 10;
var IPE_LEDGER_REPORT_CAP = 60000;   // 真管事的那道闸；2000 楼旋钮只是粗筛
var IPE_LEDGER_SHRINK    = 0.4;                   // 新文本 < 旧版 40% 视为疑似事故

/* ---- 基础工具 ---- */
function ipeChatKey() {
    try {
        var c = ctx();
        if (typeof c.getCurrentChatId === "function") {
            var x = c.getCurrentChatId();
            if (x) return String(x);
        }
        if (c.chatId) return String(c.chatId);
        return String(c.characterId || "char") + "::" + String(c.name1 || "chat");
    } catch(e) { return "unknown-chat"; }
}
function ipeChatKeyReady() {
    var k = ipeChatKey();
    return !!k && k !== "unknown-chat";
}

// 数楼不数字：楼层存在即计数，藏楼不改数组长度，天然免疫
function ipeFloorNo() {
    try {
        var c = ctx();
        return (c && c.chat && c.chat.length) ? c.chat.length : 0;
    } catch(e) { return 0; }
}

function ipeMetaRoot() {
    try {
        var c = ctx();
        var m = c.chatMetadata || c.chat_metadata;
        if (m && typeof m === "object") return m;
    } catch(e) {}
    return null;
}
function ipeReadJsonLS(key) {
    try {
        var raw = localStorage.getItem(key);
        var v = raw ? JSON.parse(raw) : null;
        return (v && typeof v === "object") ? v : {};
    } catch(e) { return {}; }
}
function ipeWriteJsonLS(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj || {})); } catch(e) {}
}

/* ---- v2 结构规整：每次读都过，改 schema 不炸 ---- */
function ipeLedgerNormalize(raw) {
    var o = (raw && typeof raw === "object") ? raw : {};
    var vs = Array.isArray(o.versions) ? o.versions : [];
    var out = [];
    for (var i = 0; i < vs.length && out.length < IPE_LEDGER_VER_MAX; i++) {
        var v = vs[i];
        if (!v) continue;
        var t = String(v.text == null ? "" : v.text);
        if (!t.trim()) continue;
        out.push({
            floor: Number.isFinite(Number(v.floor)) ? Number(v.floor) : -1,
            ts:    Number.isFinite(Number(v.ts))    ? Number(v.ts)    : 0,
            text:  t
        });
    }
    return {
        v: 2,
        current:   String(o.current == null ? "" : o.current),
        versions:  out,
        order:     String(o.order || ""),
        lastFloor: Number.isFinite(Number(o.lastFloor)) ? Number(o.lastFloor) : -1,
        updatedAt: Number.isFinite(Number(o.updatedAt)) ? Number(o.updatedAt) : 0
    };
}

/* ---- v1 → v2 迁移：只在 v2 键不存在时跑一次，v1 键保留不删 ---- */
function ipeLedgerMigrateV1(rawV1) {
    var o = (rawV1 && typeof rawV1 === "object") ? rawV1 : {};
    var list = Array.isArray(o.entries) ? o.entries : [];
    var lines = [];
    for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (!e) continue;
        var t = String((typeof e === "string") ? e : (e.text || "")).trim();
        if (!t) continue;
        var since = Number(e && e.since);
        lines.push("\u00b7 " + t + (Number.isFinite(since) && since >= 0 ? "\uff08\u7b2c" + since + "\u697c\u8d77\uff09" : ""));
    }
    var text = lines.join("\n");
    var st = ipeLedgerNormalize({ current: text, order: String(o.order || ""), lastFloor: ipeFloorNo() });
    if (text) st.versions = [{ floor: ipeFloorNo(), ts: Date.now(), text: text }];
    return st;
}

function ipeLedgerRead() {
    // 1) v2 主档
    try {
        var root = ipeMetaRoot();
        if (root && root[IPE_LEDGER_META_KEY] && typeof root[IPE_LEDGER_META_KEY] === "object") {
            return ipeLedgerNormalize(root[IPE_LEDGER_META_KEY]);
        }
    } catch(e0) {}
    // 2) v2 镜像
    try {
        var all2 = ipeReadJsonLS(IPE_LEDGER_LS_KEY);
        var hit2 = all2[ipeChatKey()];
        if (hit2 && typeof hit2 === "object") return ipeLedgerNormalize(hit2);
    } catch(e1) {}
    // 3) v1 迁移（主档优先，镜像兜底）
    try {
        var r = ipeMetaRoot();
        if (r && r[IPE_LEDGER_META_V1] && typeof r[IPE_LEDGER_META_V1] === "object") {
            var m1 = ipeLedgerMigrateV1(r[IPE_LEDGER_META_V1]);
            if (m1.current) { ipeLedgerSave(m1); return m1; }
        }
        var allV1 = ipeReadJsonLS(IPE_LEDGER_LS_V1);
        var hitV1 = allV1[ipeChatKey()];
        if (hitV1 && typeof hitV1 === "object") {
            var m2 = ipeLedgerMigrateV1(hitV1);
            if (m2.current) { ipeLedgerSave(m2); return m2; }
        }
    } catch(e2) {}
    return ipeLedgerNormalize(null);
}

function ipeLedgerSave(state) {
    var clean = ipeLedgerNormalize(state);
    clean.updatedAt = Date.now();
    var metaOk = false, lsOk = false;
    try {
        var root = ipeMetaRoot();
        if (root) {
            root[IPE_LEDGER_META_KEY] = clean;
            metaOk = true;
            var c = ctx();
            if (typeof c.saveMetadataDebounced === "function") c.saveMetadataDebounced();
            else if (typeof c.saveMetadata === "function") c.saveMetadata();
        }
    } catch(eM) { metaOk = false; }
    if (ipeChatKeyReady()) {
        try {
            var all = ipeReadJsonLS(IPE_LEDGER_LS_KEY);
            all[ipeChatKey()] = clean;
            ipeWriteJsonLS(IPE_LEDGER_LS_KEY, all);
            lsOk = true;
        } catch(eL) { lsOk = false; }
    }
    return { meta: metaOk, ls: lsOk };
}

// 落新版：旧版入历史，新文本成为 current
function ipeLedgerCommit(text) {
    var st = ipeLedgerRead();
    var old = String(st.current || "");
    if (old.trim()) {
        st.versions.unshift({ floor: st.lastFloor >= 0 ? st.lastFloor : ipeFloorNo(), ts: Date.now(), text: old });
        st.versions = st.versions.slice(0, IPE_LEDGER_VER_MAX);
    }
    st.current   = String(text || "");
    st.lastFloor = ipeFloorNo();
    return ipeLedgerSave(st);
}

function ipeLedgerRollback(idx) {
    var st = ipeLedgerRead();
    var v = st.versions[idx];
    if (!v) return false;
    var old = String(st.current || "");
    st.versions.splice(idx, 1);
    if (old.trim()) st.versions.unshift({ floor: st.lastFloor >= 0 ? st.lastFloor : ipeFloorNo(), ts: Date.now(), text: old });
    st.versions = st.versions.slice(0, IPE_LEDGER_VER_MAX);
    st.current = v.text;
    ipeLedgerSave(st);
    return true;
}



/* ============================================================
   🐚 挂账 v2.0 · 三层视野 / 协议 / 保底 / 贴耳 / 楼内展示
   ============================================================ */

/* ---- 代码持有的最小协议：仅此两条 ---- */
var IPE_LEDGER_TAG_DEFAULT_OPEN  = "<ledger>";
var IPE_LEDGER_TAG_DEFAULT_CLOSE = "</ledger>";

/* 定界符可配：预设本来就输出 <掛帳>…</掛帳> 的，把这两项设成一样，
   插件就不再套第二层。中间是什么形状代码照旧一个字不看。 */
function ipeLedgerTagOpen()  { return String(cfg().ledgerTagOpen  || IPE_LEDGER_TAG_DEFAULT_OPEN); }
function ipeLedgerTagClose() { return String(cfg().ledgerTagClose || IPE_LEDGER_TAG_DEFAULT_CLOSE); }

// 标签按字面转义；尖括号形式容忍内部空格，非尖括号（###账本### / 【账本】）原样匹配
function ipeLedgerTagRe(tag) {
    var t = String(tag || "").trim();
    if (!t) return null;
    var esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    esc = esc.replace(/^</, "<\\s*").replace(/>$/, "\\s*>").replace(/\//g, "\\s*\\/\\s*");
    return new RegExp(esc, "i");
}
var IPE_LEDGER_SENTINEL  = "NO_CHANGE";
function ipeLedgerProtocolNote() { return [
    "记什么、分几层、什么格式，全归你的预设，代码一概不看。",
    "",
    "手动挂账（点「重新挂账」）：副 AI 说什么原样给你看，你点采用或重 roll。",
    "没有任何拦截和判定——你人在这儿，你就是校验器。",
    "",
    "自动挂账（挂机连跑、没人看屏幕时）才需要机器合同：",
    "① 输出包在 " + ipeLedgerTagOpen() + " … " + ipeLedgerTagClose() + " 之间。",
    "② 默认要求每轮都重写完整账本。想省 token 的话，去「高级设置」打开「允许回没变化」，",
    "   副 AI 就可以在真的没变化时只回一个 " + IPE_LEDGER_SENTINEL + "。状态快照式的预设不建议开。",
    "这两句插件会自动附在你的预设末尾；你自己写了就不再附加。",
    "",
    "定界符可以在「高级设置」里改成你预设本来就在用的标签（比如 <掛帳>），改了就不用套两层。"
].join("\n"); }

/* ---- report 摘要层：定界符按字面转义，不让用户直接写正则 ---- */
function ipeEscRe(s) { return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function ipeLedgerReportBlock() {
    var m = Number(cfg().ledgerReportFloors);
    if (!Number.isFinite(m) || m <= 0) return "";
    if (m > 2000) m = 2000;

    var open  = String(cfg().ledgerReportOpen  || "<report>");
    var close = String(cfg().ledgerReportClose || "</report>");
    if (!open || !close) return "";

    var chat;
    try { chat = ctx().chat || []; } catch(e) { return ""; }
    var start = Math.max(0, chat.length - m);
    var re = new RegExp(ipeEscRe(open) + "([\\s\\S]*?)" + ipeEscRe(close), "g");

    var picked = [];
    for (var i = start; i < chat.length; i++) {
        var msg = chat[i];
        if (!msg || msg.is_user === true) continue;   // 只在非 user 楼里抠；藏楼照抠（特性）
        var txt = String(msg.mes || "");
        if (!txt) continue;
        re.lastIndex = 0;
        var hit;
        while ((hit = re.exec(txt)) !== null) {
            var body = String(hit[1] || "").trim();
            if (body) picked.push(body);
        }
    }
    if (!picked.length) return "";

    // 安全阀：从最旧开始丢，直到不超顶
    var total = 0, keep = [];
    for (var k = picked.length - 1; k >= 0; k--) {
        total += picked[k].length + 2;
        if (total > IPE_LEDGER_REPORT_CAP) { ipeLedgerReportTruncated = true; break; }
        keep.unshift(picked[k]);
    }
    return keep.join("\n\n");
}
var ipeLedgerReportTruncated = false;
var ipeLedgerLastUserChars = 0;      // 上次拼装后的总字数，面板灰字用

/* ---- 账本历史层 ---- */
function ipeLedgerHistoryBlock() {
    var n = Number(cfg().ledgerVersionsN);
    if (!Number.isFinite(n) || n < 1) n = 3;
    if (n > 5) n = 5;
    var st = ipeLedgerRead();
    var vs = st.versions.slice(0, Math.max(0, n - 1));   // 旧版
    var out = [];
    for (var i = vs.length - 1; i >= 0; i--) {           // 旧 → 新
        out.push("\u3010\u7b2c " + (vs[i].floor >= 0 ? vs[i].floor : "?") + " \u697c\u65f6\u7248\u672c\u3011\n" + vs[i].text);
    }
    if (String(st.current || "").trim()) {
        out.push("\u3010\u5f53\u524d\u7248\u672c\uff08\u7b2c " + (st.lastFloor >= 0 ? st.lastFloor : ipeFloorNo()) + " \u697c\uff09\u3011\n" + st.current);
    }
    // 空账本必须说出来。什么都不说，副 AI 会以为不用建。
    if (!out.length) return "（当前还没有账本，这是第一次，请产出完整的一份。）";
    return out.join("\n\n");
}

/* ---- 投喂拼装：段落标题只做定位，不声明优先级 ---- */
function ipeLedgerBuildUser(text, extra) {
    var st = ipeLedgerRead();
    var u = "";
    var note = ipeLedgerNoteValue().trim();
    if (note)  u += "\u3010\u672c\u5361\u8981\u70b9\u3011\n" + note + "\n\n";
    var order = String(st.order || "").trim();
    if (order) u += "\u3010User \u6307\u4ee4\u3011\n" + order + "\n\n";
    // 一次性补充：只这一发有效，不落盘，不污染常驻的 User 指令
    var ex = String(extra || "").trim();
    if (ex) u += "\u3010\u8fd9\u6b21\u989d\u5916\u8981\u6c42\u3011\n" + ex + "\n\n";

    ipeLedgerReportTruncated = false;
    var rep = ipeLedgerReportBlock();
    if (rep) u += "\u3010\u5267\u60c5\u6458\u8981 \u00b7 \u8fd1 " + Number(cfg().ledgerReportFloors || 0) + " \u697c \u00b7 \u65e7\u2192\u65b0\u3011\n" + rep + "\n\n";

    var his = ipeLedgerHistoryBlock();
    if (his) u += "\u3010\u8d26\u672c\u5386\u53f2 \u00b7 \u65e7\u2192\u65b0\u3011\n" + his + "\n\n";

    u += "\u3010\u5f53\u524d\u697c\u5c42\u3011\u7b2c " + ipeFloorNo() + " \u697c\n\n";
    u += "\u3010\u672c\u8f6e\u6b63\u6587\u3011\n" + ipeTrimSourceText(text);
    ipeLedgerLastUserChars = u.length;
    return u;
}

// 面板灰字：不发请求，本地干跑一次拼装看有多大
function ipeLedgerEstimateChars() {
    try {
        var chat = ctx().chat || [];
        var msg = "";
        for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m.mes; break; }
        }
        var sys = ipeLedgerSystemText().length;
        var usr = ipeLedgerBuildUser(msg).length;
        return sys + usr;
    } catch(e) { return 0; }
}

/* ---- API ---- */
function ipeLedgerApiItem() {
    var list = ipeGetApiProfiles();
    var id = cfg().ledgerApiProfile || "";
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
}

async function ipeLedgerCallAPI(text, extra) {
    var item = ipeLedgerApiItem();
    if (!item || !item.endpoint) throw new Error("请先在挂账页选一套 API 预设（地址为空）");
    if (!item.model) throw new Error("这套 API 预设没有选模型");

    var headers = { "Content-Type": "application/json" };
    if (item.key) headers["Authorization"] = "Bearer " + item.key;

    // system 只放用户预设，代码不再追加任何内容
    var body = {
        model: item.model,
        messages: [
            { role: "system", content: ipeLedgerSystemText() },
            { role: "user",   content: ipeLedgerBuildUser(text, extra) }
        ],
        temperature: 0.2,
        stream: false
    };

    var res = await ipeFetchWithTimeout(
        buildChatUrl(item.endpoint),
        { method: "POST", headers: headers, body: JSON.stringify(body) },
        Number(cfg().requestTimeout || 0)
    );
    var raw = await res.text();
    if (!res.ok) throw new Error("API " + res.status + "：" + raw.slice(0, 180));
    var data;
    try { data = JSON.parse(raw); } catch(e) { throw new Error("返回不是 JSON：" + raw.slice(0, 160)); }
    var out = parseChatResponse(data);
    if (!out) throw new Error("响应里没有内容：" + raw.slice(0, 160));
    return out;
}

/* ---- 降级阶梯：笨 AI 记不住包裹也照样能收 ----
   照 Fable 在 adrCdSanitizePickResponse 里的路子——先机械剥壳，再逐级放宽。
   四级都不带语义判断，代码永远不看内容写了什么。
     1 完整一对   <ledger>…</ledger>
     2 只有开标签  取它后面全部
     3 只有闭标签  取它前面全部
     4 一个都没有  整段兜底（配合缩水保护 + 状态栏明示）
   标签匹配大小写不敏感、容忍空格，`< / LEDGER >` 也认。            */
var IPE_LEDGER_MIN_LEN  = 30;   // 兜底且账本原本为空时的长度地板，挡住"我不能协助"这类短回复

function ipeLedgerExtract(txt) {
    var s0 = String(txt || "");
    if (!s0.trim()) return null;

    // 机械剥壳：markdown 围栏
    var s1 = s0.replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();

    var reO = ipeLedgerTagRe(ipeLedgerTagOpen());
    var reC = ipeLedgerTagRe(ipeLedgerTagClose());
    var mo = reO ? s1.match(reO) : null;
    var mc = reC ? s1.match(reC) : null;

    if (mo && mc && mc.index > mo.index) {
        return { text: s1.slice(mo.index + mo[0].length, mc.index).trim(), level: 1 };
    }
    if (mo && !mc) {
        return { text: s1.slice(mo.index + mo[0].length).trim(), level: 2 };
    }
    if (!mo && mc) {
        return { text: s1.slice(0, mc.index).trim(), level: 3 };
    }
    return { text: s1.trim(), level: 4 };
}

var IPE_LEDGER_LEVEL_NOTE = {
    1: "",
    2: "（副 AI 漏了闭标签，已按开标签之后整段收下）",
    3: "（副 AI 漏了开标签，已按闭标签之前整段收下）",
    4: "（副 AI 没写包裹，已按整段兜底收下）"
};

/* ---- 保底：任一命中则保留旧版 + 报警 ---- */
/* ============================================================
   手动挂账 = 预览制
   人就站在旁边，人就是校验器。副 AI 说什么原样给你看，
   写得好点采用，写得烂点重 roll——跟 roll 正文一模一样。
   标签、阶梯、缩水拦截、哨兵那套机器合同只服务自动模式。
   ============================================================ */
function ipeLedgerShowPreview(text, bare) {
    ["ipe-ledger-preview-box","iped-ledger-preview-box"].forEach(function(id){
        var el = q("#" + id); if (el) el.style.display = "";
    });
    ["ipe-ledger-preview","iped-ledger-preview"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = String(text || "");
    });
    ["ipe-ledger-preview-tip","iped-ledger-preview-tip"].forEach(function(id){
        var el = q("#" + id); if (el) el.textContent = bare
            ? "副 AI 没写包裹，这是它的原话。可以直接改，改完点采用；也可以回上面「额外说一句」补一句再重 roll。"
            : "可以直接在上面改，改完点采用；不满意就回上面「额外说一句」补一句，再点重 roll。";
    });
}
function ipeLedgerHidePreview() {
    ["ipe-ledger-preview-box","iped-ledger-preview-box"].forEach(function(id){
        var el = q("#" + id); if (el) el.style.display = "none";
    });
}
function ipeLedgerAdoptPreview(which) {
    var el = q("#" + (which === "drawer" ? "iped-ledger-preview" : "ipe-ledger-preview"));
    var t = el ? String(el.value || "").trim() : "";
    if (!t) { ipeLedgerStatus("预览是空的，没什么可采用", "#c9a227"); return; }
    ipeLedgerCommit(t);
    ipeLedgerHidePreview();
    ipeLedgerClearExtra();
    ipeLedgerSync();
    ipeLedgerStatus("已采用 \u2713 第 " + ipeFloorNo() + " 楼（旧版已进历史，可回滚）", "#6ec577");
}

function ipeLedgerExtraOnce() {
    var a = q("#ipe-ledger-extra"), b = q("#iped-ledger-extra");
    var v = (a && a.value) || (b && b.value) || "";
    return String(v).trim();
}
function ipeLedgerClearExtra() {
    ["ipe-ledger-extra","iped-ledger-extra"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = "";
    });
}

async function ipeLedgerRunManual() {
    if (ipeLedgerBusy) { ipeLedgerStatus("上一次还没跑完", "#c9a227"); return; }
    var msg = null;
    try {
        var chat = ctx().chat;
        for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m; break; }
        }
    } catch(e) {}
    if (!msg) { ipeLedgerStatus("没找到可读的正文", "#d4726a"); return; }

    ipeLedgerBusy = true;
    ipeLedgerStatus("正在挂账…", "#6ec577");
    try {
        var ex  = ipeLedgerExtraOnce();
        var out = await ipeLedgerCallAPI(msg.mes, ex);
        var got = ipeLedgerExtract(out);          // 有标签顺手剥，没标签原样给
        var body = (got && got.text) ? got.text : String(out || "");
        ipeLedgerShowPreview(body, !got || got.level === 4);
        ipeLedgerStatus(ex ? "按你补的那句重跑了一次，看一眼" : "副 AI 回来了，看一眼再决定", "#6ec577");
    } catch(e) {
        ipeLedgerStatus("挂账失败：" + (e && e.message ? e.message : String(e)), "#d4726a");
    } finally {
        ipeLedgerBusy = false;
    }
}

var ipeLedgerBusy = false;
var ipeLedgerFailStreak = 0;
var ipeLedgerPending = null;      // 缩水拦截暂存，点「强制采用」才落盘

function ipeLedgerShowForce(on) {
    ["ipe-ledger-force","iped-ledger-force"].forEach(function(id){
        var el = q("#" + id);
        if (el) el.style.display = on ? "" : "none";
    });
}

async function ipeLedgerRun(targetIdx, silent) {
    if (ipeLedgerBusy) { if (!silent) ipeLedgerStatus("上一次挂账还没跑完", "#c9a227"); return; }

    var msg = null;
    try {
        var chat = ctx().chat;
        if (typeof targetIdx === "number" && chat[targetIdx]) msg = chat[targetIdx];
        else for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            // 跳过 user 楼与藏楼/系统楼：刚藏完末楼不该给隐形消息挂账
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m; break; }
        }
    } catch(e) {}
    if (!msg) { ipeLedgerStatus("没找到可读的正文", "#d4726a"); return; }

    ipeLedgerBusy = true;
    ipeLedgerPending = null;
    ipeLedgerShowForce(false);
    ipeLedgerStatus("正在挂账…", "#6ec577");
    try {
        var out = await ipeLedgerCallAPI(msg.mes);
        var got = ipeLedgerExtract(out);

        if (!got || !got.text) {                               // 保底 2/3：整个回复是空的
            ipeLedgerFailStreak++;
            ipeLedgerStatus("副 AI 返回是空的，账本未改动。点「重新挂账」可以手动看一眼。", "#d4726a");
            return;
        }
        var body = got.text;
        var note = IPE_LEDGER_LEVEL_NOTE[got.level] || "";
        ipeLedgerFailStreak = 0;

        if (body.replace(/\s+/g, "") === IPE_LEDGER_SENTINEL) { // 静默哨兵
            ipeLedgerStatus("本轮无变化（第 " + ipeFloorNo() + " 楼）" + note, "#6ec577");
            return;
        }

        var oldText = String(ipeLedgerRead().current || "");

        // 兜底级 + 账本原本为空 + 内容极短 → 大概率是拒答/寒暄，压住等确认
        if (got.level === 4 && !oldText.trim() && body.length < IPE_LEDGER_MIN_LEN) {
            ipeLedgerPending = body;
            ipeLedgerShowForce(true);
            ipeLedgerStatus("副 AI 没写包裹，且回复很短（" + body.length + " 字），像是拒答而不是账本，已拦下。"
                + "确实要用请点「强制采用」。｜原文：" + body.slice(0, 40), "#c9a227");
            return;
        }

        if (oldText.trim() && body.length < oldText.length * IPE_LEDGER_SHRINK) {   // 保底 4
            ipeLedgerPending = body;
            ipeLedgerShowForce(true);
            // 事故现场就该停车等人来看，不能带着警报继续飞
            var wasAuto = cfg().ledgerAutoRun === true;
            if (wasAuto) { save("ledgerAutoRun", false); ipeLedgerRefreshBotEditors(); }
            ipeLedgerStatus("疑似事故已拦截：新账本只有旧版的 "
                + Math.round(body.length / oldText.length * 100) + "%，账本未改动。"
                + (wasAuto ? "自动挂账已自动关闭，等你看过再开。" : "")
                + "确认无误请点「强制采用」。", "#c9a227");
            return;
        }

        ipeLedgerCommit(body);
        ipeLedgerStatus("已挂账 \u2713 第 " + ipeFloorNo() + " 楼" + note
            + (ipeLedgerReportTruncated ? "（report 层已截断）" : ""),
            got.level === 1 ? "#6ec577" : "#c9a227");
        ipeLedgerSync();
    } catch(e) {
        ipeLedgerFailStreak++;
        ipeLedgerStatus("挂账失败：" + (e && e.message ? e.message : String(e)), "#d4726a");
    } finally {
        ipeLedgerBusy = false;
    }
}

/* ============================================================
   🐚 贴耳 · 扩展提示词通道（账本原文直出，代码不渲染）
   ============================================================ */
function ipeLedgerEpDepth() {
    var d = Number(cfg().ledgerEpDepth);
    if (!Number.isFinite(d) || d < 0) d = 2;
    if (d > 99) d = 99;
    return Math.round(d);
}

function ipeLedgerEpText() {
    var st = ipeLedgerRead();
    var order = String(st.order || "").trim();
    var cur   = String(st.current || "").trim();
    if (!order && !cur) return "";
    var out = "";
    if (order) out += "\u3010User \u6307\u4ee4\u3011\n" + order + "\n\n";
    if (cur) {
        out += "\u4ee5\u4e0b\u4e3a\u7cfb\u7edf\u8bb0\u5f55\uff0c\u4f9b\u53d9\u4e8b\u8fde\u8d2f\u4f7f\u7528\uff0c\u4e0d\u8981\u590d\u8ff0\u6216\u4eff\u5199\u3002\n" + cur;
    }
    return out.trim();
}

function ipeLedgerApplyEP() {
    try {
        var c = ctx();
        if (typeof c.setExtensionPrompt !== "function") return false;
        var EPT  = c.extensionPromptTypes || c.extension_prompt_types || {};
        var pos  = EPT.IN_CHAT != null ? EPT.IN_CHAT : 1;
        var EPR  = c.extensionPromptRoles || c.extension_prompt_roles || {};
        var role = EPR.SYSTEM != null ? EPR.SYSTEM : 0;
        var text = cfg().ledgerEpEnabled !== false ? ipeLedgerEpText() : "";
        c.setExtensionPrompt(IPE_LEDGER_EP_KEY, String(text || ""), pos, ipeLedgerEpDepth(), false, role);
        return true;
    } catch(e) { return false; }
}

/* ============================================================
   🐚 楼内展示 · 只进 DOM，绝不写入 message.mes
   因此从源头不进 prompt、不进存档，Gemini 全程接触不到账本格式。
   ============================================================ */
var IPE_LEDGER_INLINE_CLASS = "ipe-ledger-inline";

function ipeLedgerRenderInline() {
    var d = ipeRootDocument();
    try {
        // 先清旧块
        var olds = d.querySelectorAll("." + IPE_LEDGER_INLINE_CLASS);
        for (var i = 0; i < olds.length; i++) {
            if (olds[i].parentNode) olds[i].parentNode.removeChild(olds[i]);
        }
        if (cfg().ledgerInlineShow === false) return;
        var cur = String(ipeLedgerRead().current || "").trim();
        if (!cur) return;

        // 找最后一条可见的 AI 楼
        var chat = ctx().chat || [];
        var idx = -1;
        for (var k = chat.length - 1; k >= 0; k--) {
            var m = chat[k];
            if (m && !m.is_user && m.is_system !== true) { idx = k; break; }
        }
        if (idx < 0) return;

        var host = d.querySelector('#chat .mes[mesid="' + idx + '"] .mes_text')
                || d.querySelector('#chat .mes[data-mesid="' + idx + '"] .mes_text');
        if (!host) return;

        var box = d.createElement("div");
        box.className = IPE_LEDGER_INLINE_CLASS;
        box.setAttribute("data-arb-ledger", "1");
        box.innerHTML = cur;
        host.appendChild(box);
    } catch(e) {}
}

function ipeLedgerInstallInlineObserver() {
    try {
        if (window.__ipeLedgerInlineObs) return;
        var d = ipeRootDocument();
        var chatEl = d.querySelector("#chat");
        if (!chatEl || typeof MutationObserver === "undefined") return;
        var t = null;
        window.__ipeLedgerInlineObs = new MutationObserver(function(){
            // 酒馆重绘会抹掉 DOM 块，防抖后补回来
            if (t) clearTimeout(t);
            t = setTimeout(function(){
                if (!d.querySelector("." + IPE_LEDGER_INLINE_CLASS)) ipeLedgerRenderInline();
            }, 250);
        });
        window.__ipeLedgerInlineObs.observe(chatEl, { childList: true, subtree: true });
    } catch(e) {}
}


/* ============================================================
   🐚 挂账 v2.0 · 预设系统与编辑器同步
   ============================================================ */

var IPE_LEDGER_PROMPT_DEFAULT = [
"你是记账员，不是编剧，也不是评论员。你站在故事外，不带叙事情绪，绝对公正。",
"你每轮读完材料后，重写一份完整账本。",
"",
"【判定标准】",
"挂账：本轮出现了「未兑现的期待」——受了伤没好、答应了没做、说好了没发生、开了头没收尾。当场完结无后续的互动，不挂。",
"结清：某条在本轮明确落地、兑现、或已不成立。没有明确落地就不划掉；宁可多挂一轮。",
"更新：某条的状态变了但事情没完（伤势好转、关系推进、事项进展），改写该条内容，但保留它的起始楼层，并在句尾追加轨迹。",
"",
"【写法规矩】",
"1. 未变动的条目必须逐字照抄，一个字不许改。",
"2. 新条目标注起始楼层：「· 事项（第{当前楼层}楼起）」。",
"3. 更新的条目用轨迹记录走势，最多保留最近 3 次转折：",
"   「· 左肩刀伤：重伤(309楼)→止血(312楼)→可活动(318楼)」",
"4. 提醒层：若某负面状态挂了 5 楼以上毫无变化，或发现叙事在原地打转，在账本末尾【提醒】段写一条给主笔的建议，例如「此伤已挂 6 楼，下轮应出现好转迹象」。提醒每轮重写，过期即删。",
"5. User 指令是最高否决：与你的任何判断冲突时，无条件服从 User 指令。",
"6. 本卡要点是本卡的判定规则（恢复周期、免挂事项、特殊体质），判定时必须参考。",
"",
"【输出格式 · 必须遵守】",
"把重写后的完整账本包在 <ledger> 和 </ledger> 之间输出，定界符外不要写任何东西。",
"本轮账本无任何变化时，输出 <ledger>NO_CHANGE</ledger>。"
].join("\n");

var IPE_LEDGER_NOTE_DEFAULT = "";

// v1.9.x 的默认挂账规则原文。逐字相同 = 用户从没改过 → 可安全自动升级到 v2。
// 用户改过一个字就不动，只给警告，绝不吞掉别人写的东西。
var IPE_LEDGER_PROMPT_V1 = [
"你是记账员，不是编剧，也不是评论员。",
"你只做一件事：读这一轮正文，判断账本需要怎么变。",
"",
"挂账标准：这一轮里出现了「未兑现的期待」——受了伤还没好、答应了还没做、说好了还没发生、开了头还没收尾。",
"已经当场完结、没有后续的互动，不挂。",
"",
"结清标准：账本里的某条，在这一轮里明确落地了、兑现了、或已经不成立了。",
"没有明确落地就不要结清；宁可多挂一轮，不要提前划掉。",
"",
"绝大多数轮次不会有变化。没变化就两个都留空，不要为了交差硬凑。",
"每条一句话，写清楚是什么，不要写成标题或标签。"
].join("\n");

// 预设里有没有教副 AI 用 <ledger> 包起来
function ipeLedgerPromptHasTag(v) {
    return String(v || "").indexOf(ipeLedgerTagOpen()) >= 0;
}

// 只包裹，零语义：不说记什么、不说分几层、不说什么格式。
// 跟生图的 image###...### 同一个性质，只保证输出能被找到。
// 预设里已经自己写了 <ledger> 就跳过，不重复叮嘱。
function ipeLedgerWrapHint() {
    var lines = [
        "",
        "【输出包裹 · 仅此一条】",
        "把上面要求你产出的全部内容，完整包在 " + ipeLedgerTagOpen() + " 和 " + ipeLedgerTagClose() + " 之间，标签外不要写任何东西。"
    ];
    // NO_CHANGE 是省 token 的优化，不是必需品。默认不给——
    // 状态快照式的预设一旦拿到这个后门，就会天天"没变化"，账本永远建不起来。
    // 账本本来就空的时候更不能给，否则空 → NO_CHANGE → 还是空，死循环。
    var hasLedger = String(ipeLedgerRead().current || "").trim().length > 0;
    if (cfg().ledgerAllowNoChange === true && hasLedger) {
        lines.push("本轮完全没有变化时，可以只输出 " + ipeLedgerTagOpen() + IPE_LEDGER_SENTINEL + ipeLedgerTagClose() + "。");
    } else {
        lines.push("每一轮都要输出完整的一份，不要因为「没什么变化」就省略或简写。");
    }
    return lines.join("\n");
}

function ipeLedgerSystemText() {
    var v = ipeLedgerPromptValue();
    return ipeLedgerPromptHasTag(v) ? v : (v + "\n" + ipeLedgerWrapHint());
}

// v1 → v2 预设升级：只在逐字相同时替换，跑一次
var ipeLedgerPromptUpgraded = false;
function ipeLedgerUpgradePrompts() {
    if (ipeLedgerPromptUpgraded) return 0;
    ipeLedgerPromptUpgraded = true;
    try {
        var list = ipeSafeJsonParse(cfg()[LP[0]], null);
        if (!Array.isArray(list) || !list.length) return 0;
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].value || "").trim() === IPE_LEDGER_PROMPT_V1.trim()) {
                list[i].value = IPE_LEDGER_PROMPT_DEFAULT;
                n++;
            }
        }
        if (n) save(LP[0], JSON.stringify(list));
        return n;
    } catch(e) { return 0; }
}

function ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue) {
    var c = cfg();
    var list = ipeSafeJsonParse(c[jsonKey], null);
    if (!Array.isArray(list) || !list.length) {
        list = [{ id: seedId, name: seedName, value: seedValue }];
        save(jsonKey, JSON.stringify(list));
    }
    return list;
}
function ipePresetItem(jsonKey, activeKey, seedId, seedName, seedValue) {
    var list = ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue);
    var id = cfg()[activeKey] || seedId;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return list[0];
}
function ipePresetSetValue(jsonKey, activeKey, seedId, seedName, seedValue, val) {
    var list = ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue);
    var it = ipePresetItem(jsonKey, activeKey, seedId, seedName, seedValue);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === it.id) list[i].value = String(val || "");
    save(jsonKey, JSON.stringify(list));
}
function ipePresetSetName(jsonKey, activeKey, seedId, seedName, seedValue, val) {
    var list = ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue);
    var it = ipePresetItem(jsonKey, activeKey, seedId, seedName, seedValue);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === it.id) list[i].name = String(val || "未命名");
    save(jsonKey, JSON.stringify(list));
}
function ipePresetAdd(jsonKey, activeKey, seedId, seedName, seedValue, prefix) {
    var list = ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue);
    var it = { id: ipeMakeId(prefix), name: "新预设 " + (list.length + 1), value: "" };
    list.push(it); save(jsonKey, JSON.stringify(list)); save(activeKey, it.id);
    return it;
}
function ipePresetDelete(jsonKey, activeKey, seedId, seedName, seedValue) {
    var list = ipePresetList(jsonKey, activeKey, seedId, seedName, seedValue);
    if (list.length <= 1) return false;
    var it = ipePresetItem(jsonKey, activeKey, seedId, seedName, seedValue);
    list = list.filter(function(x){ return x && x.id !== it.id; });
    save(jsonKey, JSON.stringify(list)); save(activeKey, list[0].id);
    return true;
}

var LP = ["ledgerPromptPresetsJson","activeLedgerPrompt","lp_1","默认挂账规则", IPE_LEDGER_PROMPT_DEFAULT];
var LN = ["ledgerNotePresetsJson","activeLedgerNote","ln_1","本卡要点", IPE_LEDGER_NOTE_DEFAULT];
function ipeLedgerPromptValue(){ return ipePresetItem.apply(null, LP).value || IPE_LEDGER_PROMPT_DEFAULT; }
function ipeLedgerNoteValue(){ return ipePresetItem.apply(null, LN).value || ""; }

/* ---- 状态行 ---- */
function ipeLedgerStatus(t, color) {
    ["#ipe-ledger-status","#iped-ledger-status"].forEach(function(id){
        var e = q(id); if (e) { e.textContent = t; e.style.color = color || ""; }
    });
}

/* ---- 版本信息（取代 v1 的账龄栏）---- */
function ipeLedgerVersionInfo() {
    var st = ipeLedgerRead();
    return "当前 " + ipeFloorNo() + " 楼\u3000历史 " + st.versions.length + " 版\u3000"
         + (st.lastFloor >= 0 ? "最后更新于第 " + st.lastFloor + " 楼" : "尚未挂过账");
}

function ipeLedgerRefreshEditors() {
    var st  = ipeLedgerRead();
    var cur = String(st.current || "");
    var od  = String(st.order || "");
    var doc = ipeRootDocument();
    ["ipe-ledger-text","iped-ledger-text"].forEach(function(id){
        var el = q("#" + id);
        if (el && el.value !== cur && doc.activeElement !== el) el.value = cur;
    });
    ["ipe-ledger-order","iped-ledger-order"].forEach(function(id){
        var el = q("#" + id);
        if (el && el.value !== od && doc.activeElement !== el) el.value = od;
    });
    ["ipe-ledger-age","iped-ledger-age"].forEach(function(id){
        var el = q("#" + id); if (el) el.textContent = ipeLedgerVersionInfo();
    });
    ["ipe-ledger-chatkey","iped-ledger-chatkey"].forEach(function(id){
        var el = q("#" + id);
        if (el) el.textContent = "当前聊天：" + ipeChatKey() + "\u3000楼层：" + ipeFloorNo();
    });
    // 版本历史下拉
    ["ipe-ledger-vers","iped-ledger-vers"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        if (!st.versions.length) { el.innerHTML = '<option value="">（暂无历史版本）</option>'; return; }
        var html = "";
        st.versions.forEach(function(v, i){
            var d = new Date(v.ts || 0);
            var hh = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
            html += '<option value="' + i + '">第 ' + (v.floor >= 0 ? v.floor : "?") + ' 楼 \u00b7 ' + hh + '</option>';
        });
        el.innerHTML = html;
    });
}

function ipeLedgerRefreshEpPreview() {
    var on   = cfg().ledgerEpEnabled !== false;
    var text = on ? ipeLedgerEpText() : "";
    var show = !on ? "（贴耳已关闭，不会注入任何内容）" : (text ? text : "（账本为空，本轮不注入）");
    ["ipe-ledger-ep-preview","iped-ledger-ep-preview"].forEach(function(id){
        var el = q("#" + id); if (el) el.textContent = show;
    });
    ["ipe-ledger-ep-enabled","iped-ledger-ep-enabled"].forEach(function(id){
        var el = q("#" + id); if (el && el.checked !== on) el.checked = on;
    });
    ["ipe-ledger-ep-depth","iped-ledger-ep-depth"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = String(ipeLedgerEpDepth());
    });
}

function ipeLedgerRefreshBotEditors() {
    ipeLedgerUpgradePrompts();
    var pv = ipePresetItem.apply(null, LP);
    var nv = ipePresetItem.apply(null, LN);
    var apiList = ipeGetApiProfiles();
    var apiId = cfg().ledgerApiProfile || "";
    var doc = ipeRootDocument();

    ["ipe-ledger-api","iped-ledger-api"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var html = '<option value="">（未选择）</option>';
        apiList.forEach(function(x){
            html += '<option value="' + esc(x.id) + '"' + (x.id === apiId ? " selected" : "") + '>'
                 + esc(x.name || x.id) + "\u3000" + esc(x.model || "未选模型") + '</option>';
        });
        el.innerHTML = html; el.value = apiId;
    });
    ipeFillSelect("ipe-ledger-prompt-slot",  ipePresetList.apply(null, LP), pv.id);
    ipeFillSelect("iped-ledger-prompt-slot", ipePresetList.apply(null, LP), pv.id);
    ipeFillSelect("ipe-ledger-note-slot",    ipePresetList.apply(null, LN), nv.id);
    ipeFillSelect("iped-ledger-note-slot",   ipePresetList.apply(null, LN), nv.id);

    [["ipe-ledger-prompt", pv.value || IPE_LEDGER_PROMPT_DEFAULT], ["iped-ledger-prompt", pv.value || IPE_LEDGER_PROMPT_DEFAULT],
     ["ipe-ledger-prompt-name", pv.name || ""], ["iped-ledger-prompt-name", pv.name || ""],
     ["ipe-ledger-note", nv.value || ""], ["iped-ledger-note", nv.value || ""],
     ["ipe-ledger-note-name", nv.name || ""], ["iped-ledger-note-name", nv.name || ""],
     ["ipe-ledger-rep-open", String(cfg().ledgerReportOpen || "<report>")],
     ["iped-ledger-rep-open", String(cfg().ledgerReportOpen || "<report>")],
     ["ipe-ledger-rep-close", String(cfg().ledgerReportClose || "</report>")],
     ["iped-ledger-rep-close", String(cfg().ledgerReportClose || "</report>")],
     ["ipe-ledger-tag-open", ipeLedgerTagOpen()], ["iped-ledger-tag-open", ipeLedgerTagOpen()],
     ["ipe-ledger-tag-close", ipeLedgerTagClose()], ["iped-ledger-tag-close", ipeLedgerTagClose()],
     ["ipe-ledger-rep-floors", String(cfg().ledgerReportFloors == null ? 10 : cfg().ledgerReportFloors)],
     ["iped-ledger-rep-floors", String(cfg().ledgerReportFloors == null ? 10 : cfg().ledgerReportFloors)]
    ].forEach(function(pr){
        var el = q("#" + pr[0]);
        if (el && el.value !== pr[1] && doc.activeElement !== el) el.value = pr[1];
    });

    ["ipe-ledger-vn","iped-ledger-vn"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        if (!el.options || !el.options.length) {
            var h = ""; for (var i = 1; i <= 5; i++) h += '<option value="'+i+'">'+i+(i===3?"（默认）":"")+'</option>';
            el.innerHTML = h;
        }
        el.value = String(Number(cfg().ledgerVersionsN) || 3);
    });
    ["ipe-ledger-auto","iped-ledger-auto"].forEach(function(id){
        var el = q("#" + id); if (el) el.checked = cfg().ledgerAutoRun === true;
    });
    ["ipe-ledger-nochange","iped-ledger-nochange"].forEach(function(id){
        var el = q("#" + id); if (el) el.checked = cfg().ledgerAllowNoChange === true;
    });
    ["ipe-ledger-inline","iped-ledger-inline"].forEach(function(id){
        var el = q("#" + id); if (el) el.checked = cfg().ledgerInlineShow !== false;
    });
    ["ipe-ledger-protocol","iped-ledger-protocol"].forEach(function(id){
        var el = q("#" + id); if (el) el.textContent = ipeLedgerProtocolNote();
    });
    // 预设里没教 <ledger> → 必然对不上协议，提前喊出来，别等跑失败四次才发现
    var lacks = !ipeLedgerPromptHasTag(pv.value || "");
    ["ipe-ledger-tagwarn","iped-ledger-tagwarn"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.style.color = "#888";
        el.textContent = lacks
            ? "\u2139\uFE0F 这份预设没提 " + ipeLedgerTagOpen() + "，插件已自动在末尾附上包裹说明（只管包裹，不管你记什么）。想自己控制措辞就在预设里写一次，插件即刻让位。"
            : "\u2713 这份预设自己写了 " + ipeLedgerTagOpen() + "，插件不再附加任何内容。";
    });
    var need = q("#ipe-ledger-size") || q("#iped-ledger-size");
    if (need) {
        var nchar = ipeLedgerEstimateChars();
        var warn  = nchar > IPE_LEDGER_REPORT_CAP;
        ["ipe-ledger-size","iped-ledger-size"].forEach(function(id){
            var el = q("#" + id); if (!el) return;
            el.textContent = "拼装后约 " + nchar.toLocaleString() + " 字"
                + (warn ? "\u3000\u26A0\uFE0F 已超 " + IPE_LEDGER_REPORT_CAP.toLocaleString() + " 字上限，摘要层会从最旧开始丢" : "");
            el.style.color = warn ? "#c9a227" : "";
        });
    }
}

/* 落盘 → 贴耳 → 刷预览 → 楼内重绘，一条龙 */
function ipeLedgerSync() {
    ipeLedgerApplyEP();
    ipeLedgerRefreshEditors();
    ipeLedgerRefreshEpPreview();
    ipeLedgerRefreshBotEditors();
    ipeLedgerRenderInline();
}

function ipeLedgerSaveFromEditor(which) {
    var el = q("#" + (which === "drawer" ? "iped-ledger-text" : "ipe-ledger-text"));
    var oe = q("#" + (which === "drawer" ? "iped-ledger-order" : "ipe-ledger-order"));
    if (!el) { ipeLedgerStatus("找不到编辑框", "#d4726a"); return; }
    var st = ipeLedgerRead();
    var next = String(el.value || "");
    if (next !== String(st.current || "") && String(st.current || "").trim()) {
        st.versions.unshift({ floor: st.lastFloor >= 0 ? st.lastFloor : ipeFloorNo(), ts: Date.now(), text: st.current });
        st.versions = st.versions.slice(0, IPE_LEDGER_VER_MAX);
    }
    st.current = next;
    if (oe) st.order = String(oe.value || "").trim();
    var r = ipeLedgerSave(st);
    ipeLedgerSync();
    ipeLedgerStatus(
        (r.meta || r.ls) ? "已保存 \u2713  主档" + (r.meta ? "\u2713" : "\u2717") + " 镜像" + (r.ls ? "\u2713" : "\u2717")
                         : "保存失败：主档和镜像都没写进去",
        (r.meta || r.ls) ? "#6ec577" : "#d4726a");
}

/* ---- Tab 切换：浮窗与抽屉各切各的容器，互不影响 ---- */
function ipeSetActiveTab(tab) {
    tab = (tab === "ledger") ? "ledger" : "image";
    save("activeTab", tab);
    var rd = ipeRootDocument();
    try {
        rd.querySelectorAll("[data-ipe-tab]").forEach(function(el){
            el.style.display = (el.getAttribute("data-ipe-tab") === tab) ? "" : "none";
        });
        rd.querySelectorAll("[data-ipe-tabbtn]").forEach(function(b){
            if (b.getAttribute("data-ipe-tabbtn") === tab) b.classList.add("ipe-tab-on");
            else b.classList.remove("ipe-tab-on");
        });
    } catch(e) {}
    if (tab === "ledger") { ipeLedgerRefreshEditors(); ipeLedgerRefreshEpPreview(); }
}

function ipeGetApiProfiles() {
    var c = cfg();
    var list = ipeSafeJsonParse(c.apiProfilesJson, null);
    if (!Array.isArray(list) || list.length === 0) {
        list = [{
            id: "api_1",
            name: "默认 API",
            endpoint: c.apiEndpoint || "",
            key: c.apiKey || "",
            model: c.model || ""
        }];
    }

    var out = [];
    for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        out.push({
            id: String(item.id || ("api_" + (i + 1))),
            name: String(item.name || ("API " + (i + 1))),
            endpoint: String(item.endpoint || item.apiEndpoint || ""),
            key: String(item.key || item.apiKey || ""),
            model: String(item.model || "")
        });
    }

    if (out.length === 0) {
        out.push({ id: "api_1", name: "默认 API", endpoint: "", key: "", model: "" });
    }
    return out;
}

function ipeSaveApiProfiles(list, critical) {
    list = Array.isArray(list) ? list : [];
    if (list.length === 0) list = [{ id: "api_1", name: "默认 API", endpoint: "", key: "", model: "" }];
    var text = JSON.stringify(list);
    if (critical) saveCritical("apiProfilesJson", text);
    else save("apiProfilesJson", text);
}

function ipeGetActiveApiProfileId() {
    var c = cfg();
    var list = ipeGetApiProfiles();
    var id = c.activeApiProfile || (list[0] && list[0].id) || "api_1";
    var exists = false;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) exists = true;
    }
    if (!exists) id = list[0].id;
    return id;
}

function ipeGetActiveApiProfileItem() {
    var list = ipeGetApiProfiles();
    var id = ipeGetActiveApiProfileId();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) return list[i];
    }
    return list[0] || { id: "api_1", name: "默认 API", endpoint: "", key: "", model: "" };
}

function ipeApplyApiProfile(item) {
    item = item || ipeGetActiveApiProfileItem();
    saveCritical("apiEndpoint", item.endpoint || "");
    saveCritical("apiKey", item.key || "");
    saveCritical("model", item.model || "");
}

function ipeSetActiveApiProfile(id) {
    var list = ipeGetApiProfiles();
    var item = null;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(id)) item = list[i];
    }
    if (!item) item = list[0];
    if (!item) return;

    saveCritical("activeApiProfile", item.id);
    ipeApplyApiProfile(item);
    ipeRefreshApiProfileEditors();
    setStatus("已切换 API 预设：" + (item.name || "API"), "#6ec577");
}

function ipeSetApiProfileField(field, val) {
    field = String(field || "");
    val = String(val || "");

    var list = ipeGetApiProfiles();
    var id = ipeGetActiveApiProfileId();
    var changed = false;

    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) !== String(id)) continue;
        if (field === "endpoint") list[i].endpoint = val;
        else if (field === "key") list[i].key = val;
        else if (field === "model") list[i].model = val;
        else if (field === "name") list[i].name = val || "未命名 API";
        changed = true;
        break;
    }

    if (!changed) {
        var fallback = { id: id || ipeMakeId("api"), name: "API", endpoint: "", key: "", model: "" };
        if (field === "endpoint") fallback.endpoint = val;
        else if (field === "key") fallback.key = val;
        else if (field === "model") fallback.model = val;
        else if (field === "name") fallback.name = val || "未命名 API";
        list.push(fallback);
    }

    ipeSaveApiProfiles(list, false);

    if (field === "endpoint") save("apiEndpoint", val);
    else if (field === "key") save("apiKey", val);
    else if (field === "model") save("model", val);
}

function ipeSetApiProfileName(val) {
    ipeSetApiProfileField("name", val || "未命名 API");
}

function ipeAddApiProfile() {
    var c = cfg();
    var list = ipeGetApiProfiles();
    var item = {
        id: ipeMakeId("api"),
        name: "API " + (list.length + 1),
        endpoint: c.apiEndpoint || "",
        key: c.apiKey || "",
        model: c.model || ""
    };
    list.push(item);
    ipeSaveApiProfiles(list, true);
    saveCritical("activeApiProfile", item.id);
    ipeApplyApiProfile(item);
    ipeRefreshApiProfileEditors();
    setStatus("已新增 API 预设，可直接改名和填写 key", "#6ec577");
}

function ipeDeleteApiProfile() {
    var list = ipeGetApiProfiles();
    if (list.length <= 1) {
        setStatus("至少保留一个 API 预设", "#d4726a");
        return;
    }

    var id = ipeGetActiveApiProfileId();
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) !== String(id)) kept.push(list[i]);
    }
    if (kept.length === 0) kept.push({ id: "api_1", name: "默认 API", endpoint: "", key: "", model: "" });

    ipeSaveApiProfiles(kept, true);
    saveCritical("activeApiProfile", kept[0].id);
    ipeApplyApiProfile(kept[0]);
    ipeRefreshApiProfileEditors();
    setStatus("已删除当前 API 预设", "#6ec577");
}

function ipeEnsureModelOption(selectId, model) {
    var el = q("#" + selectId);
    if (!el) return;
    model = String(model || "");
    var found = false;
    for (var i = 0; i < el.options.length; i++) {
        if (String(el.options[i].value) === model) found = true;
    }
    if (model && !found) {
        var opt = ipeRootDocument().createElement("option");
        opt.value = model;
        opt.textContent = model + " (已保存)";
        el.appendChild(opt);
    }
    if (model) el.value = model;
}

function ipeRefreshApiProfileEditors() {
    var list = ipeGetApiProfiles();
    var active = ipeGetActiveApiProfileId();
    var item = ipeGetActiveApiProfileItem();

    ipeFillSelect("ipe-api-profile", list, active);
    ipeFillSelect("iped-api-profile", list, active);

    ["ipe-api-profile-name","iped-api-profile-name"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.name || "";
    });
    ["ipe-api-endpoint","iped-api-endpoint"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.endpoint || "";
    });
    ["ipe-api-key","iped-api-key"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.key || "";
    });

    ipeEnsureModelOption("ipe-model", item.model || "");
    ipeEnsureModelOption("iped-model", item.model || "");
}

function ipeGetBaseTemplates() {
    var c = cfg();
    var list = ipeSafeJsonParse(c.baseTemplatesJson, null);
    if (!Array.isArray(list) || list.length === 0) {
        list = [];
        for (var i = 1; i <= 4; i++) {
            list.push({
                id: "tpl_" + i,
                name: c["baseTemplateName" + i] || ("预设" + i),
                value: c["baseTemplateSlot" + i] || (i === 1 ? (c.baseTemplate || "") : "")
            });
        }
    }

    var out = [];
    for (var j = 0; j < list.length; j++) {
        var item = list[j] || {};
        var id = String(item.id || ("tpl_" + (j + 1)));
        var name = String(item.name || ("模板" + (j + 1)));
        var value = String(item.value || "");
        out.push({ id: id, name: name, value: value });
    }

    if (out.length === 0) out.push({ id: "tpl_1", name: "预设1", value: "" });
    return out;
}

function ipeSaveBaseTemplates(list) {
    save("baseTemplatesJson", JSON.stringify(list || []));
}

function ipeGetActiveTemplateId() {
    var list = ipeGetBaseTemplates();
    var active = cfg().activeBaseTemplate || "";
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return active;
    }
    saveCritical("activeBaseTemplate", list[0].id);
    return list[0].id;
}

function ipeGetActiveTemplateItem() {
    var list = ipeGetBaseTemplates();
    var active = ipeGetActiveTemplateId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return list[i];
    }
    return list[0];
}

function ipeGetTemplateValue() {
    var item = ipeGetActiveTemplateItem();
    return String((item && item.value) || cfg().baseTemplate || "");
}

function ipeSetTemplateValue(val) {
    var list = ipeGetBaseTemplates();
    var active = ipeGetActiveTemplateId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].value = val || "";
            if (i === 0) save("baseTemplate", val || "");
            break;
        }
    }
    ipeSaveBaseTemplates(list);
}

function ipeSetTemplateName(val) {
    var list = ipeGetBaseTemplates();
    var active = ipeGetActiveTemplateId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].name = val || ("模板" + (i + 1));
            break;
        }
    }
    ipeSaveBaseTemplates(list);
}

function ipeAddTemplatePreset() {
    var list = ipeGetBaseTemplates();
    var id = ipeMakeId("tpl");
    list.push({ id: id, name: "新模板" + (list.length + 1), value: "image###{Description}###" });
    ipeSaveBaseTemplates(list);
    saveCritical("activeBaseTemplate", id);
    ipeRefreshSystemPromptEditors();
    ipeRefreshTemplateEditors();
    ipeRefreshAnchorEditors();
    ipeRefreshRuleEditors();
    applyQuickEntryVisibility();
    ipeSaveNow();
}

function ipeDeleteTemplatePreset() {
    var list = ipeGetBaseTemplates();
    if (list.length <= 1) {
        setStatus("至少保留一个基础模板", "#d4726a");
        return;
    }
    var active = ipeGetActiveTemplateId();
    var next = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== active) next.push(list[i]);
    }
    ipeSaveBaseTemplates(next);
    saveCritical("activeBaseTemplate", next[0].id);
    ipeRefreshTemplateEditors();
    ipeSaveNow();
}

function ipeGetAnchorPresets() {
    var c = cfg();
    var list = ipeSafeJsonParse(c.anchorPresetsJson, null);
    if (!Array.isArray(list) || list.length === 0) {
        list = [{ id: "anchor_1", name: "角色锚点1", value: c.characterAnchors || "" }];
    }

    var out = [];
    for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        out.push({
            id: String(item.id || ("anchor_" + (i + 1))),
            name: String(item.name || ("角色锚点" + (i + 1))),
            value: String(item.value || "")
        });
    }
    if (out.length === 0) out.push({ id: "anchor_1", name: "角色锚点1", value: "" });
    return out;
}

function ipeSaveAnchorPresets(list) {
    save("anchorPresetsJson", JSON.stringify(list || []));
}

function ipeGetActiveAnchorId() {
    var list = ipeGetAnchorPresets();
    var active = cfg().activeAnchorPreset || "";
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return active;
    }
    saveCritical("activeAnchorPreset", list[0].id);
    return list[0].id;
}

function ipeGetActiveAnchorItem() {
    var list = ipeGetAnchorPresets();
    var active = ipeGetActiveAnchorId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return list[i];
    }
    return list[0];
}

function ipeGetAnchorValue() {
    var item = ipeGetActiveAnchorItem();
    return String((item && item.value) || cfg().characterAnchors || "");
}

function ipeSetAnchorValue(val) {
    var list = ipeGetAnchorPresets();
    var active = ipeGetActiveAnchorId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].value = val || "";
            if (i === 0) save("characterAnchors", val || "");
            break;
        }
    }
    ipeSaveAnchorPresets(list);
}

function ipeSetAnchorName(val) {
    var list = ipeGetAnchorPresets();
    var active = ipeGetActiveAnchorId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].name = val || ("角色锚点" + (i + 1));
            break;
        }
    }
    ipeSaveAnchorPresets(list);
}

function ipeAddAnchorPreset() {
    var list = ipeGetAnchorPresets();
    var id = ipeMakeId("anchor");
    list.push({ id: id, name: "新角色锚点" + (list.length + 1), value: "" });
    ipeSaveAnchorPresets(list);
    saveCritical("activeAnchorPreset", id);
    ipeRefreshAnchorEditors();
    ipeSaveNow();
}

function ipeDeleteAnchorPreset() {
    var list = ipeGetAnchorPresets();
    if (list.length <= 1) {
        setStatus("至少保留一个角色锚点", "#d4726a");
        return;
    }
    var active = ipeGetActiveAnchorId();
    var next = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== active) next.push(list[i]);
    }
    ipeSaveAnchorPresets(next);
    saveCritical("activeAnchorPreset", next[0].id);
    ipeRefreshAnchorEditors();
    ipeSaveNow();
}



function ipeGetSystemPromptPresets() {
    var c = cfg();
    var list = ipeSafeJsonParse(c.systemPromptPresetsJson, null);
    if (!Array.isArray(list) || list.length === 0) {
        list = [{
            id: "sys_emo",
            name: "情感",
            value: c.systemPrompt || "You extract concise visual image-generation descriptions from Chinese roleplay text. Focus on visible emotion, relationship tension, micro-expressions, body language, atmosphere, lighting, and cinematic mood. Output only the final English Description. Do not think aloud. Do not explain."
        }, {
            id: "sys_plot",
            name: "剧情",
            value: "You extract concise visual image-generation descriptions from Chinese roleplay text. Focus on visible plot actions, scene composition, character placement, objects, environment, time, lighting, camera distance, and narrative context. Output only the final English Description. Do not think aloud. Do not explain."
        }];
    }

    var out = [];
    for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        out.push({
            id: String(item.id || ("sys_" + (i + 1))),
            name: String(item.name || ("系统提示" + (i + 1))),
            value: String(item.value || "")
        });
    }
    if (out.length > 2) out = out.slice(0, 2);
    if (out.length === 0) out.push({ id: "sys_emo", name: "情感", value: "" });
    if (out.length === 1) out.push({ id: "sys_plot", name: "剧情", value: "" });
    return out;
}

function ipeSaveSystemPromptPresets(list) {
    save("systemPromptPresetsJson", JSON.stringify(list || []));
}

function ipeGetActiveSystemPromptId() {
    var list = ipeGetSystemPromptPresets();
    var active = cfg().activeSystemPromptPreset || "";
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return active;
    }
    saveCritical("activeSystemPromptPreset", list[0].id);
    return list[0].id;
}

function ipeGetActiveSystemPromptItem() {
    var list = ipeGetSystemPromptPresets();
    var active = ipeGetActiveSystemPromptId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return list[i];
    }
    return list[0];
}

function ipeGetSystemPromptValue() {
    var item = ipeGetActiveSystemPromptItem();
    return String((item && item.value) || cfg().systemPrompt || "");
}

function ipeSetSystemPromptValue(val) {
    var list = ipeGetSystemPromptPresets();
    var active = ipeGetActiveSystemPromptId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].value = val || "";
            if (i === 0) save("systemPrompt", val || "");
            break;
        }
    }
    ipeSaveSystemPromptPresets(list);
}

function ipeRefreshSystemPromptEditors() {
    var list = ipeGetSystemPromptPresets();
    var active = ipeGetActiveSystemPromptId();
    var item = ipeGetActiveSystemPromptItem();

    ipeFillSelect("ipe-system-slot", list, active);
    ipeFillSelect("iped-system-slot", list, active);

    ["ipe-system-prompt","iped-system-prompt"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.value || "";
    });
}

function ipeGetRulePresets() {
    var c = cfg();
    var list = ipeSafeJsonParse(c.rulePresetsJson, null);
    if (!Array.isArray(list) || list.length === 0) {
        list = [{
            id: "rule_1",
            name: "GPT-image-2",
            value: c.extractionRules || ""
        }, {
            id: "rule_2",
            name: "NanoBanana",
            value: ""
        }, {
            id: "rule_3",
            name: "NAI",
            value: ""
        }];
    }

    var out = [];
    for (var i = 0; i < list.length; i++) {
        var item = list[i] || {};
        out.push({
            id: String(item.id || ("rule_" + (i + 1))),
            name: String(item.name || ("提取规则" + (i + 1))),
            value: String(item.value || "")
        });
    }
    if (out.length === 0) out.push({ id: "rule_1", name: "GPT-image-2", value: "" });
    return out;
}

function ipeSaveRulePresets(list) {
    save("rulePresetsJson", JSON.stringify(list || []));
}

function ipeGetActiveRuleId() {
    var list = ipeGetRulePresets();
    var active = cfg().activeRulePreset || "";
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return active;
    }
    saveCritical("activeRulePreset", list[0].id);
    return list[0].id;
}

function ipeGetActiveRuleItem() {
    var list = ipeGetRulePresets();
    var active = ipeGetActiveRuleId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) return list[i];
    }
    return list[0];
}

function ipeGetRuleValue() {
    var item = ipeGetActiveRuleItem();
    return String((item && item.value) || cfg().extractionRules || "");
}

function ipeSetRuleValue(val) {
    var list = ipeGetRulePresets();
    var active = ipeGetActiveRuleId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].value = val || "";
            if (i === 0) save("extractionRules", val || "");
            break;
        }
    }
    ipeSaveRulePresets(list);
}

function ipeSetRuleName(val) {
    var list = ipeGetRulePresets();
    var active = ipeGetActiveRuleId();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === active) {
            list[i].name = val || ("提取规则" + (i + 1));
            break;
        }
    }
    ipeSaveRulePresets(list);
}

function ipeAddRulePreset() {
    var list = ipeGetRulePresets();
    var id = ipeMakeId("rule");
    list.push({ id: id, name: "新提取规则" + (list.length + 1), value: "" });
    ipeSaveRulePresets(list);
    saveCritical("activeRulePreset", id);
    ipeRefreshRuleEditors();
    ipeSaveNow();
}

function ipeDeleteRulePreset() {
    var list = ipeGetRulePresets();
    if (list.length <= 1) {
        setStatus("至少保留一个提取规则", "#d4726a");
        return;
    }
    var active = ipeGetActiveRuleId();
    var next = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id !== active) next.push(list[i]);
    }
    ipeSaveRulePresets(next);
    saveCritical("activeRulePreset", next[0].id);
    ipeRefreshRuleEditors();
    ipeSaveNow();
}

function ipeRefreshRuleEditors() {
    var list = ipeGetRulePresets();
    var active = ipeGetActiveRuleId();
    var item = ipeGetActiveRuleItem();

    ipeFillSelect("ipe-rule-slot", list, active);
    ipeFillSelect("iped-rule-slot", list, active);

    ["ipe-rule-name","iped-rule-name"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.name || "";
    });
    ["ipe-extract-rules","iped-extract-rules"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.value || "";
    });
}

function ipeFillSelect(id, list, active) {
    var el = q("#" + id);
    if (!el) return;
    list = Array.isArray(list) ? list : [];
    if (list.length === 0) {
        el.innerHTML = "";
        return;
    }

    var exists = false;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(active)) exists = true;
    }
    if (!exists) active = list[0].id;

    var html = "";
    for (var j = 0; j < list.length; j++) {
        var selected = String(list[j].id) === String(active) ? " selected" : "";
        html += '<option value="' + esc(list[j].id) + '"' + selected + '>' + esc(list[j].name) + '</option>';
    }
    el.innerHTML = html;
    el.value = active;

    for (var k = 0; k < el.options.length; k++) {
        if (String(el.options[k].value) === String(active)) {
            el.selectedIndex = k;
            break;
        }
    }
}

function ipeRefreshTemplateEditors() {
    var list = ipeGetBaseTemplates();
    var active = ipeGetActiveTemplateId();
    var item = ipeGetActiveTemplateItem();

    ipeFillSelect("ipe-template-slot", list, active);
    ipeFillSelect("iped-template-slot", list, active);

    ["ipe-template-name","iped-template-name"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.name || "";
    });
    ["ipe-base-template","iped-base-template"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.value || "";
    });
}

function ipeRefreshAnchorEditors() {
    var list = ipeGetAnchorPresets();
    var active = ipeGetActiveAnchorId();
    var item = ipeGetActiveAnchorItem();

    ipeFillSelect("ipe-anchor-slot", list, active);
    ipeFillSelect("iped-anchor-slot", list, active);

    ["ipe-anchor-name","iped-anchor-name"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.name || "";
    });
    ["ipe-char-anchors","iped-char-anchors"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = item.value || "";
    });
    ["ipe-anchor-guide-editor","iped-anchor-guide-editor"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = ipeGetAnchorUsageGuide();
    });
}

function normalizeApiBase(base) {
    var url = (base || "").trim();
    if (!url) return "";

    while (url.length > 1 && url.charAt(url.length - 1) === "/") {
        url = url.slice(0, -1);
    }

    // 用户如果填了完整的聊天接口，回退到基础 /v1
    if (url.indexOf("/chat/completions") >= 0) {
        url = url.replace(/\/chat\/completions\/?$/, "");
    }

    // 用户如果填了 /models，回退到基础 /v1
    if (url.indexOf("/models") >= 0) {
        url = url.replace(/\/models\/?$/, "");
    }

    // 用户只填域名时，补 /v1
    if (!url.endsWith("/v1")) {
        url += "/v1";
    }

    return url;
}

function buildChatUrl(base) {
    var root = normalizeApiBase(base);
    if (!root) return "";
    return root + "/chat/completions";
}

function buildModelsUrl(base) {
    var root = normalizeApiBase(base);
    if (!root) return "";
    return root + "/models";
}

function extractModelsFromResponse(data) {
    var models = [];

    function pushModel(m) {
        if (!m) return;
        if (typeof m === "string") {
            models.push(m);
            return;
        }
        if (m.id) models.push(m.id);
        else if (m.name) models.push(m.name);
        else if (m.model) models.push(m.model);
    }

    if (data && data.data && Array.isArray(data.data)) {
        data.data.forEach(pushModel);
    }

    if (models.length === 0 && data && data.models && Array.isArray(data.models)) {
        data.models.forEach(pushModel);
    }

    if (models.length === 0 && data && data.result && Array.isArray(data.result)) {
        data.result.forEach(pushModel);
    }

    if (models.length === 0 && Array.isArray(data)) {
        data.forEach(pushModel);
    }

    // 兼容某些中转返回 { "model-a": {...}, "model-b": {...} }
    if (models.length === 0 && data && typeof data === "object") {
        for (var k in data) {
            if (!data.hasOwnProperty(k)) continue;
            if (k === "data" || k === "models" || k === "result" || k === "object" || k === "success" || k === "message" || k === "error") continue;
            if (typeof data[k] === "object" || typeof data[k] === "string" || typeof data[k] === "number") {
                models.push(k);
            }
        }
    }

    var clean = [];
    models.forEach(function(id) {
        id = String(id || "").trim();
        if (!id) return;
        if (clean.indexOf(id) < 0) clean.push(id);
    });

    return clean;
}

function ipeFetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = Number(timeoutMs || 0);

    if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === "undefined") {
        return fetch(url, options);
    }

    if (timeoutMs < 30000) timeoutMs = 30000;

    options = options || {};
    var originalSignal = options.signal;
    var controller = new AbortController();

    if (originalSignal) {
        if (originalSignal.aborted) {
            try { controller.abort(); } catch(e) {}
        } else {
            try {
                originalSignal.addEventListener("abort", function() {
                    try { controller.abort(); } catch(e) {}
                }, { once: true });
            } catch(e) {}
        }
    }

    var timer = setTimeout(function() {
        try { controller.abort(); } catch(e) {}
    }, timeoutMs);

    options.signal = controller.signal;

    return fetch(url, options).finally(function() {
        clearTimeout(timer);
    });
}

async function fetchModels() {
    var c = cfg();
    if (!c.apiEndpoint) {
        setStatus("请先填写 API 地址", "#d4726a");
        return;
    }

    var url = buildModelsUrl(c.apiEndpoint);
    var headers = {};
    if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;

    try {
        setStatus("正在拉取模型…", "#6ec577");

        var res = await ipeFetchWithTimeout(url, {
            method: "GET",
            headers: headers
        }, Number(cfg().requestTimeout || 0));

        var raw = await res.text();

        if (!res.ok) {
            throw new Error("HTTP " + res.status + "：" + raw.slice(0, 180));
        }

        var data;
        try {
            data = JSON.parse(raw);
        } catch(e) {
            throw new Error("模型接口返回的不是 JSON：" + raw.slice(0, 160));
        }

        var models = extractModelsFromResponse(data);

        if (!models.length) {
            throw new Error("没有识别到模型列表，返回：" + raw.slice(0, 180));
        }

        ["ipe-model", "iped-model"].forEach(function(sid) {
            var sel = q("#" + sid);
            if (!sel) return;

            sel.innerHTML = "";

            var first = ipeRootDocument().createElement("option");
            first.value = "";
            first.textContent = "请选择模型";
            first.disabled = true;
            sel.appendChild(first);

            models.forEach(function(id) {
                var opt = ipeRootDocument().createElement("option");
                opt.value = id;
                opt.textContent = id;
                if (id === c.model) opt.selected = true;
                sel.appendChild(opt);
            });

            if (c.model && models.indexOf(c.model) >= 0) {
                sel.value = c.model;
            } else if (models.length > 0) {
                sel.value = models[0];
                ipeSetApiProfileField("model", models[0]);
            }
        });

        setStatus("已加载 " + models.length + " 个模型", "#6ec577");
    } catch(e) {
        console.error("[IPE] fetchModels:", e);
        setStatus("拉取模型失败：" + e.message, "#d4726a");
    }
}

async function testConnection() {
    var c = cfg();
    if (!c.apiEndpoint) {
        setStatus("请先填写 API 地址", "#d4726a");
        return;
    }

    var url = buildChatUrl(c.apiEndpoint);
    var headers = { "Content-Type": "application/json" };
    if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;

    var model = c.model || "gpt-4o-mini";

    try {
        setStatus("正在测试连接…", "#6ec577");

        var res = await ipeFetchWithTimeout(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: "user", content: "Hi" }
                ],
                max_tokens: 5,
                stream: false
            })
        }, Number(cfg().requestTimeout || 0));

        var raw = await res.text();

        if (!res.ok) {
            throw new Error("HTTP " + res.status + "：" + raw.slice(0, 180));
        }

        setStatus("连接成功 ✓", "#6ec577");
    } catch(e) {
        console.error("[IPE] testConnection:", e);
        setStatus("连接失败：" + e.message, "#d4726a");
    }
}

function parseChatResponse(data) {
    if (!data) return "";

    if (data.choices && data.choices[0]) {
        var ch = data.choices[0];

        if (ch.message) {
            var msg = ch.message;

            if (typeof msg.content === "string" && msg.content.trim()) {
                return msg.content.trim();
            }

            if (msg.content && Array.isArray(msg.content)) {
                var parts = [];
                msg.content.forEach(function(part) {
                    if (!part) return;
                    if (typeof part === "string") parts.push(part);
                    else if (part.text) parts.push(part.text);
                    else if (part.content) parts.push(part.content);
                });
                if (parts.join("").trim()) return parts.join("\n").trim();
            }

            if (msg.text) return String(msg.text).trim();
            if (msg.reasoning_content && msg.reasoning_content.trim()) {
                // 有些中转会把内容放在 reasoning_content，但这通常不是最终 Description。
                // 这里只在没有 content 时兜底返回，避免完全空。
                return String(msg.reasoning_content).trim();
            }
        }

        if (ch.text) return String(ch.text).trim();
        if (ch.delta && ch.delta.content) return String(ch.delta.content).trim();
    }

    if (data.content && Array.isArray(data.content) && data.content[0]) {
        if (data.content[0].text) return String(data.content[0].text).trim();
        if (typeof data.content[0] === "string") return String(data.content[0]).trim();
    }

    if (data.response) return String(data.response).trim();
    if (data.text) return String(data.text).trim();
    if (data.output_text) return String(data.output_text).trim();

    return "";
}

function ipeExtractContentText(text) {
    text = String(text || "");

    // 只提取 <content>...</content> 里的正文。
    // 支持多段 content，全部拼接；不读取思维链、隐藏标签、其他元信息。
    var parts = [];
    var re = /<content(?:\s[^>]*)?>([\s\S]*?)<\/content>/gi;
    var m;

    while ((m = re.exec(text)) !== null) {
        if (m[1] && String(m[1]).trim()) {
            parts.push(String(m[1]).trim());
        }
    }

    if (parts.length > 0) {
        return parts.join("\n\n");
    }

    // 如果这一条消息没有 <content> 标签，兜底使用原文。
    // 这样普通酒馆消息也能手动提取，不会直接空跑。
    return text;
}

function ipeTrimSourceText(text) {
    text = ipeExtractContentText(text);

    // 只限制“输入正文”长度，不限制模型输出 max_tokens。
    // 这里保留一个很宽的输入保护，避免超长历史/隐藏块把请求撑爆。
    var maxLen = 9000;
    if (text.length > maxLen) {
        text = text.slice(text.length - maxLen);
        text = "【注意：以下为 <content> 正文末尾片段，前文已省略】\n" + text;
    }

    return text;
}

function buildVisionUserPrompt(text, supplement) {
    var c = cfg();
    var user = "";

    var activeAnchors = ipeStripBuiltInAnchorGuide(ipeGetAnchorValue());
    if (activeAnchors) {
        user += "【角色锚点使用规则】\n" + ipeGetAnchorUsageGuide() + "\n\n";
        user += "【角色外貌锚点】\n" + activeAnchors + "\n\n";
    }
    var activeRules = ipeGetRuleValue();
    if (activeRules) user += "【提取规则】\n" + activeRules + "\n\n";

    user += "【正文内容】\n" + ipeTrimSourceText(text);

    if (supplement) user += "\n\n【补充指令】\n" + supplement;

    user += "\n\n任务：把正文转成英文生图 Description。\n";
    user += "要求：只输出最终英文 Description；不要解释；不要标题；不要代码块；不要中文；不要复述任务。\n";
    user += "优先写可见画面：人物数量、姿态、表情、服装、环境、光线、氛围、镜头距离。";

    return user;
}


function ipeCanAbortRequest() {
    return !!ipeAbortController;
}

function ipeAbortCurrentRequest() {
    try {
        if (ipeAbortController) {
            ipeUserAbortRequested = true;
            ipeAbortController.abort();
            ipeAbortController = null;
            ipeSetStopButtonsState(false);
            setStatus("已打断当前请求", "#d4726a");
        } else {
            ipeSetStopButtonsState(false);
            setStatus("当前没有进行中的请求", "#888");
        }
    } catch(e) {
        setStatus("打断失败：" + e.message, "#d4726a");
    }
}

async function callAPI(text, supplement) {
    var c = cfg();
    if (!c.apiEndpoint) throw new Error("请先配置 API 地址");
    if (!c.model) throw new Error("请先加载并选择模型");

    var url = buildChatUrl(c.apiEndpoint);
    var headers = { "Content-Type": "application/json" };
    if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;

    ipeUserAbortRequested = false;
    if (typeof AbortController !== "undefined") {
        ipeAbortController = new AbortController();
        ipeSetStopButtonsState(true);
    } else {
        ipeAbortController = null;
    }

    var systemPrompt = ipeGetSystemPromptValue() || c.systemPrompt || "You extract concise visual image-generation descriptions from Chinese roleplay text. Output only the final English Description. Do not think aloud. Do not explain.";

    var body = {
        model: c.model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildVisionUserPrompt(text, supplement || "") }
        ],
        temperature: 0.4,
        stream: false
    };

    var fetchOptions = {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
    };
    if (ipeAbortController) fetchOptions.signal = ipeAbortController.signal;

    var res = await ipeFetchWithTimeout(url, fetchOptions, Number(cfg().requestTimeout || 0));

    var raw = await res.text();

    if (!res.ok) {
        throw new Error("API " + res.status + "：" + raw.slice(0, 220));
    }

    var data;
    try {
        data = JSON.parse(raw);
    } catch(e) {
        throw new Error("API 返回不是 JSON：" + raw.slice(0, 180));
    }

    var out = parseChatResponse(data);
    if (out) return out;

    var finish = "";
    try {
        if (data.choices && data.choices[0] && data.choices[0].finish_reason) {
            finish = data.choices[0].finish_reason;
        }
    } catch(e) {}

    if (finish === "length") {
        throw new Error("模型返回为空，finish_reason=length。服务端仍然截断了输出。当前插件已不主动设置 max_tokens；请检查中转/模型是否有默认输出上限。原始返回：" + raw.slice(0, 180));
    }

    throw new Error("无法解析响应：" + raw.slice(0, 220));
}

function setStatus(t, color) {
    ["#ipe-status","#iped-status"].forEach(function(id){
        var e = q(id); if(e){e.textContent=t;e.style.color=color||"";}
    });
}
function setPreview(t) {
    ["#ipe-preview-text","#iped-preview-text"].forEach(function(id){
        var e = q(id); if(e){e.value=t;e.disabled=false;}
    });
}
function setBtns(r, j) {
    ["ipe","iped"].forEach(function(p){
        var br=q("#"+p+"-btn-reroll"),bj=q("#"+p+"-btn-inject");
        if(br)br.disabled=!r; if(bj)bj.disabled=!j;
    });
    ipeSetStopButtonsState(!!ipeAbortController);
}

function ipeClearApiRetry() {
    if (ipeRetryTimer) {
        try { clearTimeout(ipeRetryTimer); } catch(e) {}
        ipeRetryTimer = null;
    }
}

function ipeErrorText(e) {
    if (!e) return "未知错误";
    var msg = String(e.message || e || "未知错误");
    if (e.name === "AbortError" && !ipeUserAbortRequested) {
        msg = "请求超时或连接被中止";
    }
    return msg;
}

function ipeIsConfigError(e) {
    var msg = ipeErrorText(e);
    return msg.indexOf("请先配置 API 地址") >= 0 || msg.indexOf("请先加载并选择模型") >= 0;
}

function ipeShouldRetryApiError(e, userAbort) {
    if (userAbort) return false;
    if (ipeIsConfigError(e)) return false;
    return true;
}

function ipeShowApiFailurePopup(msg, willRetry) {
    var title = "IPE：API 请求失败";
    var body = msg || "API 暂时不可用。";
    if (willRetry) body += "\n10 秒后自动重试一次。";

    try {
        var w = ipeRootWindow();
        var toastr = w && (w.toastr || (w.parent && w.parent.toastr));
        if (toastr && typeof toastr.error === "function") {
            toastr.error(body, title, { timeOut: 9000, extendedTimeOut: 3000, closeButton: true, progressBar: true });
            return;
        }
    } catch(e) {}

    try {
        var d = ipeRootDocument();
        var old = d.getElementById("ipe-api-failure-popup");
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var box = d.createElement("div");
        box.id = "ipe-api-failure-popup";
        box.setAttribute("role", "alert");
        box.style.cssText = [
            "position:fixed",
            "right:14px",
            "bottom:92px",
            "max-width:min(420px,calc(100vw - 28px))",
            "z-index:2147483647",
            "padding:12px 14px",
            "border-radius:12px",
            "border:1px solid rgba(255,95,95,.55)",
            "background:rgba(42,18,24,.96)",
            "color:#fff",
            "box-shadow:0 12px 30px rgba(0,0,0,.45)",
            "font-size:13px",
            "line-height:1.45",
            "white-space:pre-wrap",
            "pointer-events:auto"
        ].join(";");

        var close = d.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.style.cssText = "float:right;margin:-4px -4px 4px 8px;border:0;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer";
        close.addEventListener("click", function(){ try { if (box.parentNode) box.parentNode.removeChild(box); } catch(e) {} });

        var titleEl = d.createElement("div");
        titleEl.textContent = title;
        titleEl.style.cssText = "font-weight:700;margin-bottom:4px;color:#ffb4b4";

        var bodyEl = d.createElement("div");
        bodyEl.textContent = body;

        box.appendChild(close);
        box.appendChild(titleEl);
        box.appendChild(bodyEl);
        (d.body || d.documentElement).appendChild(box);
        setTimeout(function(){ try { if (box.parentNode) box.parentNode.removeChild(box); } catch(e) {} }, 10000);
    } catch(e) {
        try { alert(title + "\n" + body); } catch(_) {}
    }
}

function ipeScheduleApiRetry(text, supplement, autoInjectNow, targetIdx, retryAttempt, msg) {
    ipeClearApiRetry();
    retryAttempt = Number(retryAttempt || 0);
    if (retryAttempt >= 1) {
        ipeShowApiFailurePopup(msg + "\n自动重试仍失败，请检查 API 预设、余额、模型或中转状态。", false);
        return;
    }

    ipeShowApiFailurePopup(msg, true);
    setStatus("API 请求失败，10 秒后自动重试一次…", "#d4726a");

    ipeRetryTimer = setTimeout(function(){
        ipeRetryTimer = null;
        try {
            if (!cfg().enabled) {
                setStatus("自动重试已取消：插件已关闭", "#888");
                return;
            }
            if (processing) {
                setStatus("自动重试已取消：当前已有新请求进行中", "#888");
                return;
            }
            if (autoInjectNow && typeof targetIdx === "number") {
                var c = ctx();
                var target = c && c.chat ? c.chat[targetIdx] : null;
                if (!target || target.is_user) {
                    setStatus("自动重试已取消：目标消息不存在", "#888");
                    return;
                }
            }
            setStatus("正在自动重试 API 请求…", "#6ec577");
            runExtract(text, supplement || "", autoInjectNow, targetIdx, retryAttempt + 1);
        } catch(e) {
            setStatus("自动重试启动失败：" + e.message, "#d4726a");
        }
    }, 10000);
}

function createUI() {
    createChatQuickButton();
    createPanel();
    createDrawer();
    bindAll();
    setTimeout(function(){ ipeRefreshApiProfileEditors(); ipeRefreshSystemPromptEditors(); ipeRefreshTemplateEditors(); ipeRefreshAnchorEditors(); ipeRefreshRuleEditors(); ipeSetStopButtonsState(!!ipeAbortController); }, 120);
    setTimeout(function(){ ipeSetActiveTab(cfg().activeTab || "image"); ipeLedgerSync(); ipeLedgerInstallInlineObserver(); }, 160);
}

function ipeForcePanelVisible() {
    var p = q("#ipe-panel");
    if (!p) {
        try { createPanel(); } catch(e) {}
        p = q("#ipe-panel");
    }
    if (!p) return;

    var currentlyOpen = p.getAttribute("data-ipe-open") === "1";

    if (currentlyOpen) {
        p.setAttribute("data-ipe-open", "0");
        p.classList.remove("visible");
        p.style.setProperty("display", "none", "important");
        return;
    }

    p.setAttribute("data-ipe-open", "1");
    p.classList.add("visible");

    function imp(k, v) { try { p.style.setProperty(k, v, "important"); } catch(e) { p.style[k] = v; } }

    imp("display", "flex");
    imp("visibility", "visible");
    imp("opacity", "1");
    imp("position", "fixed");
    imp("z-index", "2147483646");
    imp("right", "8px");
    imp("left", "8px");
    imp("bottom", "78px");
    imp("width", "auto");
    imp("max-height", "72vh");
    imp("overflow", "hidden");
    imp("pointer-events", "auto");
    imp("transform", "translateZ(0)");
}

function ipeOpenPanelOnly() {
    var p = q("#ipe-panel");
    if (!p) {
        try { createPanel(); } catch(e) {}
        p = q("#ipe-panel");
    }
    if (!p) return;

    p.setAttribute("data-ipe-open", "1");
    p.classList.add("visible");

    function imp(k, v) { try { p.style.setProperty(k, v, "important"); } catch(e) { p.style[k] = v; } }

    imp("display", "flex");
    imp("visibility", "visible");
    imp("opacity", "1");
    imp("position", "fixed");
    imp("z-index", "2147483646");
    imp("right", "8px");
    imp("left", "8px");
    imp("bottom", "78px");
    imp("width", "auto");
    imp("max-height", "72vh");
    imp("overflow", "hidden");
    imp("pointer-events", "auto");
    imp("transform", "translateZ(0)");
}

function ipeHardOpenPanel() {
    var p = q("#ipe-panel");

    if (!p) {
        try { createPanel(); } catch(e) {}
        p = q("#ipe-panel");
    }

    if (!p) {
        try { alert("IPE 面板未创建成功，但扩展本体已加载。请从扩展抽屉里继续使用。"); } catch(e) {}
        return;
    }

    p.setAttribute("data-ipe-open", "1");
    p.classList.add("visible");

    function imp(k, v) {
        try { p.style.setProperty(k, v, "important"); }
        catch(e) { try { p.style[k] = v; } catch(_) {} }
    }

    imp("display", "flex");
    imp("visibility", "visible");
    imp("opacity", "1");
    imp("position", "fixed");
    imp("z-index", "2147483646");
    imp("right", "8px");
    imp("left", "8px");
    imp("bottom", "76px");
    imp("width", "auto");
    imp("max-height", "74vh");
    imp("overflow", "hidden");
    imp("pointer-events", "auto");
    imp("transform", "translateZ(0)");

    // 如果按钮在顶层文档，面板也必须在顶层文档
    try {
        var d = ipeRootDocument();
        if (p.ownerDocument !== d) {
            (d.body || d.documentElement).appendChild(p);
        }
    } catch(e) {}
}

function ipeHardTogglePanel() {
    var p = q("#ipe-panel");
    if (p && p.getAttribute("data-ipe-open") === "1") {
        p.setAttribute("data-ipe-open", "0");
        p.classList.remove("visible");
        try { p.style.setProperty("display", "none", "important"); } catch(e) { p.style.display = "none"; }
        return;
    }
    ipeHardOpenPanel();
}


function ipeRemoveMiniButton() {
    var mini = q("#ipe-open-mini");
    if (mini && mini.parentNode) {
        try { mini.parentNode.removeChild(mini); } catch(e) {}
    }
}


function ipeFindQuickMount() {
    var d = ipeRootDocument ? ipeRootDocument() : document;
    var selectors = [
        "#send_form",
        "#form_sheld",
        "#chatForm",
        "#chat",
        "#sheld",
        "body"
    ];

    for (var i = 0; i < selectors.length; i++) {
        try {
            var el = d.querySelector(selectors[i]);
            if (el) return el;
        } catch(e) {}
    }
    return d.body || d.documentElement;
}

function ipeToggleMiniPanel() {
    var p = q("#ipe-panel");
    if (!p) {
        try { createPanel(); bindAll(); } catch(e) {}
        p = q("#ipe-panel");
    }
    if (!p) return;

    var open = p.getAttribute("data-ipe-open") === "1";
    if (open) {
        p.setAttribute("data-ipe-open", "0");
        p.classList.remove("visible");
        try { p.style.setProperty("display", "none", "important"); } catch(e) { p.style.display = "none"; }
        return;
    }

    p.setAttribute("data-ipe-open", "1");
    p.classList.add("visible");

    function imp(k, v) {
        try { p.style.setProperty(k, v, "important"); }
        catch(e) { try { p.style[k] = v; } catch(_) {} }
    }

    imp("display", "flex");
    imp("visibility", "visible");
    imp("opacity", "1");
    imp("position", "fixed");
    imp("z-index", "2147483646");
    var entry = q("#ipe-chat-quick-entry");
    var entryRect = null;
    try { if (entry) entryRect = entry.getBoundingClientRect(); } catch(e) {}

    if (entryRect) {
        var panelWidth = Math.min(420, Math.max(320, (window.innerWidth || 420) - 20));
        var left = Math.max(10, Math.min((window.innerWidth || 420) - panelWidth - 10, entryRect.left));
        var bottomSpace = (window.innerHeight || 700) - entryRect.bottom;
        if (bottomSpace > 280) {
            imp("top", Math.round(entryRect.bottom + 8) + "px");
            imp("bottom", "auto");
        } else {
            imp("bottom", Math.round((window.innerHeight || 700) - entryRect.top + 8) + "px");
            imp("top", "auto");
        }
        imp("left", Math.round(left) + "px");
        imp("right", "auto");
        imp("width", panelWidth + "px");
    } else {
        imp("right", "10px");
        imp("left", "10px");
        imp("bottom", "72px");
        imp("width", "auto");
    }
    imp("max-height", "70vh");
    imp("overflow", "hidden");
    imp("pointer-events", "auto");
}

function ipeRemoveOldFloatingBits() {
    ["#ipe-open-mini", "#ipe-ball"].forEach(function(sel){
        var el = q(sel);
        if (el && el.parentNode) {
            try { el.parentNode.removeChild(el); } catch(e) {}
        }
    });
}


function applyQuickEntryVisibility() {
    var visible = !!cfg().showQuickEntry;
    var el = q("#ipe-chat-quick-entry");
    if (el) {
        el.style.display = visible ? "inline-flex" : "none";
    }
    if (!visible) {
        var p = q("#ipe-floating-panel");
        if (p) p.style.display = "none";
    }
}

function createChatQuickButton() {
    ipeRemoveOldFloatingBits();

    if (!cfg().showQuickEntry) {
        var oldEntry = q("#ipe-chat-quick-entry");
        if (oldEntry && oldEntry.parentNode) {
            try { oldEntry.parentNode.removeChild(oldEntry); } catch(e) {}
        }
        applyQuickEntryVisibility();
        return;
    }


    var existing = q("#ipe-chat-quick-entry");
    if (existing) return;

    var d = ipeRootDocument ? ipeRootDocument() : document;
    var btn = d.createElement("button");
    btn.id = "ipe-chat-quick-entry";
    btn.type = "button";
    btn.textContent = "🐚 IPE";
    btn.title = "可移动 IPE 快捷入口：拖动移动，点击打开小面板";

    function imp(k, v) {
        try { btn.style.setProperty(k, v, "important"); }
        catch(e) { try { btn.style[k] = v; } catch(_) {} }
    }

    var savedLeft = Number(cfg().quickEntryLeft);
    var savedTop = Number(cfg().quickEntryTop);
    var hasSaved = Number.isFinite(savedLeft) && Number.isFinite(savedTop);

    imp("position", "fixed");
    imp("left", hasSaved ? savedLeft + "px" : "12px");
    imp("top", hasSaved ? savedTop + "px" : "");
    imp("right", hasSaved ? "auto" : "12px");
    imp("bottom", hasSaved ? "auto" : "92px");

    imp("display", "inline-flex");
    imp("align-items", "center");
    imp("justify-content", "center");
    imp("gap", "4px");
    imp("height", "34px");
    imp("min-height", "34px");
    imp("padding", "0 11px");
    imp("border-radius", "999px");
    imp("border", "1px solid rgba(255,255,255,.32)");
    imp("background", "linear-gradient(135deg, rgba(76,90,220,.96), rgba(36,154,210,.96))");
    imp("color", "#ffffff");
    imp("font-size", "13px");
    imp("font-weight", "700");
    imp("line-height", "1");
    imp("box-shadow", "0 8px 22px rgba(0,0,0,.35)");
    imp("z-index", "2147483647");
    imp("cursor", "grab");
    imp("pointer-events", "auto");
    imp("user-select", "none");
    imp("-webkit-user-select", "none");
    imp("touch-action", "none");
    imp("white-space", "nowrap");

    var dragging = false;
    var moved = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    function clampPos(left, top) {
        var w = 88, h = 36;
        try {
            var rect = btn.getBoundingClientRect();
            if (rect && rect.width) w = rect.width;
            if (rect && rect.height) h = rect.height;
        } catch(e) {}
        var maxLeft = Math.max(0, (window.innerWidth || 360) - w - 4);
        var maxTop = Math.max(0, (window.innerHeight || 640) - h - 4);
        return {
            left: Math.max(4, Math.min(maxLeft, left)),
            top: Math.max(4, Math.min(maxTop, top))
        };
    }

    function getPoint(ev) {
        if (ev && ev.touches && ev.touches.length) {
            return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        }
        if (ev && ev.changedTouches && ev.changedTouches.length) {
            return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
        }
        return { x: ev.clientX || 0, y: ev.clientY || 0 };
    }

    function beginDrag(ev) {
        var p = getPoint(ev);
        var rect = btn.getBoundingClientRect();
        dragging = true;
        moved = false;
        startX = p.x;
        startY = p.y;
        startLeft = rect.left;
        startTop = rect.top;
        imp("cursor", "grabbing");
        try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
    }

    function moveDrag(ev) {
        if (!dragging) return;
        var p = getPoint(ev);
        var dx = p.x - startX;
        var dy = p.y - startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
        var pos = clampPos(startLeft + dx, startTop + dy);
        imp("left", pos.left + "px");
        imp("top", pos.top + "px");
        imp("right", "auto");
        imp("bottom", "auto");
        try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
    }

    function endDrag(ev) {
        if (!dragging) return;
        dragging = false;
        imp("cursor", "grab");

        var rect = btn.getBoundingClientRect();
        var pos = clampPos(rect.left, rect.top);
        save("quickEntryLeft", String(Math.round(pos.left)));
        save("quickEntryTop", String(Math.round(pos.top)));

        if (!moved) {
            ipeToggleMiniPanel();
        }

        try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
    }

    btn.addEventListener("mousedown", beginDrag);
    btn.addEventListener("touchstart", beginDrag, { passive: false });

    try {
        d.addEventListener("mousemove", moveDrag, { passive: false });
        d.addEventListener("mouseup", endDrag, { passive: false });
        d.addEventListener("touchmove", moveDrag, { passive: false });
        d.addEventListener("touchend", endDrag, { passive: false });
        d.addEventListener("touchcancel", endDrag, { passive: false });
    } catch(e) {
        window.addEventListener("mousemove", moveDrag, { passive: false });
        window.addEventListener("mouseup", endDrag, { passive: false });
        window.addEventListener("touchmove", moveDrag, { passive: false });
        window.addEventListener("touchend", endDrag, { passive: false });
        window.addEventListener("touchcancel", endDrag, { passive: false });
    }

    try {
        (d.body || d.documentElement).appendChild(btn);
    } catch(e) {
        document.body.appendChild(btn);
    }
    applyQuickEntryVisibility();
    ipeSetStopButtonsState(!!ipeAbortController);
}

function ipeEnsureQuickButtonLater() {
    createChatQuickButton();
    setTimeout(createChatQuickButton, 700);
    setTimeout(createChatQuickButton, 1600);
    setTimeout(createChatQuickButton, 3200);
}

function createBall() {
    // V1.6：不再创建悬浮球，只清理旧版本遗留入口
    ipeRemoveOldFloatingBits();
}

function createPanel() {
    if (q("#ipe-panel")) return;
    var c = cfg();
    var panel = ipeRootDocument().createElement("div");
    panel.id = "ipe-panel"; panel.className = "ipe-panel";

    var h = '<div class="ipe-panel-header">';
    h += '<span class="ipe-panel-title">🐚 小海螺 · IPE</span>';
    h += '<div style="display:flex;align-items:center;gap:8px">'+ '<button id="ipe-theme-toggle" type="button" class="ipe-btn" style="flex:none;padding:3px 8px" title="开灯 / 关灯">'+(c.mistTheme===true?'☀️':'🌙')+'</button>' + '<label class="ipe-toggle"><input type="checkbox" id="ipe-enabled"'+(c.enabled?' checked':'')+'><span class="ipe-toggle-slider"></span></label><button id="ipe-panel-close" type="button" class="ipe-btn" style="flex:none;padding:3px 8px">×</button></div>';
    h += '</div>';
    h += '<div class="ipe-tabs">'
       + '<button type="button" class="ipe-tab" data-ipe-tabbtn="image">\uD83C\uDFA8 生图</button>'
       + '<button type="button" class="ipe-tab" data-ipe-tabbtn="ledger">\uD83D\uDCCB 挂账</button>'
       + '</div>';
    h += '<div class="ipe-sections">';

    h += secHTML("api-config","API 配置", true,
        '<label>API 预设<select id="ipe-api-profile"></select></label>'+
        '<label>预设名称<input type="text" id="ipe-api-profile-name" value="" placeholder="例如：DeepSeek / Flash 3.5"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-api-profile-add" class="ipe-btn" type="button">新增 API</button>'+
            '<button id="ipe-api-profile-delete" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<label>API 地址<input type="text" id="ipe-api-endpoint" value="'+esc(c.apiEndpoint)+'" placeholder="https://api.openai.com/v1"></label>'+
        '<label>API 密钥<input type="password" id="ipe-api-key" value="'+esc(c.apiKey)+'" placeholder="sk-..."></label>'+
        '<label>模型</label><select id="ipe-model"><option value="'+esc(c.model)+'">'+(c.model?esc(c.model)+' (已保存)':'请先加载模型')+'</option></select>'+
        '<div class="ipe-preview-actions" style="margin-top:6px"><button id="ipe-btn-models" class="ipe-btn">加载模型</button><button id="ipe-btn-test" class="ipe-btn">测试连接</button></div>'+
        '<div class="ipe-hint">可保存多个 API 预设；切换预设会同步地址、key 和模型。</div>');

    h += secHTML("system-prompt","系统提示", true,
        '<label>系统提示预设<select id="ipe-system-slot"></select></label>'+
        '<textarea id="ipe-system-prompt" rows="5" placeholder="系统提示词"></textarea>'+
        '<div class="ipe-hint">两套固定预设：情感 / 剧情。当前选中的系统提示会用于提取请求</div>');

    h += secHTML("base-template","基础模板", true,
        '<label>模板预设<select id="ipe-template-slot"></select></label>'+
        '<label>模板名称<input type="text" id="ipe-template-name" value="" placeholder="例如：乙游CG"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-template-add" class="ipe-btn" type="button">新增模板</button>'+
            '<button id="ipe-template-delete" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<textarea id="ipe-base-template" rows="6" placeholder="image###...{Description}...###"></textarea>'+
        '<div class="ipe-hint">可无限新增模板。用 {Description} 标记描述文本的插入位置</div>');

    h += secHTML("char-anchors","角色锚点", true,
        '<label>锚点预设<select id="ipe-anchor-slot"></select></label>'+
        '<label>锚点名称<input type="text" id="ipe-anchor-name" value="" placeholder="例如：陆星河 / 苑无忧"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-anchor-add" class="ipe-btn" type="button">新增锚点</button>'+
            '<button id="ipe-anchor-delete" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<textarea id="ipe-char-anchors" rows="5" placeholder="陆星河：a man, 28 years old, tall..."></textarea>'+
        '<div class="ipe-anchor-guide"><div class="ipe-anchor-guide-title">通用锚点规则已启用</div>'+
        '会自动随提取请求发送；文本框只需填写具体角色外貌锚点，不必重复粘贴通用规则。'+
        '<div class="ipe-preview-actions" style="margin-top:8px">'+
            '<button id="ipe-anchor-guide-toggle" class="ipe-btn" type="button">编辑通用规则</button>'+
            '<button id="ipe-anchor-guide-reset" class="ipe-btn" type="button">恢复默认</button>'+
        '</div>'+
        '<div id="ipe-anchor-guide-editor-wrap" class="ipe-anchor-guide-editor-wrap" style="display:none">'+
            '<textarea id="ipe-anchor-guide-editor" rows="7" placeholder="通用角色锚点调用规则"></textarea>'+
            '<div class="ipe-hint">这里改的是所有角色锚点共用的调用规则；保存后会随每次提取请求发送。</div>'+
        '</div></div>'+
        '<div class="ipe-hint">当前选中的角色锚点会随提取请求一起发送</div>');

    h += secHTML("extract-rules","提取规则", true,
        '<label>规则预设<select id="ipe-rule-slot"></select></label>'+
        '<label>规则名称<input type="text" id="ipe-rule-name" value="" placeholder="例如：GPT-image-2 / NAI / NanoBanana"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-rule-add" class="ipe-btn" type="button">新增规则</button>'+
            '<button id="ipe-rule-delete" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<textarea id="ipe-extract-rules" rows="5" placeholder="例：输出英文自然语言描述；不要参数；不要解释；适配当前生图模型..."></textarea>'+
        '<div class="ipe-hint">当前选中的提取规则会随提取请求一起发送</div>');

    h += secHTML("preview","预览", false,
        '<div style="margin-bottom:6px;color:#888;font-size:12px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">显示快捷入口 <input type=\"checkbox\" id=\"ipe-show-quick-entry\"'+(c.showQuickEntry?' checked':'')+'></label></div>'+
        '<div style="margin-bottom:6px;color:#888;font-size:12px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">自动注入 <input type="checkbox" id="ipe-auto-inject"'+(c.autoInject?' checked':'')+'></label></div>'+
        '<div id="ipe-status" class="ipe-preview-status">等待新消息…</div>'+
        '<textarea id="ipe-preview-text" rows="6" placeholder="生成的 Description 将显示在这里…"></textarea>'+
        '<label>补充指令<input type="text" id="ipe-supplement" placeholder="例：这段是冷战不是撒娇"></label>'+
        '<div class="ipe-preview-actions">'+
        '<button id="ipe-btn-save-now" class="ipe-btn">保存设置</button><button id="ipe-btn-extract" class="ipe-btn">手动提取</button>'+
        '<button id="ipe-btn-stop" class="ipe-btn" disabled>打断请求</button>'+
        '<button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>'+
        '<button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button></div>');

    h += secHTML("ledger","\uD83D\uDCCB 账本（本聊天）", false,
        '<div id="ipe-ledger-chatkey" class="ipe-hint" style="margin-bottom:6px"></div>'+
        '<label>账本（副 AI 记的，你也能直接改）</label>'+
        '<textarea id="ipe-ledger-text" rows="6" placeholder="左肩刀伤&#10;答应她周末去看展"></textarea>'+
        '<label style="margin-top:8px">\u26A0\uFE0F User 指令（压过账本与副 AI 的判断）</label>'+
        '<textarea id="ipe-ledger-order" rows="2" placeholder="例：伤先别好，我还要写；这条约定先别结清"></textarea>'+
        '<div class="ipe-preview-actions" style="margin-top:6px">'+
            '<button id="ipe-ledger-save" class="ipe-btn ipe-btn-primary" type="button">保存账本</button>'+
            '<button id="ipe-ledger-reload" class="ipe-btn" type="button">重新读取</button>'+
        '</div>'+
        '<label style="margin-top:8px">\uD83D\uDCAC 这次额外说一句（可留空；只对下一次挂账有效）</label>'+
        '<textarea id="ipe-ledger-extra" rows="2" placeholder="例：伤挂了八轮了，这轮该写好转；念想那层别凑满三条"></textarea>'+
        '<div class="ipe-preview-actions" style="margin-top:6px">'+
            '<button id="ipe-ledger-run" class="ipe-btn ipe-btn-primary" type="button">\uD83E\uDD16 重新挂账（读最后一楼，先给你看）</button>'+
        '</div>'+
        '<div id="ipe-ledger-preview-box" style="display:none;margin-top:8px">'+
            '<label>\uD83D\uDC40 副 AI 刚才说了什么（可直接改）</label>'+
            '<textarea id="ipe-ledger-preview" rows="10"></textarea>'+
            '<div class="ipe-preview-actions" style="margin-top:6px">'+
                '<button id="ipe-ledger-adopt" class="ipe-btn ipe-btn-primary" type="button">\u2713 采用</button>'+
                '<button id="ipe-ledger-reroll" class="ipe-btn" type="button">\uD83C\uDFB2 重 roll</button>'+
                '<button id="ipe-ledger-preview-close" class="ipe-btn" type="button">收起</button>'+
            '</div>'+
            '<div id="ipe-ledger-preview-tip" class="ipe-hint"></div>'+
        '</div>'+
        '<div class="ipe-preview-actions" id="ipe-ledger-force" style="display:none">'+
            '<button id="ipe-ledger-force-btn" class="ipe-btn" type="button">\u26A0\uFE0F 强制采用这次结果</button>'+
        '</div>'+
        '<div id="ipe-ledger-status" class="ipe-preview-status" style="margin-top:6px">\u2014</div>'+
        '<details class="ipe-fold"><summary>\u23F1 后悔药（改错了从这儿找回来）</summary><div class="ipe-fold-body">'+
            '<pre id="ipe-ledger-age" class="ipe-ledger-age"></pre>'+
            '<label>存过的旧账本<select id="ipe-ledger-vers"></select></label>'+
            '<div class="ipe-preview-actions" style="margin-top:2px">'+
                '<button id="ipe-ledger-rollback" class="ipe-btn" type="button">换回这版</button>'+
                '<button id="ipe-ledger-view" class="ipe-btn" type="button">先看看</button>'+
            '</div>'+
            '<div class="ipe-hint">最近 10 次改动都留着。</div>'+
        '</div></details>'+
        '<div class="ipe-hint">账本存在本聊天里（chat_metadata 主档 + 本地镜像）。切换聊天会各用各的。</div>'+
        '<hr style="border:none;border-top:1px solid rgba(255,255,255,.10);margin:12px 0">'+
        '<div style="font-weight:600;font-size:12px;margin-bottom:6px">\uD83E\uDD16 副 AI（谁来记账）</div>'+
        '<label>挂账用哪套 API<select id="ipe-ledger-api"></select></label>'+
        '<div class="ipe-hint" style="margin-bottom:6px">在生图页配好地址密钥，这儿选一套用。跟生图各用各的，不打架。</div>'+
        '<details class="ipe-fold"><summary>\u2699\uFE0F 高级设置（不懂就别动，默认就挺好）</summary><div class="ipe-fold-body">'+
            '<div class="ipe-hint">副 AI 每次能看到：本卡要点 + User 指令 + 最近几楼摘要 + 最近几版账本 + 楼层数 + 这一楼正文。不看角色卡和世界书。</div>'+
            '<label>让它往回看几楼（0 = 不看）<input type="text" inputmode="numeric" id="ipe-ledger-rep-floors" placeholder="10"></label>'+
            '<label>摘要起始标签<input type="text" id="ipe-ledger-rep-open" placeholder="&lt;report&gt;"></label>'+
            '<label>摘要结束标签<input type="text" id="ipe-ledger-rep-close" placeholder="&lt;/report&gt;"></label>'+
            '<label>让它看最近几版账本<select id="ipe-ledger-vn"></select></label>'+
            '<div class="ipe-hint" style="margin-top:8px">下面两格一般不用动。只有当你的预设本来就在用别的标签（比如 &lt;掛帳&gt;）时，改成一样的就不用套两层。</div>'+
            '<label>账本起始标签<input type="text" id="ipe-ledger-tag-open" placeholder="&lt;ledger&gt;"></label>'+
            '<label>账本结束标签<input type="text" id="ipe-ledger-tag-close" placeholder="&lt;/ledger&gt;"></label>'+
            '<div class="ipe-preview-actions" style="margin-top:2px"><button id="ipe-ledger-tag-reset" class="ipe-btn" type="button">恢复成 &lt;ledger&gt;</button></div>'+
            '<div style="color:#888;font-size:12px;margin-top:10px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">允许副 AI 回「没变化」省一次重写 <input type="checkbox" id="ipe-ledger-nochange"></label></div>'+
            '<div class="ipe-hint">默认关。开了能省 token，但状态快照式的预设容易被它当借口天天不更新。</div>'+
            '<div id="ipe-ledger-size" class="ipe-hint" style="margin-top:6px"></div>'+
        '</div></details>'+
        '<div class="ipe-preview-actions" style="margin-bottom:8px">'+
            '<button id="ipe-ledger-test" class="ipe-btn" type="button">测试连接</button>'+
        '</div>'+
        '<div style="color:#888;font-size:12px;margin-bottom:8px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">自动挂账（每来一楼跑一次） <input type="checkbox" id="ipe-ledger-auto"></label></div>'+
        '<details class="ipe-fold" open><summary>\uD83D\uDCDD 挂账规则（想记什么写在这儿）</summary><div class="ipe-fold-body">'+
        '<label>规则预设<select id="ipe-ledger-prompt-slot"></select></label>'+
        '<label>预设名称<input type="text" id="ipe-ledger-prompt-name" placeholder="例：修仙 / 爱情 / 大世界"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-ledger-prompt-add" class="ipe-btn" type="button">新增</button>'+
            '<button id="ipe-ledger-prompt-del" class="ipe-btn" type="button">删除当前</button>'+
            '<button id="ipe-ledger-prompt-reset" class="ipe-btn" type="button">恢复默认</button>'+
        '</div>'+
        '<textarea id="ipe-ledger-prompt" rows="7" placeholder="告诉副 AI：这张卡该挂什么"></textarea>'+
        '<div class="ipe-hint">想记什么、分几层、什么格式，随你写。包裹格式插件自己会加，不用管。</div>'+
        '<details class="ipe-fold"><summary>\uD83D\uDD27 插件到底在背后干了什么</summary><div class="ipe-fold-body">'+
            '<pre id="ipe-ledger-protocol" class="ipe-ledger-age" style="max-height:none"></pre>'+
            '<div id="ipe-ledger-tagwarn" class="ipe-hint" style="line-height:1.6"></div>'+
        '</div></details>'+
        '<label style="margin-top:8px">本卡要点 / 世界观硬设定<select id="ipe-ledger-note-slot"></select></label>'+
        '<label>要点名称<input type="text" id="ipe-ledger-note-name" placeholder="例：707号室"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-ledger-note-add" class="ipe-btn" type="button">新增</button>'+
            '<button id="ipe-ledger-note-del" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<textarea id="ipe-ledger-note" rows="4" placeholder="只写会影响判定的硬设定，例：此人体质特殊，外伤两日即愈"></textarea>'+
        '<div class="ipe-hint">别贴整张角色卡——副 AI 读了人设会开始共情，判断就跟着剧情跑偏了。</div>'+
        '</div></details>'+
        '<hr style="border:none;border-top:1px solid rgba(255,255,255,.10);margin:12px 0">'+
        '<div style="color:#888;font-size:12px;margin-bottom:6px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">在楼里显示账本（只进画面，不进存档） <input type="checkbox" id="ipe-ledger-inline"></label></div>'+
        '<div style="color:#888;font-size:12px;margin-bottom:6px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">贴耳注入（模型读得到，楼里读不到） <input type="checkbox" id="ipe-ledger-ep-enabled"></label></div>'+
        '<details class="ipe-fold"><summary>\uD83C\uDFA7 贴耳细节（想看模型到底读到什么）</summary><div class="ipe-fold-body">'+
            '<label>注入深度<select id="ipe-ledger-ep-depth"></select></label>'+
            '<div class="ipe-hint">数字越小越靠近最新一楼。默认 2 就挺好。</div>'+
            '<label style="margin-top:6px">模型实际读到的原文</label>'+
            '<pre id="ipe-ledger-ep-preview" class="ipe-ledger-age"></pre>'+
            '<div class="ipe-hint">不占楼层、不进聊天记录，一轮一换。</div>'+
        '</div></details>',
        "ledger");

    h += '</div><div class="ipe-footer">by ' + IPE_CREDITS + '</div>';
    panel.innerHTML = h;
    ipeRootDocument().body.appendChild(panel);
    ipeApplyTheme();
}

function secHTML(id, title, collapsed, body, tab) {
    return '<div class="ipe-section'+(collapsed?' collapsed':'')+'" id="ipe-section-'+id+'" data-ipe-tab="'+(tab||"image")+'">'+
        '<div class="ipe-section-header"><span>'+title+'</span><span class="ipe-collapse-icon">▾</span></div>'+
        '<div class="ipe-section-body">'+body+'</div></div>';
}

function createDrawer() {
    if (q("#ipe-drawer")) return;
    var c = cfg();
    var h = '<div id="ipe-drawer"><div class="inline-drawer">';
    h += '<div class="inline-drawer-toggle inline-drawer-header"><b>\uD83D\uDC1A 小海螺 · IPE</b>';
    h += '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>';
    h += '<div class="inline-drawer-content">';
    h += '<div style="margin-bottom:6px"><label>启用 <input type="checkbox" id="iped-enabled"'+(c.enabled?' checked':'')+'></label></div>';
    h += '<div style=\"margin-bottom:6px\"><label>显示快捷入口 <input type=\"checkbox\" id=\"iped-show-quick-entry\"'+(c.showQuickEntry?' checked':'')+'></label></div>';
    h += '<div style="margin-bottom:6px"><label>自动注入 <input type="checkbox" id="iped-auto-inject"'+(c.autoInject?' checked':'')+'></label></div>';
    h += '<div style="margin:8px 0;display:flex;gap:6px"><input type="button" id="iped-open-panel" class="menu_button" value="打开 IPE 小面板"><input type="button" id="iped-reset-entry" class="menu_button" value="重置入口位置"></div>';
    h += '<div class="ipe-tabs" style="margin:8px 0">'
       + '<button type="button" class="ipe-tab" data-ipe-tabbtn="image">\uD83C\uDFA8 生图</button>'
       + '<button type="button" class="ipe-tab" data-ipe-tabbtn="ledger">\uD83D\uDCCB 挂账</button>'
       + '</div>';
    h += '<div data-ipe-tab="image">';
    h += '<hr><small><b>API 配置</b></small>';
    h += '<label>API 预设</label><select id="iped-api-profile" class="text_pole"></select>';
    h += '<label>预设名称</label><input type="text" id="iped-api-profile-name" class="text_pole" value="" placeholder="例如：DeepSeek / Flash 3.5">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-api-profile-add" class="menu_button" value="新增 API"><input type="button" id="iped-api-profile-delete" class="menu_button" value="删除当前"></div>';
    h += '<label>API 地址</label><input type="text" id="iped-api-endpoint" class="text_pole" value="'+esc(c.apiEndpoint)+'" placeholder="https://api.openai.com/v1">';
    h += '<label>API 密钥</label><input type="password" id="iped-api-key" class="text_pole" value="'+esc(c.apiKey)+'" placeholder="sk-...">';
    h += '<label>模型</label><select id="iped-model" class="text_pole"><option value="'+esc(c.model)+'">'+(c.model?esc(c.model)+' (已保存)':'请先加载模型')+'</option></select>';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-btn-models" class="menu_button" value="加载模型"><input type="button" id="iped-btn-test" class="menu_button" value="测试连接"></div>';
    h += '<small style="color:#888">可保存多个 API 预设；切换预设会同步地址、key 和模型。</small>';
    h += '<hr><small><b>系统提示</b></small>';
    h += '<label>系统提示预设</label><select id="iped-system-slot" class="text_pole"></select>';
    h += '<textarea id="iped-system-prompt" class="text_pole" rows="4" placeholder="系统提示词"></textarea>';
    h += '<small style="color:#888">两套固定预设：情感 / 剧情</small>';
    h += '<hr><small><b>基础模板</b></small>';
    h += '<label>模板预设</label><select id="iped-template-slot" class="text_pole"></select>';
    h += '<label>模板名称</label><input type="text" id="iped-template-name" class="text_pole" value="" placeholder="例如：乙游CG">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-template-add" class="menu_button" value="新增模板"><input type="button" id="iped-template-delete" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-base-template" class="text_pole" rows="5" placeholder="image###...{Description}...###"></textarea>';
    h += '<small style="color:#888">可无限新增模板。用 {Description} 标记插入位置</small>';
    h += '<hr><small><b>角色锚点</b></small>';
    h += '<label>锚点预设</label><select id="iped-anchor-slot" class="text_pole"></select>';
    h += '<label>锚点名称</label><input type="text" id="iped-anchor-name" class="text_pole" value="" placeholder="例如：陆星河 / 苑无忧">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-anchor-add" class="menu_button" value="新增锚点"><input type="button" id="iped-anchor-delete" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-char-anchors" class="text_pole" rows="4" placeholder="陆星河：a man, 28 years old, tall..."></textarea>';
    h += '<div class="ipe-anchor-guide"><div class="ipe-anchor-guide-title">通用锚点规则已启用</div>会自动随提取请求发送；文本框只需填写具体角色外貌锚点，不必重复粘贴通用规则。<div style="display:flex;gap:6px;margin-top:8px"><input type="button" id="iped-anchor-guide-toggle" class="menu_button" value="编辑通用规则"><input type="button" id="iped-anchor-guide-reset" class="menu_button" value="恢复默认"></div><div id="iped-anchor-guide-editor-wrap" class="ipe-anchor-guide-editor-wrap" style="display:none"><textarea id="iped-anchor-guide-editor" class="text_pole" rows="6" placeholder="通用角色锚点调用规则"></textarea><small style="color:#888">这里改的是所有角色锚点共用的调用规则；保存后会随每次提取请求发送。</small></div></div>';
    h += '<hr><small><b>提取规则</b></small>';
    h += '<label>规则预设</label><select id="iped-rule-slot" class="text_pole"></select>';
    h += '<label>规则名称</label><input type="text" id="iped-rule-name" class="text_pole" value="" placeholder="例如：GPT-image-2 / NAI / NanoBanana">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-rule-add" class="menu_button" value="新增规则"><input type="button" id="iped-rule-delete" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-extract-rules" class="text_pole" rows="4" placeholder="例：输出英文自然语言描述；不要参数；不要解释；适配当前生图模型..."></textarea>';
    h += '<hr><small><b>预览</b></small>';
    h += '<div id="iped-status" style="color:#888;font-size:12px;margin:4px 0">等待新消息…</div>';
    h += '<textarea id="iped-preview-text" class="text_pole" rows="5" placeholder="生成的 Description 将显示在这里…"></textarea>';
    h += '<label>补充指令</label><input type="text" id="iped-supplement" class="text_pole" placeholder="例：这段是冷战不是撒娇">';
    h += '<div style="display:flex;gap:6px;margin-top:6px">';
    h += '<input type="button" id="iped-btn-save-now" class="menu_button" value="保存设置">';
    h += '<input type="button" id="iped-btn-extract" class="menu_button" value="手动提取">';
    h += '<input type="button" id="iped-btn-stop" class="menu_button" value="打断请求" disabled>';
    h += '<input type="button" id="iped-btn-reroll" class="menu_button" value="重新生成" disabled>';
    h += '<input type="button" id="iped-btn-inject" class="menu_button" value="确认注入" disabled>';
    h += '</div>';
    h += '</div>';
    h += '<div data-ipe-tab="ledger">';
    h += '<div id="iped-ledger-chatkey" style="color:#888;font-size:11px;margin:4px 0"></div>';
    h += '<label>账本（副 AI 记的，你也能直接改）</label>';
    h += '<textarea id="iped-ledger-text" class="text_pole" rows="5" placeholder="左肩刀伤&#10;答应她周末去看展"></textarea>';
    h += '<label>\u26A0\uFE0F User 指令（压过账本与副 AI 的判断）</label>';
    h += '<textarea id="iped-ledger-order" class="text_pole" rows="2" placeholder="例：伤先别好，我还要写"></textarea>';
    h += '<div style="display:flex;gap:6px;margin-top:6px;padding-right:6px"><input type="button" id="iped-ledger-save" class="menu_button" value="保存账本"><input type="button" id="iped-ledger-reload" class="menu_button" value="重新读取"></div>';
    h += '<label>\uD83D\uDCAC 这次额外说一句（可留空；只对下一次挂账有效）</label>';
    h += '<textarea id="iped-ledger-extra" class="text_pole" rows="2" placeholder="例：伤挂了八轮了，这轮该写好转"></textarea>';
    h += '<div style="display:flex;margin-top:6px;padding-right:6px"><input type="button" id="iped-ledger-run" class="menu_button" style="flex:1" value="\uD83E\uDD16 重新挂账（读最后一楼，先给你看）"></div>';
    h += '<div id="iped-ledger-preview-box" style="display:none;margin-top:8px">';
    h += '<label>\uD83D\uDC40 副 AI 刚才说了什么（可直接改）</label>';
    h += '<textarea id="iped-ledger-preview" class="text_pole" rows="8"></textarea>';
    h += '<div style="display:flex;gap:6px;margin-top:6px;padding-right:6px"><input type="button" id="iped-ledger-adopt" class="menu_button" value="\u2713 采用"><input type="button" id="iped-ledger-reroll" class="menu_button" value="\uD83C\uDFB2 重 roll"><input type="button" id="iped-ledger-preview-close" class="menu_button" value="收起"></div>';
    h += '<div id="iped-ledger-preview-tip" style="color:#888;font-size:11px;margin-top:4px"></div>';
    h += '</div>';
    h += '<div id="iped-ledger-force" style="display:none;margin-top:6px"><input type="button" id="iped-ledger-force-btn" class="menu_button" style="width:100%" value="\u26A0\uFE0F 强制采用这次结果"></div>';
    h += '<div id="iped-ledger-status" style="color:#888;font-size:12px;margin:6px 0">\u2014</div>';
    h += '<details class="ipe-fold"><summary>\u23F1 后悔药（改错了从这儿找回来）</summary><div class="ipe-fold-body">';
    h += '<pre id="iped-ledger-age" class="ipe-ledger-age"></pre>';
    h += '<label>存过的旧账本</label><select id="iped-ledger-vers" class="text_pole"></select>';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-ledger-rollback" class="menu_button" value="换回这版"><input type="button" id="iped-ledger-view" class="menu_button" value="先看看"></div>';
    h += '</div></details>';
    h += '<small style="color:#888">账本存在本聊天里；切换聊天会各用各的。</small>';
    h += '<hr><small><b>\uD83E\uDD16 副 AI（谁来记账）</b></small>';
    h += '<label>挂账用哪套 API</label><select id="iped-ledger-api" class="text_pole"></select>';
    h += '<div style="display:flex;gap:6px;margin:6px 0;padding-right:6px"><input type="button" id="iped-ledger-test" class="menu_button" style="flex:1" value="测试连接"></div>';
    h += '<details class="ipe-fold"><summary>\u2699\uFE0F 高级设置（不懂就别动）</summary><div class="ipe-fold-body">';
    h += '<label>让它往回看几楼（0=不看）</label><input type="text" inputmode="numeric" id="iped-ledger-rep-floors" class="text_pole" placeholder="10">';
    h += '<label>摘要起始标签</label><input type="text" id="iped-ledger-rep-open" class="text_pole" placeholder="&lt;report&gt;">';
    h += '<label>摘要结束标签</label><input type="text" id="iped-ledger-rep-close" class="text_pole" placeholder="&lt;/report&gt;">';
    h += '<label>让它看最近几版账本</label><select id="iped-ledger-vn" class="text_pole"></select>';
    h += '<small style="color:#888">下面两格一般不用动。预设本来就在用别的标签时改成一样的即可。</small>';
    h += '<label>账本起始标签</label><input type="text" id="iped-ledger-tag-open" class="text_pole" placeholder="&lt;ledger&gt;">';
    h += '<label>账本结束标签</label><input type="text" id="iped-ledger-tag-close" class="text_pole" placeholder="&lt;/ledger&gt;">';
    h += '<div style="margin-top:6px"><input type="button" id="iped-ledger-tag-reset" class="menu_button" value="恢复成 &lt;ledger&gt;"></div>';
    h += '<div style="margin-top:10px"><label>允许副 AI 回「没变化」省一次重写 <input type="checkbox" id="iped-ledger-nochange"></label></div>';
    h += '<small style="color:#888">默认关。开了省 token，但快照式预设容易被它当借口不更新。</small>';
    h += '<div id="iped-ledger-size" style="color:#888;font-size:11px;margin:4px 0"></div>';
    h += '</div></details>';
    h += '<div style="margin-bottom:6px"><label>自动挂账（每来一楼跑一次） <input type="checkbox" id="iped-ledger-auto"></label></div>';
    h += '<label>挂账规则预设</label><select id="iped-ledger-prompt-slot" class="text_pole"></select>';
    h += '<label>预设名称</label><input type="text" id="iped-ledger-prompt-name" class="text_pole" placeholder="例：修仙 / 爱情 / 大世界">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-ledger-prompt-add" class="menu_button" value="新增"><input type="button" id="iped-ledger-prompt-del" class="menu_button" value="删除当前"><input type="button" id="iped-ledger-prompt-reset" class="menu_button" value="恢复默认"></div>';
    h += '<textarea id="iped-ledger-prompt" class="text_pole" rows="6" placeholder="告诉副 AI：这张卡该挂什么"></textarea>';
    h += '<details class="ipe-fold"><summary>\uD83D\uDD27 插件到底在背后干了什么</summary><div class="ipe-fold-body">';
    h += '<pre id="iped-ledger-protocol" class="ipe-ledger-age" style="max-height:none"></pre>';
    h += '<div id="iped-ledger-tagwarn" style="color:#888;font-size:12px;line-height:1.6"></div>';
    h += '</div></details>';
    h += '<label>本卡要点 / 世界观硬设定</label><select id="iped-ledger-note-slot" class="text_pole"></select>';
    h += '<label>要点名称</label><input type="text" id="iped-ledger-note-name" class="text_pole" placeholder="例：707号室">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-ledger-note-add" class="menu_button" value="新增"><input type="button" id="iped-ledger-note-del" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-ledger-note" class="text_pole" rows="4" placeholder="只写会影响判定的硬设定"></textarea>';
    h += '<small style="color:#888">不要贴整张角色卡。</small>';
    h += '<hr>';
    h += '<div style="margin-bottom:6px"><label>在楼里显示账本（只进画面，不进存档） <input type="checkbox" id="iped-ledger-inline"></label></div>';
    h += '<div style="margin-bottom:6px"><label>贴耳注入（模型读得到，楼里读不到） <input type="checkbox" id="iped-ledger-ep-enabled"></label></div>';
    h += '<details class="ipe-fold"><summary>\uD83C\uDFA7 贴耳细节（想看模型到底读到什么）</summary><div class="ipe-fold-body">';
    h += '<label>注入深度</label><select id="iped-ledger-ep-depth" class="text_pole"></select>';
    h += '<label>模型实际读到的原文</label>';
    h += '<pre id="iped-ledger-ep-preview" class="ipe-ledger-age"></pre>';
    h += '<small style="color:#888">不占楼层、不进聊天记录，一轮一换。</small>';
    h += '</div></details>';
    h += '</div>';
    h += '<div style="margin-top:8px;color:#666;font-size:11px;text-align:right">by ' + IPE_CREDITS + '</div></div></div></div>';

    var jq = null;
    try { jq = ipeRootWindow().jQuery || ipeRootWindow().$ || window.jQuery || window.$; } catch(e) { jq = window.jQuery || window.$; }
    var target = jq ? jq("#extensions_settings2") : null;
    if (target && target.length) { target.append(h); console.log("[IPE] 抽屉已挂载"); }
}

function ipeForceSaveFromEditors() {
    try {
        var el;

        el = q("#ipe-api-profile") || q("#iped-api-profile");
        if (el && el.value) saveCritical("activeApiProfile", el.value);
        el = q("#ipe-api-profile-name") || q("#iped-api-profile-name");
        if (el) ipeSetApiProfileName(el.value);
        el = q("#ipe-api-endpoint") || q("#iped-api-endpoint");
        if (el) ipeSetApiProfileField("endpoint", el.value);
        el = q("#ipe-api-key") || q("#iped-api-key");
        if (el) ipeSetApiProfileField("key", el.value);
        el = q("#ipe-model") || q("#iped-model");
        if (el && el.value) ipeSetApiProfileField("model", el.value);

        el = q("#ipe-system-prompt") || q("#iped-system-prompt");
        if (el) ipeSetSystemPromptValue(el.value);
        el = q("#ipe-system-slot") || q("#iped-system-slot");
        if (el && el.value) saveCritical("activeSystemPromptPreset", el.value);

        el = q("#ipe-base-template") || q("#iped-base-template");
        if (el) ipeSetTemplateValue(el.value);
        el = q("#ipe-template-name") || q("#iped-template-name");
        if (el) ipeSetTemplateName(el.value);

        el = q("#ipe-char-anchors") || q("#iped-char-anchors");
        if (el) ipeSetAnchorValue(el.value);
        el = q("#ipe-anchor-name") || q("#iped-anchor-name");
        if (el) ipeSetAnchorName(el.value);
        el = q("#ipe-anchor-guide-editor") || q("#iped-anchor-guide-editor");
        if (el) ipeSetAnchorUsageGuide(el.value);

        el = q("#ipe-extract-rules") || q("#iped-extract-rules");
        if (el) ipeSetRuleValue(el.value);
        el = q("#ipe-rule-name") || q("#iped-rule-name");
        if (el) ipeSetRuleName(el.value);

        el = q("#ipe-template-slot") || q("#iped-template-slot");
        if (el && el.value) saveCritical("activeBaseTemplate", el.value);
        el = q("#ipe-anchor-slot") || q("#iped-anchor-slot");
        if (el && el.value) saveCritical("activeAnchorPreset", el.value);
        el = q("#ipe-rule-slot") || q("#iped-rule-slot");
        if (el && el.value) saveCritical("activeRulePreset", el.value);

        ipeSaveNow();
        ipeRefreshApiProfileEditors();
        ipeRefreshSystemPromptEditors();
        ipeRefreshTemplateEditors();
        ipeRefreshAnchorEditors();
        ipeRefreshRuleEditors();
        setStatus("设置已保存", "#62c073");
    } catch(e) {
        console.error("[IPE] force save failed:", e);
        setStatus("保存失败", "#d4726a");
    }
}

function ipeSetStopButtonsState(active) {
    ["ipe-btn-stop","iped-btn-stop"].forEach(function(id){
        var el = q("#" + id);
        if (!el) return;
        el.disabled = !active;
        el.style.opacity = active ? "1" : "0.45";
        el.style.pointerEvents = active ? "auto" : "none";
    });
}

function bindAll() {
    ipeRootDocument().querySelectorAll(".ipe-section-header").forEach(function(h){
        h.addEventListener("click", function(){ h.parentElement.classList.toggle("collapsed"); });
    });

    ["ipe-api-profile","iped-api-profile"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            ipeSetActiveApiProfile(el.value);
        });
    });

    ["ipe-api-profile-name","iped-api-profile-name"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetApiProfileName(el.value);
            var other=q("#"+(id==="ipe-api-profile-name"?"iped-api-profile-name":"ipe-api-profile-name"));
            if(other&&other!==el) other.value=el.value;
            ipeRefreshApiProfileEditors();
        });
        el.addEventListener("change", function(){
            ipeSetApiProfileName(el.value);
            ipeSaveNow();
            ipeRefreshApiProfileEditors();
        });
    });

    ["ipe-api-profile-add","iped-api-profile-add"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeAddApiProfile);
    });

    ["ipe-api-profile-delete","iped-api-profile-delete"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeDeleteApiProfile);
    });

    var fields = [
        ["endpoint","ipe-api-endpoint","iped-api-endpoint"],
        ["key","ipe-api-key","iped-api-key"]
    ];
    fields.forEach(function(arr){
        var key=arr[0], id1=arr[1], id2=arr[2];
        [id1,id2].forEach(function(id){
            var el=q("#"+id); if(!el) return;
            el.addEventListener("input", function(){
                ipeSetApiProfileField(key, el.value);
                var o=q("#"+(id===id1?id2:id1));
                if(o&&o!==el) o.value=el.value;
            });
            el.addEventListener("change", function(){
                ipeSetApiProfileField(key, el.value);
                ipeSaveNow();
            });
        });
    });

    ["ipe-system-slot","iped-system-slot"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            saveCritical("activeSystemPromptPreset", el.value);
            ipeRefreshSystemPromptEditors();
            ipeSaveNow();
        });
    });

    ["ipe-system-prompt","iped-system-prompt"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetSystemPromptValue(el.value);
            var other=q("#"+(id==="ipe-system-prompt"?"iped-system-prompt":"ipe-system-prompt"));
            if(other&&other!==el) other.value=el.value;
        });
        el.addEventListener("change", function(){
            ipeSetSystemPromptValue(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-template-slot","iped-template-slot"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            saveCritical("activeBaseTemplate", el.value);
            ipeRefreshTemplateEditors();
        });
    });

    ["ipe-template-name","iped-template-name"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetTemplateName(el.value);
            ipeRefreshTemplateEditors();
        });
        el.addEventListener("change", function(){
            ipeSetTemplateName(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-base-template","iped-base-template"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetTemplateValue(el.value);
            var other=q("#"+(id==="ipe-base-template"?"iped-base-template":"ipe-base-template"));
            if(other&&other!==el) other.value=el.value;
        });
        el.addEventListener("change", function(){
            ipeSetTemplateValue(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-template-add","iped-template-add"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeAddTemplatePreset);
    });

    ["ipe-template-delete","iped-template-delete"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeDeleteTemplatePreset);
    });

    ["ipe-anchor-slot","iped-anchor-slot"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            saveCritical("activeAnchorPreset", el.value);
            ipeRefreshAnchorEditors();
        });
    });

    ["ipe-anchor-name","iped-anchor-name"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetAnchorName(el.value);
            ipeRefreshAnchorEditors();
        });
        el.addEventListener("change", function(){
            ipeSetAnchorName(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-char-anchors","iped-char-anchors"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetAnchorValue(el.value);
            var other=q("#"+(id==="ipe-char-anchors"?"iped-char-anchors":"ipe-char-anchors"));
            if(other&&other!==el) other.value=el.value;
        });
        el.addEventListener("change", function(){
            ipeSetAnchorValue(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-anchor-guide-editor","iped-anchor-guide-editor"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetAnchorUsageGuide(el.value);
            var other=q("#"+(id==="ipe-anchor-guide-editor"?"iped-anchor-guide-editor":"ipe-anchor-guide-editor"));
            if(other&&other!==el) other.value=el.value;
        });
        el.addEventListener("change", function(){
            ipeSetAnchorUsageGuide(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-anchor-guide-toggle","iped-anchor-guide-toggle"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeToggleAnchorGuideEditor);
    });

    ["ipe-anchor-guide-reset","iped-anchor-guide-reset"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeResetAnchorUsageGuide);
    });

    ["ipe-anchor-add","iped-anchor-add"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeAddAnchorPreset);
    });

    ["ipe-anchor-delete","iped-anchor-delete"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeDeleteAnchorPreset);
    });

    ["ipe-rule-slot","iped-rule-slot"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            saveCritical("activeRulePreset", el.value);
            ipeRefreshRuleEditors();
        });
    });

    ["ipe-rule-name","iped-rule-name"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetRuleName(el.value);
            ipeRefreshRuleEditors();
        });
        el.addEventListener("change", function(){
            ipeSetRuleName(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-extract-rules","iped-extract-rules"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            ipeSetRuleValue(el.value);
            var other=q("#"+(id==="ipe-extract-rules"?"iped-extract-rules":"ipe-extract-rules"));
            if(other&&other!==el) other.value=el.value;
        });
        el.addEventListener("change", function(){
            ipeSetRuleValue(el.value);
            ipeSaveNow();
        });
    });

    ["ipe-rule-add","iped-rule-add"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeAddRulePreset);
    });

    ["ipe-rule-delete","iped-rule-delete"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("click", ipeDeleteRulePreset);
    });

    ["ipe-model","iped-model"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            ipeSetApiProfileField("model", el.value);
            var o=q("#"+(id==="ipe-model"?"iped-model":"ipe-model"));
            if(o) o.value=el.value;
        });
    });

    ["ipe-enabled","iped-enabled"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("enabled", el.checked);
            var o=q("#"+(id==="ipe-enabled"?"iped-enabled":"ipe-enabled"));
            if(o) o.checked=el.checked;
        });
    });

    ["ipe-show-quick-entry","iped-show-quick-entry"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("showQuickEntry", el.checked);
            var o=q("#"+(id==="ipe-show-quick-entry"?"iped-show-quick-entry":"ipe-show-quick-entry"));
            if(o) o.checked=el.checked;
            if (el.checked) {
                createChatQuickButton();
            } else {
                applyQuickEntryVisibility();
                var oldEntry = q("#ipe-chat-quick-entry");
                if (oldEntry && oldEntry.parentNode) {
                    try { oldEntry.parentNode.removeChild(oldEntry); } catch(e) {}
                }
            }
        });
    });

    ["ipe-auto-inject","iped-auto-inject"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("autoInject", el.checked);
            var o=q("#"+(id==="ipe-auto-inject"?"iped-auto-inject":"ipe-auto-inject"));
            if(o) o.checked=el.checked;
        });
    });

    ["ipe","iped"].forEach(function(p){
        var be=q("#"+p+"-btn-extract"); if(be && !be.__ipeBound){ be.__ipeBound = true; be.addEventListener("click", onExtract); }
        var br=q("#"+p+"-btn-reroll"); if(br && !br.__ipeBound){ br.__ipeBound = true; br.addEventListener("click", onReroll); }
        var bj=q("#"+p+"-btn-inject"); if(bj && !bj.__ipeBound){ bj.__ipeBound = true; bj.addEventListener("click", onInject); }
        var bm=q("#"+p+"-btn-models"); if(bm && !bm.__ipeBound){ bm.__ipeBound = true; bm.addEventListener("click", fetchModels); }
        var bt=q("#"+p+"-btn-test"); if(bt && !bt.__ipeBound){ bt.__ipeBound = true; bt.addEventListener("click", testConnection); }
        var bs=q("#"+p+"-btn-stop"); if(bs && !bs.__ipeBound){ bs.__ipeBound = true; bs.addEventListener("click", ipeAbortCurrentRequest); }
        var bv=q("#"+p+"-btn-save-now"); if(bv && !bv.__ipeBound){ bv.__ipeBound = true; bv.addEventListener("click", ipeForceSaveFromEditors); }
    });

    var openPanelBtn = q("#iped-open-panel");
    if (openPanelBtn) {
        openPanelBtn.addEventListener("click", function(){
            ipeToggleMiniPanel();
        });
    }

    var resetEntryBtn = q("#iped-reset-entry");
    if (resetEntryBtn) {
        resetEntryBtn.addEventListener("click", function(){
            save("quickEntryLeft", "");
            save("quickEntryTop", "");
            var old = q("#ipe-chat-quick-entry");
            if (old && old.parentNode) {
                try { old.parentNode.removeChild(old); } catch(e) {}
            }
            createChatQuickButton();
            setStatus("已重置快捷入口位置", "#6ec577");
        });
    }

    var themeToggleBtn = q("#ipe-theme-toggle");
    if (themeToggleBtn && !themeToggleBtn.__ipeThemeBound) {
        themeToggleBtn.__ipeThemeBound = true;
        themeToggleBtn.addEventListener("click", function(){
            save("mistTheme", cfg().mistTheme !== true);
            ipeSaveNow();
            ipeApplyTheme();
        });
    }

    var closePanelBtn = q("#ipe-panel-close");
    if (closePanelBtn) {
        closePanelBtn.addEventListener("click", function(){
            var p = q("#ipe-panel");
            if (p) {
                p.setAttribute("data-ipe-open", "0");
                p.classList.remove("visible");
                p.style.setProperty("display", "none", "important");
            }
        });
    }

    try {
        var c = ctx();
        if (c.eventSource && c.event_types && c.event_types.MESSAGE_RECEIVED) {
            c.eventSource.on(c.event_types.MESSAGE_RECEIVED, onMsgReceived);
            console.log("[IPE] 已绑定消息事件");
        }
    } catch(e) { console.log("[IPE] 消息事件绑定跳过"); }


    try {
        var d = ipeRootDocument ? ipeRootDocument() : document;
        if (typeof MutationObserver !== "undefined" && d.body && !window.__ipeQuickButtonObserver) {
            window.__ipeQuickButtonObserver = new MutationObserver(function(){
                if (cfg().showQuickEntry && !q("#ipe-chat-quick-entry")) {
                    setTimeout(createChatQuickButton, 100);
                }
            });
            window.__ipeQuickButtonObserver.observe(d.body, { childList: true, subtree: true });
        }
    } catch(e) {}

    /* ---------- 🐚 挂账：Tab 与账本绑定 ---------- */
    try {
        ipeRootDocument().querySelectorAll("[data-ipe-tabbtn]").forEach(function(b){
            b.addEventListener("click", function(ev){
                try { ev.preventDefault(); ev.stopPropagation(); } catch(e){}
                ipeSetActiveTab(b.getAttribute("data-ipe-tabbtn"));
            });
        });
    } catch(e) {}

    [["ipe-ledger-save","panel"],["iped-ledger-save","drawer"]].forEach(function(pair){
        var el = q("#" + pair[0]); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerSaveFromEditor(pair[1]); });
    });

    ["ipe-ledger-reload","iped-ledger-reload"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            ipeLedgerRefreshEditors();
            ipeLedgerStatus("已从存档重新读取", "#6ec577");
        });
    });

    // 浮窗改了同步到抽屉，反之亦然（不落盘，落盘只在「保存账本」）
    [["ipe-ledger-text","iped-ledger-text"],["iped-ledger-text","ipe-ledger-text"]].forEach(function(pair){
        var el = q("#" + pair[0]); if (!el) return;
        el.addEventListener("input", function(){
            var other = q("#" + pair[1]);
            if (other && other.value !== el.value) other.value = el.value;
            ipeLedgerStatus("有未保存的改动", "#c9a227");
        });
    });

    /* ---------- v2 新增控件绑定 ---------- */
    // 强制采用（缩水拦截后）
    ["ipe-ledger-force-btn","iped-ledger-force-btn"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            if (ipeLedgerPending == null) { ipeLedgerStatus("没有待确认的结果", "#c9a227"); return; }
            ipeLedgerCommit(ipeLedgerPending);
            ipeLedgerPending = null;
            ipeLedgerShowForce(false);
            ipeLedgerSync();
            ipeLedgerStatus("已强制采用 \u2713 旧版仍在历史里，可随时回滚", "#6ec577");
        });
    });

    // 版本回滚 / 预览
    ["ipe-ledger-rollback","iped-ledger-rollback"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            var sel = q("#" + (id.indexOf("iped") === 0 ? "iped-ledger-vers" : "ipe-ledger-vers"));
            var i = sel ? Number(sel.value) : NaN;
            if (!Number.isFinite(i)) { ipeLedgerStatus("先选一个历史版本", "#c9a227"); return; }
            if (ipeLedgerRollback(i)) { ipeLedgerSync(); ipeLedgerStatus("已回滚 \u2713 当前版已存入历史", "#6ec577"); }
            else ipeLedgerStatus("回滚失败：找不到该版本", "#d4726a");
        });
    });
    ["ipe-ledger-view","iped-ledger-view"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            var sel = q("#" + (id.indexOf("iped") === 0 ? "iped-ledger-vers" : "ipe-ledger-vers"));
            var i = sel ? Number(sel.value) : NaN;
            var st = ipeLedgerRead();
            var v = Number.isFinite(i) ? st.versions[i] : null;
            if (!v) { ipeLedgerStatus("先选一个历史版本", "#c9a227"); return; }
            ["ipe-ledger-age","iped-ledger-age"].forEach(function(pid){
                var pe = q("#" + pid); if (pe) pe.textContent = "【第 " + v.floor + " 楼时版本 · 仅预览，未回滚】\n" + v.text;
            });
            ipeLedgerStatus("预览中；要真正切过去请点「回滚到此版」", "#c9a227");
        });
    });

    // 三层视野配置
    ["ipe-ledger-rep-floors","iped-ledger-rep-floors"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            var n = parseInt(String(el.value).replace(/[^0-9]/g, ""), 10);
            if (!Number.isFinite(n) || n < 0) n = 0;
            if (n > 2000) n = 2000;
            save("ledgerReportFloors", n);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(n === 0 ? "摘要层已关闭" : "摘要层追溯 " + n + " 楼", "#6ec577");
        });
    });
    [["ipe-ledger-rep-open","ledgerReportOpen"],["iped-ledger-rep-open","ledgerReportOpen"],
     ["ipe-ledger-rep-close","ledgerReportClose"],["iped-ledger-rep-close","ledgerReportClose"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("change", function(){
            save(pr[1], String(el.value || ""));
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("摘要定界符已更新", "#6ec577");
        });
    });
    [["ipe-ledger-tag-open","ledgerTagOpen"],["iped-ledger-tag-open","ledgerTagOpen"],
     ["ipe-ledger-tag-close","ledgerTagClose"],["iped-ledger-tag-close","ledgerTagClose"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("change", function(){
            var v = String(el.value || "").trim();
            if (!v) { ipeLedgerStatus("标签不能留空，已还原", "#c9a227"); ipeLedgerRefreshBotEditors(); return; }
            save(pr[1], v);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("账本标签已改为 " + ipeLedgerTagOpen() + " … " + ipeLedgerTagClose(), "#6ec577");
        });
    });
    ["ipe-ledger-nochange","iped-ledger-nochange"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerAllowNoChange", !!el.checked);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.checked ? "已允许副 AI 回「没变化」" : "已要求每轮都重写完整账本", "#6ec577");
        });
    });
    ["ipe-ledger-tag-reset","iped-ledger-tag-reset"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            save("ledgerTagOpen", IPE_LEDGER_TAG_DEFAULT_OPEN);
            save("ledgerTagClose", IPE_LEDGER_TAG_DEFAULT_CLOSE);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("已恢复成 " + IPE_LEDGER_TAG_DEFAULT_OPEN, "#6ec577");
        });
    });
    ["ipe-ledger-vn","iped-ledger-vn"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerVersionsN", Number(el.value) || 3);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("账本历史带 " + (Number(el.value) || 3) + " 版", "#6ec577");
        });
    });

    // 楼内展示开关
    ["ipe-ledger-inline","iped-ledger-inline"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerInlineShow", !!el.checked);
            ipeLedgerRenderInline();
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.checked ? "楼内展示已开（只进画面）" : "楼内展示已关", "#6ec577");
        });
    });

    /* ---------- 副 AI 区绑定 ---------- */
    ["ipe-ledger-api","iped-ledger-api"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerApiProfile", el.value || "");
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.value ? "挂账 API 已切换" : "挂账 API 已清空", "#6ec577");
        });
    });

    ["ipe-ledger-run","iped-ledger-run"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerRunManual(); });
    });
    // 预览三件套：采用 / 重 roll / 收起
    [["ipe-ledger-adopt","panel"],["iped-ledger-adopt","drawer"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerAdoptPreview(pr[1]); });
    });
    ["ipe-ledger-reroll","iped-ledger-reroll"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerRunManual(); });
    });
    ["ipe-ledger-preview-close","iped-ledger-preview-close"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerHidePreview(); ipeLedgerStatus("已收起，账本没动", "#888"); });
    });

    ["ipe-ledger-test","iped-ledger-test"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", async function(){
            var it = ipeLedgerApiItem();
            if (!it || !it.endpoint) { ipeLedgerStatus("先选一套 API 预设", "#d4726a"); return; }
            ipeLedgerStatus("正在测试…", "#6ec577");
            try {
                var hd = { "Content-Type": "application/json" };
                if (it.key) hd["Authorization"] = "Bearer " + it.key;
                var res = await ipeFetchWithTimeout(buildChatUrl(it.endpoint), {
                    method: "POST", headers: hd,
                    body: JSON.stringify({ model: it.model, messages: [{ role: "user", content: "ping" }], stream: false })
                }, 30000);
                var raw = await res.text();
                if (!res.ok) { ipeLedgerStatus("连接失败 " + res.status + "：" + raw.slice(0, 100), "#d4726a"); return; }
                ipeLedgerStatus("连接正常 \u2713 模型 " + (it.model || "?"), "#6ec577");
            } catch(e) { ipeLedgerStatus("连接失败：" + (e && e.message ? e.message : e), "#d4726a"); }
        });
    });

    ["ipe-ledger-auto","iped-ledger-auto"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerAutoRun", !!el.checked);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.checked ? "自动挂账已开（每来一楼跑一次）" : "自动挂账已关", "#6ec577");
        });
    });

    // 两套预设：值 / 名称 / 新增 / 删除
    [["ipe-ledger-prompt", LP], ["iped-ledger-prompt", LP],
     ["ipe-ledger-note", LN],   ["iped-ledger-note", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("input", function(){
            ipePresetSetValue.apply(null, pr[1].concat([el.value]));
            var other = q("#" + (pr[0].charAt(0) === "i" && pr[0].indexOf("iped") === 0
                ? pr[0].replace("iped-", "ipe-") : pr[0].replace("ipe-", "iped-")));
            if (other && other !== el) other.value = el.value;
        });
    });
    [["ipe-ledger-prompt-name", LP], ["iped-ledger-prompt-name", LP],
     ["ipe-ledger-note-name", LN],   ["iped-ledger-note-name", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("input", function(){
            ipePresetSetName.apply(null, pr[1].concat([el.value]));
            ipeLedgerRefreshBotEditors();
        });
    });
    [["ipe-ledger-prompt-slot", LP], ["iped-ledger-prompt-slot", LP],
     ["ipe-ledger-note-slot", LN],   ["iped-ledger-note-slot", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("change", function(){
            save(pr[1][1], el.value);
            ipeLedgerRefreshBotEditors();
        });
    });
    [["ipe-ledger-prompt-add", LP, "lp"], ["iped-ledger-prompt-add", LP, "lp"],
     ["ipe-ledger-note-add", LN, "ln"],   ["iped-ledger-note-add", LN, "ln"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("click", function(){
            ipePresetAdd.apply(null, pr[1].concat([pr[2]]));
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("已新增预设", "#6ec577");
        });
    });
    [["ipe-ledger-prompt-del", LP], ["iped-ledger-prompt-del", LP],
     ["ipe-ledger-note-del", LN],   ["iped-ledger-note-del", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("click", function(){
            var ok = ipePresetDelete.apply(null, pr[1]);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(ok ? "已删除" : "至少要留一个预设", ok ? "#6ec577" : "#c9a227");
        });
    });
    ["ipe-ledger-prompt-reset","iped-ledger-prompt-reset"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            ipePresetSetValue.apply(null, LP.concat([IPE_LEDGER_PROMPT_DEFAULT]));
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("已恢复默认挂账规则（v2 失格化版）", "#6ec577");
        });
    });

    // 补充指令两边同步（不落盘，一次性）
    [["ipe-ledger-extra","iped-ledger-extra"],["iped-ledger-extra","ipe-ledger-extra"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("input", function(){
            var other = q("#" + pr[1]);
            if (other && other.value !== el.value) other.value = el.value;
        });
    });

    // User 指令：两边同步（落盘走「保存账本」）
    [["ipe-ledger-order","iped-ledger-order"],["iped-ledger-order","ipe-ledger-order"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("input", function(){
            var other = q("#" + pr[1]);
            if (other && other.value !== el.value) other.value = el.value;
            ipeLedgerStatus("User 指令有未保存的改动", "#c9a227");
        });
    });

    // 深度下拉：0-10 填充 + 切换即生效
    ["ipe-ledger-ep-depth","iped-ledger-ep-depth"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        if (!el.options || !el.options.length) {
            var html = "";
            for (var i = 0; i <= 10; i++) html += '<option value="'+i+'">'+i+(i===2?"（默认）":"")+'</option>';
            el.innerHTML = html;
        }
        el.value = String(ipeLedgerEpDepth());
        el.addEventListener("change", function(){
            save("ledgerEpDepth", Number(el.value) || 0);
            ipeLedgerSync();
            ipeLedgerStatus("注入深度已改为 " + ipeLedgerEpDepth(), "#6ec577");
        });
    });

    ["ipe-ledger-ep-enabled","iped-ledger-ep-enabled"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.checked = cfg().ledgerEpEnabled !== false;
        el.addEventListener("change", function(){
            save("ledgerEpEnabled", !!el.checked);
            ipeLedgerSync();
            ipeLedgerStatus(el.checked ? "贴耳已开启" : "贴耳已关闭（注入内容已清空）", "#6ec577");
        });
    });

    // 换聊天 → 账本跟着换 + 重贴耳
    try {
        var cc = ctx();
        if (cc.eventSource && cc.event_types && cc.event_types.CHAT_CHANGED) {
            cc.eventSource.on(cc.event_types.CHAT_CHANGED, function(){
                setTimeout(function(){
                    ipeLedgerSync();
                    ipeLedgerStatus("已切换到本聊天的账本", "#6ec577");
                }, 200);
            });
            console.log("[IPE] 已绑定换聊天事件");
        }
    } catch(e) { console.log("[IPE] 换聊天事件绑定跳过"); }

    // 每来一楼刷新一次楼层年龄（独立监听，不动生图那条 onMsgReceived）
    try {
        var cm = ctx();
        if (cm.eventSource && cm.event_types && cm.event_types.MESSAGE_RECEIVED) {
            cm.eventSource.on(cm.event_types.MESSAGE_RECEIVED, function(){
                setTimeout(function(){
                    ipeLedgerSync();
                    if (cfg().ledgerAutoRun === true) ipeLedgerRun(null, true);
                }, 500);
            });
            console.log("[IPE] 挂账已绑定消息事件");
        }
    } catch(e) {}

    ipeRefreshTemplateEditors();
}

function buildInjectTag(desc) {
    var tpl = ipeGetTemplateValue() || cfg().baseTemplate || "image###{Description}###";
    return tpl.indexOf("{Description}") >= 0 ? tpl.replace("{Description}", desc) : tpl + desc;
}

function injectDescToMessage(desc, targetIdx) {
    var idx = typeof targetIdx === "number" ? targetIdx : currentIdx;
    if (idx < 0) throw new Error("消息不存在");

    var pv=q("#ipe-preview-text"), pvd=q("#iped-preview-text");
    if (!desc) desc = (pv&&pv.value)||(pvd&&pvd.value)||currentDesc;
    if (!desc) throw new Error("没有内容");

    var c = ctx();
    var msg = c.chat[idx];
    if (!msg) throw new Error("消息不存在");

    var tag = buildInjectTag(desc);
    if (String(msg.mes || "").indexOf(tag) >= 0) {
        return { injected: false, reason: "duplicate", tag: tag };
    }

    msg.mes = String(msg.mes || "").trimEnd() + "\n\n" + tag;
    if (typeof c.saveChat === "function") c.saveChat();

    var el=q('#chat .mes[mesid="'+idx+'"] .mes_text');
    if(el && el.innerHTML.indexOf(esc(tag)) < 0) el.insertAdjacentHTML("beforeend", "<p>"+esc(tag)+"</p>");

    return { injected: true, tag: tag };
}

function onMsgReceived(idx) {
    if (!cfg().enabled) return;
    try {
        var msg=ctx().chat[idx];
        if(!msg||msg.is_user) return;

        pendingAutoIdx = idx;
        currentIdx = idx;

        if (autoTimer) clearTimeout(autoTimer);

        var delay = Number(cfg().autoInjectDelay || 1800);
        if (delay < 500) delay = 500;

        autoTimer = setTimeout(function() {
            runPendingAutoExtract();
        }, delay);

        setStatus("已捕捉新正文，等待自动提取…", "#6ec577");
    } catch(e){}
}

function runPendingAutoExtract() {
    if (pendingAutoIdx < 0) return;

    if (processing) {
        setTimeout(runPendingAutoExtract, 1200);
        return;
    }

    try {
        var idx = pendingAutoIdx;
        pendingAutoIdx = -1;

        var msg = ctx().chat[idx];
        if (!msg || msg.is_user) return;

        currentIdx = idx;
        runExtract(msg.mes, "", !!cfg().autoInject, idx);
    } catch(e) {
        setStatus("自动提取失败：" + e.message, "#d4726a");
    }
}

async function onExtract() {
    if (processing) return;
    try {
        var chat=ctx().chat; if(!chat||!chat.length){setStatus("无法读取","#d4726a");return;}
        for(var i=chat.length-1;i>=0;i--){if(!chat[i].is_user){currentIdx=i;await runExtract(chat[i].mes, "", false, i);return;}}
        setStatus("未找到 AI 消息","#d4726a");
    } catch(e){setStatus("错误: "+e.message,"#d4726a");}
}

async function runExtract(text, supplement, autoInjectNow, targetIdx, retryAttempt) {
    retryAttempt = Number(retryAttempt || 0);
    if (retryAttempt === 0) ipeClearApiRetry();

    processing = true;
    var ball = q("#ipe-ball"); if(ball)ball.classList.add("processing");
    setStatus(retryAttempt > 0 ? "正在自动重试提取…" : "正在提取…","#6ec577"); setBtns(false,false);
    try {
        var desc = await callAPI(text, supplement||"");
        currentDesc = desc; setPreview(desc);

        if (autoInjectNow) {
            var result = injectDescToMessage(desc, typeof targetIdx === "number" ? targetIdx : currentIdx);
            if (result && result.injected) {
                setStatus("提取完成并已自动注入 ✓","#6ec577");
                setBtns(false,false);
                var s1=q("#ipe-supplement"),s2=q("#iped-supplement");
                if(s1)s1.value=""; if(s2)s2.value="";
                if(ball) ball.classList.remove("has-result");
            } else {
                setStatus("提取完成，跳过自动注入（可能已注入）","#6ec577");
                setBtns(true,true);
                if(ball) ball.classList.add("has-result");
            }
        } else {
            setStatus("提取完成 — 可编辑后确认注入","#6ec577");
            setBtns(true,true);
            if(ball) ball.classList.add("has-result");
        }

        if(ball){ball.classList.remove("processing");}
        var s=q("#ipe-section-preview"); if(s)s.classList.remove("collapsed");
    } catch(e) {
        console.error("[IPE]",e);
        var userAbort = e && e.name === "AbortError" && ipeUserAbortRequested;
        var msg = userAbort ? "请求已被打断" : ipeErrorText(e);
        setStatus("失败: "+msg,"#d4726a");
        setBtns(true,false); if(ball)ball.classList.remove("processing");

        if (ipeShouldRetryApiError(e, userAbort)) {
            ipeScheduleApiRetry(text, supplement || "", !!autoInjectNow, targetIdx, retryAttempt, msg);
        }
    }
    ipeAbortController = null;
    ipeUserAbortRequested = false;
    ipeSetStopButtonsState(false);
    processing = false;
}

async function onReroll() {
    if(processing||currentIdx<0) return;
    try{var msg=ctx().chat[currentIdx];if(!msg)return;
    var sup=q("#ipe-supplement");var supd=q("#iped-supplement");
    await runExtract(msg.mes,(sup&&sup.value)||(supd&&supd.value)||"", false, currentIdx);}catch(e){}
}

function onInject() {
    if(currentIdx<0) return;
    try {
        var result = injectDescToMessage("", currentIdx);
        if (result && result.injected) {
            setStatus("已注入 ✓","#6ec577"); setBtns(false,false);
            var ball=q("#ipe-ball"); if(ball)ball.classList.remove("has-result");
            var s1=q("#ipe-supplement"),s2=q("#iped-supplement");
            if(s1)s1.value=""; if(s2)s2.value="";
            console.log("[IPE] 注入 #"+currentIdx);
        } else {
            setStatus("已存在相同注入，跳过","#6ec577");
        }
    } catch(e){console.error("[IPE]",e);setStatus("注入失败: "+e.message,"#d4726a");}
}

function init() {
    if (initialized) return;
    try { loadSettings(); createUI(); ipeRemoveOldFloatingBits(); ipeEnsureQuickButtonLater(); initialized=true; console.log("[IPE] ✓ 已加载"); }
    catch(e) { console.error("[IPE] 初始化失败:",e); }
}

function waitAndInit() {
    if (typeof SillyTavern === "undefined" || !SillyTavern.getContext) {
        setTimeout(waitAndInit, 300); return;
    }
    try {
        var c = SillyTavern.getContext();
        c.eventSource.on(c.event_types.APP_READY, function(){ setTimeout(init, 100); });
    } catch(e) { setTimeout(init, 2000); }
}

waitAndInit();

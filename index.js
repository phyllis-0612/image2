/*
 *  Image Prompt Extractor v1.8.7
 *  SillyTavern 1.18 — SillyTavern.getContext() + fetch API
 */

const EXT_NAME = "image-prompt-extractor";
var IPE_VERSION = "2.19.0";
/* 内置生图包裹（2.14.0）：默认模板、新建模板的初值、挂账剥标签的兜底，都认这一个。
   之前是 image###…###；老聊天里已经注入过的 image### 楼仍按 IPE_LEGACY_IMAGE_TEMPLATE 剥，不留脏正文。 */
var IPE_DEFAULT_IMAGE_TEMPLATE = "<draw>{Description}</draw>";
var IPE_LEGACY_IMAGE_TEMPLATE  = "image###{Description}###";
/* 模板里认得的占位符：{Description} 拿整段 / 没单放的层，其余五个是分层占位符 */
var IPE_IMG_TPL_PH_RE = /\{(?:Description|Camera|Env|Mood|Chars|Pose)\}/g;
function ipeImgTemplatePlaceholders(t) {
    var out = [], m;
    IPE_IMG_TPL_PH_RE.lastIndex = 0;
    while ((m = IPE_IMG_TPL_PH_RE.exec(String(t || "")))) out.push({ i: m.index, e: m.index + m[0].length });
    return out;
}
/* 模板整体是一对 <xxx>…</xxx> 包着的（默认 <draw>）就返回标签名，否则空串 */
function ipeImgTemplateEnvelope(t) {
    var m = String(t || "").match(/^\s*<([A-Za-z][\w-]*)\s*>[\s\S]*<\/\1\s*>\s*$/);
    return m ? m[1] : "";
}
/* 填模板（2.14.1 融合规则）：vals 是 占位符 → 值。
   多行模板里，某一行的占位符全部填成空，这一整行连同 "Setting:" 这种标签一起不输出。
   于是一张模板同时服务两条路：分层成功时五行各就各位、{Description} 那行消失；
   没分层时五行连标签一起消失、整段落在 {Description} 那行。单行模板不收行。
   用回调替换，desc 里带 $& 之类也不会被 replace 当模式解释。 */
function ipeImgFillTemplate(tpl, vals) {
    var lines = String(tpl == null ? "" : tpl).split("\n");
    var multi = lines.length > 1;
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        var hadPh = false, allEmpty = true;
        var filled = lines[i].replace(IPE_IMG_TPL_PH_RE, function(m){
            if (!Object.prototype.hasOwnProperty.call(vals, m)) return m;
            hadPh = true;
            var v = String(vals[m] == null ? "" : vals[m]);
            if (v.trim()) allEmpty = false;
            return v;
        });
        if (multi && hadPh && allEmpty) continue;
        out.push(filled);
    }
    return out.join("\n");
}
const DEFAULTS = {
    enabled: true,
    mistTheme: false,   // v1.8.7 开灯：莫兰迪雾蓝浅色皮，默认关（暗色）
    autoInject: false,
    autoInjectDelay: 1800,
    supplementPresetsJson: "[]",   // 2.16.0 补充指令常用短语
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
    ledgerWaitBeforeSend: true,   // 2.18.0 发消息前等挂账跑完（generate_interceptor）
    ledgerWaitMaxSec: 60,
    ledgerRetryOnce: true,        // 2.18.0 网络错 / 5xx / 超时 自动重试一次
    ledgerRetryDelayMs: 3000,
    ledgerCompressPrompt: "",       // 2.19.0 压缩指令，空 = 内置默认
    ledgerCompressWarnChars: 3000,  // 账本超过这么多字提醒可以压缩
    ledgerApiProfile: "",
    ledgerReportFloors: 10, ledgerReportOpen: "<report>", ledgerReportClose: "</report>",
    ledgerVersionsN: 3,
    ledgerTagOpen: "<ledger>", ledgerTagClose: "</ledger>",
    ledgerAllowNoChange: false,
    ledgerInlineShow: true,
    ledgerPromptPresetsJson: "", activeLedgerPrompt: "lp_1",
    ledgerNotePresetsJson: "",   activeLedgerNote: "ln_1",
    ledgerAutoRun: false,
    ledgerAutoOffReason: "",
    ledgerModeEnabled: false,      // 2.13.1 场景模式：与枢轨共用楼尾路由标记
    ledgerModeTag: "route, ipe_mode", // 新标记优先，兼容 2.13.0 的 <ipe_mode>
    ledgerPromptNsfwPresetsJson: "", activeLedgerPromptNsfw: "lpn_1",   // 2.13.3 NSFW 槽：自己的预设库，选哪个就是哪个
    ledgerModeManual: "",          // 手动指定：空 = 自动听标记；"normal" 或某个模式名 = 一直用它       // 2.12.4 自动挂账被插件自己关掉的原因：fail（连续失败）/ shrink（疑似事故）；人手动开回去就清空
    ledgerStream: true,            // 2.10.0 流式接收：思考模型边想边流，中转不会因空闲把连接掐断
    ledgerIdleTimeout: 300,        // 秒。「连续多少秒一个字节都没收到」才判死；0 = 永不
    ledgerReasoningEffort: "",     // reasoning_effort；空 = 不发，用模型默认
    ledgerMaxTokens: 0,            // 输出上限；0 = 不发。思考模型发 max_completion_tokens，普通模型发 max_tokens
    imgLayered: false,             // 2.11.0 分层生图：一次请求四层输出（镜头 / 环境 / 人物 / 动作）
    imgLockCamera: false, imgLockEnv: false, imgLockMood: false, imgLockChars: false, imgLockPose: false
};
let currentDesc = "", currentIdx = -1, processing = false, initialized = false;
let ipeAbortController = null;
let ipeUserAbortRequested = false;
let ipeRetryTimer = null;
let autoTimer = null, pendingAutoIdx = -1;

const IPE_CREDITS = "ripple & GPT & Claude Fable 5.1";
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
var IPE_LEDGER_VER_MAX   = 10;               // 兜底极限；实际库存跟随旋钮，见 ipeLedgerVerMax()

/* 库存深度 = 界面那个 1~5 旋钮。旋钮是"总账数"（历史 + 现任），
   所以历史区上限 = 旋钮 - 1。一层一账、滚动淘汰，删太多全碎就重建。 */
function ipeLedgerVerMax() {
    var n = 3;
    try {
        var v = Number(cfg().ledgerVersionsN);
        if (Number.isFinite(v)) n = v;
    } catch(e) {}
    if (n < 1) n = 1;
    if (n > 5) n = 5;
    return n - 1;
}
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
function ipeCharName() {
    try { var c = ctx(); return String(c.name2 || (c.characters && c.characters[c.characterId] && c.characters[c.characterId].name) || ""); } catch(e) { return ""; }
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
var IPE_LEDGER_MIRROR_MAX_CHATS = 30;   // 镜像只留最近活跃的这么多个聊天，主档在 chat_metadata 里不受影响
function ipeLedgerPruneMirror(all, keepN) {
    var keys = Object.keys(all || {});
    if (keys.length <= keepN) return all;
    keys.sort(function(a, b){ return (Number(all[b] && all[b].updatedAt) || 0) - (Number(all[a] && all[a].updatedAt) || 0); });
    var out = {};
    for (var i = 0; i < keepN && i < keys.length; i++) out[keys[i]] = all[keys[i]];
    return out;
}
function ipeWriteJsonLS(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj || {})); return true; }
    catch(e) {
        // 撞到配额：只对账本镜像做减法——先砍到 10 个聊天，再砍到只剩当前这个，仍不行才放弃
        if (key !== IPE_LEDGER_LS_KEY) return false;
        try {
            var cur = ipeChatKey();
            var shrunk = ipeLedgerPruneMirror(obj, 10);
            try { localStorage.setItem(key, JSON.stringify(shrunk)); return true; } catch(e2) {}
            var only = {}; if (obj && obj[cur]) only[cur] = obj[cur];
            localStorage.setItem(key, JSON.stringify(only)); return true;
        } catch(e3) { return false; }
    }
}

/* ---- v2 结构规整：每次读都过，改 schema 不炸 ---- */
/* 里程碑（2.17.0）：最近 cap 版之外，每 10 楼再留一版（同一段留最新那版），最多 12 个。
   历史默认只留 2 版，倒退十几楼就没底稿可退、整本清空只剩近几楼摘要；有里程碑就能退到最近的那一版。
   副 AI 只喂最近几版（ipeLedgerHistoryBlock 只切前 n-1），里程碑不进 prompt，只是后悔药。 */
var IPE_LEDGER_MILESTONE_SPAN = 10;
var IPE_LEDGER_MILESTONE_MAX  = 12;
/* 第二层里程碑（2.18.1）：每 100 楼一段，只在那一段里连一个 10 楼里程碑都没有时才留一版（同段留最新），最多 10 个。
   12 个 10 楼里程碑只罩得住最近 120 楼；从一千多楼删回一百多楼，靠这层退。 */
var IPE_LEDGER_MILESTONE2_SPAN = 100;
var IPE_LEDGER_MILESTONE2_MAX  = 10;
/* 近处全留（2.18.2）：存档至少留最近 6 版，之后才跳到每 10 楼一版。
   以前只留「让它看最近几版」那 2 版，105 楼删回 95 楼要退到 88；现在退到 94。
   副 AI 仍只喂「让它看最近几版」那几版，多存的只是后悔药。 */
var IPE_LEDGER_RECENT_KEEP = 6;
function ipeLedgerNormalize(raw) {
    var o = (raw && typeof raw === "object") ? raw : {};
    var vs = Array.isArray(o.versions) ? o.versions : [];
    var out = [];
    var cap = ipeLedgerVerMax();
    var keepRecent = cap < 1 ? 0 : Math.max(cap, IPE_LEDGER_RECENT_KEEP);   // 历史关到只留现任：什么都不存
    var seenFloor = {}, buckets = {}, milestones = 0;   // 一层一账：同楼多版只留最新（数组头部即最新）
    var covered100 = {}, milestones2 = 0;                // 每个 100 楼段里有没有已留的版本（现任外的 cap 版 + 10 楼里程碑都算）
    for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (!v) continue;
        var t = String(v.text == null ? "" : v.text);
        if (!t.trim()) continue;
        var f = Number.isFinite(Number(v.floor)) ? Number(v.floor) : -1;
        var tag = String(v.tag || "");
        if (f >= 0) {
            var dk = f + "|" + tag;                    // 「压缩前」备份和同楼的正常版本不算重复
            if (seenFloor[dk]) continue;
            seenFloor[dk] = true;
        }
        var item = { floor: f, ts: Number.isFinite(Number(v.ts)) ? Number(v.ts) : 0, text: t };
        if (tag) item.tag = tag;
        var b100 = f >= 0 ? Math.floor(f / IPE_LEDGER_MILESTONE2_SPAN) : -1;
        var b = f >= 0 ? Math.floor(f / IPE_LEDGER_MILESTONE_SPAN) : -1;
        if (out.length < keepRecent) {
            out.push(item);
            if (b100 >= 0) { covered100[b100] = true; buckets[b] = true; }   // 近处已有的段，里程碑不再重复留
            continue;
        }
        if (f < 0 || cap < 1) continue;
        if (milestones < IPE_LEDGER_MILESTONE_MAX && !buckets[b]) {
            buckets[b] = true; milestones++; covered100[b100] = true;
            out.push(item); continue;
        }
        if (milestones2 < IPE_LEDGER_MILESTONE2_MAX && !covered100[b100]) {     // 这一百楼里一版都没有：留最新的这版
            covered100[b100] = true; milestones2++;
            out.push(item);
        }
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
            all[ipeChatKey()] = Object.assign({}, clean, { who: ipeCharName(), floors: ipeFloorNo() });   // 镜像多记角色名，「继承账本」列表用
            all = ipeLedgerPruneMirror(all, IPE_LEDGER_MIRROR_MAX_CHATS);
            lsOk = ipeWriteJsonLS(IPE_LEDGER_LS_KEY, all) !== false;
        } catch(eL) { lsOk = false; }
    }
    return { meta: metaOk, ls: lsOk };
}

// 落新版：一层一账。上一楼的账入历史；同一楼重挂（重roll后再采用）直接替换，旧稿不留。
/* atFloor：正文实际取自哪一层，就盖哪一层的戳。
   末楼被藏起来时 ipeLedgerRun 会往下找活楼，读的是第 8 层正文，
   而 ipeFloorNo() 还是 chat.length=10——不传就会盖错戳，对账全靠楼号，一错就误伤。 */
function ipeLedgerCommit(text, atFloor) {
    var nowFloor = Number.isFinite(Number(atFloor)) && Number(atFloor) > 0
                 ? Number(atFloor) : ipeFloorNo();
    ipeLedgerReconcile(Math.max(nowFloor, ipeFloorNo()), { silent: true });  // 落账前先对账，底下全是活楼
    var st = ipeLedgerRead();
    var old = String(st.current || "");
    if (old.trim() && st.lastFloor >= 0 && st.lastFloor !== nowFloor) {
        // lastFloor < nowFloor：正常翻楼，旧账入历史。
        // lastFloor > nowFloor：预览开着时自动挂账已经落了更新的一楼，现在采用的是旧楼稿——
        // 新账不能就这么被静默覆盖掉，也进历史，后悔药里找得回。
        st.versions.unshift({ floor: st.lastFloor, ts: Date.now(), text: old });
    }
    st.current   = String(text || "");
    st.lastFloor = nowFloor;
    return ipeLedgerSave(st);
}

/* ---- 导出 / 导入 ----
   账本只活在 chat_metadata + localStorage 镜像里，聊天一删就没了，
   也没法挪到别的聊天。这两个函数不碰任何现有逻辑，纯进出。 */
function ipeLedgerExport() {
    var st = ipeLedgerRead();
    var pack = {
        _fmt: "ipe-ledger", _v: 2,
        exportedAt: new Date().toISOString(),
        chatKey: ipeChatKey(),
        floorAtExport: ipeFloorNo(),
        data: st
    };
    var name = "ipe-ledger-" + String(ipeChatKey() || "chat").replace(/[^\w.-]+/g, "_")
             + "-" + new Date().toISOString().slice(0, 10) + ".json";
    try {
        var blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch(e){} }, 200);
        ipeLedgerStatus("已导出 \u2713 " + name + "（当前版 + " + st.versions.length + " 个历史版）", "#6ec577");
    } catch(e) {
        ipeLedgerStatus("导出失败：" + (e && e.message ? e.message : String(e)), "#d4726a");
    }
}

function ipeLedgerImportText(txt) {
    var pack;
    try { pack = JSON.parse(String(txt || "")); }
    catch(e) { ipeLedgerStatus("导入失败：这不是合法 JSON", "#d4726a"); return false; }

    // 容两种：整包（有 _fmt）或裸账本对象
    var raw = (pack && pack._fmt === "ipe-ledger" && pack.data) ? pack.data : pack;
    if (!raw || typeof raw !== "object" || typeof raw.current !== "string") {
        ipeLedgerStatus("导入失败：里面没有账本正文（缺 current 字段）", "#d4726a");
        return false;
    }

    // 覆盖前先把现任存进历史，别让人一键抹掉自己攒的东西
    try {
        var cur = ipeLedgerRead();
        if (String(cur.current || "").trim()) {
            var bak = ipeLedgerNormalize(raw);
            bak.versions.unshift({ floor: cur.lastFloor, ts: Date.now(), text: String(cur.current) });
            ipeLedgerSave(ipeLedgerNormalize(bak));
        } else {
            ipeLedgerSave(ipeLedgerNormalize(raw));
        }
    } catch(e) {
        ipeLedgerStatus("导入失败：" + (e && e.message ? e.message : String(e)), "#d4726a");
        return false;
    }

    ipeLedgerSync();
    var st2 = ipeLedgerRead();
    ipeLedgerStatus("已导入 \u2713 当前版停在第 " + st2.lastFloor + " 楼，"
        + "原本的账本已存进历史可回滚。下一轮会自动对账到实际楼层。", "#6ec577");
    return true;
}

function ipeLedgerRollback(idx) {
    var st = ipeLedgerRead();
    var v = st.versions[idx];
    if (!v) return false;
    var old = String(st.current || "");
    st.versions.splice(idx, 1);
    // 一层一账：现任与目标不同楼才把现任送回历史，同楼就是替换
    if (old.trim() && st.lastFloor >= 0 && st.lastFloor !== v.floor) {
        st.versions.unshift({ floor: st.lastFloor, ts: Date.now(), text: old });
    }
    st.current = v.text;
    if (v.floor >= 0) st.lastFloor = v.floor;         // 账跟楼走，回滚后楼号也跟着回去
    ipeLedgerSave(st);
    return true;
}

/* ============================================================
   🐚 楼层对账 · 账跟楼走，楼没了账就碎
   limit = 允许存活的最大楼号。floor > limit 的版本（含现任）粉碎——真删，不留残余。
   现任账本永远是幸存版本里楼号最大的那份；全军覆没就回到"第一次挂账"，
   下轮副 AI 凭实时上下文 + report 重建。
   删楼场景 limit = 当前楼层数，挂账/刷新时自动跑，用户零操作；
   重roll 场景由事件或兜底钮带更小的 limit 进来（连当前楼的账一起碎）。
   ============================================================ */
function ipeLedgerReconcile(limit, opts) {
    opts = opts || {};
    try {
        if (!ipeChatKeyReady()) return false;          // 聊天没就绪不动账，防初始化竞态误杀
        var c = ctx();
        if (!c || !Array.isArray(c.chat)) return false;
        // 换聊天/清屏瞬间 chat 可能短暂为空：这时 limit=0 会把整本账连历史一起碎光。
        // 楼都没有就不对账，等楼回来再说。
        if (!c.chat.length) return false;
    } catch(e0) { return false; }
    if (!Number.isFinite(Number(limit)) || Number(limit) < 0) limit = ipeFloorNo();
    limit = Number(limit);

    var st = ipeLedgerRead();
    var smashed = 0;

    var keep = [];
    for (var i = 0; i < st.versions.length; i++) {
        var v = st.versions[i];
        if (v.floor >= 0 && v.floor > limit) { smashed++; continue; }
        keep.push(v);
    }
    st.versions = keep;

    var demoted = false;
    if (String(st.current || "").trim() && st.lastFloor > limit) {
        st.current = ""; st.lastFloor = -1; smashed++; demoted = true;
        var bi = -1, bf = -1;                          // 幸存者里楼号最大的顶上当现任
        for (var k = 0; k < st.versions.length; k++) {
            if (st.versions[k].floor > bf) { bf = st.versions[k].floor; bi = k; }
        }
        if (bi >= 0) {
            var v2 = st.versions.splice(bi, 1)[0];
            st.current = v2.text;
            st.lastFloor = v2.floor;
        }
    }

    if (!smashed) return false;
    ipeLedgerSave(st);
    try { console.log("[IPE] 楼层对账", { limit: limit, smashed: smashed, currentFloor: st.lastFloor }); } catch(eL) {}
    if (!opts.silent) {
        var msg = "楼层对账：碎掉 " + smashed + " 份已不存在楼层的账";
        if (demoted) msg += (st.lastFloor >= 0
            ? "，已自动回退到第 " + st.lastFloor + " 楼的账"
            : "，账本已清空，下轮挂账会重建");
        ipeLedgerStatus(msg, "#c9a227");
    }
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

function ipeLedgerReportBlock(skipFloor) {
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
        if (Number.isFinite(Number(skipFloor)) && i === Number(skipFloor) - 1) continue;   // 本轮那楼已作正文全量投喂，摘要层不重复
        var txt = String(msg.mes || "");
        if (!txt) continue;
        re.lastIndex = 0;
        var hit;
        while ((hit = re.exec(txt)) !== null) {
            var body = ipeLedgerStripImageTag(String(hit[1] || "")).trim();
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
    // 「压缩前」备份不喂：刚压完就把压缩前的全本喂回去，副 AI 会照着重新写长
    var vs = st.versions.filter(function(v){ return !v.tag; }).slice(0, Math.max(0, n - 1));   // 旧版
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
/* 生图会把 <draw>…</draw>（2.14.0 前是 image###…###）追加进 msg.mes。有 <content> 标签的楼不受影响
   （只取标签内），没有标签的楼会兜底返回整条，那串英文 tag 就混进挂账正文了。
   这里按用户当前所有生图模板的字面前后缀剥掉，模板改了也跟着变。
   占位符不只 {Description}：只放 {Camera} {Env} {Mood} {Chars} {Pose} 的分层模板，
   前缀 = 第一个占位符之前，后缀 = 最后一个占位符之后（以前这种模板整段当字面量找，永远找不到，
   几千字的风格正文就原样喂进了挂账）。
   模板整体是 <xxx>…</xxx> 一对标签包着的，直接按标签对剥：模板正文后来改过、旧楼是老版模板注入的，一样认得。 */
function ipeLedgerStripImageTag(text) {
    var out = String(text || "");
    var tpls = [];
    try {
        var list = ipeGetBaseTemplates();
        if (Array.isArray(list)) list.forEach(function(x){ if (x && x.value) tpls.push(String(x.value)); });
    } catch(e) {}
    try { if (cfg().baseTemplate) tpls.push(String(cfg().baseTemplate)); } catch(e) {}
    tpls.push(IPE_DEFAULT_IMAGE_TEMPLATE);
    tpls.push(IPE_LEGACY_IMAGE_TEMPLATE);

    var esc = function(x){ return String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
    /* 注入永远追加在楼尾（injectDescToMessage 只做 trimEnd + "\n\n" + tag）。
       所以「只有前缀」和「模板没占位符」这两种，都从**最后一次**出现的位置剥到楼尾，
       而不是从第一次出现就一路剥——正文里恰好有同样的字，不会被误伤。 */
    var stripTail = function(str, marker) {
        var k = str.lastIndexOf(marker);
        if (k < 0) return str;
        return str.slice(0, k).replace(/\s+$/, "");
    };

    var seen = {};
    for (var i = 0; i < tpls.length; i++) {
        var t = tpls[i];
        if (!t || seen[t]) continue;
        seen[t] = true;
        var phs = ipeImgTemplatePlaceholders(t);
        if (!phs.length) {
            // buildInjectTag 对无占位符模板是 tpl + desc 直接拼接：整个模板字面量就是前缀
            if (t.trim()) out = stripTail(out, t);
            continue;
        }
        var envTag = ipeImgTemplateEnvelope(t);
        if (envTag) {
            // <draw>…</draw> 这类整体包裹：按标签对剥，不依赖中间那几千字风格正文一字不差
            try { out = out.replace(new RegExp("\\s*<" + esc(envTag) + "\\s*>[\\s\\S]*?<\\/" + esc(envTag) + "\\s*>", "g"), ""); } catch(e) {}
            continue;
        }
        var pre = t.slice(0, phs[0].i), suf = t.slice(phs[phs.length - 1].e);
        if (t.indexOf("\n") >= 0) {
            // 多行模板：占位符全空的行会被 ipeImgFillTemplate 整行收掉，"Setting: " 这种半行前缀可能不在正文里。
            // 前缀退到第一个占位符所在行之前、后缀退到最后一个占位符所在行之后，收不收行都对得上。
            var nl0 = pre.lastIndexOf("\n"), nl1 = suf.indexOf("\n");
            pre = nl0 >= 0 ? pre.slice(0, nl0 + 1) : "";
            suf = nl1 >= 0 ? suf.slice(nl1) : "";
        }
        if (!pre && !suf) continue;
        if (pre && suf) {
            try { out = out.replace(new RegExp("\\s*" + esc(pre) + "[\\s\\S]*?" + esc(suf), "g"), ""); } catch(e) {}
        } else if (pre) {
            out = stripTail(out, pre);
        } else {
            // 只有后缀：desc + suf 追加在楼尾，没有可靠起点，只能剥掉最后一段（最后一个空行之后到后缀）
            try { out = out.replace(new RegExp("\\n\\n(?:(?!\\n\\n)[\\s\\S])*?" + esc(suf) + "\\s*$"), ""); } catch(e) {}
        }
    }
    return out;
}

function ipeLedgerBuildUser(text, extra, atFloor) {
    try { ipeLedgerReconcile(ipeFloorNo(), { silent: true }); } catch(eRec) {}   // 副 AI 只许拿活楼的账当底稿
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
    var floorNo = (Number.isFinite(Number(atFloor)) && Number(atFloor) > 0) ? Number(atFloor) : ipeFloorNo();
    var rep = ipeLedgerReportBlock(floorNo);
    if (rep) u += "\u3010\u5267\u60c5\u6458\u8981 \u00b7 \u8fd1 " + Number(cfg().ledgerReportFloors || 0) + " \u697c \u00b7 \u65e7\u2192\u65b0\u3011\n" + rep + "\n\n";

    var his = ipeLedgerHistoryBlock();
    if (his) u += "\u3010\u8d26\u672c\u5386\u53f2 \u00b7 \u65e7\u2192\u65b0\u3011\n" + his + "\n\n";

    u += "\u3010\u5f53\u524d\u697c\u5c42\u3011\u7b2c " + floorNo + " \u697c\n\n";   // 正文取自哪层就报哪层，藏末楼时不再虚报 chat.length
    u += "\u3010\u672c\u8f6e\u6b63\u6587\u3011\n" + ipeTrimSourceText(ipeLedgerStripModeTag(ipeLedgerStripImageTag(text)));
    ipeLedgerLastUserChars = u.length;
    return u;
}

// 面板灰字：不发请求，本地干跑一次拼装看有多大
function ipeLedgerEstimateChars() {
    try {
        var chat = ctx().chat || [];
        var msg = "", fl = 0;
        for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m.mes; fl = i + 1; break; }
        }
        var sys = ipeLedgerSystemText().length;
        var usr = ipeLedgerBuildUser(msg, "", fl).length;
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

/* ---- 思考模型识别 ----
   o 系列 / gpt-5 系列不吃非默认 temperature，硬发 0.2 官方直连立刻 400。
   gpt-5-chat-latest 是例外：它不思考，也接受 temperature。 */
function ipeLedgerIsReasoningModel(model) {
    var m = String(model || "").trim().toLowerCase();
    if (!m) return false;
    if (/^gpt-5/.test(m) && m.indexOf("chat") >= 0) return false;
    return /^(o\d|gpt-5)/.test(m);
}

function ipeLedgerIdleMs() {
    var sec = Number(cfg().ledgerIdleTimeout);
    if (!Number.isFinite(sec) || sec <= 0) return 0;
    return Math.max(1, Math.floor(sec)) * 1000;
}

/* ---- 空闲看门狗 ----
   2.8.2 之前挂账没有任何超时：requestTimeout 默认 0 且没有界面能改，
   ipeFetchWithTimeout 拿到 0 直接返回裸 fetch。副 AI 一挂死，Busy 永远是
   true，之后每一楼自动挂账全被「上一次还没跑完」挡掉，失败计数也不走。
   现在改成看门狗：不是「总共多久」，是「连续多久一个字节都没收到」。
   思考模型想五分钟没关系，只要连接活着、字节还在流，就不判死。 */
function ipeLedgerWatchdog(controller, idleMs) {
    var timer = null, fired = false, mult = 1;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    function kick() {
        if (!idleMs || !controller) return;
        clear();
        timer = setTimeout(function(){
            fired = true;
            try { controller.abort(); } catch(e) {}
        }, idleMs * mult);
    }
    /* 首字节到了 = 连接证明是通的，之后的沉默大概率是模型在思考而不是中转吊死。
       阈值放宽一倍；首字节之前不放，那段才是中转最爱掐的地方。 */
    function relax() { mult = 2; }
    return { kick: kick, clear: clear, relax: relax, fired: function(){ return fired; }, currentMs: function(){ return idleMs * mult; } };
}

/* ---- SSE 逐块拼 delta ----
   四种回法都认，代码不看内容写了什么：
     1 标准流      data: {"choices":[{"delta":{"content":"…"}}]}
     2 思考流      delta.reasoning_content / delta.reasoning 只计数，不进账本
     3 中转偷懒    要了 stream:true 却整包 JSON 回来 → 回退 parseChatResponse
     4 流里夹 error 对象 → 当场抛，不等 [DONE]
   onChunk 每收到一块就喊一声（喂看门狗），onProgress 给状态行报字数。 */
async function ipeLedgerReadStream(res, onChunk, onProgress) {
    var content = "", reasonChars = 0, sawData = false, buf = "", allText = "", finish = "";
    var lastReport = 0;
    function report(force) {
        if (typeof onProgress !== "function") return;
        var now = Date.now();
        if (!force && now - lastReport < 400) return;
        lastReport = now;
        try { onProgress(content.length, reasonChars); } catch(e) {}
    }
    function handleLine(line) {
        line = line.replace(/\r$/, "");
        if (!/^data:/.test(line)) return;
        var payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        var j; try { j = JSON.parse(payload); } catch(e) { return; }
        sawData = true;
        if (j && j.error) {
            var em = (j.error && (j.error.message || j.error.msg)) || JSON.stringify(j.error);
            throw new Error("API 流内报错：" + String(em).slice(0, 180));
        }
        var ch = j && j.choices && j.choices[0];
        if (!ch) return;
        if (ch.finish_reason) finish = String(ch.finish_reason);
        var d = ch.delta || ch.message || {};
        if (typeof d.content === "string") content += d.content;
        else if (Array.isArray(d.content)) d.content.forEach(function(p){
            if (!p) return;
            if (typeof p === "string") content += p;
            else if (typeof p.text === "string") content += p.text;
        });
        var r = d.reasoning_content != null ? d.reasoning_content : d.reasoning;
        if (typeof r === "string") reasonChars += r.length;
    }
    function feed(chunk) {
        if (!chunk) return;
        buf += chunk; allText += chunk;
        var idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
            var line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            handleLine(line);
        }
        report(false);
    }
    if (res.body && typeof res.body.getReader === "function" && typeof TextDecoder !== "undefined") {
        var reader = res.body.getReader();
        var dec = new TextDecoder("utf-8");
        while (true) {
            var r = await reader.read();
            if (r.done) break;
            if (typeof onChunk === "function") onChunk();
            feed(dec.decode(r.value, { stream: true }));
        }
        feed(dec.decode());
    } else {
        feed(await res.text());   // 没有可读流的环境：整包读
    }
    if (buf) handleLine(buf);
    report(true);
    if (sawData) return { text: content.trim(), finish: finish, reasonChars: reasonChars };
    // 一行 data: 都没见到 → 不是 SSE，按整包 JSON 处理
    var data;
    try { data = JSON.parse(allText); }
    catch(e) { throw new Error("返回既不是 SSE 也不是 JSON：" + allText.slice(0, 160)); }
    return { text: parseChatResponse(data), finish: ipeLedgerFinishOf(data), reasonChars: 0 };
}

function ipeLedgerFinishOf(data) {
    try { var ch = data && data.choices && data.choices[0]; return ch && ch.finish_reason ? String(ch.finish_reason) : ""; }
    catch(e) { return ""; }
}

/* 空回复不能只说「空」——空的原因决定下一步怎么调。 */
function ipeLedgerEmptyReason(finish, reasonChars) {
    var f = String(finish || "").toLowerCase();
    if (f === "length" || f === "max_tokens") {
        return "副 AI 回了个空：finish_reason=length，思考把输出额度吃光了，轮到写账本时一个 token 都不剩。"
             + "把「思考强度」调成 low；或在「输出上限」填个大数（如 16000）压过中转的默认值。";
    }
    if (f === "content_filter") return "副 AI 回了个空：finish_reason=content_filter，被内容过滤拦下了。换个模型或改写本卡要点。";
    return "副 AI 回了个空（流式已收完，正文为零字，finish_reason=" + (finish || "无")
         + (reasonChars > 0 ? "，思考 " + reasonChars + " 字" : "") + "）";
}

async function ipeLedgerCallAPI(text, extra, atFloor, userOverride) {
    var item = ipeLedgerApiItem();
    if (!item || !item.endpoint) throw new Error("请先在挂账页选一套 API 预设（地址为空）");
    if (!item.model) throw new Error("这套 API 预设没有选模型");
    if (userOverride == null) ipeLedgerModeIngest(text, atFloor);      // 先读这楼的场景标记，再拼 system；压缩账本不读楼，沿用当前模式

    var headers = { "Content-Type": "application/json" };
    if (item.key) headers["Authorization"] = "Bearer " + item.key;

    var useStream = cfg().ledgerStream !== false;

    // system 只放用户预设，代码不再追加任何内容
    var body = {
        model: item.model,
        messages: [
            { role: "system", content: ipeLedgerSystemText() },
            { role: "user",   content: userOverride != null ? String(userOverride) : ipeLedgerBuildUser(text, extra, atFloor) }
        ],
        stream: useStream
    };
    if (!ipeLedgerIsReasoningModel(item.model)) body.temperature = 0.2;
    var eff = String(cfg().ledgerReasoningEffort || "").trim();
    if (eff) body.reasoning_effort = eff;
    var maxT = Math.floor(Number(cfg().ledgerMaxTokens) || 0);
    if (maxT > 0) {
        if (ipeLedgerIsReasoningModel(item.model)) body.max_completion_tokens = maxT;
        else body.max_tokens = maxT;
    }

    /* 副 AI 有时候半天不回，或者这套预设本来就不通——得能自己掐掉。
       ⏹ 按钮走 ipeLedgerAbort；看门狗也走它，但用 fired() 区分「人掐的」和「空闲判死」。 */
    ipeLedgerAbort = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var idleMs = ipeLedgerIdleMs();
    var dog = ipeLedgerWatchdog(ipeLedgerAbort, idleMs);
    var startedAt = Date.now();
    function progress(chars, reasonChars) {
        var sec = Math.round((Date.now() - startedAt) / 1000);
        var t = chars >= 4
            ? "挂账中…副 AI 正在写账本，已收 " + chars + " 字"
            : (chars > 0
                ? "挂账中…副 AI 已开口（" + chars + " 字），后面在思考，连接是通的"
                : (reasonChars > 0 ? "挂账中…副 AI 思考中（思考 " + reasonChars + " 字）" : "挂账中…等副 AI 开口"));
        ipeLedgerStatus(t + "，" + sec + " 秒（先别发下一条，贴耳还是上一份）", "#c9a227");
    }

    try {
        dog.kick();
        var res = await fetch(buildChatUrl(item.endpoint), {
            method: "POST", headers: headers, body: JSON.stringify(body),
            signal: ipeLedgerAbort ? ipeLedgerAbort.signal : undefined
        });
        dog.kick();
        if (!res.ok) {
            var errRaw = await res.text();
            throw new Error("API " + res.status + "：" + errRaw.slice(0, 180));
        }
        var out, finish = "", reasonChars = 0;
        if (useStream) {
            var got = await ipeLedgerReadStream(res, function(){ dog.relax(); dog.kick(); }, progress);
            out = got.text; finish = got.finish; reasonChars = got.reasonChars;
        } else {
            var raw = await res.text();
            var data;
            try { data = JSON.parse(raw); } catch(e) { throw new Error("返回不是 JSON：" + raw.slice(0, 160)); }
            out = parseChatResponse(data);
            finish = ipeLedgerFinishOf(data);
        }
        if (!out) throw new Error(ipeLedgerEmptyReason(finish, reasonChars));
        return out;
    } catch(e) {
        if (dog.fired()) {
            throw new Error("挂账超时：连续 " + Math.round(dog.currentMs() / 1000) + " 秒没收到副 AI 任何字节，已主动断开。"
                + (useStream ? "连接大概率在中转那头卡死了，换套 API 预设试试。" : "思考模型请把「流式接收」打开。"));
        }
        throw e;
    } finally {
        dog.clear();
    }
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
var ipeLedgerPreviewKind = "";        // "" = 普通手动挂账；"compress" = 压缩结果，采用时走 ipeLedgerCommitCompressed
function ipeLedgerAdoptPreview(which) {
    var el = q("#" + (which === "drawer" ? "iped-ledger-preview" : "ipe-ledger-preview"));
    var t = el ? String(el.value || "").trim() : "";
    if (!t) { ipeLedgerStatus("预览是空的，没什么可采用", "#c9a227"); return; }
    if (ipeLedgerPreviewKind === "compress") {
        ipeLedgerPreviewKind = "";
        ipeLedgerCommitCompressed(t);
        ipeLedgerHidePreview();
        return;
    }
    var f = ipeLedgerPreviewFloor || 0;   // 预览那份正文取自哪层，就盖哪层
    ipeLedgerCommit(t, f);
    ipeLedgerModeAfterRun(ipeLedgerPreviewMode);
    ipeLedgerHidePreview();
    ipeLedgerClearExtra();
    ipeLedgerSync();
    ipeLedgerStatus("已采用 \u2713 第 " + (f || ipeFloorNo()) + " 楼（旧版已进历史，可回滚）", "#6ec577");
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

/* ============================================================
   🗜 压缩账本（2.19.0）：账本只增不减，跑到几百楼贴耳几千字。让副 AI 把现任账本重写短一版：
   合并已了结的支线、精简语言，硬设定与未结项一字不丢。不自动压，只在超过阈值时提醒；
   压完先进预览，人看过点采用才落账；旧版打「压缩前」标记进历史可回滚，且不再喂给副 AI。
   ============================================================ */
var IPE_LEDGER_COMPRESS_DEFAULT = [
"【任务：压缩账本】",
"上面是现任账本。把它重写成更短的一版，交给你自己下一轮继续用。",
"铁律：",
"1. 格式照旧：分段、标题、条目写法全按你的挂账规则，不改结构，不换名字。",
"2. 只删不添：不新增任何事实、判断、推测。账本里没有的，压缩后也不能有。",
"3. 硬设定与未结项一字不丢：人物固定设定、伤病与恢复周期、承诺、欠债、约定、待回应项、楼层标记，原样保留。",
"4. 已了结的事合并：起因、过程、结果收成一句，只留对后续有影响的结果。纯过程描写、重复表述、已被后续事实覆盖的旧状态删掉。",
"5. 命令段照旧只写对下一轮有约束力的内容，不因压缩而变。",
"6. 目标长度不超过原来的 60%。删无可删时宁可长一点，也不许丢事实。"
].join("\n");
function ipeLedgerCompressPrompt() {
    var custom = String(cfg().ledgerCompressPrompt || "").trim();
    return custom || IPE_LEDGER_COMPRESS_DEFAULT;
}
function ipeLedgerCompressWarnChars() {
    var n = Number(cfg().ledgerCompressWarnChars);
    return (Number.isFinite(n) && n >= 0) ? n : 3000;
}
function ipeLedgerBuildCompressUser(cur) {
    var u = "";
    var note = ipeLedgerNoteValue().trim();
    if (note) u += "\u3010\u672c\u5361\u8981\u70b9\u3011\n" + note + "\n\n";
    u += "\u3010\u73b0\u4efb\u8d26\u672c\uff08" + cur.length + " \u5b57\uff09\u3011\n" + cur + "\n\n";
    u += ipeLedgerCompressPrompt() + "\n";
    u += "输出仍完整包在 " + ipeLedgerTagOpen() + " 和 " + ipeLedgerTagClose() + " 之间，标签外不写任何东西。";
    return u;
}
function ipeLedgerCommitCompressed(text) {
    var st = ipeLedgerRead();
    var old = String(st.current || "");
    if (old.trim()) st.versions.unshift({ floor: st.lastFloor, ts: Date.now(), text: old, tag: "压缩前" });
    st.current = String(text || "");
    ipeLedgerSave(st);
    ipeLedgerClearExtra();
    ipeLedgerSync();
    var pct = old.length ? Math.round(String(text || "").length / old.length * 100) : 0;
    ipeLedgerStatus("已压缩 \u2713 " + old.length + " 字 → " + String(text || "").length + " 字（" + pct + "%），压缩前那版已进历史（标「压缩前」），换回去随时可以。", "#6ec577");
    try { console.log("[IPE] 账本压缩", { from: old.length, to: String(text || "").length }); } catch(e) {}
}
async function ipeLedgerCompress() {
    if (ipeLedgerBusy) { ipeLedgerStatus("上一次还在跑，等它一下", "#c9a227"); return; }
    var cur = String(ipeLedgerRead().current || "");
    if (!cur.trim()) { ipeLedgerStatus("账本是空的，没什么可压", "#c9a227"); return; }
    ipeLedgerPreviewKind = "compress";
    ipeLedgerSetBusy(true);
    ipeLedgerStatus("正在压缩账本（" + cur.length + " 字）…副 AI 在合并支线、精简语言", "#c9a227");
    try {
        var out = await ipeLedgerCallAPI("", "", ipeLedgerRead().lastFloor, ipeLedgerBuildCompressUser(cur));
        var got = ipeLedgerExtract(out);
        var body = (got && got.text) ? got.text : String(out || "").trim();
        if (!body) { ipeLedgerPreviewKind = ""; ipeLedgerStatus("副 AI 回了个空，账本没动", "#d4726a"); return; }
        var pct = Math.round(body.length / cur.length * 100);
        ipeLedgerShowPreview(body, !got || got.level === 4);
        var tip = "压缩结果：" + cur.length + " 字 → " + body.length + " 字（" + pct + "%）。看一眼硬设定和未结项还在不在，点采用才落账，压缩前那版会进历史可回滚。";
        if (pct < 30) tip = "⚠️ 只剩原来的 " + pct + "%，删得太狠了，很可能丢了事实。仔细核对，或者不采用、重 roll 一次。" + tip;
        else if (pct >= 95) tip = "几乎没压下去（" + pct + "%），副 AI 觉得没什么可删。可以在「额外说一句」里点名哪段该合并，再重 roll。" + tip;
        ["ipe-ledger-preview-tip","iped-ledger-preview-tip"].forEach(function(id){ var el = q("#" + id); if (el) el.textContent = tip; });
        ipeLedgerStatus("压缩结果回来了（" + pct + "%），看一眼再采用", pct < 30 ? "#c9a227" : "#6ec577");
    } catch(e) {
        ipeLedgerPreviewKind = "";
        if (ipeLedgerIsAbort(e)) ipeLedgerStatus("已中断压缩。账本没动。", "#c9a227");
        else ipeLedgerStatus("压缩失败：" + ((e && e.message) ? e.message : String(e)) + "｜账本没动", "#d4726a");
    } finally {
        ipeLedgerSetBusy(false);
    }
}

async function ipeLedgerRunManual() {
    if (ipeLedgerBusy) { ipeLedgerStatus("上一次还在跑，等它一下", "#c9a227"); return; }
    ipeLedgerPreviewKind = "";
    var msg = null, msgFloor = 0;
    try {
        var chat = ctx().chat;
        for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m; msgFloor = i + 1; break; }
        }
    } catch(e) {}
    if (!msg) { ipeLedgerStatus("没找到可读的正文", "#d4726a"); return; }
    ipeLedgerPreviewFloor = msgFloor;

    ipeLedgerSetBusy(true);
    ipeLedgerStatus("正在挂账…（这会儿先别发下一条，贴耳还是上一份）", "#c9a227");
    try {
        var ex  = ipeLedgerExtraOnce();
        var out = await ipeLedgerCallAPI(msg.mes, ex, msgFloor);
        ipeLedgerPreviewMode = ipeLedgerLastMode;
        var got = ipeLedgerExtract(out);          // 有标签顺手剥，没标签原样给
        var body = (got && got.text) ? got.text : String(out || "");
        ipeLedgerShowPreview(body, !got || got.level === 4);
        ipeLedgerStatus(ex ? "按你补的那句重跑了一次，看一眼" : "副 AI 回来了，看一眼再决定", "#6ec577");
    } catch(e) {
        if (ipeLedgerIsAbort(e)) {
            ipeLedgerStatus("已中断挂账。账本没动，还是上一份。", "#c9a227");
        } else {
            var d = (e && e.message) ? e.message : String(e);
            ipeLedgerFailStreak++;
            ipeLedgerStatus("挂账失败：" + d, "#d4726a");
            ipeLedgerFailNotice(d);
        }
    } finally {
        ipeLedgerSetBusy(false);
    }
}

var ipeLedgerBusy = false;
var ipeLedgerFailStreak = 0;
var ipeLedgerAbort = null;            // 当前挂账请求的中断句柄
var ipeLedgerAbortedByUser = false;   // 区分「人掐的」和「超时自己断的」

function ipeLedgerStop() {
    if (!ipeLedgerAbort) { ipeLedgerStatus("现在没有在跑的挂账", "#c9a227"); return false; }
    ipeLedgerAbortedByUser = true;
    try { ipeLedgerAbort.abort(); } catch(e) {}
    ipeLedgerAbort = null;
    return true;
}

function ipeLedgerIsAbort(e) {
    if (ipeLedgerAbortedByUser) return true;
    return !!e && (e.name === "AbortError" || /abort/i.test(String((e && e.message) || "")));
}

/* 插件自己把自动挂账关掉：记下原因、面板里留提示、弹一张带「重新打开」按钮的常驻卡。
   以前只在状态行说一句，人根本发现不了，之后几十楼都没记账。 */
function ipeLedgerAutoOff(reason) {
    save("ledgerAutoRun", false);
    save("ledgerAutoOffReason", String(reason || "fail"));
    try { ipeLedgerRefreshBotEditors(); } catch(e) {}
    var why = reason === "shrink"
        ? "上一轮副 AI 交回来的账本比旧版短太多，像是事故，已经拦下没落账。"
        : "已经连续两次挂账失败，多半是 API 或模型的问题，再撞下去只会烧额度。";
    try {
        ipeNotice({
            kind: "error", sticky: true,
            title: "自动挂账已被插件关闭",
            body: why + "\n\n之后每一楼都不会自动记账。处理好后点下面按钮重开。",
            actions: [{ label: "重新打开自动挂账", onClick: function(){
                save("ledgerAutoRun", true); save("ledgerAutoOffReason", "");
                ipeLedgerFailStreak = 0;
                try { ipeLedgerRefreshBotEditors(); } catch(e) {}
                ipeLedgerStatus("自动挂账已重新打开（每来一楼跑一次）", "#6ec577");
            } }]
        });
    } catch(e) {}
}

/* 状态行在面板里，面板关着就等于没说。失败必须弹到面板外面来。 */
function ipeLedgerFailNotice(detail) {
    var d0 = String(detail || "");
    if (d0.length > 160) d0 = d0.slice(0, 160) + "…（完整错误见挂账页状态行）";
    var body = "挂账失败：" + d0;
    if (ipeLedgerFailStreak >= 2) {
        body += "\n已经连续失败 " + ipeLedgerFailStreak + " 次——多半不是这一楼的问题，"
             +  "换一套 API 预设或换个模型再试。";
    }
    body += "\n\n这一楼没挂上，贴耳还是上一份。先别发下一条，去点「重新挂账」补上。";
    try { ipeShowApiFailurePopup(body, false, { sticky: true, title: "挂账失败 · 账本还是上一份" }); } catch(e) {}
}
var ipeLedgerStaleWarned = false;

/* 副 AI 在跑的这几秒，贴耳里还是上一份账本。
   这一发要是现在发出去，Gemini 读到的就落后一楼。
   拦不住，但必须让人看得见——所以球转起来、状态行说话、真发了还再喊一次。 */
function ipeLedgerSetBusy(on) {
    ipeLedgerBusy = !!on;
    if (on) { ipeLedgerStaleWarned = false; ipeLedgerAbortedByUser = false; }
    else { ipeLedgerAbort = null; }
    try {
        ["ipe-ledger-stop","iped-ledger-stop"].forEach(function(id){
            var el = q("#" + id);
            if (el) el.style.display = on ? "" : "none";
        });
    } catch(e) {}
    try {
        var ball = q("#ipe-chat-quick-entry");
        if (ball) {
            if (on) ball.classList.add("ipe-ledger-busy");
            else ball.classList.remove("ipe-ledger-busy");
        }
    } catch(e) {}
}
var ipeLedgerPending = null;      // 缩水拦截暂存，点「强制采用」才落盘
var ipeLedgerPreviewFloor = 0;    // 预览那份正文取自哪一层，采用时照这个盖戳
var ipeLedgerPendingMode = "normal"; // 被保护闸拦下的结果实际用了哪套规则
var ipeLedgerPreviewMode = "normal"; // 手动预览实际用了哪套规则；采用后才消费一次性模式

function ipeLedgerShowForce(on) {
    ["ipe-ledger-force","iped-ledger-force"].forEach(function(id){
        var el = q("#" + id);
        if (el) el.style.display = on ? "" : "none";
    });
}

var ipeLedgerQueued = false;          // 2.18.0 补挂队列：跑着的时候又来了一楼，跑完自动补最新一楼
/* 可重试：5xx / 429 / 408 / 网络错 / 中转回了非 JSON。看门狗超时不重试——默认 300 秒一次，再等一轮太久，按老规矩计失败。 */
var IPE_LEDGER_RETRYABLE_RE = /^API (5\d\d|429|408)|Failed to fetch|NetworkError|Load failed|network|ECONN|socket|返回不是 JSON/i;
function ipeLedgerRetryable(e) {
    if (!e || ipeLedgerIsAbort(e)) return false;
    return IPE_LEDGER_RETRYABLE_RE.test(String(e.message || e));
}
async function ipeLedgerRun(targetIdx, silent, retryAttempt) {
    retryAttempt = Number(retryAttempt || 0);
    if (ipeLedgerBusy) {
        if (silent) { ipeLedgerQueued = true; ipeLedgerStatus("挂账还在跑，这楼记下了，跑完自动补挂最新一楼", "#c9a227"); }
        else ipeLedgerStatus("上一次挂账还没跑完", "#c9a227");
        return;
    }

    var msg = null, msgFloor = 0;
    try {
        var chat = ctx().chat;
        if (typeof targetIdx === "number" && chat[targetIdx]) { msg = chat[targetIdx]; msgFloor = targetIdx + 1; }
        else for (var i = chat.length - 1; i >= 0; i--) {
            var m = chat[i];
            // 跳过 user 楼与藏楼/系统楼：刚藏完末楼不该给隐形消息挂账
            if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { msg = m; msgFloor = i + 1; break; }
        }
    } catch(e) {}
    if (!msg) { ipeLedgerStatus("没找到可读的正文", "#d4726a"); return; }

    ipeLedgerPreviewFloor = msgFloor;
    ipeLedgerSetBusy(true);
    ipeLedgerPending = null;
    ipeLedgerShowForce(false);
    ipeLedgerStatus("自动挂账中…（这会儿先别发下一条，贴耳还是上一份）", "#c9a227");
    try {
        var out = await ipeLedgerCallAPI(msg.mes, "", msgFloor);
        var usedMode = ipeLedgerLastMode;
        var got = ipeLedgerExtract(out);

        if (!got || !got.text) {                               // 保底 2/3：整个回复是空的
            ipeLedgerFailStreak++;
            ipeLedgerStatus("副 AI 返回是空的，账本未改动。点「重新挂账」可以手动看一眼。", "#d4726a");
            ipeLedgerFailNotice("副 AI 返回是空的，账本未改动。");
            return;
        }
        var body = got.text;
        var note = IPE_LEDGER_LEVEL_NOTE[got.level] || "";
        ipeLedgerFailStreak = 0;

        if (body.replace(/\s+/g, "") === IPE_LEDGER_SENTINEL) { // 静默哨兵
            ipeLedgerModeAfterRun(usedMode);
            ipeLedgerStatus("本轮无变化（第 " + (msgFloor || ipeFloorNo()) + " 楼）" + note, "#6ec577");
            return;
        }

        var oldText = String(ipeLedgerRead().current || "");

        // 兜底级 + 账本原本为空 + 内容极短 → 大概率是拒答/寒暄，压住等确认
        if (got.level === 4 && !oldText.trim() && body.length < IPE_LEDGER_MIN_LEN) {
            ipeLedgerPending = body;
            ipeLedgerPendingMode = usedMode;
            ipeLedgerShowForce(true);
            ipeLedgerStatus("副 AI 没写包裹，且回复很短（" + body.length + " 字），像是拒答而不是账本，已拦下。"
                + "确实要用请点「强制采用」。｜原文：" + body.slice(0, 40), "#c9a227");
            return;
        }

        if (oldText.trim() && body.length < oldText.length * IPE_LEDGER_SHRINK) {   // 保底 4
            ipeLedgerPending = body;
            ipeLedgerPendingMode = usedMode;
            ipeLedgerShowForce(true);
            // 事故现场就该停车等人来看，不能带着警报继续飞
            var wasAuto = cfg().ledgerAutoRun === true;
            if (wasAuto) { ipeLedgerAutoOff("shrink"); }
            ipeLedgerStatus("疑似事故已拦截：新账本只有旧版的 "
                + Math.round(body.length / oldText.length * 100) + "%，账本未改动。"
                + (wasAuto ? "自动挂账已自动关闭，等你看过再开。" : "")
                + "确认无误请点「强制采用」。", "#c9a227");
            return;
        }

        ipeLedgerCommit(body, msgFloor);
        ipeLedgerModeAfterRun(usedMode);
        ipeLedgerStatus("已挂账 \u2713 第 " + (msgFloor || ipeFloorNo()) + " 楼" + note + (ipeLedgerLastMode !== "normal" ? "｜" + ipeLedgerLastMode + " 槽" + (ipeLedgerNsfwFellBack ? "（内容为空，已用 Normal 槽）" : "") : "")
            + (ipeLedgerReportTruncated ? "（report 层已截断）" : ""),
            got.level === 1 ? "#6ec577" : "#c9a227");
        ipeLedgerSync();
    } catch(e) {
        if (ipeLedgerIsAbort(e)) {
            ipeLedgerQueued = false;                       // 人掐的：排着的也别跑了
            ipeLedgerStatus("已中断挂账。账本没动，还是上一份。", "#c9a227");
            return;
        }
        var d = (e && e.message) ? e.message : String(e);
        /* 2.18.0 自动重试一次：网络错 / 5xx / 429 / 超时 这类中转抽风，等几秒再撞一次，
           这次不计失败、不弹卡；重试还失败才按老规矩来。拒答、空回复、4xx 不重试。
           已经有更新的楼排队了就不重试，补挂那楼时一并覆盖。 */
        if (retryAttempt < 1 && cfg().ledgerRetryOnce !== false && !ipeLedgerQueued && ipeLedgerRetryable(e)) {
            var delay = Number(cfg().ledgerRetryDelayMs); if (!(delay >= 0)) delay = 3000;
            var rIdx = (typeof targetIdx === "number") ? targetIdx : (msgFloor - 1);
            ipeLedgerStatus("挂账失败（" + d.slice(0, 80) + "），" + Math.round(delay / 1000) + " 秒后自动重试一次…", "#c9a227");
            try { console.log("[IPE] 挂账重试", { floor: msgFloor, err: d.slice(0, 120) }); } catch(eL) {}
            setTimeout(function(){ ipeLedgerRun(rIdx, silent, 1); }, delay);
            return;
        }
        ipeLedgerFailStreak++;
        /* 连撞两次就别再撞了——每层自动跑一次，坏预设能烧一晚上额度。
           跟缩水拦截一个道理：事故现场停车，等人来看。 */
        var offNote = "";
        if (ipeLedgerFailStreak >= 2 && cfg().ledgerAutoRun === true) {
            ipeLedgerAutoOff("fail");
            offNote = "自动挂账已自动关闭，换好 API 再开。";
        }
        ipeLedgerStatus("挂账失败：" + d + (offNote ? "｜" + offNote : ""), "#d4726a");
        ipeLedgerFailNotice(d + (offNote ? "\n" + offNote : ""));
    } finally {
        ipeLedgerSetBusy(false);
        if (ipeLedgerQueued) {
            ipeLedgerQueued = false;
            if (cfg().ledgerAutoRun === true) setTimeout(function(){ ipeLedgerRun(null, true); }, 80);   // 补挂最新一楼
        }
    }
}

/* ============================================================
   ⏳ 发消息前等挂账跑完（2.18.0）· generate_interceptor
   manifest 里声明了 ipeGenerateInterceptor，酒馆组 prompt 之前会先 await 它。
   副 AI 还在挂账时就在这里等它落账、贴耳换新再放行；最多等 ledgerWaitMaxSec 秒，超时照发并提醒。
   swipe / regenerate 不等：正在挂的是马上要被换掉的那楼，等它没意义，直接掐掉。continue 照等。
   这是「贴耳落后一楼」的根治——以前只能喊一句提醒。
   ============================================================ */
var ipeLedgerWaitedMs = 0;
async function ipeGenerateInterceptor(chat, contextSize, abort, type) {
    try {
        if (!ipeLedgerBusy) return;
        var t = String(type || "").toLowerCase();
        if (t === "swipe" || t === "regenerate") {
            if (ipeLedgerPreviewFloor >= ipeFloorNo()) { try { ipeLedgerStop(); } catch(e) {} }
            return;
        }
        if (t === "quiet") return;
        if (cfg().ledgerWaitBeforeSend === false) return;
        var sec = Number(cfg().ledgerWaitMaxSec); if (!(sec > 0)) sec = 60;
        var maxMs = sec * 1000, t0 = Date.now();
        ipeLedgerStatus("⏳ 你发了下一条，正在等副 AI 把这楼的账挂完再送出去…", "#c9a227");
        while (ipeLedgerBusy && Date.now() - t0 < maxMs) await new Promise(function(r){ setTimeout(r, 120); });
        ipeLedgerWaitedMs = Date.now() - t0;
        if (ipeLedgerBusy) {
            ipeLedgerStatus("等了 " + Math.round(sec) + " 秒账本还没挂完，这一发先送出去了，读到的是上一楼的账", "#c9a227");
        } else {
            try { ipeLedgerApplyEP(); } catch(e) {}
            ipeLedgerStatus("账本挂完了（等了 " + (ipeLedgerWaitedMs / 1000).toFixed(1) + " 秒），这一发读到的是新账", "#6ec577");
        }
    } catch(e) {}
}
try { window.ipeGenerateInterceptor = ipeGenerateInterceptor; } catch(e) {}

/* ============================================================
   🧬 从别的聊天继承账本（2.18.0）
   镜像里存着最近 30 个聊天的账本。同一张卡开新聊天时挑一份复制过来当起手：
   盖本聊天当前楼号的戳（盖原楼号会被下一次对账当幽灵账碎掉），本聊天原有的账先进历史。
   ============================================================ */
function ipeLedgerInheritList() {
    var all = ipeReadJsonLS(IPE_LEDGER_LS_KEY), cur = ipeChatKey(), me = ipeCharName();
    var out = [];
    Object.keys(all).forEach(function(k){
        var v = all[k];
        if (!v || k === cur || !String(v.current || "").trim()) return;
        var who = String(v.who || "");
        out.push({ key: k, who: who, floor: Number(v.lastFloor) || 0, updatedAt: Number(v.updatedAt) || 0,
                   len: String(v.current).length, sameChar: !!(me && who === me) });
    });
    out.sort(function(a, b){ return (Number(b.sameChar) - Number(a.sameChar)) || (b.updatedAt - a.updatedAt); });
    return out;
}
function ipeLedgerRefreshInherit() {
    var list = ipeLedgerInheritList();
    ["ipe-ledger-inherit-sel", "iped-ledger-inherit-sel"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var cur = el.value;
        var html = '<option value="">从别的聊天继承账本…' + (list.length ? "（" + list.length + " 份）" : "（镜像里没有别的聊天）") + '</option>';
        list.forEach(function(it){
            var k = it.key.length > 28 ? it.key.slice(0, 28) + "…" : it.key;
            var d = it.updatedAt ? new Date(it.updatedAt).toLocaleDateString() : "";
            html += '<option value="' + esc(it.key) + '">' + (it.sameChar ? "★ " : "") + esc(it.who ? it.who + " · " : "") + esc(k) + " · 第 " + it.floor + " 楼 · " + it.len + " 字" + (d ? " · " + d : "") + '</option>';
        });
        el.innerHTML = html;
        el.value = list.some(function(x){ return x.key === cur; }) ? cur : "";
    });
}
function ipeLedgerInherit(key) {
    var all = ipeReadJsonLS(IPE_LEDGER_LS_KEY);
    var src = all[String(key || "")];
    if (!src || !String(src.current || "").trim()) { ipeLedgerStatus("那份账本读不到了（镜像里没有）", "#d4726a"); return false; }
    var cur = ipeLedgerRead();
    var hadCur = !!String(cur.current || "").trim();
    var st = ipeLedgerNormalize({ current: String(src.current), order: String(cur.order || src.order || ""), lastFloor: ipeFloorNo(), versions: [] });
    if (hadCur) st.versions.unshift({ floor: cur.lastFloor, ts: Date.now(), text: String(cur.current) });
    ipeLedgerSave(st);
    ipeLedgerSync();
    ipeLedgerStatus("已从「" + (src.who ? src.who + " · " : "") + key + "」继承账本（" + String(src.current).length + " 字），盖第 " + ipeFloorNo() + " 楼的戳。"
        + (hadCur ? "原本的账本已进历史可回滚。" : ""), "#6ec577");
    try { console.log("[IPE] 继承账本", { from: key, floor: ipeFloorNo() }); } catch(eL) {}
    return true;
}
function ipeLedgerInheritClick(selId) {
    var sel = q("#" + selId); if (!sel) return;
    var key = sel.value;
    if (!key) { ipeLedgerStatus("先在下拉里选一份要继承的账本", "#c9a227"); return; }
    var cur = ipeLedgerRead();
    if (String(cur.current || "").trim()) {
        var okc = true;
        try { var rw = ipeRootWindow(); if (rw && typeof rw.confirm === "function") okc = rw.confirm("本聊天已经有账本了。继承会先把它存进历史，再用选中的那份覆盖现任。\n\n继续？"); } catch(e) {}
        if (!okc) { ipeLedgerStatus("已取消，账本没动", "#c9a227"); return; }
    }
    ipeLedgerInherit(key);
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

/* ---- 贴耳自检 ----
   账本编辑框显示的是「账本」，真正进 prompt 的是「贴耳」，中间隔着 setExtensionPrompt。
   2.8.1 那个抢跑 bug 难认，就是因为这一段不可见：账本看着对，注进去的是旧的。
   这里直接读酒馆手里存的那份，不重算——重算就又变成"我以为它是什么"了。 */
function ipeLedgerInspectEP() {
    var live = null, src = "";
    try {
        var c = ctx();
        var bag = c.extensionPrompts || c.extension_prompts;
        if (bag && bag[IPE_LEDGER_EP_KEY]) {
            var e = bag[IPE_LEDGER_EP_KEY];
            live = String((e && e.value != null) ? e.value : e);
            src  = "酒馆现存";
        }
    } catch(e) {}
    if (live == null) {                       // 拿不到就退回本地算一份，并明说是算的
        try { live = String(ipeLedgerEpText() || ""); src = "本地重算（读不到酒馆存的那份）"; }
        catch(e2) { live = ""; src = "读取失败"; }
    }

    var st  = ipeLedgerRead();
    var on  = cfg().ledgerEpEnabled !== false;
    var head = "【贴耳自检】" + src
        + "\n开关：" + (on ? "开" : "关（贴耳为空是正常的）")
        + "\n深度：" + ipeLedgerEpDepth() + "　当前楼：" + ipeFloorNo()
        + "\n账本现任：第 " + st.lastFloor + " 楼"
        + "\n贴耳长度：" + live.length + " 字"
        + (live.indexOf(String(st.current || "").slice(0, 40)) >= 0 || !String(st.current||"").trim()
            ? "\n\u2705 贴耳与账本现任一致"
            : "\n\u26A0\uFE0F 贴耳内容与账本现任对不上——这就是 roll 抢跑那类问题的现场")
        + "\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n";

    /* 只往只读框里写。绝不碰 #ipe-ledger-preview——那个框旁边就是「采用」，
       也绝不碰 #ipe-ledger-text——那是账本正文。自检文本一旦有被采用的可能，
       就等于给账本开了条污染通道。 */
    var payload = head + (live || "（空）");
    var shown = false;
    ["ipe-ledger-ep-out","iped-ledger-ep-out"].forEach(function(id){
        var el = q("#" + id);
        if (el) { el.textContent = payload; el.parentNode.style.display = ""; shown = true; }
    });
    if (!shown) { try { alert(payload); } catch(e) {} }
    ipeLedgerStatus("已抓取贴耳原文 \u2713 只读，不会进账本", "#6ec577");
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

        // 纯文字 + 折叠壳：正文用 textContent 原样印字（换行靠 CSS pre-wrap），绝不当 HTML 解释
        var box = d.createElement("details");
        box.className = IPE_LEDGER_INLINE_CLASS;
        box.setAttribute("data-arb-ledger", "1");
        var sum = d.createElement("summary");
        sum.className = IPE_LEDGER_INLINE_CLASS + "-title";
        sum.textContent = "\uD83D\uDC1A \u6f6e\u6c50\u56de\u54cd";
        var body = d.createElement("div");
        body.className = IPE_LEDGER_INLINE_CLASS + "-body";
        body.textContent = cur;
        box.appendChild(sum); box.appendChild(body);
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
"【模块身份】",
"",
"你是独立运行的\"剧情挂账AI\"。你读取当前完整正文与上一轮账本，负责整理已发生事实、继承状态、追踪未结项、识别停滞，并向正文模型下达本轮硬性门槛。",
"",
"你的输出会交给另一名正文模型继续写作。你只能做\"账房＋审计\"，不能做编剧、导演、演员、上帝视角或剧情预测者。",
"",
"每轮只输出文末规定的 <ledger> 账本，不输出分析过程、解释、建议或账本以外的任何文字。",
"",
"材料中若附有「User 指令」，它压过账本与你的一切判断，无条件服从。材料中若附有「本卡要点」，它是本卡的判定规则（恢复周期、免挂事项、特殊体质），判定时必须参考。",
"",
"────────────────────",
"",
"【输出铁律：纯文本】",
"",
"1. 账本整体用 <ledger> 与 </ledger> 包住，这是唯一允许出现的一对标签。",
"2. 账本内部只允许纯文本。禁止任何尖括号标签，禁止 markdown 标题、加粗、代码围栏。",
"3. 分行只用换行，分组只用【】，条目只用\"- \"与\"①②③\"。",
"4. 楼层数以插件提供的楼层数字为准；未提供时继承上一轮加一。",
"",
"────────────────────",
"",
"【账本的两种性质：命令与事实】",
"",
"账本分两段，性质不同，口气不同，位置固定：",
"",
"一、命令段（【本轮必须】）",
"放在账本最前面。只写对正文模型本轮写作具有约束力的内容，用祈使句，不超过 6 行。没有硬性要求时写\"本轮无硬性约束\"。命令段只能从事实段的到期项、停滞项、待回应项中抽取，不得凭空新增。",
"",
"二、事实段（【楼层状态】起的全部层）",
"只记录已发生的事实，用回顾性语言。正文模型读取它是为了不忘，不是为了照着写。",
"",
"正文模型对命令段必须执行；对事实段只需保持一致。",
"",
"────────────────────",
"",
"【最高权限边界：只挂账，不预测】",
"",
"一、允许执行",
"1. 提取正文中已发生的客观事实；",
"2. 继承并更新上一轮已存在的账目；",
"3. 记录已明确成立但尚未完成的承诺、行动与后果；",
"4. 统计每一条账目已经挂了几轮；",
"5. 判断正文是否产生可入账的实质变化；",
"6. 判断既有相位条件是否已满足；",
"7. 判断当前场景是否仍有玩家输入、即时回应或行动结果尚未承接；",
"8. 判断当前是否允许转场；",
"9. 按本文规定的轮数阈值，把到期项提升为命令、把长期无人处理的项标记搁置；",
"10. 向正文模型下达抽象的最低推进门槛。",
"",
"二、绝对禁止",
"1. 预测下一轮会发生什么；",
"2. 设计下一件剧情事件；",
"3. 指定下一场景的时间、地点、人物或行动；",
"4. 替任何角色决定对白、态度、选择与结果；",
"5. 替玩家决定任何行动、心理或立场；",
"6. 创造新的 NPC、秘密、线索、冲突、事故、反转或幕后真相；",
"7. 推测尚未揭示的动机、身份、阴谋与答案；",
"8. 为细节解释意义或填写\"可能指向\"；",
"9. 为支线设计\"下一触发事件\"；",
"10. 主动挑选哪条支线应升格为主线；",
"11. 在旧主线结束后自行规划新主线；",
"12. 提供候选剧情、示范写法或\"可以这样发展\"；",
"13. 使用\"可能、即将、将会、下一步、适合安排、建议、可以让、应当发生、指向\"描述未来内容。",
"",
"三、入账判定（实质变化的唯一标准）",
"正文所写的变化，必须能在下一轮账本的某个具体字段里写出具体改动，才算实质变化。写不进账本的不算：眼神、心绪、氛围、重复动作、原话复述、内心独白，若不导致任何字段改动，一律记为\"无变化\"。",
"可入账的字段包括：体况、亲密边界、社会关系、情感水位、核心矛盾、相位、最新实质变化、支线节点、细节状态、挂账状态、场景结果。",
"你只判定\"能否入账\"，不指定应当改哪个字段。",
"",
"────────────────────",
"",
"【总更新规则】",
"",
"一、继承优先：以上一轮账本为底稿，无新证据的字段原样继承，只有正文实际发生的变化才更新。禁止擅自刷新、润色、缩减、合并或删除仍有效的旧账。",
"",
"二、证据准入：只有正文已实际发生的事件、角色已明确作出的决定承诺行动、持续言行能稳定确认的关系状态、正文已呈现的客观细节可以入账。气氛、套路、单轮情绪、猜测、未来计划不能写成事实。证据不足写\"证据不足\"或\"无\"。",
"",
"三、事实语言：只用回顾性语言——已发生 / 已建立 / 尚未完成 / 尚无变化 / 条件已满足 / 条件未满足 / 已解决 / 仍在持续 / 证据不足。",
"",
"四、固定编号：M 主线 / S 支线 / D 未决细节 / T 待办承诺 / H 体况 / C 场景。同一事项只有一个主记录位置，其他层只引用编号。编号在事项结束前不得重置、更换或挪用。C 只记录正文已实际进入的场景。",
"",
"五、实际完成后销账：\"准备完成\"\"即将完成\"\"答应稍后完成\"不算完成。只有正文实际发生并产生结果，才能标\"已解决｜下轮删除\"。未经正文明确取消不得标\"已取消\"。",
"",
"六、不得擅自升格：M、S、D 之间的升格只能在正文已实际形成结构后追认。旧主线结束而正文未建新中心时，写\"暂无已建立的新主线\"。",
"",
"七、姓名解析：从角色卡、Persona、对话署名与上一轮账本识别实际姓名并直接输出。严禁输出任何宏、变量或占位符。无法识别时写\"主角色\"与\"玩家\"。",
"",
"八、空槽位：栏目无内容时只写一行\"① 无\"或\"- 无\"，不展开空字段。",
"",
"────────────────────",
"",
"【轮数追踪与搁置撤销】",
"",
"这是 v3 新增的核心机制。每一条未结账目都必须标记已挂轮数，并按阈值自动升级或撤销。\"挂了 N 轮无人处理\"是事实，不是预测，允许记录。",
"",
"一、T 待办承诺",
"- 字段\"已挂轮数\"自登记起每轮 +1，正文实际处理才停止。",
"- 1–2 轮：普通记账，不进命令段。",
"- 3 轮：升入命令段\"必须结清\"，状态改\"催办\"。",
"- 6 轮：状态改\"已搁置｜下轮删除\"，在命令段附注一句事实：\"T 编号 已挂 6 轮无人处理，视为搁置，下轮撤销。\"下一轮删除。",
"- 搁置撤销后，同一事项若正文重新提起，以新 T 编号重新登记，已挂轮数归零。",
"",
"二、不得搁置的三类（只会越催越硬，永不撤销）",
"1. T-H 体况恢复项；",
"2. Phase 3 倒计时；",
"3. 待回应的玩家输入。",
"这三类每轮都进命令段，直到正文实际处理。",
"",
"三、S 支线",
"- 字段\"无实质变化轮数\"自最近一次实质变化起每轮 +1。",
"- 8 轮：自动移入暂挂索引，状态\"暂挂\"。",
"- 暂挂后再 12 轮无人提起：状态\"已淡出｜下轮删除\"，从暂挂索引移除。",
"- 正文重新提起时回到活跃栏，计数归零。",
"",
"四、D 未决细节",
"- 字段\"未回应轮数\"自登记起每轮 +1。",
"- 6 轮：状态\"已淡出｜下轮删除\"。",
"- 不进命令段。细节是线索，不是债务。",
"",
"五、M 主线停滞",
"- 连续 3 轮无可入账变化，停滞计数 3，进命令段\"当前主线必须产生可入账变化或完成收束\"。",
"- 主线永不搁置。",
"",
"六、C 场景停滞",
"- 连续 2 轮无可入账变化，停滞计数 2，进命令段\"当前场景必须产生可入账变化或形成结果\"。",
"",
"────────────────────",
"",
"【第零层：楼层状态】",
"楼层数以插件为准。当前篇章限 15 字，只概括已形成的叙事时期，只在主线、长期时间阶段或核心场域实际变化时更换。",
"",
"────────────────────",
"",
"【第一层：核心锚点】",
"",
"一、体况：默认\"正常\"。仅在正文出现明确、直接的身体事件时更新。禁止根据情绪、职业、氛围、设定或联想擅自添加受伤、生病、虚弱、疲惫与失眠。非正常体况必须建 H 编号并连续计数。",
"",
"二、体况硬性恢复协议（最高执行优先级，任何角色性格、剧情张力、旧伤设定均不得豁免）",
"1. 伤病、疾病、疼痛、疲惫、失眠只能是短期事件后果，不得成为长期主线、支线、暗流、魅力来源或反复制造张力的工具。",
"2. 禁止围绕同一伤病反复描写疼痛、虚弱、脸色、伤口、复发、拒绝治疗、带伤行动或反复照料。",
"3. 同一 H 自首次出现起每轮 +1。更换措辞、症状、部位、短暂不提、接受治疗、换景、换日、换篇章、称为恢复期或后遗症，均不得重置。",
"4. 只有正文明确写出恢复完成，才能回填\"正常\"并结束 H。",
"5. 已结束的 H 不得无明确独立新原因复活。一旦复活视为新伤，命令段附注\"同一部位已于 H[旧编号] 痊愈\"。",
"强制周期：第 1 轮记录；第 2 轮正文必须已出现治疗或处置且不恶化；第 3 轮正文必须已明确好转，新增 T-H；第 4 轮正文必须完成恢复回填\"正常\"。",
"第 4 轮仍未恢复：H 状态\"违规超期\"，T-H\"强制执行\"，命令段第一行写\"必须先完成合理恢复，禁止以其他剧情覆盖\"。持续累计，不得重开 H 逃避。",
"",
"三、睡眠：连续强调缺觉最多两轮。第 2 轮建 T-H 强制休息；第 3 轮正文必须已完成有效休息回填\"正常\"，否则\"违规超期\"。不得以噩梦、电话、工作、警报、来客或角色拒绝延长。",
"",
"四、身体最亲密边界：只记核心双方已实际发生的最亲密接触尺度，保持历史最深，不因疏远回退。只计双方接受的亲密意味接触；医疗、救援、冲突、意外、强迫不计。限 4 字。",
"",
"五、社会关系：已明确成立的现实身份，限 4 字。",
"",
"六、情感水位：持续互动已实际抵达的阶段，限 4 字。单轮暧昧、心软、性吸引、套路不得跳级。",
"",
"七、真实渴望：由持续行为、选择与明确自我矛盾共同证实的深层倾向，限 8 字。证据不足写\"证据不足\"。",
"",
"八、核心刻痕：1–2 个已持续影响角色认知、选择或关系逻辑的关键记忆。不是近期摘要。无决定性新证据时原样继承。",
"",
"────────────────────",
"",
"【人物在场簿】",
"",
"一、目的：让 NPC 的身份、关系与最近状态跨楼连贯，防止正文忘记已发生的关系变化（如已决裂却无缘由和好）。笔墨要轻，每人不超过 4 行。",
"",
"二、准入：出现 ≥2 次，或正文明确赋予功能（医生、上司、旧友等）。路人不进。上限 5 人；满时按已离场轮数最高者移入\"远景索引\"，只留一行。",
"",
"三、每人记录：",
"- 姓名｜身份（限 6 字）",
"- 与主角色/玩家关系：[已成立的关系，限 4 字]｜最近变化：[第X楼＋变化 / 无]",
"- 最后出现：第X楼＋当时在哪、在做什么（限 15 字）",
"- 已离场轮数：[数字]｜手持未结项：[T/S编号 / 无]",
"",
"四、关系变化只能追认正文已发生的事件。决裂、和解、升温、疏远都必须有楼号。正文若出现与\"最近变化\"相反的关系状态而无对应事件，记入\"连续性风险\"。",
"",
"五、提醒规则：",
"- 已离场 ≥6 轮：事实段该行末尾加\"久未出现\"。",
"- 已离场 ≥6 轮且手持催办中的 T：进命令段一行\"T 编号涉及[姓名]（关系：[状态]），已 N 轮未出现\"。只说账，不说让他出来。",
"- 永远不写\"应该回来\"\"可以安排出场\"。",
"",
"────────────────────",
"",
"【第二层：纪元主线】",
"",
"一、主线是当前时期正文已建立的唯一核心因果链，有且只有一条，不得拼接。固定 M 编号直至实际解决。",
"",
"二、相位",
"- Phase 1·迷雾期：核心矛盾已萌生，目标、风险或信息未完整显形。追认进 Phase 2 需正文已出现：矛盾被人物明确感知；至少一方已采取针对性行动；事件已产生现实影响。",
"- Phase 2·发酵期：人物已进入行动、调查、对抗、隐瞒、取舍或拉扯，矛盾产生持续代价。追认进 Phase 3 需正文已出现：足以改变局势的证据、选择、公开冲突或不可逆行动。",
"- Phase 3·引爆期：矛盾已公开化或不可逆。最多三轮：第 1 轮冲突正面出现；第 2 轮正文必须产生立场、选择或代价的实际变化；第 3 轮正文必须解决核心问题并呈现即时后果。到期未解决标\"违规超期\"，命令段要求先完成当前矛盾，禁止新增主线、转移场景或追加无关危机。Phase 3 每轮都进命令段，写明\"X/3\"。",
"- Interlude·纪元间章：上一主线已解决、保留一轮凭证后，正文尚未建立新中心的过渡。正文一旦形成新核心因果链，立即追认为新 M 的 Phase 1。",
"",
"三、主线结束：正文已满足核心矛盾有明确结果、关键行动已产生后果、局势形成新实际状态。解决后保留一轮凭证，进入 Interlude。",
"",
"────────────────────",
"",
"【第三层：支线簿】",
"支线是正文已形成独立目标、矛盾、行动链或未解后果，但未成为主线的次级因果链。单个细节、一次承诺、单次互动不构成支线。状态只能用：活跃 / 等待条件 / 暂挂 / 并轨 / 收束｜下轮删除 / 已淡出｜下轮删除。活跃最多 3 条，暂挂索引最多 5 条。活跃栏已满时优先合并同源或按\"无实质变化轮数\"最高者移入暂挂。\"已建立等待条件\"只记正文已明确给出的条件。只有正文已实际改变主线核心矛盾、资源、立场或结果条件，才能追认\"并轨\"。",
"",
"────────────────────",
"",
"【第四层：未决细节】",
"只记正文已出现、尚未得到解释或回应的客观细节。不记猜测、预感、暗流、伏笔推测。不填\"可能指向\"。上限 3 条，状态只能用：未回应 / 已回响 / 已解释 / 已被正文升格 / 已解决｜下轮删除 / 已淡出｜下轮删除。",
"",
"────────────────────",
"",
"【第五层：动态挂账】",
"只记已建立明确未兑现期待的具体事项：已答应的事、已约定的计划、已接下的任务、已开始但无结果的具体行动、已到期的体况恢复项。主线支线宏观内容不重复写入。状态只能用：未完成 / 等待既有条件 / 条件已满足 / 催办 / 强制执行 / 已解决｜下轮删除 / 已取消｜下轮删除 / 已搁置｜下轮删除。普通挂账最多 3 条；T-H 不受上限。",
"",
"────────────────────",
"",
"【第六层：当前场景审计】",
"场景由相对连续的时间、地点、在场人物与进行中的行动构成，可跨多楼，只在正文实际进入新时间、地点、人物结构或行动目标时建新 C。不得规划下一场景。转场权限只能用：禁止转场（仍有玩家输入、即时回应、行动结果或 Phase 3 冲突未承接）/ 允许转场（当前场景目标已形成明确结果）/ 有条件允许（须先完成已列未结项）/ 无法判断。即使允许，不指定转去哪里、何时、由谁、之后发生什么。只检查已发生的时间、地点、人物、信息、物品、体况、主线、支线、挂账是否一致。换景换日不得清空旧账或重置 H。",
"",
"────────────────────",
"",
"【第七层：命令段生成规则】",
"",
"命令段从以下来源按优先级抽取，最多 6 行，全部用祈使句：",
"",
"优先级 1：H 违规超期 / T-H 强制执行 → \"必须先完成合理恢复\"",
"优先级 2：待回应的玩家输入 → \"必须先直接回应：[具体输入]\"",
"优先级 3：Phase 3 倒计时 / 违规超期 → \"Phase 3 第 X/3 轮，必须[产生实际变化 / 完成收网]\"",
"优先级 4：T 已挂 ≥3 轮 → \"必须结清 T 编号：[事项]，已挂 X 轮\"",
"优先级 5：M 或 C 停滞达阈值 → \"当前[主线 / 场景]必须产生可入账变化或收束\"",
"优先级 6：NPC 离场 ≥6 轮且手持催办 T → \"T 编号涉及[姓名]（关系：[状态]），已 N 轮未出现\"",
"优先级 7：转场限制 → 引用转场权限",
"",
"每行只写要求，不写做法。超过 6 行时保留优先级最高的 6 行。没有任何来源时写\"本轮无硬性约束，至少一项既有状态须产生可入账变化\"。",
"",
"输出前自检：命令段是否含任何未来事件、具体做法、剧情建议？事实段是否含任何预测语言？账本内是否含尖括号或 markdown？若有，删除。",
"",
"────────────────────",
"",
"【固定输出格式】",
"",
"<ledger>",
"飞地记忆锚点与状态追踪",
"",
"【本轮必须 · 正文模型硬性约束】",
"- [祈使句 1]",
"- [祈使句 2]",
"- …（最多 6 行 / 本轮无硬性约束，至少一项既有状态须产生可入账变化）",
"- 入账判定：本轮所写变化须能在下轮账本某字段写出具体改动；写不进账本的不算。",
"",
"【楼层状态】",
"当前楼层数：[数字]",
"当前篇章：[限15字]",
"",
"【核心锚点】",
"- 体况：[主角色姓名]：[正常 / 状态｜H编号｜第X轮 / 违规超期｜H编号｜第X轮]｜[玩家姓名]：[同上]",
"- 身体最亲密边界：[双方姓名]：[限4字]",
"- 社会关系：[限4字]",
"- 情感水位：[限4字]",
"- 真实渴望：[角色姓名]：[限8字 / 证据不足]",
"- 核心刻痕：",
"  1. [关键记忆 / 无]",
"  2. [关键记忆 / 无]",
"",
"【人物在场簿】",
"- [姓名｜身份]：关系[限4字]｜最近变化[第X楼＋变化 / 无]｜最后出现[第X楼＋15字内]｜离场[数字]轮｜未结[编号 / 无]",
"- [同上 / 无]",
"远景索引：[姓名｜关系｜最后出现楼号 / 无]",
"",
"【纪元主线】",
"- 当前唯一主线：[M编号｜名称 / 暂无已建立的新主线]",
"- 核心矛盾：[已明确成立的矛盾 / 无]",
"- 当前相位：[Phase 1·迷雾期 / Phase 2·发酵期 / Phase 3·引爆期 / Interlude·纪元间章]",
"- 相位轮次：[第X轮；Phase 3写X/3或违规超期]",
"- 最新实质变化：[第X楼＋已发生的变化 / 无]",
"- 现存未决事实：[已建立但尚无结果 / 无]",
"- 主线停滞计数：[0 / 1 / 2 / 3]",
"- 当前状态：[推进 / 停滞 / 收网中 / 违规超期 / 已解决｜待正文建立新主线]",
"",
"【支线簿】",
"① [S编号｜名称]",
"对象：",
"起始楼层：",
"已知事实：",
"当前节点：",
"最近实质变化：[第X楼＋变化 / 无]",
"无实质变化轮数：[数字]",
"与主线关系：[助推 / 阻碍 / 平行 / 并轨 / 尚未形成关系]",
"当前状态：[活跃 / 等待条件 / 暂挂 / 并轨 / 收束｜下轮删除 / 已淡出｜下轮删除]",
"已建立等待条件：[正文明确条件 / 无]",
"② [同上结构 / 无]",
"③ [同上结构 / 无]",
"暂挂索引：[S编号｜名称｜暂挂轮数｜恢复条件 / 无]",
"",
"【未决细节】",
"① [D编号｜客观细节]",
"来源楼层：",
"已知影响：[已造成的影响 / 尚无实际影响]",
"未回应轮数：[数字]",
"当前状态：[未回应 / 已回响 / 已解释 / 已被正文升格 / 已解决｜下轮删除 / 已淡出｜下轮删除]",
"② [同上结构 / 无]",
"③ [同上结构 / 无]",
"",
"【动态挂账】",
"1. [T编号 / T-H编号]",
"对象：",
"事项：",
"来源楼层：",
"已挂轮数：[数字]",
"关联：[无 / M编号 / S编号 / H编号]",
"已建立期限或条件：[正文明确内容 / 无]",
"状态：[未完成 / 等待既有条件 / 条件已满足 / 催办 / 强制执行 / 已解决｜下轮删除 / 已取消｜下轮删除 / 已搁置｜下轮删除]",
"2. [同上结构 / 无]",
"3. [同上结构 / 无]",
"",
"【当前场景】",
"- 当前场景：[C编号]",
"- 时间：[已确立 / 未明确]",
"- 地点：[已确立 / 未明确]",
"- 在场人物：",
"- 当前承载线路：[M编号 / S编号 / T编号 / Interlude / 无法判断]",
"- 已在进行的行动：[已开始未结束 / 无]",
"- 待回应的玩家输入：[具体已发生输入 / 无]",
"- 本轮可入账变化：[改动了哪个字段＋内容 / 无]",
"- 场景停滞计数：[0 / 1 / 2]",
"- 场景结果状态：[尚未形成结果 / 已完成 / 已受阻 / 已改变 / 已放弃 / 已明确延后]",
"- 转场权限：[禁止转场 / 允许转场 / 有条件允许 / 无法判断]",
"- 连续性风险：[已发现的时间、地点、人物、物品、体况矛盾，或 NPC 关系与在场簿不符 / 无]",
"",
"【本轮结算】",
"- 已销账：[本轮标记删除的编号 / 无]",
"- 已搁置：[本轮撤销的编号＋已挂轮数 / 无]",
"- 已淡出：[本轮淡出的编号 / 无]",
"</ledger>"
].join("\n");

// v2.x 的默认挂账规则原文，同样只用于逐字相同时的自动升级。
var IPE_LEDGER_PROMPT_V2 = [
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
// 跟生图的 <draw>…</draw> 同一个性质，只保证输出能被找到。
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

/* ============================================================
   🎭 场景模式路由（2.13.1）
   不额外叫一个 AI 判断。主 AI 在正文末尾留一个极短标记：
     <route>normal</route> / <route>nsfw</route> / <route>aftercare</route>
   插件机械读标记，换用对应的挂账规则预设；模式名和映射全由用户配，插件不关心叫什么。
   三态语义：
     · 读到标记 → 切到该模式（只认配过的名字和 normal）
     · 没标记   → 沿用上一楼的模式，不会因为这楼没写就掉回普通
     · 一次性模式（如 aftercare）→ 用完一轮自动回 normal
   手动指定优先于自动；关着就永远 normal。状态存 chat_metadata，换聊天各用各的。
   标记发给副 AI 前会剥掉；主聊天里的隐藏交给酒馆正则。
   ============================================================ */
var IPE_LEDGER_MODE_META = "ipe_ledger_mode_v1";
var ipeLedgerLastMode = "normal";     // 本次挂账实际用的模式，给状态行报

/* 只有两个槽：normal / nsfw。路由的是槽，不是预设。
   Normal 槽 = 「挂账规则」面板（预设库 LP，选哪个就是哪个）；
   NSFW 槽  = 「NSFW 槽 · 挂账规则」面板（自己的预设库 LPN，选哪个就是哪个）。
   一次只可能用一个槽，标记二选一。 */
var IPE_LEDGER_KNOWN_MODES = ["nsfw"];
function ipeLedgerModeTagNames() {
    var raw = String(cfg().ledgerModeTag || "route, ipe_mode");
    var parts = raw.split(/[,\s，、]+/), out = [], seen = {};
    for (var i = 0; i < parts.length; i++) {
        var t = String(parts[i] || "").trim().replace(/[^\w-]/g, "").toLowerCase();
        if (t && !seen[t]) { seen[t] = true; out.push(t); }
    }
    if (!out.length) out = ["route", "ipe_mode"];
    /* 2.13.0 的默认值自动升级：新旧标记都认，不掐断旧聊天。自定义标签保持原样。 */
    if (out.length === 1 && out[0] === "ipe_mode") out.unshift("route");
    return out;
}
function ipeLedgerModeTagName() {
    return ipeLedgerModeTagNames()[0] || "route";
}
function ipeLedgerModeRe() {
    var tags = ipeLedgerModeTagNames().map(ipeEscRe).join("|");
    return new RegExp("<\\s*(" + tags + ")\\s*>\\s*([\\w-]+)\\s*<\\s*\\/\\s*\\1\\s*>", "gi");
}
function ipeLedgerTailModeMatch(text) {
    var re = ipeLedgerModeRe(), m, hit = null;
    var s0 = String(text || "");
    while ((m = re.exec(s0)) !== null) {
        if (!s0.slice(re.lastIndex).trim()) hit = { mode: String(m[2] || "").toLowerCase(), index: m.index, end: re.lastIndex };
    }
    return hit;
}
function ipeLedgerReadModeMarker(text) {
    var hit = ipeLedgerTailModeMatch(text);
    return hit ? hit.mode : "";
}
function ipeLedgerStripModeTag(text) {
    var out = String(text || ""), hit;
    /* 只剥楼尾连续标记；正文中引用的示例标签原样留给副 AI。 */
    while ((hit = ipeLedgerTailModeMatch(out))) out = out.slice(0, hit.index);
    return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function ipeLedgerModeState() {
    try {
        var r = ipeMetaRoot(); var v = r && r[IPE_LEDGER_MODE_META];
        if (v && typeof v === "object") return { mode: String(v.mode || "normal").toLowerCase(), floor: Number(v.floor) || 0 };
    } catch(e) {}
    return { mode: "normal", floor: 0 };
}
function ipeLedgerModeSet(mode, floor) {
    try {
        var r = ipeMetaRoot(); if (!r) return;
        r[IPE_LEDGER_MODE_META] = { mode: String(mode || "normal").toLowerCase(), floor: Number(floor) || 0, updatedAt: Date.now() };
        var c = ctx(); if (c && typeof c.saveMetadataDebounced === "function") c.saveMetadataDebounced();
    } catch(e) {}
}
function ipeLedgerModeItem(name) {
    var n = String(name || "").toLowerCase();
    return IPE_LEDGER_KNOWN_MODES.indexOf(n) >= 0 ? { name: n } : null;
}
/* 当前生效模式：手动优先，其次自动状态；关着就 normal */
function ipeLedgerModeEffective() {
    if (cfg().ledgerModeEnabled !== true) return "normal";
    var man = String(cfg().ledgerModeManual || "").trim().toLowerCase();
    if (man) return man;
    return ipeLedgerModeState().mode || "normal";
}
var ipeLedgerNsfwFellBack = false;   // NSFW 槽选的预设是空的 → 这一轮回落到 Normal，状态行提示
function ipeLedgerPromptValueForMode(mode) {
    var m = String(mode || "normal").toLowerCase();
    ipeLedgerNsfwFellBack = false;
    if (m === "nsfw") {
        var v = String(ipePresetItem.apply(null, LPN).value || "").trim();
        if (v) return v;
        ipeLedgerNsfwFellBack = true;
    }
    return ipeLedgerPromptValue();
}
/* 一楼正文进来：读标记、更新状态。返回本次生效的模式。 */
function ipeLedgerModeIngest(text, floor) {
    if (cfg().ledgerModeEnabled !== true) { ipeLedgerLastMode = "normal"; return "normal"; }
    var source = text;
    try { source = ipeLedgerStripImageTag(text); } catch(e) {}
    var mk = ipeLedgerReadModeMarker(source);
    if (mk && (mk === "normal" || ipeLedgerModeItem(mk))) ipeLedgerModeSet(mk, floor);
    ipeLedgerLastMode = ipeLedgerModeEffective();
    return ipeLedgerLastMode;
}
/* 一次挂账跑成：一次性模式自动回普通（只动自动状态，不动手动指定） */
function ipeLedgerModeAfterRun(usedMode) { /* 2.13.3 起没有一次性模式；保留签名给各调用点 */ }
function ipeLedgerModeSnippet() {
    var t = ipeLedgerModeTagName();
    var opts = ["normal"].concat(IPE_LEDGER_KNOWN_MODES).map(function(n){ return "<" + t + ">" + n + "</" + t + ">"; }).join("、");
    return "每轮正文的最后一行，预测下一轮回复应使用的预设模式，并单独输出一个标记：" + opts + "。根据当前情节走向判断：下一轮即将进入或仍处于亲密场景时写 nsfw；下一轮应回到常规场景时写 normal。必须提前一轮切换，不要等场景已经写出后才标记。标记之外不要解释。";
}

function ipeLedgerSystemText() {
    var v = ipeLedgerPromptValueForMode(ipeLedgerModeEffective());
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
            var _lv = list[i] ? String(list[i].value || "").trim() : "";
            if (list[i] && (_lv === IPE_LEDGER_PROMPT_V1.trim() || _lv === IPE_LEDGER_PROMPT_V2.trim())) {
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

var LP = ["ledgerPromptPresetsJson","activeLedgerPrompt","lp_1","飞地·大事件挂账", IPE_LEDGER_PROMPT_DEFAULT];
var LN = ["ledgerNotePresetsJson","activeLedgerNote","ln_1","本卡要点", IPE_LEDGER_NOTE_DEFAULT];
var LPN = ["ledgerPromptNsfwPresetsJson","activeLedgerPromptNsfw","lpn_1","NSFW 挂账规则", ""];   // NSFW 槽自己的库
function ipeLedgerPromptValue(){ return ipePresetItem.apply(null, LP).value || IPE_LEDGER_PROMPT_DEFAULT; }
function ipeLedgerPromptNsfwValue(){ return ipePresetItem.apply(null, LPN).value || ""; }
function ipeLedgerNoteValue(){ return ipePresetItem.apply(null, LN).value || ""; }

/* ---- 状态行 ---- */
function ipeLedgerStatus(t, color) {
    ["#ipe-ledger-status","#iped-ledger-status"].forEach(function(id){
        var e = q(id); if (e) { e.textContent = t; e.style.color = color || ""; }
    });
}

/* ---- 版本信息（取代 v1 的账龄栏）---- */
/* 场景模式 UI：面板 ipe- / 抽屉 iped- 同一套 */
function ipeLedgerModeRefresh() {
    var on = cfg().ledgerModeEnabled === true;
    var doc = ipeRootDocument();
    ["ipe","iped"].forEach(function(pre){
        var cb = q("#" + pre + "-ledger-mode-on"); if (cb) cb.checked = on;
        var tg = q("#" + pre + "-ledger-mode-tag"); if (tg && doc.activeElement !== tg) tg.value = ipeLedgerModeTagNames().join(", ");
        var sel = q("#" + pre + "-ledger-mode-manual");
        if (sel) {
            sel.innerHTML = '<option value="">自动（听标记）</option><option value="normal">锁定 normal</option><option value="nsfw">锁定 nsfw</option>';
            sel.value = String(cfg().ledgerModeManual || "");
        }
        var fold = q("#" + pre + "-ledger-nsfw-fold"); if (fold) fold.style.display = on ? "" : "none";   // 关着就藏
        var sn = q("#" + pre + "-ledger-mode-snippet"); if (sn) sn.value = ipeLedgerModeSnippet();
        var now = q("#" + pre + "-ledger-mode-now");
        if (now) {
            var eff = ipeLedgerModeEffective();
            var normalName = (ipePresetItem.apply(null, LP) || {}).name || "?";
            var nsfwItem = ipePresetItem.apply(null, LPN) || {};
            var nsfwName = (nsfwItem.name || "?") + (String(nsfwItem.value || "").trim() ? "" : "（内容为空，会回落到 Normal）");
            now.textContent = on
                ? ("当前生效：" + eff + (String(cfg().ledgerModeManual || "").trim() ? "（手动锁定）" : "（自动，本聊天记忆）") + "　｜　Normal 槽 → " + normalName + "　NSFW 槽 → " + nsfwName)
                : "场景模式未启用：一直用 Normal 槽 → " + normalName;
        }
    });
}
function ipeLedgerModeBind() {
    ["ipe","iped"].forEach(function(pre){
        var cb = q("#" + pre + "-ledger-mode-on");
        if (cb && !cb.__ipeBound) { cb.__ipeBound = true; cb.addEventListener("change", function(){
            save("ledgerModeEnabled", !!cb.checked); ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(cb.checked ? "场景模式已启用：楼尾标记决定用 Normal 槽还是 NSFW 槽" : "场景模式已关：一直用 Normal 槽", "#6ec577");
        }); }
        var tg = q("#" + pre + "-ledger-mode-tag");
        if (tg && !tg.__ipeBound) { tg.__ipeBound = true; tg.addEventListener("change", function(){
            var raw = String(tg.value || "").split(/[,\s，、]+/), clean = [], seen = {};
            for (var i = 0; i < raw.length; i++) {
                var tag = String(raw[i] || "").trim().replace(/[^\w-]/g, "").toLowerCase();
                if (tag && !seen[tag]) { seen[tag] = true; clean.push(tag); }
            }
            var v = clean.length ? clean.join(", ") : "route, ipe_mode";
            save("ledgerModeTag", v); ipeLedgerRefreshBotEditors();
        }); }
        var sel = q("#" + pre + "-ledger-mode-manual");
        if (sel && !sel.__ipeBound) { sel.__ipeBound = true; sel.addEventListener("change", function(){
            save("ledgerModeManual", String(sel.value || "")); ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(sel.value ? "已锁定 " + sel.value + " 槽，改回「自动」才会听标记" : "已改回自动，听楼尾标记", "#6ec577");
        }); }
    });
}

function ipeLedgerVersionInfo() {
    var st = ipeLedgerRead();
    var modeNote = "";
    try {
        if (cfg().ledgerModeEnabled === true) {
            var man = String(cfg().ledgerModeManual || "").trim();
            modeNote = "\u3000模式 " + ipeLedgerModeEffective() + (man ? "（手动）" : "（自动）");
        }
    } catch(e) {}
    var len = String(st.current || "").length, warn = ipeLedgerCompressWarnChars();
    var sizeNote = "\u3000账本 " + len + " 字" + (warn > 0 && len > warn ? "（超过 " + warn + " 字了，可以「压缩一版」）" : "");
    return "当前 " + ipeFloorNo() + " 楼\u3000历史 " + st.versions.length + " 版" + sizeNote + "\u3000"
         + (st.lastFloor >= 0 ? "最后更新于第 " + st.lastFloor + " 楼" : "尚未挂过账") + modeNote;
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
            html += '<option value="' + i + '">第 ' + (v.floor >= 0 ? v.floor : "?") + ' 楼 \u00b7 ' + hh + (v.tag ? ' \u00b7 ' + esc(v.tag) : '') + '</option>';
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
    try { ipeLedgerRefreshInherit(); } catch(eI) {}
    ipeLedgerUpgradePrompts();
    var pv = ipePresetItem.apply(null, LP);
    var nv = ipePresetItem.apply(null, LN);
    var pnv = ipePresetItem.apply(null, LPN);
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
    ipeFillSelect("ipe-ledger-prompt-n-slot",  ipePresetList.apply(null, LPN), pnv.id);
    ipeFillSelect("iped-ledger-prompt-n-slot", ipePresetList.apply(null, LPN), pnv.id);

    [["ipe-ledger-prompt-n", pnv.value || ""], ["iped-ledger-prompt-n", pnv.value || ""],
     ["ipe-ledger-prompt-n-name", pnv.name || ""], ["iped-ledger-prompt-n-name", pnv.name || ""],
     ["ipe-ledger-prompt", pv.value || IPE_LEDGER_PROMPT_DEFAULT], ["iped-ledger-prompt", pv.value || IPE_LEDGER_PROMPT_DEFAULT],
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
        var el = q("#" + id); if (!el) return;
        el.checked = cfg().ledgerAutoRun === true;
        // 开关在左：老 style.css 里那条 space-between !important 会把它推回右边，这里用 important 压回来
        try { if (el.parentNode && el.parentNode.tagName === "LABEL") el.parentNode.style.setProperty("justify-content", "flex-start", "important"); } catch(e) {}
    });
    try { ipeLedgerModeRefresh(); } catch(eM) {}
    ["ipe-ledger-auto-hint","iped-ledger-auto-hint"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var reason = String(cfg().ledgerAutoOffReason || "");
        var off = cfg().ledgerAutoRun !== true;
        if (off && reason) {
            el.style.display = "";
            el.style.color = "#c9a227";
            el.textContent = "⚠ 自动挂账不是你关的，是插件自己关的：" + (reason === "shrink" ? "上一轮账本疑似事故被拦下" : "连续两次挂账失败")
                + "。这期间每一楼都不会自动记账。确认 API 正常后，点左边开关重开。";
        } else {
            el.style.display = "none";
            el.textContent = "";
        }
    });
    ["ipe-ledger-nochange","iped-ledger-nochange"].forEach(function(id){
        var el = q("#" + id); if (el) el.checked = cfg().ledgerAllowNoChange === true;
    });
    ["ipe-ledger-stream","iped-ledger-stream"].forEach(function(id){
        var el = q("#" + id); if (el) el.checked = cfg().ledgerStream !== false;
    });
    ["ipe-ledger-idle","iped-ledger-idle"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var v = String(Math.max(0, Math.floor(Number(cfg().ledgerIdleTimeout) || 0)));
        if (el.value !== v && doc.activeElement !== el) el.value = v;
    });
    ["ipe-ledger-effort","iped-ledger-effort"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        if (!el.options || !el.options.length) {
            el.innerHTML = '<option value="">不发（模型默认）</option>'
                + ["minimal","low","medium","high"].map(function(v){ return '<option value="'+v+'">'+v+'</option>'; }).join("");
        }
        el.value = String(cfg().ledgerReasoningEffort || "");
    });
    ["ipe-ledger-maxtok","iped-ledger-maxtok"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var v = String(Math.max(0, Math.floor(Number(cfg().ledgerMaxTokens) || 0)));
        if (el.value !== v && doc.activeElement !== el) el.value = v;
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
/* 改楼（2.17.0）：第 i 楼（0-based）正文改了。现任账本若正是按这楼记的，那是照改前正文记的，作废，
   回退到更早的版本；自动挂账开着就立刻按改后的正文重挂。
   改更早的楼不动账（改个错别字不该丢记忆），只提示；改比账本还高的楼，账本本来就没记到那，不管。
   典型场景：倒退回第 110 楼把回复改掉再续写——以前 110 楼那份「买票去北京」的账原样留着。 */
function ipeLedgerOnEdited(i) {
    var st = ipeLedgerRead();
    var floor = i + 1;
    if (!String(st.current || "").trim() || st.lastFloor < 0) return;
    if (floor > st.lastFloor) return;
    if (floor < st.lastFloor) {
        ipeLedgerStatus("第 " + floor + " 楼改过了，比现任账本（第 " + st.lastFloor + " 楼）早，账本没动；要按改后的正文重记就点「重新挂账」", "#c9a227");
        return;
    }
    ipeLedgerReconcile(i, { silent: true });
    ipeLedgerApplyEP();
    try { ipeLedgerRefreshEditors(); ipeLedgerRefreshEpPreview(); ipeLedgerRefreshBotEditors(); ipeLedgerRenderInline(); } catch(eR) {}
    var st2 = ipeLedgerRead();
    var auto = cfg().ledgerAutoRun === true;
    var msg = null; try { msg = (ctx().chat || [])[i]; } catch(eM) {}
    var rerun = auto && msg && !msg.is_user && msg.is_system !== true;
    ipeLedgerStatus("第 " + floor + " 楼改过了，那楼的账作废"
        + (st2.lastFloor >= 0 ? "，回退到第 " + st2.lastFloor + " 楼的账" : "，账本已清空")
        + (rerun ? "，正在按改后的正文重挂…" : ""), "#c9a227");
    try { console.log("[IPE] 改楼对账", { floor: floor, fallback: st2.lastFloor, rerun: !!rerun }); } catch(eL) {}
    if (rerun) ipeLedgerRun(i, true);
}

function ipeLedgerSync() {
    try { ipeLedgerReconcile(ipeFloorNo()); } catch(eRec) {}   // 先对账再贴耳，幽灵账进不了 prompt
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
    // 一层一账：手动改账 = 修订"这一楼"的账，原楼号不变、不产生同楼旧版
    st.current = next;
    if (st.lastFloor < 0 && next.trim()) st.lastFloor = ipeFloorNo();
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
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.name || "";
    });
    ["ipe-api-endpoint","iped-api-endpoint"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.endpoint || "";
    });
    ["ipe-api-key","iped-api-key"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.key || "";
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
    list.push({ id: id, name: "新模板" + (list.length + 1), value: IPE_DEFAULT_IMAGE_TEMPLATE });
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
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.value || "";
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
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.name || "";
    });
    ["ipe-extract-rules","iped-extract-rules"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.value || "";
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

/* 2.14.3 名字框回写守卫：各刷新函数不再往 document.activeElement（正在打字的那个框）写 value。
   之前每敲一个字就 存 → 整面刷新 → 把存下来的名字写回正在打字的框：
   清空的瞬间存的是兜底名「模板33」，被写回去，iOS 输入法再把「你好」接在后面 = 「模板33你好」；
   写 value 也会打断输入法合成。挂账那边的 ipeLedgerRefreshBotEditors 早有这道守卫，生图这边补齐。
   兜底名只在 change（离开输入框）时写回。 */
function ipeRefreshTemplateEditors() {
    var list = ipeGetBaseTemplates();
    var active = ipeGetActiveTemplateId();
    var item = ipeGetActiveTemplateItem();

    ipeFillSelect("ipe-template-slot", list, active);
    ipeFillSelect("iped-template-slot", list, active);
    ipeFillSelect("ipe-reinject-tpl", list, active);     // 预览区的快捷下拉，与模板预设同一份
    ipeFillSelect("iped-reinject-tpl", list, active);

    ["ipe-template-name","iped-template-name"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.name || "";
    });
    ["ipe-base-template","iped-base-template"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.value || "";
    });
}

function ipeRefreshAnchorEditors() {
    var list = ipeGetAnchorPresets();
    var active = ipeGetActiveAnchorId();
    var item = ipeGetActiveAnchorItem();

    ipeFillSelect("ipe-anchor-slot", list, active);
    ipeFillSelect("iped-anchor-slot", list, active);

    ["ipe-anchor-name","iped-anchor-name"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.name || "";
    });
    ["ipe-char-anchors","iped-char-anchors"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = item.value || "";
    });
    ["ipe-anchor-guide-editor","iped-anchor-guide-editor"].forEach(function(id){
        var el = q("#" + id); if (el && el !== document.activeElement) el.value = ipeGetAnchorUsageGuide();
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

/* ============================================================
   🎨 分层生图（2.11.0）
   老路：一次提取吐一整段 Description，改一处全部重来，环境每楼重提会漂，
   多人动作模型读不清谁在哪。
   新路：还是一次请求，但让副 AI 按四个标签分节输出——
     <camera> 镜头   <env> 环境   <mood> 氛围   <chars> 人物   <pose> 动作与空间关系
   插件机械剥壳（跟挂账认 <ledger> 一个路子），每层一个框、一个锁：
     · 锁住的层不重提，原样喂回去让其他层与之保持一致
     · 环境层：场景没换时副 AI 回 NO_CHANGE，插件沿用本聊天上一楼的环境
     · 只重摇某一层 = 其余三层临时按锁定处理
   模板可用 {Camera} {Env} {Chars} {Pose} 单独放置；{Description} 拿没被单独放置的层。
   老模板只写 {Description} 的照样能用，四层按顺序拼成一段。
   ============================================================ */
var IPE_IMG_LAYERS = ["camera", "env", "mood", "chars", "pose"];
var IPE_IMG_LAYER_LABEL = { camera: "镜头", env: "环境", mood: "氛围", chars: "人物", pose: "动作" };
var IPE_IMG_LAYER_ICON  = { camera: "📷", env: "🌆", mood: "🎞️", chars: "🧍", pose: "🤝" };
var IPE_IMG_LAYER_PH    = { camera: "{Camera}", env: "{Env}", mood: "{Mood}", chars: "{Chars}", pose: "{Pose}" };
/* 可跨楼沿用的层：环境（物理空间几十楼不换）、氛围（一段戏的基调常常连着几楼）。
   副 AI 回 NO_CHANGE 就沿用本聊天上一楼；其他层没这个后门。 */
var IPE_IMG_INHERIT = { env: true, mood: true };
var IPE_IMG_LAYERS_META_KEY = "ipe_img_layers_v1";
var IPE_IMG_NOCHANGE = "NO_CHANGE";
var ipeImgLayersFresh = false;   // 本次预览是否来自成功分层；副 AI 没分层时为 false，注入不拿旧层框填占位符

function ipeImgLayeredOn() { return cfg().imgLayered === true; }
function ipeImgLockKey(l) { return "imgLock" + l.charAt(0).toUpperCase() + l.slice(1); }
function ipeImgLocks(override) {
    var out = {};
    IPE_IMG_LAYERS.forEach(function(l){ out[l] = override ? !!override[l] : cfg()[ipeImgLockKey(l)] === true; });
    return out;
}

/* 本聊天上一次的四层，存 chat_metadata；换聊天自然各用各的 */
function ipeImgLayersRead() {
    try {
        var root = ipeMetaRoot();
        var v = root && root[IPE_IMG_LAYERS_META_KEY];
        if (v && typeof v === "object") return v;
    } catch(e) {}
    return null;
}
function ipeImgLayersSave(layers, floor) {
    try {
        var root = ipeMetaRoot(); if (!root) return;
        var o = { floor: Number(floor) || 0, envFloor: Number(layers && layers.envFloor) || Number(floor) || 0, moodFloor: Number(layers && layers.moodFloor) || Number(floor) || 0, updatedAt: Date.now() };
        IPE_IMG_LAYERS.forEach(function(l){ o[l] = String((layers && layers[l]) || ""); });
        root[IPE_IMG_LAYERS_META_KEY] = o;
        var c = ctx(); if (c && typeof c.saveMetadataDebounced === "function") c.saveMetadataDebounced();
    } catch(e) {}
}

/* 面板里四个框此刻的值（面板优先，抽屉兜底） */
function ipeImgLayerBoxValues() {
    var out = {};
    IPE_IMG_LAYERS.forEach(function(l){
        var a = q("#ipe-layer-" + l), b = q("#iped-layer-" + l);
        out[l] = String((a && a.value) || (b && b.value) || "").trim();
    });
    return out;
}

/* 喂给副 AI 的"上一楼"：环境继承只认本聊天存档（框里的值可能是别的聊天留下的）；
   锁定层以框里的值为准——人改过再锁，就是"照这个来"。 */
function ipeImgPrevLayers(locks) {
    var st = ipeImgLayersRead();
    var box = ipeImgLayerBoxValues();
    var out = { floor: st ? Number(st.floor) || 0 : 0, envFloor: st ? Number(st.envFloor || st.floor) || 0 : 0, moodFloor: st ? Number(st.moodFloor || st.floor) || 0 : 0 };
    IPE_IMG_LAYERS.forEach(function(l){
        var stored = st ? String(st[l] || "").trim() : "";
        if (ipeImgIsNoChange(stored)) stored = "";              // 存档里是哨兵字面量：当没有，不喂给副 AI
        var boxV = String(box[l] || "").trim();
        if (ipeImgIsNoChange(boxV)) boxV = "";
        out[l] = (locks && locks[l] && boxV) ? boxV : stored;
    });
    return out;
}

function ipeImgLayerContract(prev, locks) {
    var lines = [
        "任务：把正文拆成五层英文生图描述，按下面五个标签分节输出。标签外不要写任何东西；不要解释；不要标题；不要代码块；不要中文。",
        "<camera>景别、机位高度、视角、构图、景深。一到两句。</camera>",
        "<env>只写物理空间：地点、室内外、时间段、天气、关键背景与道具、背景人物的数量与动态。不写光线质感和情绪。两到三句。</env>",
        "<mood>这一楼的画面感觉，用画面载体写而不是堆形容词：光的方向与质地、色温、明暗对比、空气感（清透 / 潮湿 / 尘光）、天气细节、整体基调。一到三句。</mood>",
        "<chars>只写本楼实际出场且入镜的角色：按角色锚点校准外貌，再写此刻的服装状态、表情、身体状态（受伤、湿发、绷带等）。</chars>",
        "<pose>动作与空间关系，写成明确的空间句：谁在哪、面朝哪、视线落在哪、手放在哪、身体接触点、相对位置与距离。</pose>"
    ];
    var lockLines = [];
    IPE_IMG_LAYERS.forEach(function(l){
        if (locks && locks[l] && prev && String(prev[l] || "").trim()) lockLines.push("<" + l + ">" + prev[l] + "</" + l + ">");
    });
    if (lockLines.length) {
        lines.push("");
        lines.push("【已锁定的层 · 原样沿用，不要重写】");
        lines.push(lockLines.join("\n"));
        lines.push("锁定层只输出 " + IPE_IMG_NOCHANGE + " 即可；其余层必须与锁定层保持一致（同一空间、同一光线、同一批人）。");
    }
    if (prev && String(prev.env || "").trim() && !(locks && locks.env)) {
        lines.push("");
        lines.push("【上一楼的环境层】");
        lines.push(prev.env);
        lines.push("本楼地点、时间段、天气、道具都没变时，<env> 里只写 " + IPE_IMG_NOCHANGE + "，其余层照常输出。换了场景才重写环境。");
    }
    if (prev && String(prev.mood || "").trim() && !(locks && locks.mood)) {
        lines.push("");
        lines.push("【上一楼的氛围层】");
        lines.push(prev.mood);
        lines.push("本楼光线、色温、情绪基调都没变时，<mood> 里只写 " + IPE_IMG_NOCHANGE + "。情绪转折、光线变化就重写。");
    }
    return lines.join("\n");
}

/* 机械剥壳：四个标签各取一段。漏闭标签就取到下一个开标签或末尾；大小写、空格都容忍。 */
function ipeImgParseLayers(txt) {
    var s0 = String(txt || "").replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    var out = { found: 0 };
    IPE_IMG_LAYERS.forEach(function(l){
        var re = new RegExp("<\\s*" + l + "\\s*>([\\s\\S]*?)(?:<\\s*\\/\\s*" + l + "\\s*>|(?=<\\s*(?:camera|env|mood|chars|pose)\\s*>)|$)", "i");
        var m = s0.match(re);
        if (m) { out[l] = String(m[1] || "").trim(); out.found++; }
        else out[l] = "";
    });
    return out;
}

/* 副 AI 写 NO_CHANGE 时常带句号、引号、反引号或把下划线写成空格（"NO_CHANGE." / "`NO_CHANGE`" / "No change"）。
   2.14.2 前只认一字不差的 NO_CHANGE，"NO_CHANGE." 就当成真环境描述落框、拼进提示词，
   还会存进上一楼记忆、下一楼继续沿用——截图里 NO_CHANGE. NO_CHANGE. 就是这么来的。 */
function ipeImgIsNoChange(v) {
    return String(v || "").replace(/[\s"'`*_\-.。!！,，;；:：()（）\[\]]/g, "").toUpperCase() === "NOCHANGE";
}

/* 合账：锁定层用旧值；NO_CHANGE 或空 → 有旧值就沿用；否则收新值 */
function ipeImgMergeLayers(parsed, prev, locks, floor) {
    var out = { notes: [], envFloor: Number(floor) || 0, moodFloor: Number(floor) || 0 };
    IPE_IMG_LAYERS.forEach(function(l){
        var v = String((parsed && parsed[l]) || "").trim();
        var prevV = prev ? String(prev[l] || "").trim() : "";
        if (ipeImgIsNoChange(prevV)) prevV = "";                // 老版本存下来的 "NO_CHANGE." 不算上一楼内容，不再往下传
        var label = IPE_IMG_LAYER_LABEL[l] || l;
        var fk = l + "Floor";                                   // envFloor / moodFloor：这层内容来自哪一楼
        var prevFloor = prev ? (Number(prev[fk]) || Number(prev.floor) || 0) : 0;
        if (locks && locks[l] && prevV) { out[l] = prevV; if (IPE_IMG_INHERIT[l]) out[fk] = prevFloor; return; }
        if (!v || ipeImgIsNoChange(v)) {
            if (prevV) {
                out[l] = prevV;
                if (IPE_IMG_INHERIT[l]) { out[fk] = prevFloor; out.notes.push(label + "沿用第 " + prevFloor + " 楼"); }
                else out.notes.push(label + "层沿用上一楼");
            } else {
                out[l] = "";
                out.notes.push(label + "层为空");
            }
            return;
        }
        out[l] = v;
    });
    return out;
}

function ipeImgJoinLayers(layers, skip) {
    var parts = [];
    IPE_IMG_LAYERS.forEach(function(l){
        if (skip && skip[l]) return;
        var v = String((layers && layers[l]) || "").trim();
        if (v) parts.push(v);
    });
    return parts.join(" ");
}

function ipeImgSetLayerBoxes(layers) {
    IPE_IMG_LAYERS.forEach(function(l){
        ["ipe-layer-", "iped-layer-"].forEach(function(pre){
            var el = q("#" + pre + l); if (el) el.value = String((layers && layers[l]) || "");
        });
    });
}

/* 面板 / 抽屉：四行框 + 锁 + 只重摇这层 */
function ipeImgLayerRowsHTML(prefix, drawer) {
    var h = "";
    IPE_IMG_LAYERS.forEach(function(l){
        var label = IPE_IMG_LAYER_ICON[l] + " " + IPE_IMG_LAYER_LABEL[l];
        if (drawer) {
            h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">'
               + '<span style="font-size:12px">' + label + '</span>'
               + '<span style="display:flex;gap:8px;align-items:center;font-size:12px">'
               + '<label style="display:inline-flex;align-items:center;gap:4px">🔒 锁 <input type="checkbox" id="' + prefix + '-lock-' + l + '"></label>'
               + '<input type="button" id="' + prefix + '-reroll-' + l + '" class="menu_button" value="只重摇这层">'
               + '</span></div>'
               + '<textarea id="' + prefix + '-layer-' + l + '" class="text_pole" rows="2"></textarea>';
        } else {
            h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;color:#888;font-size:12px">'
               + '<span>' + label + '</span>'
               + '<span style="display:flex;gap:8px;align-items:center">'
               + '<label style="display:flex;flex-direction:row;align-items:center;gap:4px">🔒 锁 <input type="checkbox" id="' + prefix + '-lock-' + l + '"></label>'
               + '<button type="button" id="' + prefix + '-reroll-' + l + '" class="ipe-btn" style="flex:none;padding:2px 8px">只重摇这层</button>'
               + '</span></div>'
               + '<textarea id="' + prefix + '-layer-' + l + '" rows="2"></textarea>';
        }
    });
    return h;
}

function ipeImgRefreshLayerUI() {
    var on = ipeImgLayeredOn();
    ["ipe-layered", "iped-layered"].forEach(function(id){ var el = q("#" + id); if (el) el.checked = on; });
    ["ipe-layers-box", "iped-layers-box"].forEach(function(id){ var el = q("#" + id); if (el) el.style.display = on ? "" : "none"; });
    IPE_IMG_LAYERS.forEach(function(l){
        ["ipe-lock-", "iped-lock-"].forEach(function(pre){
            var el = q("#" + pre + l); if (el) el.checked = cfg()[ipeImgLockKey(l)] === true;
        });
    });
    var st = ipeImgLayersRead();
    ipeImgSetLayerBoxes(st || {});
}

function ipeImgBindLayerUI() {
    ["ipe-layered", "iped-layered"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.addEventListener("change", function(){
            save("imgLayered", !!el.checked);
            ipeImgRefreshLayerUI();
            setStatus(el.checked ? "分层提取已开：镜头 / 环境 / 氛围 / 人物 / 动作，各一框一锁" : "分层提取已关，回到整段 Description", "#6ec577");
        });
    });
    IPE_IMG_LAYERS.forEach(function(l){
        ["ipe", "iped"].forEach(function(pre){
            var lk = q("#" + pre + "-lock-" + l);
            if (lk && !lk.__ipeBound) { lk.__ipeBound = true; lk.addEventListener("change", function(){
                save(ipeImgLockKey(l), !!lk.checked);
                var o = q("#" + (pre === "ipe" ? "iped" : "ipe") + "-lock-" + l); if (o) o.checked = lk.checked;
                setStatus((lk.checked ? "已锁定" : "已解锁") + IPE_IMG_LAYER_LABEL[l] + "层" + (lk.checked ? "：之后提取原样沿用框里这段" : ""), "#6ec577");
            }); }
            var rr = q("#" + pre + "-reroll-" + l);
            if (rr && !rr.__ipeBound) { rr.__ipeBound = true; rr.addEventListener("click", function(){ onRerollLayer(l); }); }
            var ta = q("#" + pre + "-layer-" + l);
            if (ta && !ta.__ipeBound) { ta.__ipeBound = true; ta.addEventListener("input", function(){
                var o = q("#" + (pre === "ipe" ? "iped" : "ipe") + "-layer-" + l); if (o && o !== ta) o.value = ta.value;
                var joined = ipeImgJoinLayers(ipeImgLayerBoxValues());
                ipeImgLayersFresh = true;
                currentDesc = joined; setPreview(joined);
            }); }
        });
    });
}

function buildVisionUserPrompt(text, supplement, lockOverride) {
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

    if (ipeImgLayeredOn()) {
        var locks = ipeImgLocks(lockOverride);
        user += "\n\n" + ipeImgLayerContract(ipeImgPrevLayers(locks), locks);
        return user;
    }

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

async function callAPI(text, supplement, lockOverride) {
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
            { role: "user", content: buildVisionUserPrompt(text, supplement || "", lockOverride) }
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

/* ============================================================
   🐚 通知卡（2.12.2）
   toastr 那块红是酒馆的默认皮，跟小海螺一点不搭。报错也要好看：
   开灯是雾蓝米霜、关灯是深色玻璃，错误只用一条莫兰迪砖红细边，不整块糊红。
   sticky 的带「知道了」按钮常驻；不 sticky 的底下一条细线走完自己收起，
   鼠标放上去暂停。最多叠 4 张，老的非常驻先走。关键样式全内联，不吃 CSS 缓存的亏。
   ============================================================ */
/* 卡片上的动作按钮（如「重新打开自动挂账」）：点了先干活再关卡 */
function ipeNoticeActionsHTML(opts, accent, pad, fs) {
    var acts = (opts && Array.isArray(opts.actions)) ? opts.actions : [];
    var h = "";
    for (var i = 0; i < acts.length; i++) {
        var a = acts[i]; if (!a || !a.label) continue;
        h += '<button type="button" class="ipe-notice-act" data-ipe-act="' + i + '" style="padding:' + pad + ';border-radius:9px;border:1px solid ' + accent + ';background:' + accent + ';color:#fff;font-size:' + fs + ';cursor:pointer;font-family:inherit;font-weight:600">' + String(a.label).replace(/[<>&]/g, "") + '</button>';
    }
    return h;
}
function ipeNoticeBindActions(root, opts, closeFn) {
    try {
        var acts = (opts && Array.isArray(opts.actions)) ? opts.actions : [];
        var btns = root.querySelectorAll(".ipe-notice-act");
        for (var i = 0; i < btns.length; i++) (function(b){
            var a = acts[Number(b.getAttribute("data-ipe-act"))];
            b.addEventListener("click", function(){ try { if (a && typeof a.onClick === "function") a.onClick(); } catch(e) {} closeFn(); });
        })(btns[i]);
    } catch(e) {}
}

/* 浮层挂哪儿：挂 <html>，不挂 body。
   实测（2.12.5 自检）：某些酒馆环境里 body 被加了 transform / filter，fixed 元素就不再以屏幕为参照，
   而是以 body 的盒子为参照，body 高度又是 0，于是 bottom:88px 算出来在屏幕上方 -88px。
   放大编辑框第一次塌成顶上一条灰也是它。<html> 没人动，挂那儿 fixed 才是真 fixed。 */
function ipeOverlayHost(d) {
    d = d || ipeRootDocument();
    return d.documentElement || d.body;
}
/* 保险：挂完量一下，真飞出屏幕就用 visualViewport 算像素 top 硬摆回来 */
function ipeNoticeFixPosition(st) {
    try {
        if (!st || !st.getBoundingClientRect) return;
        var rw = ipeRootWindow() || window;
        var vv = rw.visualViewport;
        var vh = (vv && vv.height) || rw.innerHeight || 0;
        var vtop = (vv && vv.offsetTop) || 0;
        if (!vh) return;
        var rc = st.getBoundingClientRect();
        var off = rc.height > 0 && (rc.top < vtop || rc.top > vtop + vh - 60);
        if (!off && !st.__ipePinned) return;
        var top = vtop + 14;
        st.style.setProperty("bottom", "auto", "important");
        st.style.setProperty("top", Math.round(top) + "px", "important");
        st.__ipePinned = true;
    } catch(e) {}
}

function ipeNoticeStack() {
    var d = ipeRootDocument();
    var st = d.getElementById("ipe-notice-stack");
    if (st) return st;
    st = d.createElement("div"); st.id = "ipe-notice-stack";
    /* 贴顶不贴底（照小红霞的做法）：body 被加 transform 时 fixed 以 body 盒子为参照、body 高 0，
       bottom:88px 会算到屏幕上方；top:22px 不管参照是谁都落在屏幕顶部 22px。 */
    /* 水平居中（群友要求）：left:50% + translateX(-50%)，跟系统通知一个位置，也不挡右上角 */
    st.style.cssText = "position:fixed;left:50%;right:auto;top:22px;bottom:auto;width:min(280px,calc(100vw - 28px));display:flex;flex-direction:column;gap:6px;pointer-events:none;margin:0;padding:0";
    /* 面板被强制 translateZ(0) 走了独立合成层；WebKit 上非合成层的浮层有时会被合成层盖住、不认 z-index。
       通知栈同样开合成层，跟面板站到同一条起跑线上。 */
    try { st.style.setProperty("z-index", "2147483647", "important"); } catch(e) {}
    try { st.style.setProperty("transform", "translateX(-50%) translateZ(0)", "important"); st.style.setProperty("will-change", "transform", "important"); st.style.setProperty("visibility", "visible", "important"); st.style.setProperty("display", "flex", "important"); } catch(e) {}
    try { var rw = ipeRootWindow(); if (rw && rw.innerWidth && rw.innerWidth <= 480) { st.style.width = "min(240px,calc(100vw - 24px))"; st.style.top = "12px"; } } catch(e) {}
    ipeOverlayHost(d).appendChild(st);
    try {
        var rw2 = ipeRootWindow() || window;
        if (rw2.visualViewport && !rw2.__ipeNoticeVVBound) {
            rw2.__ipeNoticeVVBound = true;
            var re = function(){ var s2 = d.getElementById("ipe-notice-stack"); if (s2) ipeNoticeFixPosition(s2); };
            rw2.visualViewport.addEventListener("resize", re); rw2.visualViewport.addEventListener("scroll", re);
        }
    } catch(e) {}
    return st;
}

function ipeNotice(opts) {
    opts = opts || {};
    var kind = opts.kind || "error";                       // error | ok | info
    var sticky = opts.sticky === true;
    var ms = Number(opts.timeout) || (kind === "error" ? 9000 : 6000);
    var mist = false; try { mist = cfg().mistTheme === true; } catch(e) {}
    var d = ipeRootDocument();
    var stack = ipeNoticeStack();

    var accent = kind === "error" ? (mist ? "#B8756C" : "#D9A19A")
               : kind === "ok"    ? (mist ? "#7C93A6" : "#9CC5B0")
               :                    (mist ? "#7C93A6" : "#A9BDD3");
    var bg  = mist ? "linear-gradient(168deg, rgba(247,248,250,.98) 0%, rgba(236,240,244,.98) 100%)" : "rgba(30,31,36,.94)";
    var fg  = mist ? "#4A5662" : "#e2e2e2";
    var sub = mist ? "#6b7a88" : "#b0b0b0";
    var bd  = mist ? "rgba(140,156,172,.30)" : "rgba(255,255,255,.10)";

    var card = d.createElement("div");
    card.className = "ipe-notice ipe-notice-" + kind + (mist ? " ipe-mist" : "");
    card.setAttribute("role", "alert");
    card.setAttribute("data-ipe-sticky", sticky ? "1" : "0");
    card.style.cssText = "pointer-events:auto;position:relative;overflow:hidden;border-radius:10px;border:1px solid " + bd
        + ";border-left:3px solid " + accent + ";background:" + bg + ";color:" + fg
        + ";box-shadow:0 8px 24px rgba(0,0,0," + (mist ? ".14" : ".40") + ");font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;font-size:11.5px;line-height:1.4;padding:7px 9px 6px"
        + ";opacity:1;visibility:visible;display:block;max-width:100%;box-sizing:border-box";
    /* 不用 backdrop-filter、不用 JS 定时把 opacity 从 0 拉到 1：iOS WebKit 对「毛玻璃 + 淡入」偶发不上屏，
       卡片就存在于 DOM 却看不见。入场动画交给 style.css 的 .ipe-notice 关键帧，CSS 缺了也只是没动画。 */
    card.innerHTML =
        '<div style="display:flex;align-items:flex-start;gap:6px">'
      +   '<span style="font-size:12px;line-height:1.3;flex:none">' + (opts.icon || "🐚") + '</span>'
      +   '<div style="flex:1;min-width:0">'
      +     '<div class="ipe-notice-title" style="font-weight:600;font-size:12px;color:' + fg + ';-webkit-text-fill-color:' + fg + '"></div>'
      +     '<div class="ipe-notice-body" style="margin-top:3px;white-space:pre-wrap;word-break:break-word;color:' + sub + ';-webkit-text-fill-color:' + sub + ';max-height:96px;overflow:auto;-webkit-overflow-scrolling:touch"></div>'
      +   '</div>'
      +   '<button type="button" class="ipe-notice-x" aria-label="关闭" style="flex:none;border:0;background:transparent;color:' + sub + ';font-size:16px;line-height:1;cursor:pointer;padding:0 2px;margin:-2px -4px 0 0;font-family:inherit">×</button>'
      + '</div>'
      + (sticky
          ? '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px;flex-wrap:wrap">' + ipeNoticeActionsHTML(opts, accent, "3px 10px", "11.5px") + '<button type="button" class="ipe-notice-ok" style="padding:3px 10px;border-radius:7px;border:1px solid ' + accent + ';background:transparent;color:' + accent + ';font-size:11.5px;cursor:pointer;font-family:inherit;line-height:1.5">知道了</button></div>'
          : '<div class="ipe-notice-bar" style="position:absolute;left:0;bottom:0;height:2px;width:100%;background:' + accent + ';opacity:.55;transform-origin:left center;transform:scaleX(1)"></div>');
    card.querySelector(".ipe-notice-title").textContent = opts.title || "小海螺";
    card.querySelector(".ipe-notice-body").textContent  = opts.body  || "";

    var closed = false;
    function close() {
        if (closed) return; closed = true;
        if (card.__ipeTimer) { clearTimeout(card.__ipeTimer); card.__ipeTimer = null; }
        try { if (card.__ipeMirror && card.__ipeMirror.parentNode) card.__ipeMirror.parentNode.removeChild(card.__ipeMirror); } catch(e) {}
        try { card.style.transition = "opacity .18s ease, transform .18s ease"; card.style.opacity = "0"; card.style.transform = "translateY(8px)"; } catch(e) {}
        setTimeout(function(){ try { if (card.parentNode) card.parentNode.removeChild(card); } catch(e) {} }, 200);
    }
    card.__ipeClose = close;
    card.querySelector(".ipe-notice-x").addEventListener("click", close);
    var okb = card.querySelector(".ipe-notice-ok"); if (okb) okb.addEventListener("click", close);
    ipeNoticeBindActions(card, opts, close);

    stack.appendChild(card);
    ipeNoticeFixPosition(stack);
    /* 自检：挂上去之后量一下。量得到就只有这一张卡；量不到（尺寸为零 / 飞出屏幕）才在面板里补一条镜像横幅，
       别让人正常情况下看见两份。 */
    var bad = true;
    try {
        var rc = card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        var rw3 = ipeRootWindow();
        var vh3 = (rw3 && rw3.innerHeight) || 0;
        bad = !rc || rc.width < 10 || rc.height < 10 || (vh3 && (rc.bottom < 0 || rc.top > vh3));
        if (typeof console !== "undefined") console.log("[IPE] 通知卡", bad ? "⚠ 浮层不可见（已在面板内镜像）" : "✓ 浮层可见", { title: opts.title, rect: rc ? { top: Math.round(rc.top), left: Math.round(rc.left), w: Math.round(rc.width), h: Math.round(rc.height) } : null, doc: d === document ? "self" : "top" });
    } catch(e) {}
    if (bad) ipeNoticeMirror(card, opts, accent, close);

    if (!sticky) {
        var bar = card.querySelector(".ipe-notice-bar");
        function arm(dur) {
            try { if (bar) { bar.style.transition = "none"; bar.style.transform = "scaleX(1)"; } } catch(e) {}
            setTimeout(function(){ try { if (bar) { bar.style.transition = "transform " + dur + "ms linear"; bar.style.transform = "scaleX(0)"; } } catch(e) {} }, 30);
            card.__ipeTimer = setTimeout(close, dur);
        }
        arm(ms);
        card.addEventListener("mouseenter", function(){ if (card.__ipeTimer) { clearTimeout(card.__ipeTimer); card.__ipeTimer = null; } try { if (bar) { bar.style.transition = "none"; bar.style.transform = "scaleX(1)"; } } catch(e) {} });
        card.addEventListener("mouseleave", function(){ if (!closed && !card.__ipeTimer) arm(3000); });
    }
    // 最多叠 4 张：老的、非常驻的先走
    try {
        var all = stack.querySelectorAll(".ipe-notice");
        for (var i = 0; i < all.length - 4; i++) if (all[i].getAttribute("data-ipe-sticky") !== "1" && all[i].__ipeClose) all[i].__ipeClose();
    } catch(e) {}
    return card;
}

/* 面板内镜像：浮层卡不管因为什么原因看不见（层级、WebKit 不上屏、被别的插件盖住），
   面板里那条横幅一定看得见——人报错的时候眼睛就在面板上。浮层关了镜像跟着关，反之亦然。 */
function ipeNoticeMirror(card, opts, accent, closeAll) {
    try {
        var hosts = [];
        var panel = q("#ipe-panel .ipe-sections"); if (panel) hosts.push(panel);
        var drawer = q("#ipe-drawer .inline-drawer-content"); if (drawer) hosts.push(drawer);
        if (!hosts.length) return;
        var host = hosts[0];
        var mist = false; try { mist = cfg().mistTheme === true; } catch(e) {}
        var m = host.ownerDocument.createElement("div");
        m.className = "ipe-notice-mirror";
        m.setAttribute("data-ipe-sticky", card.getAttribute("data-ipe-sticky"));
        m.style.cssText = "margin:8px 12px 2px;padding:10px 12px;border-radius:12px;border:1px solid " + (mist ? "rgba(140,156,172,.30)" : "rgba(255,255,255,.10)")
            + ";border-left:3px solid " + accent + ";background:" + (mist ? "rgba(255,255,255,.70)" : "rgba(255,255,255,.05)") + ";color:" + (mist ? "#4A5662" : "#dedede")
            + ";font-size:12.5px;line-height:1.5;display:block";
        m.innerHTML = '<div style="display:flex;align-items:flex-start;gap:8px">'
            + '<span style="flex:none">' + (opts.icon || "🐚") + '</span>'
            + '<div style="flex:1;min-width:0"><div class="ipe-notice-title" style="font-weight:600;-webkit-text-fill-color:currentColor"></div><div class="ipe-notice-body" style="margin-top:3px;white-space:pre-wrap;word-break:break-word;opacity:.85;-webkit-text-fill-color:currentColor"></div></div>'
            + '<button type="button" class="ipe-notice-x" aria-label="关闭" style="flex:none;border:0;background:transparent;color:inherit;opacity:.7;font-size:16px;line-height:1;cursor:pointer;padding:0 2px;font-family:inherit">×</button></div>'
            + (opts.sticky === true ? '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap">' + ipeNoticeActionsHTML(opts, accent, "5px 14px", "12px") + '<button type="button" class="ipe-notice-ok" style="padding:5px 14px;border-radius:9px;border:1px solid ' + accent + ';background:transparent;color:' + accent + ';font-size:12px;cursor:pointer;font-family:inherit">知道了</button></div>' : '');
        m.querySelector(".ipe-notice-title").textContent = opts.title || "小海螺";
        m.querySelector(".ipe-notice-body").textContent = opts.body || "";
        m.querySelector(".ipe-notice-x").addEventListener("click", closeAll);
        var okb = m.querySelector(".ipe-notice-ok"); if (okb) okb.addEventListener("click", closeAll);
        ipeNoticeBindActions(m, opts, closeAll);
        host.insertBefore(m, host.firstChild);
        card.__ipeMirror = m;
        // 镜像也最多 4 条
        var all = host.querySelectorAll(".ipe-notice-mirror");
        for (var i = all.length - 1; i >= 4; i--) if (all[i].getAttribute("data-ipe-sticky") !== "1" && all[i].parentNode) all[i].parentNode.removeChild(all[i]);
    } catch(e) {}
}

/* 让用户不用真把 API 弄坏就能看一眼报错卡长什么样、在哪儿出现 */
function ipeNoticeDemo() {
    var card = ipeShowApiFailurePopup("演示用，账本没有任何变化。真出错时就长这样：常驻不消失，点「知道了」才走。", false,
        { sticky: true, title: "挂账失败 · 账本还是上一份（演示）" });
    /* 自检报告写进卡片正文（镜像里也能读到）：浮层到底在哪、多大、哪个文档、算出来的样式是什么 */
    setTimeout(function(){
        try {
            var d = ipeRootDocument(), rw = ipeRootWindow() || window;
            var st = d.getElementById("ipe-notice-stack");
            var cs = (card && (d.defaultView || rw).getComputedStyle) ? (d.defaultView || rw).getComputedStyle(card) : null;
            var ss = (st && (d.defaultView || rw).getComputedStyle) ? (d.defaultView || rw).getComputedStyle(st) : null;
            var rc = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
            var rs = st && st.getBoundingClientRect ? st.getBoundingClientRect() : null;
            var vv = rw.visualViewport;
            var pnl = q("#ipe-panel"); var rp = pnl && pnl.getBoundingClientRect ? pnl.getBoundingClientRect() : null;
            function r4(x){ return x ? Math.round(x.left) + "," + Math.round(x.top) + " " + Math.round(x.width) + "×" + Math.round(x.height) : "无"; }
            var lines = [
                "—— 自检 v" + IPE_VERSION + " ——",
                "文档: " + (d === document ? "本页" : "顶层") + "　栈父级: " + (st && st.parentNode ? st.parentNode.tagName : "无") + (st && st.__ipePinned ? "（已用像素钉住）" : "") + "　卡片在DOM: " + (card && card.isConnected ? "是" : "否"),
                "视口: " + rw.innerWidth + "×" + rw.innerHeight + (vv ? "　visualViewport: " + Math.round(vv.width) + "×" + Math.round(vv.height) + " @" + Math.round(vv.offsetLeft) + "," + Math.round(vv.offsetTop) : ""),
                "栈 rect: " + r4(rs) + "　卡 rect: " + r4(rc) + "　面板 rect: " + r4(rp),
                ss ? ("栈样式: pos=" + ss.position + " z=" + ss.zIndex + " disp=" + ss.display + " vis=" + ss.visibility + " op=" + ss.opacity + " bottom=" + ss.bottom + " top=" + ss.top) : "栈样式: 拿不到",
                cs ? ("卡样式: disp=" + cs.display + " vis=" + cs.visibility + " op=" + cs.opacity + " bg=" + cs.backgroundColor) : "卡样式: 拿不到"
            ];
            var txt = lines.join("\n");
            // 自检只进控制台；只有浮层没量到（走了镜像）时才把报告写进镜像正文，方便截图给开发者
            if (card && card.__ipeMirror) { var b = card.__ipeMirror.querySelector(".ipe-notice-body"); if (b) b.textContent += "\n\n" + txt; }
            if (typeof console !== "undefined") console.log("[IPE] 通知卡自检\n" + txt);
        } catch(e) {}
    }, 120);
}

/* opts.sticky：不自动消失，必须手点。挂账失败用这个——
   人若没看见弹窗就以为账挂上了，剧情接着走、账本却停在上一楼。
   生图失败不用：它有自动重试，常驻反而吵。 */
function ipeShowApiFailurePopup(msg, willRetry, opts) {
    opts = opts || {};
    var title = opts.title || "小海螺 · 请求失败";
    var body = msg || "API 暂时不可用。";
    if (willRetry) body += "\n10 秒后自动重试一次。";
    try {
        return ipeNotice({ kind: "error", title: title, body: body, sticky: opts.sticky === true });
    } catch(e) {
        try { alert(title + "\n" + body); } catch(_) {}
    }
}

function ipeScheduleApiRetry(text, supplement, autoInjectNow, targetIdx, retryAttempt, msg, lockOverride) {
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
                // 这 10 秒里要是 swipe / 重roll / 手改了这一楼，正文已经不是当初那份——
                // 再把旧描述注进新 swipe 就是张冠李戴。楼变了就不补注了。
                if (String(target.mes || "") !== String(text || "")) {
                    setStatus("自动重试已取消：这一楼内容已变化（swipe/重roll/编辑）", "#888");
                    return;
                }
            }
            setStatus("正在自动重试 API 请求…", "#6ec577");
            runExtract(text, supplement || "", autoInjectNow, targetIdx, retryAttempt + 1, lockOverride);
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
    setTimeout(function(){ ipeRefreshApiProfileEditors(); ipeRefreshSystemPromptEditors(); ipeRefreshTemplateEditors(); ipeRefreshAnchorEditors(); ipeRefreshRuleEditors(); ipeSetStopButtonsState(!!ipeAbortController); try { ipeImgBindLayerUI(); ipeImgRefreshLayerUI(); } catch(eL) {} try { ipeInstallZoomButtons(); } catch(eZ) {} try { ipeRefreshSuppPresets(); } catch(eS) {} try { ipeInstallMesButtonsObserver(); ipeInstallMesButtons(); } catch(eM) {} }, 120);
    setTimeout(function(){ try { ipeInstallZoomButtons(); } catch(eZ) {} }, 2500);   // 抽屉晚到也补上
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
    /* 月灰入米霜 · SVG 胶囊皮肤（按钮外壳透明，视觉全由 SVG 承担） */
    btn.innerHTML = '<svg viewBox="0 0 120 44" xmlns="http://www.w3.org/2000/svg" aria-label="IPE" style="height:100%;width:auto;display:block;pointer-events:none"><defs><linearGradient id="pkIPE-bg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#B0B1CF"/><stop offset="100%" stop-color="#F1E2D2"/></linearGradient></defs><rect x="1" y="1" width="118" height="42" rx="21" fill="url(#pkIPE-bg)"/><circle cx="24" cy="22" r="7" fill="none" stroke="#FBF3E8" stroke-width="1.2" opacity="0.7"><animate attributeName="r" values="6;16" dur="3.4s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.7;0" dur="3.4s" repeatCount="indefinite"/></circle><g transform="translate(9.5 10.5) scale(0.48)"><path d="M25 24 a1.5 1.5 0 0 1 -3 0 a3.5 3.5 0 0 1 7 0 a6 6 0 0 1 -12 0 a9 9 0 0 1 18 0" fill="none" stroke="#FDF7EE" stroke-width="3.2" stroke-linecap="round"/></g><text x="47" y="28.5" font-size="16.5" font-weight="700" fill="#797EAC" letter-spacing="2.5" font-family="-apple-system,sans-serif">IPE</text></svg>';
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
    imp("height", "30px");
    imp("min-height", "30px");
    imp("padding", "0");
    imp("border-radius", "999px");
    imp("border", "none");
    imp("background", "transparent");
    imp("color", "#ffffff");
    imp("font-size", "13px");
    imp("font-weight", "700");
    imp("line-height", "1");
    btn.style.boxShadow = "none"; /* 不带 important：给脉冲动画让路 */
    imp("filter", "drop-shadow(0 6px 14px rgba(0,0,0,.30))");
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
        '<textarea id="ipe-base-template" rows="6" placeholder="&lt;draw&gt;{Description}&lt;/draw&gt;"></textarea>'+
        '<div class="ipe-hint">可无限新增模板。留空即用内置 &lt;draw&gt;{Description}&lt;/draw&gt;。用 {Description} 标记描述文本的插入位置；分层模式可用 {Camera} {Env} {Mood} {Chars} {Pose}，整段用 &lt;draw&gt;…&lt;/draw&gt; 包住，挂账时按标签对剥干净。两种都写也行：哪一行的占位符全空，那一整行连标签一起不输出，分层与整段共用一张模板</div>'+
        '<div class="ipe-preview-actions" style="margin-top:8px">'+
            '<button id="ipe-pack-export" class="ipe-btn" type="button">\u2B07 导出全部预设包</button>'+
            '<button id="ipe-pack-export-cur" class="ipe-btn" type="button">\u2B07 只导出当前这套</button>'+
            '<button id="ipe-pack-import" class="ipe-btn" type="button">\u2B06 导入预设包</button>'+
        '</div>'+
        '<input type="file" id="ipe-pack-file" accept=".json,application/json" style="display:none">'+
        '<div class="ipe-hint">包里装：模板 / 提取规则 / 系统提示 / 通用锚点规则，不含角色锚点（那是各人自己卡的）、不含 API 与密钥。导入按名字合并：新名字追加，同名覆盖前会问一句。「只导出当前这套」= 当前选中的模板、规则、系统提示各一份，发给别人用这个。角色锚点要备份的话，去锚点区点「备份锚点」。</div>');

    h += secHTML("char-anchors","角色锚点", true,
        '<label>锚点预设<select id="ipe-anchor-slot"></select></label>'+
        '<label>锚点名称<input type="text" id="ipe-anchor-name" value="" placeholder="例如：陆星河 / 苑无忧"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-anchor-add" class="ipe-btn" type="button">新增锚点</button>'+
            '<button id="ipe-anchor-delete" class="ipe-btn" type="button">删除当前</button>'+
            '<button id="ipe-pack-export-anchors" class="ipe-btn" type="button" title="只导出角色锚点，给自己备份换设备用">\u2B07 备份锚点</button>'+
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
        '<div style="margin-bottom:6px;color:#888;font-size:12px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">分层提取（镜头 / 环境 / 氛围 / 人物 / 动作） <input type="checkbox" id="ipe-layered"></label></div>'+
        '<div id="ipe-status" class="ipe-preview-status">等待新消息…</div>'+
        '<div id="ipe-layers-box" style="display:none">'+
            ipeImgLayerRowsHTML("ipe", false)+
            '<div class="ipe-hint" style="margin-top:6px">锁住的层不重提，原样沿用框里那段；「只重摇这层」= 其余各层临时锁定。场景没换时环境层、基调没变时氛围层，自动沿用本聊天上一楼。模板可用 {Camera} {Env} {Mood} {Chars} {Pose} 单独放置，{Description} 拿剩下的层；只写 {Description} 就是五层拼成一段。下面这框是拼好的整段，直接改也行。</div>'+
        '</div>'+
        '<textarea id="ipe-preview-text" rows="6" placeholder="生成的 Description 将显示在这里…"></textarea>'+
        '<label>补充指令<input type="text" id="ipe-supplement" placeholder="例：这段是冷战不是撒娇"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px;align-items:center"><select id="ipe-supp-presets" style="flex:1;min-width:0"><option value="">常用短语…</option></select>'+
        '<button id="ipe-supp-save" class="ipe-btn" style="flex:none" title="把补充指令框里这句存起来">存为常用</button>'+
        '<button id="ipe-supp-del" class="ipe-btn" style="flex:none" title="删掉下拉里选中的那条">删</button></div>'+
        '<div class="ipe-preview-actions">'+
        '<button id="ipe-btn-save-now" class="ipe-btn">保存设置</button><button id="ipe-btn-extract" class="ipe-btn">手动提取</button>'+
        '<button id="ipe-btn-stop" class="ipe-btn" disabled>打断请求</button>'+
        '<button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>'+
        '<button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button></div>'+
        '<div class="ipe-preview-actions" style="margin-top:6px;align-items:center"><select id="ipe-reinject-tpl" style="flex:1;min-width:0"></select>'+
        '<button id="ipe-btn-reinject" class="ipe-btn" style="flex:none">换画风重注入</button></div>'+
        '<div class="ipe-hint">不重新提取：换个基础模板，把这楼楼尾那块 &lt;draw&gt; 按新模板重拼一遍替换掉，旧的不留。这里选的就是「基础模板」里的模板预设，两边同步。</div>');

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
        '<div class="ipe-preview-actions" id="ipe-ledger-reconcile-box" style="display:none;margin-top:6px">'+
            '<button id="ipe-ledger-reconcile" class="ipe-btn" type="button">\uD83D\uDD04 重roll完点我对账（删楼不用管）</button>'+
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
        '<div class="ipe-preview-actions">'+
            '<button id="ipe-ledger-compress" class="ipe-btn" type="button" title="让副 AI 合并已了结的支线、精简语言；压完先预览，采用才落账">\uD83D\uDDDC 压缩一版</button>'+
            '<button id="ipe-ledger-export" class="ipe-btn" type="button">\u2B07 \u5BFC\u51FA\u8D26\u672C</button>'+
            '<button id="ipe-ledger-import" class="ipe-btn" type="button">\u2B06 \u5BFC\u5165\u8D26\u672C</button>'+
            '<button id="ipe-ledger-ep" class="ipe-btn" type="button">\u{1F50D} \u770B\u8D34\u8033</button>'+
            '<button id="ipe-notice-demo" class="ipe-btn" type="button" title="看看报错卡长什么样，不动账本">\uD83D\uDD14 试一下报错卡</button>'+
        '</div>'+
        '<input type="file" id="ipe-ledger-file" accept=".json,application/json" style="display:none">'+
        '<div class="ipe-preview-actions" style="margin-top:6px;align-items:center"><select id="ipe-ledger-inherit-sel" style="flex:1;min-width:0"><option value="">从别的聊天继承账本…</option></select>'+
        '<button id="ipe-ledger-inherit" class="ipe-btn" style="flex:none" type="button">继承这份</button></div>'+
        '<div class="ipe-hint">同一张卡开新聊天时用：把别的聊天的现任账本复制过来当起手（★ 是同一个角色的）。盖本聊天当前楼号的戳，这里原有的账本先进历史。</div>'+
        '<div id="ipe-ledger-ep-box" style="display:none;margin-top:6px">'+
            '<div style="font-size:12px;opacity:.7;margin-bottom:4px">\u{1F50D} \u8D34\u8033\u81EA\u68C0\uFF08\u53EA\u8BFB\uFF0C\u4E0D\u4F1A\u8FDB\u8D26\u672C\uFF09</div>'+
            '<pre id="ipe-ledger-ep-out" style="white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;font-size:12px;line-height:1.5;margin:0;padding:8px;border-radius:8px;background:rgba(127,127,127,.10)"></pre>'+
            '<button id="ipe-ledger-ep-close" class="ipe-btn" type="button" style="margin-top:6px">\u6536\u8D77</button>'+
        '</div>'+
        '<div class="ipe-preview-actions" id="ipe-ledger-stop" style="display:none">'+
            '<button id="ipe-ledger-stop-btn" class="ipe-btn" type="button">\u23F9 中断这次挂账</button>'+
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
            '<div class="ipe-hint">一层楼一份账，留几份跟着上面「读几轮」的旋钮走。删楼/重roll后楼没了的账会自动碎掉，不用你管。</div>'+
        '</div></details>'+
        '<div class="ipe-hint">账本存在本聊天里（chat_metadata 主档 + 本地镜像）。切换聊天会各用各的。</div>'+
        '<hr style="border:none;border-top:1px solid rgba(255,255,255,.10);margin:12px 0">'+
        '<div style="font-weight:600;font-size:12px;margin-bottom:6px">\uD83E\uDD16 副 AI（谁来记账）</div>'+
        '<label>挂账用哪套 API<select id="ipe-ledger-api"></select></label>'+
        '<div class="ipe-hint" style="margin-bottom:6px">在生图页配好地址密钥，这儿选一套用。跟生图各用各的，不打架。</div>'+
        '<div class="ipe-preview-actions" style="margin-bottom:8px">'+
            '<button id="ipe-ledger-test" class="ipe-btn" type="button">测试连接（测的是上面这套 API）</button>'+
        '</div>'+
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
            '<div style="color:#888;font-size:12px;margin-top:10px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">流式接收（思考模型必开） <input type="checkbox" id="ipe-ledger-stream"></label></div>'+
            '<div class="ipe-hint">默认开。副 AI 边想边把字节流回来，中转不会因为「半天没动静」把连接掐断；关了就是老的整包干等。</div>'+
            '<label>空闲超时（秒，0 = 永不）<input type="text" id="ipe-ledger-idle" placeholder="300"></label>'+
            '<div class="ipe-hint">不是总时长，是「连续多少秒一个字节都没收到」才判死，思考再久只要连接活着就不算。超时算一次失败，自动挂账连撞两次照样自动关。</div>'+
            '<label>思考强度 reasoning_effort<select id="ipe-ledger-effort"></select></label>'+
            '<div class="ipe-hint">只对 o 系列 / gpt-5 这类思考模型有意义。不发 = 用模型默认；记账一般 low 就够，high 一楼能想好几分钟。</div>'+
            '<label>输出上限（token，0 = 不发）<input type="text" id="ipe-ledger-maxtok" placeholder="0"></label>'+
            '<div class="ipe-hint">思考 token 和正文共用这个上限。中转给的默认值太小时，思考模型会把额度想光、正文交白卷（状态行会报 finish_reason=length）。填 16000 之类的大数压过它。</div>'+
            '<div id="ipe-ledger-size" class="ipe-hint" style="margin-top:6px"></div>'+
        '</div></details>'+
        '<details class="ipe-fold" id="ipe-ledger-nsfw-fold" style="display:none" open><summary>\uD83D\uDD1E NSFW 槽 · 挂账规则（标记为 nsfw 时用这套）</summary><div class="ipe-fold-body">'+
        '<label>规则预设<select id="ipe-ledger-prompt-n-slot"></select></label>'+
        '<label>预设名称<input type="text" id="ipe-ledger-prompt-n-name" placeholder="例：现代 NSFW / 古代 NSFW"></label>'+
        '<div class="ipe-preview-actions" style="margin-top:2px">'+
            '<button id="ipe-ledger-prompt-n-add" class="ipe-btn" type="button">新增</button>'+
            '<button id="ipe-ledger-prompt-n-del" class="ipe-btn" type="button">删除当前</button>'+
        '</div>'+
        '<textarea id="ipe-ledger-prompt-n" rows="7" placeholder="亲密场景下副 AI 该怎么记账。留空则回落到 Normal 槽。"></textarea>'+
        '<div class="ipe-hint">这个槽有自己的预设库，跟上面 Normal 槽互不混。一次只用一个槽：楼尾标记 nsfw 用这套，normal 用上面那套。</div>'+
        '</div></details>'+
        '<details class="ipe-fold"><summary>\uD83C\uDFAD 场景模式（楼尾标记二选一：Normal 槽 / NSFW 槽）</summary><div class="ipe-fold-body">'+
            '<div style="color:#888;font-size:12px"><label class="ipe-switch-left" style="display:flex;align-items:center;gap:10px;flex-direction:row;justify-content:flex-start"><input type="checkbox" id="ipe-ledger-mode-on"> 启用场景模式（开了才出现 NSFW 槽）</label></div>'+
            '<div class="ipe-hint">与枢轨共用楼尾标记 &lt;route&gt;nsfw&lt;/route&gt; / &lt;route&gt;normal&lt;/route&gt;。小海螺据此在两个槽之间二选一，枢轨据此换整套预设。没标记沿用上一楼。默认也兼容旧 &lt;ipe_mode&gt;，正文里引用标签不会误触，标记发给副 AI 前会剥掉。</div>'+
            '<label>监听标签名（逗号分隔）<input type="text" id="ipe-ledger-mode-tag" placeholder="route, ipe_mode"></label>'+
            '<label>手动锁定<select id="ipe-ledger-mode-manual"></select></label>'+
            '<div class="ipe-hint">「自动」= 听标记。锁定某个槽就一直用它，模型判断错了拨这个纠正，改回自动继续听。</div>'+
            '<label style="margin-top:8px">给主 AI 的那几句（复制进常驻区）</label>'+
            '<textarea id="ipe-ledger-mode-snippet" rows="4" readonly></textarea>'+
            '<div id="ipe-ledger-mode-now" class="ipe-hint"></div>'+
        '</div></details>'+
        '<div style="color:#888;font-size:12px;margin-bottom:8px"><label class="ipe-switch-left" style="display:flex;align-items:center;gap:10px;flex-direction:row;justify-content:flex-start"><input type="checkbox" id="ipe-ledger-auto"> 自动挂账（每来一楼跑一次）</label></div>'+
        '<div id="ipe-ledger-auto-hint" class="ipe-hint" style="display:none;margin:-2px 0 8px;line-height:1.6"></div>'+
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
        '<details class="ipe-fold"><summary>\uD83D\uDDDC 压缩账本（合并没用的支线、精简语言）</summary><div class="ipe-fold-body">'+
            '<div class="ipe-hint">账本只增不减，跑到几百楼贴耳好几千字。点账本区的「压缩一版」，副 AI 按下面的指令重写一版更短的，先进预览，你看过点采用才落账；压缩前那版进历史可回滚。插件不会自动压。</div>'+
            '<label>压缩指令（留空用内置默认）<textarea id="ipe-ledger-compress-prompt" rows="6" placeholder="' + esc(IPE_LEDGER_COMPRESS_DEFAULT).replace(/\n/g, "&#10;") + '"></textarea></label>'+
            '<div class="ipe-preview-actions"><button id="ipe-ledger-compress-reset" class="ipe-btn" type="button">还原内置默认</button></div>'+
            '<label>账本超过多少字提醒<input type="number" id="ipe-ledger-compress-warn" min="0" step="500"></label>'+
            '<div class="ipe-hint">只是版本信息那行多一句提醒，0 = 不提醒。</div>'+
        '</div></details>'+
        '<details class="ipe-fold"><summary>\uD83C\uDFA7 贴耳细节（想看模型到底读到什么）</summary><div class="ipe-fold-body">'+
            '<label>注入深度<select id="ipe-ledger-ep-depth"></select></label>'+
            '<div class="ipe-hint">数字越小越靠近最新一楼。默认 2 就挺好。</div>'+
            '<div style="color:#888;font-size:12px;margin:8px 0 2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><input type="checkbox" id="ipe-ledger-wait"> <span>发消息前等挂账跑完，最多</span> <input type="number" id="ipe-ledger-wait-sec" min="5" max="600" step="5" style="width:64px;padding:3px 6px"> <span>秒</span></div>'+
            '<div class="ipe-hint">副 AI 还在挂账时你发了下一条，酒馆会先等账落下、贴耳换新再送出去；超时就照发并提醒。重 roll 不等。</div>'+
            '<div style="color:#888;font-size:12px;margin:8px 0 2px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="ipe-ledger-retry"> <span>挂账失败自动重试一次（网络错 / 5xx / 超时）</span></div>'+
            '<label style="margin-top:6px">模型实际读到的原文</label>'+
            '<pre id="ipe-ledger-ep-preview" class="ipe-ledger-age"></pre>'+
            '<div class="ipe-hint">不占楼层、不进聊天记录，一轮一换。</div>'+
        '</div></details>',
        "ledger");

    h += '</div><div class="ipe-footer">by ' + IPE_CREDITS + ' \u00B7 v' + IPE_VERSION + '</div>';
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
    h += '<textarea id="iped-base-template" class="text_pole" rows="5" placeholder="&lt;draw&gt;{Description}&lt;/draw&gt;"></textarea>';
    h += '<small style="color:#888">可无限新增模板。留空即用内置 &lt;draw&gt;{Description}&lt;/draw&gt;。用 {Description} 标记插入位置；分层可用 {Camera} {Env} {Mood} {Chars} {Pose}，整段用 &lt;draw&gt;…&lt;/draw&gt; 包住。两种都写也行：占位符全空的行整行不输出</small>';
    h += '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><input type="button" id="iped-pack-export" class="menu_button" value="\u2B07 导出全部预设包"><input type="button" id="iped-pack-export-cur" class="menu_button" value="\u2B07 只导出当前这套"><input type="button" id="iped-pack-import" class="menu_button" value="\u2B06 导入预设包"></div>';
    h += '<input type="file" id="iped-pack-file" accept=".json,application/json" style="display:none">';
    h += '<small style="color:#888">包里装模板 / 规则 / 系统提示 / 通用锚点规则，不含角色锚点、API 与密钥；导入按名字合并，同名覆盖前会问。锚点备份在锚点区。</small>';
    h += '<hr><small><b>角色锚点</b></small>';
    h += '<label>锚点预设</label><select id="iped-anchor-slot" class="text_pole"></select>';
    h += '<label>锚点名称</label><input type="text" id="iped-anchor-name" class="text_pole" value="" placeholder="例如：陆星河 / 苑无忧">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-anchor-add" class="menu_button" value="新增锚点"><input type="button" id="iped-anchor-delete" class="menu_button" value="删除当前"><input type="button" id="iped-pack-export-anchors" class="menu_button" value="\u2B07 备份锚点"></div>';
    h += '<textarea id="iped-char-anchors" class="text_pole" rows="4" placeholder="陆星河：a man, 28 years old, tall..."></textarea>';
    h += '<div class="ipe-anchor-guide"><div class="ipe-anchor-guide-title">通用锚点规则已启用</div>会自动随提取请求发送；文本框只需填写具体角色外貌锚点，不必重复粘贴通用规则。<div style="display:flex;gap:6px;margin-top:8px"><input type="button" id="iped-anchor-guide-toggle" class="menu_button" value="编辑通用规则"><input type="button" id="iped-anchor-guide-reset" class="menu_button" value="恢复默认"></div><div id="iped-anchor-guide-editor-wrap" class="ipe-anchor-guide-editor-wrap" style="display:none"><textarea id="iped-anchor-guide-editor" class="text_pole" rows="6" placeholder="通用角色锚点调用规则"></textarea><small style="color:#888">这里改的是所有角色锚点共用的调用规则；保存后会随每次提取请求发送。</small></div></div>';
    h += '<hr><small><b>提取规则</b></small>';
    h += '<label>规则预设</label><select id="iped-rule-slot" class="text_pole"></select>';
    h += '<label>规则名称</label><input type="text" id="iped-rule-name" class="text_pole" value="" placeholder="例如：GPT-image-2 / NAI / NanoBanana">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-rule-add" class="menu_button" value="新增规则"><input type="button" id="iped-rule-delete" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-extract-rules" class="text_pole" rows="4" placeholder="例：输出英文自然语言描述；不要参数；不要解释；适配当前生图模型..."></textarea>';
    h += '<hr><small><b>预览</b></small>';
    h += '<div style="margin:6px 0"><label>分层提取（镜头 / 环境 / 氛围 / 人物 / 动作） <input type="checkbox" id="iped-layered"></label></div>';
    h += '<div id="iped-status" style="color:#888;font-size:12px;margin:4px 0">等待新消息…</div>';
    h += '<div id="iped-layers-box" style="display:none">' + ipeImgLayerRowsHTML("iped", true)
       + '<small style="color:#888">锁住的层不重提；「只重摇这层」= 其余各层临时锁定。环境 / 氛围没变时沿用上一楼。模板可用 {Camera} {Env} {Mood} {Chars} {Pose}，{Description} 拿剩下的层。</small></div>';
    h += '<textarea id="iped-preview-text" class="text_pole" rows="5" placeholder="生成的 Description 将显示在这里…"></textarea>';
    h += '<label>补充指令</label><input type="text" id="iped-supplement" class="text_pole" placeholder="例：这段是冷战不是撒娇">';
    h += '<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><select id="iped-supp-presets" class="text_pole" style="flex:1;min-width:0"><option value="">常用短语…</option></select>';
    h += '<input type="button" id="iped-supp-save" class="menu_button" value="存为常用"><input type="button" id="iped-supp-del" class="menu_button" value="删"></div>';
    h += '<div style="display:flex;gap:6px;margin-top:6px">';
    h += '<input type="button" id="iped-btn-save-now" class="menu_button" value="保存设置">';
    h += '<input type="button" id="iped-btn-extract" class="menu_button" value="手动提取">';
    h += '<input type="button" id="iped-btn-stop" class="menu_button" value="打断请求" disabled>';
    h += '<input type="button" id="iped-btn-reroll" class="menu_button" value="重新生成" disabled>';
    h += '<input type="button" id="iped-btn-inject" class="menu_button" value="确认注入" disabled>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;margin-top:6px;align-items:center"><select id="iped-reinject-tpl" class="text_pole" style="flex:1;min-width:0"></select>';
    h += '<input type="button" id="iped-btn-reinject" class="menu_button" value="换画风重注入"></div>';
    h += '<small style="color:#888">不重新提取：换个基础模板，把这楼楼尾那块 &lt;draw&gt; 按新模板重拼替换。</small>';
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
    h += '<div id="iped-ledger-reconcile-box" style="display:none;margin-top:6px;padding-right:6px"><input type="button" id="iped-ledger-reconcile" class="menu_button" style="width:100%" value="\uD83D\uDD04 重roll完点我对账（删楼不用管）"></div>';
    h += '<div id="iped-ledger-preview-box" style="display:none;margin-top:8px">';
    h += '<label>\uD83D\uDC40 副 AI 刚才说了什么（可直接改）</label>';
    h += '<textarea id="iped-ledger-preview" class="text_pole" rows="8"></textarea>';
    h += '<div style="display:flex;gap:6px;margin-top:6px;padding-right:6px"><input type="button" id="iped-ledger-adopt" class="menu_button" value="\u2713 采用"><input type="button" id="iped-ledger-reroll" class="menu_button" value="\uD83C\uDFB2 重 roll"><input type="button" id="iped-ledger-preview-close" class="menu_button" value="收起"></div>';
    h += '<div id="iped-ledger-preview-tip" style="color:#888;font-size:11px;margin-top:4px"></div>';
    h += '</div>';
    h += '<div style="display:flex;gap:6px;margin-top:6px">'
       +   '<input type="button" id="iped-ledger-compress" class="menu_button" style="flex:1" value="\uD83D\uDDDC 压缩一版">'
       +   '<input type="button" id="iped-ledger-export" class="menu_button" style="flex:1" value="\u2B07 \u5BFC\u51FA\u8D26\u672C">'
       +   '<input type="button" id="iped-ledger-import" class="menu_button" style="flex:1" value="\u2B06 \u5BFC\u5165\u8D26\u672C">'
       +   '<input type="button" id="iped-ledger-ep" class="menu_button" style="flex:1" value="\u{1F50D} \u770B\u8D34\u8033">'
       +   '<input type="button" id="iped-notice-demo" class="menu_button" style="flex:1" value="\uD83D\uDD14 试一下报错卡">'
       + '</div>';
    h += '<input type="file" id="iped-ledger-file" accept=".json,application/json" style="display:none">';
    h += '<div style="display:flex;gap:6px;margin-top:6px;align-items:center"><select id="iped-ledger-inherit-sel" class="text_pole" style="flex:1;min-width:0"><option value="">从别的聊天继承账本…</option></select>'
       + '<input type="button" id="iped-ledger-inherit" class="menu_button" value="继承这份"></div>';
    h += '<small style="color:#888">同一张卡开新聊天时用：把别的聊天的现任账本复制过来当起手，盖本聊天当前楼号的戳。</small>';
    h += '<div id="iped-ledger-ep-box" style="display:none;margin-top:6px">'
       +   '<div style="font-size:12px;opacity:.7;margin-bottom:4px">\u{1F50D} \u8D34\u8033\u81EA\u68C0\uFF08\u53EA\u8BFB\uFF0C\u4E0D\u4F1A\u8FDB\u8D26\u672C\uFF09</div>'
       +   '<pre id="iped-ledger-ep-out" style="white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;font-size:12px;line-height:1.5;margin:0;padding:8px;border-radius:8px;background:rgba(127,127,127,.10)"></pre>'
       +   '<input type="button" id="iped-ledger-ep-close" class="menu_button" style="width:100%;margin-top:6px" value="\u6536\u8D77">'
       + '</div>';
    h += '<div id="iped-ledger-stop" style="display:none;margin-top:6px"><input type="button" id="iped-ledger-stop-btn" class="menu_button" style="width:100%" value="\u23F9 \u4E2D\u65AD\u8FD9\u6B21\u6302\u8D26"></div>';
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
    h += '<div style="margin-top:10px"><label>流式接收（思考模型必开） <input type="checkbox" id="iped-ledger-stream"></label></div>';
    h += '<small style="color:#888">默认开。边想边流字节回来，中转不会因空闲掐连接；关了就是整包干等。</small>';
    h += '<label>空闲超时（秒，0 = 永不）</label><input type="text" id="iped-ledger-idle" class="text_pole" placeholder="300">';
    h += '<small style="color:#888">「连续多少秒一个字节都没收到」才判死，思考再久只要连接活着就不算。超时算一次失败。</small>';
    h += '<label>思考强度 reasoning_effort</label><select id="iped-ledger-effort" class="text_pole"></select>';
    h += '<small style="color:#888">只对 o 系列 / gpt-5 这类思考模型有意义。不发 = 模型默认；记账一般 low 就够。</small>';
    h += '<label>输出上限（token，0 = 不发）</label><input type="text" id="iped-ledger-maxtok" class="text_pole" placeholder="0">';
    h += '<small style="color:#888">思考与正文共用。中转默认值太小会让思考模型交白卷（finish_reason=length），填 16000 之类压过它。</small>';
    h += '<div id="iped-ledger-size" style="color:#888;font-size:11px;margin:4px 0"></div>';
    h += '</div></details>';
    h += '<details class="ipe-fold" id="iped-ledger-nsfw-fold" style="display:none" open><summary>\uD83D\uDD1E NSFW 槽 · 挂账规则（标记为 nsfw 时用这套）</summary><div class="ipe-fold-body">';
    h += '<label>规则预设</label><select id="iped-ledger-prompt-n-slot" class="text_pole"></select>';
    h += '<label>预设名称</label><input type="text" id="iped-ledger-prompt-n-name" class="text_pole" placeholder="例：现代 NSFW / 古代 NSFW">';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-ledger-prompt-n-add" class="menu_button" value="新增"><input type="button" id="iped-ledger-prompt-n-del" class="menu_button" value="删除当前"></div>';
    h += '<textarea id="iped-ledger-prompt-n" class="text_pole" rows="6" placeholder="亲密场景下副 AI 该怎么记账。留空则回落到 Normal 槽。"></textarea>';
    h += '<small style="color:#888">自己的预设库，跟 Normal 槽互不混；楼尾标记 nsfw 用这套。</small>';
    h += '</div></details>';
    h += '<details class="ipe-fold"><summary>\uD83C\uDFAD 场景模式（楼尾标记二选一：Normal 槽 / NSFW 槽）</summary><div class="ipe-fold-body">';
    h += '<div style="margin-bottom:6px"><label class="ipe-switch-left"><input type="checkbox" id="iped-ledger-mode-on"> 启用场景模式（开了才出现 NSFW 槽）</label></div>';
    h += '<small style="color:#888">与枢轨共用楼尾 &lt;route&gt;nsfw&lt;/route&gt; / &lt;route&gt;normal&lt;/route&gt;，两个槽二选一；没标记沿用；兼容旧 &lt;ipe_mode&gt;。</small>';
    h += '<label>监听标签名（逗号分隔）</label><input type="text" id="iped-ledger-mode-tag" class="text_pole" placeholder="route, ipe_mode">';
    h += '<label>手动锁定</label><select id="iped-ledger-mode-manual" class="text_pole"></select>';
    h += '<label>给主 AI 的那几句（复制进常驻区）</label><textarea id="iped-ledger-mode-snippet" class="text_pole" rows="4" readonly></textarea>';
    h += '<div id="iped-ledger-mode-now" style="color:#888;font-size:11px;margin:4px 0"></div>';
    h += '</div></details>';
    h += '<div style="margin-bottom:6px"><label class="ipe-switch-left"><input type="checkbox" id="iped-ledger-auto"> 自动挂账（每来一楼跑一次）</label></div>';
    h += '<div id="iped-ledger-auto-hint" style="display:none;color:#c9a227;font-size:11px;margin:-2px 0 6px;line-height:1.6"></div>';
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
    h += '<label>压缩指令（留空用内置默认）</label><textarea id="iped-ledger-compress-prompt" class="text_pole" rows="5"></textarea>';
    h += '<div style="display:flex;gap:6px;margin-top:4px;align-items:center"><input type="button" id="iped-ledger-compress-reset" class="menu_button" value="还原内置默认"> 账本超过 <input type="number" id="iped-ledger-compress-warn" class="text_pole" min="0" step="500" style="width:80px;display:inline-block"> 字提醒</div>';
    h += '<label>注入深度</label><select id="iped-ledger-ep-depth" class="text_pole"></select>';
    h += '<div style="margin-top:6px"><input type="checkbox" id="iped-ledger-wait"> 发消息前等挂账跑完，最多 <input type="number" id="iped-ledger-wait-sec" class="text_pole" min="5" max="600" step="5" style="width:64px;display:inline-block"> 秒</div>';
    h += '<div style="margin-top:6px"><input type="checkbox" id="iped-ledger-retry"> 挂账失败自动重试一次（网络错 / 5xx / 超时）</div>';
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

/* ============================================================
   📦 生图预设包（2.12.0）
   一个 JSON 装五样：模板 / 提取规则 / 系统提示 / 角色锚点 / 通用锚点规则。
   不带 API 地址和密钥——分享给别人的时候不能把 key 送出去。
   导入按名字合并：新名字追加，同名覆盖（覆盖前问一句），绝不清空对方已有的。
   系统提示固定两槽（情感 / 剧情），按 id 对位，对不上再按名字。
   ============================================================ */
var IPE_IMG_PACK_FMT = "ipe-image-pack";

function ipeImgPackBuild(scope) {
    /* 角色锚点是每个人自己卡的东西，跟画风包不混：all / current 都不带锚点；
       只有 scope === "anchors" 才导出锚点（给自己备份、换设备用）。 */
    if (scope === "anchors") {
        var al = ipeGetAnchorPresets(), ao = [];
        for (var k = 0; k < al.length; k++) if (al[k]) ao.push({ id: al[k].id, name: al[k].name, value: String(al[k].value || "") });
        return { _fmt: IPE_IMG_PACK_FMT, _v: 1, exportedAt: new Date().toISOString(), pluginVersion: IPE_VERSION, scope: "anchors",
                 templates: [], rules: [], systemPrompts: [], anchors: ao, anchorGuide: "" };
    }
    var onlyCur = scope === "current";
    function pick(list, activeId) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var it = list[i]; if (!it) continue;
            if (onlyCur && it.id !== activeId) continue;
            out.push({ id: it.id, name: it.name, value: String(it.value || "") });
        }
        return out;
    }
    var guide = String(cfg().anchorUsageGuide || "").trim();   // 只导出用户自己改过的；没改过就不带，导入方保留自己的默认
    return {
        _fmt: IPE_IMG_PACK_FMT, _v: 1,
        exportedAt: new Date().toISOString(),
        pluginVersion: IPE_VERSION,
        scope: onlyCur ? "current" : "all",
        templates:     pick(ipeGetBaseTemplates(),      ipeGetActiveTemplateId()),
        rules:         pick(ipeGetRulePresets(),        ipeGetActiveRuleId()),
        systemPrompts: pick(ipeGetSystemPromptPresets(), ipeGetActiveSystemPromptId()),
        anchors:       [],
        anchorGuide:   guide
    };
}

function ipeToast(msg, ok) {
    try { ipeNotice({ kind: ok ? "ok" : "error", title: ok ? "小海螺 · 完成" : "小海螺 · 出了点问题", body: msg }); } catch(e) {}
    try { setStatus(msg, ok ? "#6ec577" : "#d4726a"); } catch(e) {}
}

function ipeImgPackExport(scope) {
    var pack = ipeImgPackBuild(scope);
    var n = pack.templates.length + pack.rules.length + pack.systemPrompts.length + pack.anchors.length;
    var name = (pack.scope === "anchors" ? "ipe-anchors-" : "ipe-image-pack-" + (pack.scope === "current" ? "current-" : "")) + new Date().toISOString().slice(0, 10) + ".json";
    try {
        var blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement("a");
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function(){ try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch(e){} }, 200);
        ipeToast(pack.scope === "anchors"
            ? "已导出 " + name + "：角色锚点 " + pack.anchors.length + " 套（只给自己备份用，别分享）"
            : "已导出 " + name + "：模板 " + pack.templates.length + " / 规则 " + pack.rules.length
              + " / 系统提示 " + pack.systemPrompts.length + (pack.anchorGuide ? " / 通用锚点规则" : "") + "（不含角色锚点、API 与密钥）", true);
        return true;
    } catch(e) {
        ipeToast("导出失败：" + (e && e.message ? e.message : String(e)), false);
        return false;
    }
}

/* 按名字合并一类预设。返回 { added, replaced } */
function ipeImgPackMergeList(cur, incoming, prefix, opts) {
    var added = 0, replaced = 0;
    var byName = {}, byId = {};
    for (var i = 0; i < cur.length; i++) { byName[String(cur[i].name || "").trim()] = cur[i]; byId[cur[i].id] = cur[i]; }
    for (var j = 0; j < (incoming || []).length; j++) {
        var it = incoming[j]; if (!it || typeof it !== "object") continue;
        var name = String(it.name || "").trim(); var value = String(it.value == null ? "" : it.value);
        if (!name && !value) continue;
        var hit = null;
        if (opts && opts.matchIdFirst && it.id && byId[it.id]) hit = byId[it.id];
        if (!hit && name && byName[name]) hit = byName[name];
        if (hit) {
            if (String(hit.value || "") !== value) { hit.value = value; replaced++; }
        } else if (opts && opts.fixedSlots) {
            continue;                                   // 系统提示只有两槽，对不上号就不硬塞
        } else {
            var nu = { id: ipeMakeId(prefix), name: name || (prefix + "_" + (cur.length + 1)), value: value };
            cur.push(nu); byName[nu.name] = nu; byId[nu.id] = nu; added++;
        }
    }
    return { added: added, replaced: replaced };
}

/* 先干跑数一数要覆盖多少，再决定问不问 */
function ipeImgPackPreview(pack) {
    function count(cur, incoming, opts) {
        var byName = {}, byId = {}, add = 0, rep = 0;
        cur.forEach(function(c){ byName[String(c.name || "").trim()] = c; byId[c.id] = c; });
        (incoming || []).forEach(function(it){
            if (!it || typeof it !== "object") return;
            var name = String(it.name || "").trim(); var value = String(it.value == null ? "" : it.value);
            if (!name && !value) return;
            var hit = (opts && opts.matchIdFirst && it.id && byId[it.id]) || (name && byName[name]) || null;
            if (hit) { if (String(hit.value || "") !== value) rep++; }
            else if (!(opts && opts.fixedSlots)) add++;
        });
        return { added: add, replaced: rep };
    }
    return {
        templates: count(ipeGetBaseTemplates(), pack.templates),
        rules: count(ipeGetRulePresets(), pack.rules),
        systemPrompts: count(ipeGetSystemPromptPresets(), pack.systemPrompts, { matchIdFirst: true, fixedSlots: true }),
        anchors: count(ipeGetAnchorPresets(), pack.anchors)
    };
}

function ipeImgPackNormalize(parsed) {
    if (Array.isArray(parsed)) return { _fmt: IPE_IMG_PACK_FMT, templates: parsed };     // 裸数组当模板表
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed._fmt && parsed._fmt !== IPE_IMG_PACK_FMT) return null;
    var has = ["templates", "rules", "systemPrompts", "anchors", "anchorGuide"].some(function(k){ return k in parsed; });
    return has ? parsed : null;
}

function ipeImgPackImportText(txt, opts) {
    opts = opts || {};
    var parsed;
    try { parsed = JSON.parse(String(txt || "")); }
    catch(e) { ipeToast("导入失败：这不是合法 JSON", false); return null; }
    var pack = ipeImgPackNormalize(parsed);
    if (!pack) { ipeToast("导入失败：这不是小海螺的生图预设包（也不是模板数组）", false); return null; }

    var pv = ipeImgPackPreview(pack);
    var totalRep = pv.templates.replaced + pv.rules.replaced + pv.systemPrompts.replaced + (pack.scope === "anchors" ? pv.anchors.replaced : 0);
    var totalAdd = pv.templates.added + pv.rules.added + pv.systemPrompts.added + (pack.scope === "anchors" ? pv.anchors.added : 0);
    var guideIn = String(pack.anchorGuide || "").trim();
    var guideChange = !!guideIn && guideIn !== String(cfg().anchorUsageGuide || "").trim();
    if (!opts.force && (totalRep > 0 || guideChange)) {
        var msg = "这个包会覆盖你 " + totalRep + " 个同名预设"
            + (pv.templates.replaced ? "（模板 " + pv.templates.replaced + "）" : "")
            + (pv.rules.replaced ? "（规则 " + pv.rules.replaced + "）" : "")
            + (pv.systemPrompts.replaced ? "（系统提示 " + pv.systemPrompts.replaced + "）" : "")
            + (pv.anchors.replaced ? "（锚点 " + pv.anchors.replaced + "）" : "")
            + (guideChange ? "，并替换通用锚点规则" : "")
            + "；另新增 " + totalAdd + " 个。\n继续吗？（取消 = 什么都不动）";
        var okc = true;
        try { var rw = ipeRootWindow(); if (rw && typeof rw.confirm === "function") okc = rw.confirm(msg); } catch(e) {}
        if (!okc) { ipeToast("已取消导入，什么都没动", false); return null; }
    }

    /* 包里带角色锚点：分享来的包一般不该要（那是别人卡的角色），只有自己备份的锚点包才要。问一句，默认不要。 */
    var wantAnchors = false, anchorsN = Array.isArray(pack.anchors) ? pack.anchors.length : 0;
    if (anchorsN > 0) {
        if (typeof opts.anchors === "boolean") wantAnchors = opts.anchors;
        else if (pack.scope === "anchors") wantAnchors = true;
        else {
            wantAnchors = false;
            try { var rw2 = ipeRootWindow(); if (rw2 && typeof rw2.confirm === "function") wantAnchors = !!rw2.confirm("这个包里还带了 " + anchorsN + " 套角色锚点。\n分享来的画风包一般不要（那是别人卡的角色）；只有你自己备份的才要。\n\n要一起导入锚点吗？（取消 = 只导其他内容）"); } catch(e) {}
        }
    }
    var tpl = ipeGetBaseTemplates(), rul = ipeGetRulePresets(), sys = ipeGetSystemPromptPresets(), anc = ipeGetAnchorPresets();
    var r1 = ipeImgPackMergeList(tpl, pack.templates, "tpl");
    var r2 = ipeImgPackMergeList(rul, pack.rules, "rule");
    var r3 = ipeImgPackMergeList(sys, pack.systemPrompts, "sys", { matchIdFirst: true, fixedSlots: true });
    var r4 = wantAnchors ? ipeImgPackMergeList(anc, pack.anchors, "anchor") : { added: 0, replaced: 0, skipped: anchorsN };
    ipeSaveBaseTemplates(tpl); ipeSaveRulePresets(rul); ipeSaveSystemPromptPresets(sys); ipeSaveAnchorPresets(anc);
    if (guideChange) {
        ipeSetAnchorUsageGuide(guideIn === IPE_DEFAULT_ANCHOR_USAGE_GUIDE ? "" : guideIn);
        ["ipe-anchor-guide-editor","iped-anchor-guide-editor"].forEach(function(id){ var el = q("#" + id); if (el) el.value = ipeGetAnchorUsageGuide(); });
    }
    try { ipeSaveNow(); } catch(e) {}
    try { ipeRefreshTemplateEditors(); ipeRefreshRuleEditors(); ipeRefreshSystemPromptEditors(); ipeRefreshAnchorEditors(); } catch(e) {}

    var sum = { templates: r1, rules: r2, systemPrompts: r3, anchors: r4, guide: guideChange };
    function fmt(label, r) { return (r.added || r.replaced) ? label + " +" + r.added + "/覆盖" + r.replaced : ""; }
    var parts = [fmt("模板", r1), fmt("规则", r2), fmt("系统提示", r3), fmt("锚点", r4), guideChange ? "通用锚点规则已替换" : "", (r4.skipped ? "角色锚点 " + r4.skipped + " 套已跳过" : "")].filter(Boolean);
    ipeToast(parts.length ? "已导入 ✓ " + parts.join("，") : "包是空的或与现有内容完全一致，什么都没变", true);
    return sum;
}

/* ============================================================
   ⤢ 放大编辑（2.11.2）
   酒馆世界书那种：每个文本框右上角一个 ⤢，点开全屏编辑框，边打边回填，
   回填走 input 事件，原有的预设保存 / 面板抽屉同步 / 层框重拼全部照常触发。
   完成、点遮罩、Esc 都关；关的时候补发一次 change。
   ============================================================ */
var IPE_ZOOM_TITLES = {
    "ipe-system-prompt": "系统提示", "ipe-base-template": "基础模板", "ipe-char-anchors": "角色锚点",
    "ipe-anchor-guide-editor": "通用锚点规则", "ipe-extract-rules": "提取规则", "ipe-preview-text": "生图描述（整段）",
    "ipe-layer-camera": "📷 镜头层", "ipe-layer-env": "🌆 环境层", "ipe-layer-mood": "🎞️ 氛围层",
    "ipe-layer-chars": "🧍 人物层", "ipe-layer-pose": "🤝 动作层",
    "ipe-ledger-text": "账本", "ipe-ledger-order": "User 指令", "ipe-ledger-extra": "这次额外说一句",
    "ipe-ledger-preview": "副 AI 刚才说了什么", "ipe-ledger-prompt": "挂账规则", "ipe-ledger-note": "本卡要点 / 世界观硬设定"
};
function ipeZoomTitleFor(ta) {
    try {
        var id = String(ta.id || "").replace(/^iped-/, "ipe-");
        if (IPE_ZOOM_TITLES[id]) return IPE_ZOOM_TITLES[id];
        var holder = (ta.parentNode && ta.parentNode.classList && ta.parentNode.classList.contains("ipe-zoom-wrap")) ? ta.parentNode : ta;
        var lab = (holder.parentNode && holder.parentNode.tagName === "LABEL") ? holder.parentNode : null;
        if (!lab && holder.previousElementSibling && holder.previousElementSibling.tagName === "LABEL") lab = holder.previousElementSibling;
        if (lab) {
            var t = "";
            for (var i = 0; i < lab.childNodes.length; i++) if (lab.childNodes[i].nodeType === 3) t += lab.childNodes[i].textContent;
            t = t.trim(); if (t) return t;
        }
        var ph = ta.getAttribute("placeholder"); if (ph) return ph.split(/[\n；;。]/)[0].slice(0, 30);
    } catch(e) {}
    return "编辑";
}
function ipeZoomClose() {
    try {
        var d = ipeRootDocument(); var ov = d.getElementById("ipe-zoom-overlay");
        if (!ov) return;
        if (ov.__ipeKey) d.removeEventListener("keydown", ov.__ipeKey);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
    } catch(e) {}
    try {
        var ball = q("#ipe-chat-quick-entry");
        if (ball && "__ipeZoomPrevVis" in ball) {
            ball.style.removeProperty("visibility");
            if (ball.__ipeZoomPrevVis) ball.style.visibility = ball.__ipeZoomPrevVis;
            delete ball.__ipeZoomPrevVis;
        }
    } catch(e) {}
}
function ipeZoomOpen(ta) {
    if (!ta) return;
    var d = ipeRootDocument();
    ipeZoomClose();
    var mist = cfg().mistTheme === true;
    var ov = d.createElement("div");
    ov.id = "ipe-zoom-overlay";
    ov.className = "ipe-zoom-overlay" + (mist ? " ipe-mist" : "");
    /* 关键样式全部内联：酒馆会缓存扩展的 style.css，更新后 JS 是新的、CSS 可能还是旧的，
       只靠外部 CSS 的话弹窗会变成一个躺在页面底部看不见的 div。外部 CSS 只做锦上添花。 */
    ov.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;width:100vw;height:100vh;min-height:100%;background:" + (mist ? "rgba(70,82,94,.38)" : "rgba(0,0,0,.55)") + ";"
        + "display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;margin:0;transform:none";
    /* 面板自己被强制到 2147483646 !important（ipeHardOpenPanel），弹窗必须再高一级且同样 important，否则压在面板底下 */
    try { ov.style.setProperty("z-index", "2147483647", "important"); } catch(e) { ov.style.zIndex = "2147483647"; }
    try {
        var ball0 = q("#ipe-chat-quick-entry");
        if (ball0) { ball0.__ipeZoomPrevVis = ball0.style.visibility; ball0.style.setProperty("visibility", "hidden", "important"); }
    } catch(e) {}
    /* 开灯皮跟面板同一套：莫兰迪雾蓝 #7C93A6 / 深汀 #5E7A92 / 正文 #4A5662 */
    var boxBg = mist ? "linear-gradient(168deg, rgba(243,245,248,.99) 0%, rgba(235,239,244,.99) 48%, rgba(228,233,239,.99) 100%)" : "rgba(28,28,32,.98)";
    var fg = mist ? "#4A5662" : "#d4d4d4";
    var taBg = mist ? "rgba(255,255,255,.72)" : "rgba(255,255,255,.05)";
    var bd = mist ? "rgba(140,156,172,.32)" : "rgba(255,255,255,.1)";
    var headBg = mist ? "linear-gradient(90deg, rgba(196,216,232,.55) 0%, rgba(214,208,232,.40) 100%)" : "transparent";
    var closeCss = mist
        ? "border:1px solid rgba(124,147,166,.55);background:rgba(124,147,166,.18);color:#5E7A92"
        : "border:1px solid rgba(110,197,119,.45);background:rgba(110,197,119,.18);color:#6ec577";
    var small = false;
    try { var rw = ipeRootWindow(); small = !!(rw && rw.innerWidth && rw.innerWidth <= 480); } catch(e) {}
    ov.innerHTML = '<div class="ipe-zoom-box" style="width:' + (small ? '100%' : 'min(920px,100%)') + ';height:' + (small ? '100%' : 'min(86vh,100%)')
        + ';background:' + boxBg + ';color:' + fg + ';border:1px solid ' + bd + ';border-radius:' + (small ? '0' : '14px') + (mist ? ';box-shadow:0 10px 40px rgba(84,100,116,.28),0 0 0 1px rgba(255,255,255,.55)' : '')
        + ';display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,.5);font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;font-size:13px;box-sizing:border-box">'
        + '<div class="ipe-zoom-head" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid ' + bd + ';flex-shrink:0;background:' + headBg + '">'
        + '<span class="ipe-zoom-title" style="font-weight:600;font-size:14px;color:' + (mist ? '#46525E' : '#e8e8e8') + '"></span>'
        + '<span class="ipe-zoom-count" style="font-size:11px;opacity:.7;margin-left:auto"></span>'
        + '<button type="button" class="ipe-zoom-close" style="padding:6px 14px;border-radius:8px;' + closeCss + ';cursor:pointer;font-size:13px;font-family:inherit">完成</button></div>'
        + '<textarea class="ipe-zoom-ta" spellcheck="false" style="flex:1;margin:' + (small ? '8px' : '12px') + ';padding:12px;background:' + taBg + ';color:' + fg + ';border:1px solid ' + bd
        + ';border-radius:10px;font-size:' + (small ? '16px' : '15px') + ';line-height:1.6;resize:none;outline:none;font-family:inherit;box-sizing:border-box;width:auto;min-height:0"></textarea></div>';
    ov.querySelector(".ipe-zoom-title").textContent = ipeZoomTitleFor(ta);
    var count = ov.querySelector(".ipe-zoom-count");
    var big = ov.querySelector(".ipe-zoom-ta");
    big.value = ta.value;
    big.readOnly = !!ta.readOnly; big.disabled = false;
    function upd(){ count.textContent = big.value.length + " 字"; }
    upd();
    big.addEventListener("input", function(){
        ta.value = big.value; upd();
        try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch(e) {}
    });
    function done(){
        try { ta.dispatchEvent(new Event("change", { bubbles: true })); } catch(e) {}
        ipeZoomClose();
    }
    ov.querySelector(".ipe-zoom-close").addEventListener("click", done);
    ov.addEventListener("click", function(ev){ if (ev.target === ov) done(); });
    ov.__ipeKey = function(ev){ if (ev.key === "Escape") done(); };
    d.addEventListener("keydown", ov.__ipeKey);
    ipeOverlayHost(d).appendChild(ov);
    /* 挂 <html> 后 fixed 以屏幕为准；下面这段像素兜底仍保留，双保险。 */
    try {
        var rw2 = d.defaultView || ipeRootWindow() || window;
        var vh = Number(rw2.innerHeight) || 0, vw = Number(rw2.innerWidth) || 0;
        var rect = ov.getBoundingClientRect ? ov.getBoundingClientRect() : null;
        if (vh > 0 && (!rect || rect.height < vh * 0.6)) { ov.style.height = vh + "px"; ov.style.minHeight = vh + "px"; }
        if (vw > 0 && (!rect || rect.width < vw * 0.6)) { ov.style.width = vw + "px"; }
        var bx = ov.firstElementChild;
        if (bx) {
            var br = bx.getBoundingClientRect ? bx.getBoundingClientRect() : null;
            if (vh > 0 && (!br || br.height < vh * 0.5)) { bx.style.height = Math.max(200, vh - (small ? 0 : 24)) + "px"; bx.style.minHeight = "200px"; }
        }
    } catch(e) {}
    setTimeout(function(){ try { big.focus(); big.setSelectionRange(big.value.length, big.value.length); } catch(e) {} }, 30);
}
/* 酒馆缓存旧 style.css 的自救：探针元素拿不到新样式，就找到本插件的 <link> 带版本号重载一次 */
var ipeCssBusted = false;
function ipeEnsureFreshCss() {
    if (ipeCssBusted) return;
    try {
        var d = ipeRootDocument();
        var probe = d.createElement("i");
        probe.className = "ipe-zoom-btn";
        probe.style.cssText = "";
        (d.body || d.documentElement).appendChild(probe);
        var pos = "";
        try { pos = (d.defaultView || window).getComputedStyle(probe).position; } catch(e) {}
        if (probe.parentNode) probe.parentNode.removeChild(probe);
        if (pos === "absolute") return;                       // 新 CSS 在，不用管
        var ver = "";
        try { ver = String((typeof IPE_VERSION !== "undefined" && IPE_VERSION) || Date.now()); } catch(e) { ver = String(Date.now()); }
        var links = d.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            var href = String(links[i].getAttribute("href") || "");
            if (/image-prompt-extractor[^"']*\/style\.css/i.test(href) || /\/ipe[^"']*\/style\.css/i.test(href)) {
                links[i].setAttribute("href", href.split("?")[0] + "?v=" + encodeURIComponent(ver));
                ipeCssBusted = true;
                try { console.log("[IPE] style.css 疑似旧缓存，已带版本号重载"); } catch(e) {}
            }
        }
    } catch(e) {}
}

function ipeInstallZoomButtons() {
    ipeEnsureFreshCss();
    ["#ipe-panel", "#ipe-drawer"].forEach(function(sel){
        var root = q(sel); if (!root) return;
        var list = root.querySelectorAll("textarea");
        for (var i = 0; i < list.length; i++) (function(ta){
            if (ta.__ipeZoom) return; ta.__ipeZoom = true;
            var doc = ta.ownerDocument;
            var wrap = doc.createElement("div"); wrap.className = "ipe-zoom-wrap";
            wrap.style.cssText = "position:relative;width:100%";
            ta.parentNode.insertBefore(wrap, ta); wrap.appendChild(ta);
            var btn = doc.createElement("button");
            btn.type = "button"; btn.className = "ipe-zoom-btn"; btn.title = "放大编辑"; btn.textContent = "⤢";
            btn.style.cssText = "position:absolute;top:4px;right:6px;z-index:2;width:22px;height:22px;line-height:20px;padding:0;margin:0;"
                + "border-radius:6px;border:1px solid rgba(128,128,128,.35);background:rgba(28,28,32,.55);color:#ccc;font-size:12px;cursor:pointer;opacity:.75";
            btn.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); ipeZoomOpen(ta); });
            wrap.appendChild(btn);
        })(list[i]);
    });
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
            var nm = ipeGetActiveApiProfileItem().name || "";
            if (el.value !== nm) el.value = nm;
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

    ["ipe-template-slot","iped-template-slot","ipe-reinject-tpl","iped-reinject-tpl"].forEach(function(id){
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
            var nm = ipeGetActiveTemplateItem().name || "";
            if (el.value !== nm) el.value = nm;   // 清空后离开：这时才把兜底名写回来
            ipeRefreshTemplateEditors();
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
            var nm = ipeGetActiveAnchorItem().name || "";
            if (el.value !== nm) el.value = nm;
            ipeRefreshAnchorEditors();
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
            var nm = ipeGetActiveRuleItem().name || "";
            if (el.value !== nm) el.value = nm;
            ipeRefreshRuleEditors();
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
        var bri=q("#"+p+"-btn-reinject"); if(bri && !bri.__ipeBound){ bri.__ipeBound = true; bri.addEventListener("click", onReinject); }
        var ssv=q("#"+p+"-supp-save"); if(ssv && !ssv.__ipeBound){ ssv.__ipeBound = true; ssv.addEventListener("click", ipeSuppSaveCurrent); }
        var sdl=q("#"+p+"-supp-del"); if(sdl && !sdl.__ipeBound){ sdl.__ipeBound = true; sdl.addEventListener("click", ipeSuppDeleteSelected); }
        var ssl=q("#"+p+"-supp-presets"); if(ssl && !ssl.__ipeBound){ ssl.__ipeBound = true; ssl.addEventListener("change", function(){
            var list = ipeGetSuppPresets(); var i = Number(ssl.value);
            if (ssl.value === "" || !Number.isFinite(i) || !list[i]) return;
            ipeSuppFill(list[i]);
            var other = q("#" + (p === "ipe" ? "iped" : "ipe") + "-supp-presets"); if (other) other.value = ssl.value;
        }); }
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
    [["ipe-pack-export","ipe-pack-export-cur","ipe-pack-import","ipe-pack-file"],
     ["iped-pack-export","iped-pack-export-cur","iped-pack-import","iped-pack-file"]].forEach(function(ids){
        var bA = q("#" + ids[0]), bC = q("#" + ids[1]), bI = q("#" + ids[2]), fi = q("#" + ids[3]);
        if (bA && !bA.dataset.ipeBound) { bA.dataset.ipeBound = "1"; bA.addEventListener("click", function(){ ipeImgPackExport("all"); }); }
        if (bC && !bC.dataset.ipeBound) { bC.dataset.ipeBound = "1"; bC.addEventListener("click", function(){ ipeImgPackExport("current"); }); }
        var bAn = q("#" + ids[0].replace("pack-export", "pack-export-anchors"));
        if (bAn && !bAn.dataset.ipeBound) { bAn.dataset.ipeBound = "1"; bAn.addEventListener("click", function(){ ipeImgPackExport("anchors"); }); }
        if (bI && fi && !bI.dataset.ipeBound) { bI.dataset.ipeBound = "1"; bI.addEventListener("click", function(){ try { fi.value = ""; fi.click(); } catch(e){} }); }
        if (fi && !fi.dataset.ipeBound) {
            fi.dataset.ipeBound = "1";
            fi.addEventListener("change", function(){
                var f = fi.files && fi.files[0]; if (!f) return;
                var r = new FileReader();
                r.onload  = function(){ ipeImgPackImportText(r.result); };
                r.onerror = function(){ ipeToast("读文件失败", false); };
                r.readAsText(f);
            });
        }
    });
    [["ipe-ledger-export","ipe-ledger-import","ipe-ledger-file"],
     ["iped-ledger-export","iped-ledger-import","iped-ledger-file"]].forEach(function(ids){
        var bE = q("#" + ids[0]), bI = q("#" + ids[1]), fi = q("#" + ids[2]);
        if (bE && !bE.dataset.ipeBound) {
            bE.dataset.ipeBound = "1";
            bE.addEventListener("click", function(){ ipeLedgerExport(); });
        }
        if (bI && fi && !bI.dataset.ipeBound) {
            bI.dataset.ipeBound = "1";
            bI.addEventListener("click", function(){ try { fi.value = ""; fi.click(); } catch(e){} });
        }
        if (fi && !fi.dataset.ipeBound) {
            fi.dataset.ipeBound = "1";
            fi.addEventListener("change", function(){
                var f = fi.files && fi.files[0];
                if (!f) return;
                var r = new FileReader();
                r.onload  = function(){ ipeLedgerImportText(r.result); };
                r.onerror = function(){ ipeLedgerStatus("读文件失败", "#d4726a"); };
                r.readAsText(f);
            });
        }
    });
    ["ipe-ledger-ep-close","iped-ledger-ep-close"].forEach(function(id){
        var b = q("#" + id);
        if (b && !b.dataset.ipeBound) {
            b.dataset.ipeBound = "1";
            b.addEventListener("click", function(){
                var box = q("#" + (id.charAt(0) === "i" && id.indexOf("iped") === 0 ? "iped" : "ipe") + "-ledger-ep-box");
                if (box) box.style.display = "none";
            });
        }
    });
    try { ipeLedgerModeBind(); } catch(eMB) {}
    ["ipe-notice-demo","iped-notice-demo"].forEach(function(id){
        var b = q("#" + id);
        if (b && !b.dataset.ipeBound) { b.dataset.ipeBound = "1"; b.addEventListener("click", function(){ ipeNoticeDemo(); }); }
    });
    ["ipe-ledger-ep","iped-ledger-ep"].forEach(function(id){
        var b = q("#" + id);
        if (b && !b.dataset.ipeBound) {
            b.dataset.ipeBound = "1";
            b.addEventListener("click", function(){ ipeLedgerInspectEP(); });
        }
    });
    ["ipe-ledger-stop-btn","iped-ledger-stop-btn"].forEach(function(id){
        var b = q("#" + id);
        if (b && !b.dataset.ipeBound) {
            b.dataset.ipeBound = "1";
            b.addEventListener("click", function(){ ipeLedgerStop(); });
        }
    });
    ["ipe-ledger-force-btn","iped-ledger-force-btn"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){
            if (ipeLedgerPending == null) { ipeLedgerStatus("没有待确认的结果", "#c9a227"); return; }
            ipeLedgerCommit(ipeLedgerPending, ipeLedgerPreviewFloor || 0);
            ipeLedgerModeAfterRun(ipeLedgerPendingMode);
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
    ["ipe-ledger-stream","iped-ledger-stream"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerStream", !!el.checked);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.checked ? "挂账改为流式接收" : "挂账改为整包等待（思考模型容易被中转掐断）", el.checked ? "#6ec577" : "#c9a227");
        });
    });
    ["ipe-ledger-idle","iped-ledger-idle"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            var n = Math.max(0, Math.floor(Number(el.value) || 0));
            save("ledgerIdleTimeout", n);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(n > 0 ? "空闲超时 " + n + " 秒（连续这么久没字节才判死）" : "已关闭空闲超时——挂死只能手点 ⏹ 中断", n > 0 ? "#6ec577" : "#c9a227");
        });
    });
    ["ipe-ledger-effort","iped-ledger-effort"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            save("ledgerReasoningEffort", String(el.value || ""));
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.value ? "reasoning_effort = " + el.value : "不发 reasoning_effort，用模型默认", "#6ec577");
        });
    });
    ["ipe-ledger-maxtok","iped-ledger-maxtok"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("change", function(){
            var n = Math.max(0, Math.floor(Number(el.value) || 0));
            save("ledgerMaxTokens", n);
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(n > 0 ? "输出上限 " + n + " token（思考模型发 max_completion_tokens）" : "不发输出上限，用中转/模型默认", "#6ec577");
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
    // 旧酒馆兜底钮：没有 MESSAGE_SWIPED 事件才现身；狠版判定，连当前楼的账一起碎
    try {
        var hasSwipeEv = false;
        try { var cEv = ctx(); hasSwipeEv = !!(cEv.eventSource && cEv.event_types && cEv.event_types.MESSAGE_SWIPED); } catch(eHs) {}
        if (!hasSwipeEv) {
            ["ipe-ledger-reconcile-box","iped-ledger-reconcile-box"].forEach(function(id){
                var el = q("#" + id); if (el) el.style.display = "";
            });
        }
        ["ipe-ledger-reconcile","iped-ledger-reconcile"].forEach(function(id){
            var el = q("#" + id); if (!el) return;
            el.addEventListener("click", function(){
                var changed = ipeLedgerReconcile(Math.max(0, ipeFloorNo() - 1));   // limit=尾楼-1：尾楼的账必碎
                ipeLedgerSync();
                if (!changed) ipeLedgerStatus("对过了，账和楼是齐的 \u2713", "#6ec577");
            });
        });
    } catch(eRb) {}
    // 预览三件套：采用 / 重 roll / 收起
    [["ipe-ledger-adopt","panel"],["iped-ledger-adopt","drawer"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerAdoptPreview(pr[1]); });
    });
    ["ipe-ledger-reroll","iped-ledger-reroll"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){ if (ipeLedgerPreviewKind === "compress") ipeLedgerCompress(); else ipeLedgerRunManual(); });
    });
    ["ipe-ledger-preview-close","iped-ledger-preview-close"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        el.addEventListener("click", function(){ ipeLedgerPreviewKind = ""; ipeLedgerHidePreview(); ipeLedgerStatus("已收起，账本没动", "#888"); });
    });
    ["ipe-ledger-compress","iped-ledger-compress"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.addEventListener("click", function(){ ipeLedgerCompress(); });
    });
    ["ipe-ledger-compress-prompt","iped-ledger-compress-prompt"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.value = String(cfg().ledgerCompressPrompt || "");
        el.addEventListener("input", function(){
            var v = el.value;
            save("ledgerCompressPrompt", v.trim() === IPE_LEDGER_COMPRESS_DEFAULT.trim() ? "" : v);
            var other = q("#" + (id === "ipe-ledger-compress-prompt" ? "iped-ledger-compress-prompt" : "ipe-ledger-compress-prompt"));
            if (other && other !== el && other !== document.activeElement) other.value = v;
        });
    });
    ["ipe-ledger-compress-reset","iped-ledger-compress-reset"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.addEventListener("click", function(){
            save("ledgerCompressPrompt", "");
            ["ipe-ledger-compress-prompt","iped-ledger-compress-prompt"].forEach(function(tid){ var t = q("#" + tid); if (t) t.value = ""; });
            ipeLedgerStatus("压缩指令已还原为内置默认", "#6ec577");
        });
    });
    ["ipe-ledger-compress-warn","iped-ledger-compress-warn"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.value = String(ipeLedgerCompressWarnChars());
        el.addEventListener("change", function(){ var v = Number(el.value); if (!(v >= 0)) v = 3000; save("ledgerCompressWarnChars", v); el.value = String(v); ipeLedgerRefreshEditors(); });
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
            save("ledgerAutoOffReason", "");          // 人亲手动过开关，之前"插件自己关的"提示就该撤
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus(el.checked ? "自动挂账已开（每来一楼跑一次）" : "自动挂账已关", "#6ec577");
        });
    });

    // 两套预设：值 / 名称 / 新增 / 删除
    [["ipe-ledger-prompt", LP], ["iped-ledger-prompt", LP],
     ["ipe-ledger-prompt-n", LPN], ["iped-ledger-prompt-n", LPN],
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
     ["ipe-ledger-prompt-n-name", LPN], ["iped-ledger-prompt-n-name", LPN],
     ["ipe-ledger-note-name", LN],   ["iped-ledger-note-name", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("input", function(){
            ipePresetSetName.apply(null, pr[1].concat([el.value]));
            ipeLedgerRefreshBotEditors();
        });
    });
    [["ipe-ledger-prompt-slot", LP], ["iped-ledger-prompt-slot", LP],
     ["ipe-ledger-prompt-n-slot", LPN], ["iped-ledger-prompt-n-slot", LPN],
     ["ipe-ledger-note-slot", LN],   ["iped-ledger-note-slot", LN]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("change", function(){
            save(pr[1][1], el.value);
            ipeLedgerRefreshBotEditors();
        });
    });
    [["ipe-ledger-prompt-add", LP, "lp"], ["iped-ledger-prompt-add", LP, "lp"],
     ["ipe-ledger-prompt-n-add", LPN, "lpn"], ["iped-ledger-prompt-n-add", LPN, "lpn"],
     ["ipe-ledger-note-add", LN, "ln"],   ["iped-ledger-note-add", LN, "ln"]].forEach(function(pr){
        var el = q("#" + pr[0]); if (!el) return;
        el.addEventListener("click", function(){
            ipePresetAdd.apply(null, pr[1].concat([pr[2]]));
            ipeLedgerRefreshBotEditors();
            ipeLedgerStatus("已新增预设", "#6ec577");
        });
    });
    [["ipe-ledger-prompt-del", LP], ["iped-ledger-prompt-del", LP],
     ["ipe-ledger-prompt-n-del", LPN], ["iped-ledger-prompt-n-del", LPN],
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
    // 2.18.0 等挂账 / 重试 / 继承
    ["ipe-ledger-wait","iped-ledger-wait"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.checked = cfg().ledgerWaitBeforeSend !== false;
        el.addEventListener("change", function(){ save("ledgerWaitBeforeSend", !!el.checked); ipeLedgerStatus(el.checked ? "发消息前会等挂账跑完" : "不等了，账没挂完也照发（贴耳可能落后一楼）", "#6ec577"); });
    });
    ["ipe-ledger-wait-sec","iped-ledger-wait-sec"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.value = String(Number(cfg().ledgerWaitMaxSec) > 0 ? Number(cfg().ledgerWaitMaxSec) : 60);
        el.addEventListener("change", function(){ var v = Number(el.value); if (!(v > 0)) v = 60; save("ledgerWaitMaxSec", v); el.value = String(v); });
    });
    ["ipe-ledger-retry","iped-ledger-retry"].forEach(function(id){
        var el = q("#" + id); if (!el || el.__ipeBound) return; el.__ipeBound = true;
        el.checked = cfg().ledgerRetryOnce !== false;
        el.addEventListener("change", function(){ save("ledgerRetryOnce", !!el.checked); });
    });
    [["ipe-ledger-inherit","ipe-ledger-inherit-sel"],["iped-ledger-inherit","iped-ledger-inherit-sel"]].forEach(function(pr){
        var b = q("#" + pr[0]); if (!b || b.__ipeBound) return; b.__ipeBound = true;
        b.addEventListener("click", function(){ ipeLedgerInheritClick(pr[1]); });
        var s = q("#" + pr[1]); if (s) s.addEventListener("focus", ipeLedgerRefreshInherit);
    });
    try { ipeLedgerRefreshInherit(); } catch(eI) {}

    // 换聊天 → 账本跟着换 + 重贴耳
    try {
        var cc = ctx();
        if (cc.eventSource && cc.event_types && cc.event_types.CHAT_CHANGED) {
            cc.eventSource.on(cc.event_types.CHAT_CHANGED, function(){
                setTimeout(function(){
                    ipeLedgerSync();
                    ipeLedgerStatus("已切换到本聊天的账本", "#6ec577");
                    try { ipeLedgerModeRefresh(); } catch(eS) {}   // 卡槽显示换成这张卡的
                    try { ipeImgRefreshLayerUI(); } catch(eL) {}   // 四个层框换成本聊天的
                    try { ipeInstallMesButtonsObserver(); ipeInstallMesButtons(); } catch(eM) {}   // 楼层 🎨 按钮换成本聊天的
                }, 200);
            });
            console.log("[IPE] 已绑定换聊天事件");
        }
    } catch(e) { console.log("[IPE] 换聊天事件绑定跳过"); }

    // 删楼/重roll → 账跟楼走：楼没了账当场碎，自动回退到幸存的最新楼（新酒馆事件直连）
    try {
        var cd = ctx();
        if (cd.eventSource && cd.event_types) {
            if (cd.event_types.MESSAGE_DELETED) {
                cd.eventSource.on(cd.event_types.MESSAGE_DELETED, function(){
                    // 400ms 等 chat 数组换完再数楼——时序缓冲照抄小红霞踩过的坑
                    setTimeout(function(){ try { ipeLedgerReconcile(ipeFloorNo()); ipeLedgerSync(); } catch(eD) {} }, 400);
                });
            }
            if (cd.event_types.MESSAGE_EDITED) {
                cd.eventSource.on(cd.event_types.MESSAGE_EDITED, function(mesId){
                    var i = Number(mesId);
                    if (!Number.isFinite(i) || i < 0) return;
                    setTimeout(function(){ try { ipeLedgerOnEdited(i); } catch(eE) {} }, 300);
                });
            }
            if (cd.event_types.MESSAGE_SWIPED) {
                cd.eventSource.on(cd.event_types.MESSAGE_SWIPED, function(mesId){
                    // 重roll第 i 楼（0-based）→ 那楼换了灵魂，它的账（floor=i+1）连同更高楼一起碎 → limit=i
                    var i = Number(mesId);
                    var limit = (Number.isFinite(i) && i >= 0) ? i : Math.max(0, ipeFloorNo() - 1);
                    setTimeout(function(){ try { ipeLedgerReconcile(limit); ipeLedgerSync(); } catch(eS) {} }, 400);
                });
            }
            console.log("[IPE] 挂账楼层对账已绑定", {
                del:   !!cd.event_types.MESSAGE_DELETED,
                swipe: !!cd.event_types.MESSAGE_SWIPED,
                edit:  !!cd.event_types.MESSAGE_EDITED
            });
        }
    } catch(e) { console.log("[IPE] 楼层对账事件绑定跳过"); }

    // 账本还在跑就发了下一条 → 这一发的贴耳落后一楼，喊出来
    try {
        var cs = ctx();
        if (cs.eventSource && cs.event_types) {
            ["GENERATION_STARTED","MESSAGE_SENT"].forEach(function(evName){
                var ev = cs.event_types[evName];
                if (!ev) return;
                cs.eventSource.on(ev, function(genType, genParams, dryRun){
                    /* 重roll 抢跑修补：MESSAGE_SWIPED 的对账挂在 400ms 之后，
                       而 Generate() 立刻就拿贴耳去组 prompt——被 roll 掉那楼的账会原样送进去，
                       Gemini 把它当既成事实，roll 几次都还是同一个剧情。
                       酒馆把 type 当第一个参数传进来，这里同步降一楼，赶在组 prompt 之前碎掉尾楼的账。
                       continue 不降：它是给当前楼续写，那楼的账仍然算数。 */
                    var t = String(genType || "").toLowerCase();
                    if ((t === "swipe" || t === "regenerate") && dryRun !== true) {
                        try {
                            ipeLedgerReconcile(Math.max(0, ipeFloorNo() - 1), { silent: true });
                            ipeLedgerApplyEP();          // 无条件重贴，不赌 reconcile 的返回值
                        } catch(eSw) {}
                    } else {
                        // 旧酒馆没有删楼事件——发出去之前同步对一次账，保证这一发的贴耳干净
                        try { if (ipeLedgerReconcile(ipeFloorNo(), { silent: true })) ipeLedgerApplyEP(); } catch(eR) {}
                    }
                    if (!ipeLedgerBusy || ipeLedgerStaleWarned) return;
                    ipeLedgerStaleWarned = true;
                    ipeLedgerStatus("\u26A0\uFE0F 账本还没记完你就发了——这一发 Gemini 读到的是上一楼的账本。"
                        + "记完会自动补上，下一发就是新的。", "#c9a227");
                });
            });
        }
    } catch(e) {}

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

function buildInjectTag(desc, layers) {
    var tpl = ipeGetTemplateValue() || cfg().baseTemplate || IPE_DEFAULT_IMAGE_TEMPLATE;
    desc = String(desc == null ? "" : desc);
    var vals = {}, any = false;
    var hasDesc = tpl.indexOf("{Description}") >= 0;
    IPE_IMG_LAYERS.forEach(function(l){
        var ph = IPE_IMG_LAYER_PH[l];
        if (tpl.indexOf(ph) < 0) return;
        any = true;
        // 有分层结果就各填各的；没分层结果时层占位符填空，由 ipeImgFillTemplate 把那几行连标签一起收掉
        vals[ph] = layers ? String(layers[l] || "").trim() : "";
    });
    if (layers && any) {
        var used = {};
        IPE_IMG_LAYERS.forEach(function(l){ if (tpl.indexOf(IPE_IMG_LAYER_PH[l]) >= 0) used[l] = true; });
        desc = ipeImgJoinLayers(layers, used);   // {Description} 只拿没被单独放置的层
    }
    if (hasDesc) { vals["{Description}"] = desc; return ipeImgFillTemplate(tpl, vals); }
    if (layers || !any) return ipeImgFillTemplate(tpl, vals) + desc;   // 没有 {Description}：剩下的层（或整段）追加在尾巴
    /* 只为分层写的模板（只有 {Camera}…{Pose}、没有 {Description}），这次却没有分层结果
       （分层关着 / 副 AI 没分层）：整段填进占位符所在的那一片，不让 {Camera} 这种字面量漏进正文。 */
    var phs = ipeImgTemplatePlaceholders(tpl);
    return tpl.slice(0, phs[0].i) + desc + tpl.slice(phs[phs.length - 1].e);
}

/* 在这楼的 extra 里记下本次注入的那块原文：换画风重注入时先按它原样剥，模板后来改了、删了都认得。 */
function ipeRememberInjectTag(msg, tag, desc, layers) {
    try {
        if (!msg.extra || typeof msg.extra !== "object") msg.extra = {};
        /* 2.16.2 省地方：那块是 <xxx>…</xxx> 整体包着的（默认 <draw>）就只记标签名，剥的时候按标签对剥，
           不再存一份几 KB 的原文副本（楼里本来就有一份）；不是包裹型的才存原文。 */
        var envName = ipeImgTemplateEnvelope(tag);
        msg.extra.ipe_inject_env = envName || "";
        if (envName) delete msg.extra.ipe_inject_tag; else msg.extra.ipe_inject_tag = String(tag || "");
        // 2.16.0 连描述和五层一起记：翻到哪楼都能按新模板重拼，刷新页面也不丢
        msg.extra.ipe_inject_desc = String(desc || "");
        var ly = null;
        if (layers && typeof layers === "object") { ly = {}; IPE_IMG_LAYERS.forEach(function(l){ ly[l] = String(layers[l] || ""); }); }
        msg.extra.ipe_inject_layers = ly;
    } catch(e) {}
}
/* 这楼记过的提取结果；没有就 null */
function ipeInjectRecord(msg) {
    try {
        var ex = msg && msg.extra;
        if (!ex || !String(ex.ipe_inject_desc || "").trim()) return null;
        var ly = (ex.ipe_inject_layers && typeof ex.ipe_inject_layers === "object" && ipeImgJoinLayers(ex.ipe_inject_layers)) ? ex.ipe_inject_layers : null;
        return { desc: String(ex.ipe_inject_desc), layers: ly };
    } catch(e) { return null; }
}

/* 注入用的内容：预览框 → currentDesc；分层开着且本次分层新鲜时带上层框 */
function ipeResolveInjectPayload(desc) {
    var pv=q("#ipe-preview-text"), pvd=q("#iped-preview-text");
    if (!desc) desc = (pv&&pv.value)||(pvd&&pvd.value)||currentDesc;
    var layers = null;
    if (ipeImgLayeredOn() && ipeImgLayersFresh) {
        var bx = ipeImgLayerBoxValues();
        if (ipeImgJoinLayers(bx)) layers = bx;
        if (!desc) desc = ipeImgJoinLayers(bx);
    }
    return { desc: String(desc || ""), layers: layers };
}

function injectDescToMessage(desc, targetIdx) {
    var idx = typeof targetIdx === "number" ? targetIdx : currentIdx;
    if (idx < 0) throw new Error("消息不存在");

    var p = ipeResolveInjectPayload(desc);
    desc = p.desc; var layers = p.layers;
    if (!desc) throw new Error("没有内容");

    var c = ctx();
    var msg = c.chat[idx];
    if (!msg) throw new Error("消息不存在");

    var tag = buildInjectTag(desc, layers);
    if (String(msg.mes || "").indexOf(tag) >= 0) {
        return { injected: false, reason: "duplicate", tag: tag };
    }

    msg.mes = String(msg.mes || "").trimEnd() + "\n\n" + tag;
    ipeRememberInjectTag(msg, tag, desc, layers);
    // 酒馆左右滑 swipe 时会用 swipes[swipe_id] 覆盖 mes（syncSwipeToMes），
    // 只写 mes 不写 swipes，一滑回来注入的 tag 就没了。两边同步。
    try {
        if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipe_id >= 0 && msg.swipe_id < msg.swipes.length) {
            msg.swipes[msg.swipe_id] = msg.mes;
        }
    } catch(eSw) {}
    if (typeof c.saveChat === "function") c.saveChat();

    var el=q('#chat .mes[mesid="'+idx+'"] .mes_text');
    if(el && el.innerHTML.indexOf(esc(tag)) < 0) el.insertAdjacentHTML("beforeend", "<p>"+esc(tag)+"</p>");
    try { ipeInstallMesButtons(); } catch(eB) {}   // 这楼刚有了记录，🎨 立刻挂上，不等观察器

    return { injected: true, tag: tag };
}

/* ============================================================
   🎨 换画风重注入（2.15.0）
   提取结果不动、不叫副 AI：把目标楼楼尾那块生图 tag（按用户所有模板 + 内置 + 老版 image### 剥）
   剥掉，再按当前选中的基础模板重拼一块追加回去。没提取过这楼也行——
   层框是这楼存下来的就用层框；预览框空、层框也对不上，就直说先提取一次。
   ============================================================ */
function reinjectDescToMessage(targetIdx, opts) {
    opts = opts || {};
    var c = ctx();
    var chat = c.chat || [];
    var idx = typeof targetIdx === "number" ? targetIdx : currentIdx;
    if (idx < 0) {
        for (var k = chat.length - 1; k >= 0; k--) {
            var m0 = chat[k];
            if (m0 && !m0.is_user && m0.is_system !== true && String(m0.mes || "").trim()) { idx = k; break; }
        }
    }
    if (idx < 0 || !chat[idx]) throw new Error("找不到要注入的楼");
    var msg = chat[idx];

    /* 内容从哪来：
       · 楼层按钮（preferRecord）或不是刚提取那楼：先用这楼记录的描述 + 五层（预览框里是别楼的，不能拿）
       · 面板按钮、且就是刚提取那楼（或还没定位过楼）：先用预览框 / 层框，人刚改过的算数 */
    var rec = ipeInjectRecord(msg);
    var previewFirst = !opts.preferRecord && (idx === currentIdx || currentIdx < 0);   // 还没定位过楼时预览框不属于任何楼，面板按钮照旧拿它
    var p = { desc: "", layers: null };
    var fromPreview = function(){
        p = ipeResolveInjectPayload("");
        if (!p.layers && ipeImgLayeredOn()) {
            // 分层不「新鲜」（比如刷新过页面）但存档就是这一楼的：层框可信，照用
            var st = ipeImgLayersRead(), bx = ipeImgLayerBoxValues();
            if (st && Number(st.floor) === idx + 1 && ipeImgJoinLayers(bx)) {
                p.layers = bx;
                if (!p.desc) p.desc = ipeImgJoinLayers(bx);
            }
        }
    };
    if (previewFirst) fromPreview();
    if (!p.desc && rec) p = { desc: rec.desc, layers: rec.layers };
    if (!p.desc) throw new Error(previewFirst ? "预览框是空的，先提取一次" : "这楼没有提取记录，先提取一次");

    var before = String(msg.mes || "");
    // 先按这楼记录的「上次注入的那块」原样剥（模板后来改了、删了都认），再按模板规则兜底剥一遍
    var stripped = before, prevTag = "", prevEnv = "";
    try {
        prevTag = String((msg.extra && msg.extra.ipe_inject_tag) || "");
        prevEnv = String((msg.extra && msg.extra.ipe_inject_env) || "");
        if (prevTag) { var kp = stripped.lastIndexOf(prevTag); if (kp >= 0) stripped = stripped.slice(0, kp) + stripped.slice(kp + prevTag.length); }
        if (prevEnv) stripped = ipeStripEnvelope(stripped, prevEnv);   // 记的是标签名：按标签对剥，模板改了删了都认
    } catch(ePT) {}
    stripped = ipeLedgerStripImageTag(stripped);
    var tag = buildInjectTag(p.desc, p.layers);
    var next = stripped.replace(/\s+$/, "") + "\n\n" + tag;
    if (next === before) return { injected: false, reason: "same", tag: tag, idx: idx, replaced: false };

    msg.mes = next;
    ipeRememberInjectTag(msg, tag, p.desc, p.layers);
    try {
        if (Array.isArray(msg.swipes) && Number.isInteger(msg.swipe_id) && msg.swipe_id >= 0 && msg.swipe_id < msg.swipes.length) {
            msg.swipes[msg.swipe_id] = msg.mes;
        }
    } catch(eSw) {}
    if (typeof c.saveChat === "function") c.saveChat();
    ipeSwapInjectedParagraph(idx, tag, prevTag, prevEnv);
    try { ipeInstallMesButtons(); } catch(eB) {}
    return { injected: true, tag: tag, idx: idx, replaced: stripped !== before };
}

/* 把文本里所有 <name>…</name> 对剥掉（name 是记录的包裹标签名） */
function ipeStripEnvelope(text, name) {
    var esc2 = String(name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!esc2) return String(text || "");
    try { return String(text || "").replace(new RegExp("\\s*<" + esc2 + "\\s*>[\\s\\S]*?<\\/" + esc2 + "\\s*>", "g"), ""); } catch(e) { return String(text || ""); }
}

/* 楼里的 DOM 只换我们自己那一段，绝不整楼重排（2.15.1）。
   2.15.0 走了酒馆 updateMessageBlock 整楼重画：楼里把 html 代码块渲染成前端卡的扩展只在自己的事件里干活，
   重画之后它们不再跑一遍，整楼就成了一屏源码。照老注入的做法：
   把上次注入追加的那个 <p>（文字等于记录的原文，或剥掉 tag 后什么都不剩）摘掉，再追加新的 <p>，其余节点一概不碰。 */
function ipeSwapInjectedParagraph(idx, tag, prevTag, prevEnv) {
    var el = q('#chat .mes[mesid="' + idx + '"] .mes_text'); if (!el) return;
    var prev = String(prevTag || "").trim(), env = String(prevEnv || "");
    try {
        Array.prototype.slice.call(el.children).forEach(function(ch){
            var t = String(ch.textContent || "").trim();
            if (!t) return;
            if ((prev && t === prev) || (env && !ipeStripEnvelope(t, env).trim()) || !ipeLedgerStripImageTag(t).trim()) ch.remove();
        });
    } catch(e) {}
    if (el.innerHTML.indexOf(esc(tag)) < 0) el.insertAdjacentHTML("beforeend", "<p>" + esc(tag) + "</p>");
}

/* ============================================================
   🎨 楼层按钮（2.16.0）：每条记过提取结果的 AI 楼，操作栏里多一个 🎨，
   点了就按当前选中的模板重拼那一楼。只挂在有记录的楼上，没记录的楼不出按钮。
   ============================================================ */
var IPE_MES_BTN_CLASS = "ipe-mes-reinject";
function ipeInstallMesButtons() {
    var d = ipeRootDocument();
    var chatEl = d.querySelector("#chat"); if (!chatEl) return 0;
    var chat = (ctx() && ctx().chat) || [];
    var n = 0;
    Array.prototype.slice.call(chatEl.querySelectorAll(".mes")).forEach(function(m){
        var idx = Number(m.getAttribute("mesid"));
        if (!Number.isFinite(idx)) return;
        var msg = chat[idx];
        var has = m.querySelector("." + IPE_MES_BTN_CLASS);
        var want = !!(msg && !msg.is_user && ipeInjectRecord(msg));
        if (want && !has) {
            /* 2.16.1 放在「…」旁边常驻可见：手机上 .extraMesButtons 默认折叠，塞进去就得先点「…」才看得到 */
            var html = '<div title="🐚 换画风：按当前模板重新注入这楼" class="mes_button ' + IPE_MES_BTN_CLASS + ' fa-solid fa-palette interactable" tabindex="0"></div>';
            var hint = m.querySelector(".mes_buttons .extraMesButtonsHint");
            var bar = m.querySelector(".mes_buttons") || m.querySelector(".extraMesButtons");
            if (hint) hint.insertAdjacentHTML("beforebegin", html);
            else if (bar) bar.insertAdjacentHTML("afterbegin", html);
            else return;
            n++;
        } else if (!want && has) {
            try { has.remove(); } catch(e) {}
        }
    });
    return n;
}
function ipeInstallMesButtonsObserver() {
    try {
        if (window.__ipeMesBtnObs) return;
        var d = ipeRootDocument();
        var chatEl = d.querySelector("#chat");
        if (!chatEl || typeof MutationObserver === "undefined") return;
        var t = null;
        window.__ipeMesBtnObs = new MutationObserver(function(){
            if (t) clearTimeout(t);
            t = setTimeout(function(){ try { ipeInstallMesButtons(); } catch(e) {} }, 250);
        });
        window.__ipeMesBtnObs.observe(chatEl, { childList: true, subtree: true });
        if (!d.__ipeMesBtnClick) {
            d.__ipeMesBtnClick = true;
            d.addEventListener("click", function(ev){
                var b = ev.target && ev.target.closest ? ev.target.closest("." + IPE_MES_BTN_CLASS) : null;
                if (!b) return;
                ev.preventDefault(); ev.stopPropagation();
                var m = b.closest(".mes"); var idx = m ? Number(m.getAttribute("mesid")) : NaN;
                if (Number.isFinite(idx)) onReinjectFloor(idx);
            }, true);
        }
    } catch(e) {}
}
function onReinjectFloor(idx) {
    var nm = String((ipeGetActiveTemplateItem() || {}).name || "");
    try {
        var r = reinjectDescToMessage(idx, { preferRecord: true });
        if (r.injected) {
            ipeNotice({ kind: "ok", title: "🐚 已换画风", body: "第 " + (r.idx + 1) + " 楼 → 「" + nm + "」" + (r.replaced ? "，旧的那块已替换" : ""), timeout: 3500 });
            setStatus("已按「" + nm + "」重新注入第 " + (r.idx + 1) + " 楼 ✓", "#6ec577");
        } else {
            ipeNotice({ kind: "info", title: "🐚 没变", body: "第 " + (r.idx + 1) + " 楼已经是「" + nm + "」的注入", timeout: 3000 });
        }
    } catch(e) {
        ipeNotice({ kind: "error", title: "🐚 换画风失败", body: String(e && e.message || e), timeout: 6000 });
    }
}

/* ============================================================
   📝 补充指令常用短语（2.16.0）：「这段是冷战不是撒娇」这种句子反复用，存起来点一下就填。
   ============================================================ */
function ipeGetSuppPresets() {
    var list = ipeSafeJsonParse(cfg().supplementPresetsJson, null);
    return Array.isArray(list) ? list.map(function(x){ return String(x || ""); }).filter(Boolean) : [];
}
function ipeSaveSuppPresets(list) { saveCritical("supplementPresetsJson", JSON.stringify(list || [])); ipeRefreshSuppPresets(); }
function ipeRefreshSuppPresets() {
    var list = ipeGetSuppPresets();
    ["ipe-supp-presets", "iped-supp-presets"].forEach(function(id){
        var el = q("#" + id); if (!el) return;
        var cur = el.value;
        var html = '<option value="">常用短语…</option>';
        list.forEach(function(s, i){ var label = s.length > 40 ? s.slice(0, 40) + "…" : s; html += '<option value="' + i + '">' + esc(label) + '</option>'; });
        el.innerHTML = html;
        el.value = (cur !== "" && Number(cur) < list.length) ? cur : "";
    });
}
function ipeSuppInputs() { return [q("#ipe-supplement"), q("#iped-supplement")].filter(Boolean); }
function ipeSuppFill(text) {
    var ins = ipeSuppInputs();
    var curv = ""; ins.forEach(function(el){ if (!curv && el.value) curv = el.value; });
    var cur = String(curv || "").trim();
    var next = !cur ? text : (cur.indexOf(text) >= 0 ? cur : cur + "；" + text);
    ins.forEach(function(el){ el.value = next; });
}
function ipeSuppSaveCurrent() {
    var v = ""; ipeSuppInputs().forEach(function(el){ if (!v && el.value) v = el.value; });
    v = String(v || "").trim();
    if (!v) { setStatus("补充指令框是空的，先写一句再存", "#d4726a"); return false; }
    var list = ipeGetSuppPresets();
    if (list.indexOf(v) < 0) list.push(v);
    ipeSaveSuppPresets(list);
    ["ipe-supp-presets", "iped-supp-presets"].forEach(function(id){ var el = q("#" + id); if (el) el.value = String(list.indexOf(v)); });
    setStatus("已存为常用短语（共 " + list.length + " 条）", "#6ec577");
    return true;
}
function ipeSuppDeleteSelected() {
    var sel = q("#ipe-supp-presets") || q("#iped-supp-presets");
    var idx = sel ? Number(sel.value) : NaN;
    var list = ipeGetSuppPresets();
    if (!sel || sel.value === "" || !Number.isFinite(idx) || idx < 0 || idx >= list.length) { setStatus("先在常用短语里选一条再删", "#d4726a"); return false; }
    list.splice(idx, 1);
    ipeSaveSuppPresets(list);
    ["ipe-supp-presets", "iped-supp-presets"].forEach(function(id){ var el = q("#" + id); if (el) el.value = ""; });
    setStatus("已删除这条常用短语", "#6ec577");
    return true;
}

function onReinject() {
    try {
        var r = reinjectDescToMessage(currentIdx);
        var nm = String((ipeGetActiveTemplateItem() || {}).name || "");
        if (r.injected) {
            setStatus("已按「" + nm + "」重新注入第 " + (r.idx + 1) + " 楼 ✓" + (r.replaced ? "（旧的那块已替换）" : ""), "#6ec577");
            var ball=q("#ipe-chat-quick-entry"); if(ball) ball.classList.remove("has-result");
            console.log("[IPE] 换画风重注入 #" + r.idx);
        } else {
            setStatus("这楼已经是「" + nm + "」的注入，没变", "#6ec577");
        }
    } catch(e){ console.error("[IPE]", e); setStatus("重注入失败: " + e.message, "#d4726a"); }
}

function onMsgReceived(idx) {
    if (!cfg().enabled) return;
    try {
        var chat = ctx().chat || [];
        var i = Number(idx);
        var msg = (Number.isFinite(i) && i >= 0) ? chat[i] : null;
        if (msg && msg.is_user) return;               // 酒馆明确点名 user 楼：不提取，维持原行为
        if (!msg) {
            // 有的酒馆/套壳发事件不带楼号（或带的不是数字）——参数靠不住就自己找最后一条 AI 楼
            i = -1;
            for (var k = chat.length - 1; k >= 0; k--) {
                var m = chat[k];
                if (m && !m.is_user && m.is_system !== true && String(m.mes || "").trim()) { i = k; msg = m; break; }
            }
            if (i < 0 || !msg) return;
            try { console.log("[IPE] 生图：事件没带楼号（收到:", idx, "），已自行定位第", i + 1, "楼"); } catch(eLg) {}
        }

        pendingAutoIdx = i;
        currentIdx = i;

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

async function runExtract(text, supplement, autoInjectNow, targetIdx, retryAttempt, lockOverride) {
    retryAttempt = Number(retryAttempt || 0);
    if (retryAttempt === 0) ipeClearApiRetry();

    processing = true;
    var ball = q("#ipe-chat-quick-entry"); if(ball)ball.classList.add("processing");
    setStatus(retryAttempt > 0 ? "正在自动重试提取…" : (ipeImgLayeredOn() ? "正在分层提取…" : "正在提取…"),"#6ec577"); setBtns(false,false);
    var layerNote = "";
    try {
        var desc = await callAPI(text, supplement||"", lockOverride);
        if (ipeImgLayeredOn()) {
            var parsed = ipeImgParseLayers(desc);
            if (parsed.found > 0) {
                var floorNo = (typeof targetIdx === "number" ? targetIdx : currentIdx) + 1;
                var locks = ipeImgLocks(lockOverride);
                var merged = ipeImgMergeLayers(parsed, ipeImgPrevLayers(locks), locks, floorNo);
                ipeImgSetLayerBoxes(merged);
                ipeImgLayersSave(merged, floorNo);
                desc = ipeImgJoinLayers(merged);
                ipeImgLayersFresh = true;
                layerNote = merged.notes.length ? "（" + merged.notes.join("，") + "）" : "（五层齐全）";
            } else {
                ipeImgLayersFresh = false;
                layerNote = "（副 AI 没分层，按整段收下；层框未更新）";
            }
        }
        currentDesc = desc; setPreview(desc);

        if (autoInjectNow) {
            var result = injectDescToMessage(desc, typeof targetIdx === "number" ? targetIdx : currentIdx);
            if (result && result.injected) {
                setStatus("提取完成并已自动注入 ✓" + layerNote,"#6ec577");
                setBtns(false,false);
                var s1=q("#ipe-supplement"),s2=q("#iped-supplement");
                if(s1)s1.value=""; if(s2)s2.value="";
                if(ball) ball.classList.remove("has-result");
            } else {
                setStatus("提取完成，跳过自动注入（可能已注入）" + layerNote,"#6ec577");
                setBtns(true,true);
                if(ball) ball.classList.add("has-result");
            }
        } else {
            setStatus("提取完成 — 可编辑后确认注入" + layerNote,"#6ec577");
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
            ipeScheduleApiRetry(text, supplement || "", !!autoInjectNow, targetIdx, retryAttempt, msg, lockOverride);
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

async function onRerollLayer(layer) {
    if (processing) return;
    if (!ipeImgLayeredOn()) { setStatus("先打开「分层提取」", "#c9a227"); return; }
    if (currentIdx < 0) {
        // 还没提取过：默认盯最后一条 AI 楼
        try { var ch = ctx().chat || []; for (var i = ch.length - 1; i >= 0; i--) { if (ch[i] && !ch[i].is_user) { currentIdx = i; break; } } } catch(e) {}
        if (currentIdx < 0) { setStatus("没找到可读的正文", "#d4726a"); return; }
    }
    try {
        var msg = ctx().chat[currentIdx]; if (!msg) return;
        var ov = {}; IPE_IMG_LAYERS.forEach(function(x){ ov[x] = x !== layer; });   // 其余三层临时锁定
        var sup = q("#ipe-supplement"), supd = q("#iped-supplement");
        setStatus("只重摇" + IPE_IMG_LAYER_LABEL[layer] + "层，其余各层锁定…", "#6ec577");
        await runExtract(msg.mes, (sup && sup.value) || (supd && supd.value) || "", false, currentIdx, 0, ov);
    } catch(e) {}
}

function onInject() {
    if(currentIdx<0) return;
    try {
        var result = injectDescToMessage("", currentIdx);
        if (result && result.injected) {
            setStatus("已注入 ✓","#6ec577"); setBtns(false,false);
            var ball=q("#ipe-chat-quick-entry"); if(ball)ball.classList.remove("has-result");
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

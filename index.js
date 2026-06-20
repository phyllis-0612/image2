/*
 *  Image Prompt Extractor v1.8.6.1
 *  SillyTavern 1.18 — SillyTavern.getContext() + fetch API
 */

const EXT_NAME = "image-prompt-extractor";
const DEFAULTS = {
    enabled: true,
    autoInject: false,
    autoInjectDelay: 1800,
    requestTimeout: 0,
    apiEndpoint: "", apiKey: "", model: "",
    apiProfilesJson: "", activeApiProfile: "api_1",
    systemPrompt: "", baseTemplate: "", characterAnchors: "", extractionRules: "",
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
    baseTemplateName4: "预设4"
};
let currentDesc = "", currentIdx = -1, processing = false, initialized = false;
let ipeAbortController = null;
let ipeUserAbortRequested = false;
let ipeRetryTimer = null;
let autoTimer = null, pendingAutoIdx = -1;

const IPE_CREDITS = "ripple & GPT";
const IPE_ANCHOR_USAGE_GUIDE = [
    "以下角色锚点仅为候选资料库，不是强制全部使用。提取时请严格根据正文当前场景按需调用：",
    "1. 只调用正文中明确出场、且当前画面确实需要入镜的角色。",
    "2. 未出场、仅被提及、仅存在于回忆/对话/电话/聊天记录中的角色，不要加入当前画面。",
    "3. 单人场景只输出单人描述，双人场景只输出双人描述；只有正文明确存在多人同场互动时，才输出多人描述。若多个主角并不处于同一场景、同一空间或同一时间片段，不需要强行生成同框互动图，此时可根据正文内容选择单人图，或输出拼图/分镜图。",
    "4. 若正文只出现某一个角色，例如只出char，则只调用char锚点；其他角色（包括NPC、{{user}}）若未实际出场，一律忽略。",
    "5. 这些角色锚点只用于校准已出场角色的外貌，不用于凭空增加角色，不用于强行拼成双人图或多人图。",
    "6. 如果当前段落没有明确描写某个角色的入镜需求，就不要因为锚点里有这个人而主动生成他/她。"
].join("\n");
const IPE_ANCHOR_USAGE_GUIDE_LEGACY = IPE_ANCHOR_USAGE_GUIDE + "\n【角色锚点】";

function ipeStripBuiltInAnchorGuide(text) {
    var s = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!s) return "";
    var patterns = [IPE_ANCHOR_USAGE_GUIDE_LEGACY, IPE_ANCHOR_USAGE_GUIDE];
    for (var i = 0; i < patterns.length; i++) {
        var p = patterns[i];
        if (s.indexOf(p) === 0) {
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
        user += "【角色锚点使用规则】\n" + IPE_ANCHOR_USAGE_GUIDE + "\n\n";
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
    btn.textContent = "🎨 IPE";
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
    h += '<span class="ipe-panel-title">图像提示词提取器</span>';
    h += '<div style="display:flex;align-items:center;gap:8px"><label class="ipe-toggle"><input type="checkbox" id="ipe-enabled"'+(c.enabled?' checked':'')+'><span class="ipe-toggle-slider"></span></label><button id="ipe-panel-close" type="button" class="ipe-btn" style="flex:none;padding:3px 8px">×</button></div>';
    h += '</div><div class="ipe-sections">';

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
        '<div class="ipe-anchor-guide"><div class="ipe-anchor-guide-title">内置锚点规则（会自动随请求发送）</div>'+
        '以下角色锚点仅为候选资料库，不是强制全部使用。提取时请严格根据正文当前场景按需调用：<br>'+
        '1. 只调用正文中明确出场、且当前画面确实需要入镜的角色。<br>'+
        '2. 未出场、仅被提及、仅存在于回忆/对话/电话/聊天记录中的角色，不要加入当前画面。<br>'+
        '3. 单人场景只输出单人描述，双人场景只输出双人描述；只有正文明确存在多人同场互动时，才输出多人描述。若多个主角并不处于同一场景、同一空间或同一时间片段，不需要强行生成同框互动图，此时可根据正文内容选择单人图，或输出拼图/分镜图。<br>'+
        '4. 若正文只出现某一个角色，例如只出char，则只调用char锚点；其他角色（包括NPC、{{user}}）若未实际出场，一律忽略。<br>'+
        '5. 这些角色锚点只用于校准已出场角色的外貌，不用于凭空增加角色，不用于强行拼成双人图或多人图。<br>'+
        '6. 如果当前段落没有明确描写某个角色的入镜需求，就不要因为锚点里有这个人而主动生成他/她。'+
        '<div style="margin-top:6px;color:#8a8a8a">下方文本框只需要填写具体角色外貌锚点内容，不必再把这段规则重复粘贴到每个预设。</div></div>'+
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

    h += '</div><div class="ipe-footer">by ' + IPE_CREDITS + '</div>';
    panel.innerHTML = h;
    ipeRootDocument().body.appendChild(panel);
}

function secHTML(id, title, collapsed, body) {
    return '<div class="ipe-section'+(collapsed?' collapsed':'')+'" id="ipe-section-'+id+'">'+
        '<div class="ipe-section-header"><span>'+title+'</span><span class="ipe-collapse-icon">▾</span></div>'+
        '<div class="ipe-section-body">'+body+'</div></div>';
}

function createDrawer() {
    if (q("#ipe-drawer")) return;
    var c = cfg();
    var h = '<div id="ipe-drawer"><div class="inline-drawer">';
    h += '<div class="inline-drawer-toggle inline-drawer-header"><b>\uD83C\uDFA8 图像提示词提取器</b>';
    h += '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>';
    h += '<div class="inline-drawer-content">';
    h += '<div style="margin-bottom:6px"><label>启用 <input type="checkbox" id="iped-enabled"'+(c.enabled?' checked':'')+'></label></div>';
    h += '<div style=\"margin-bottom:6px\"><label>显示快捷入口 <input type=\"checkbox\" id=\"iped-show-quick-entry\"'+(c.showQuickEntry?' checked':'')+'></label></div>';
    h += '<div style="margin-bottom:6px"><label>自动注入 <input type="checkbox" id="iped-auto-inject"'+(c.autoInject?' checked':'')+'></label></div>';
    h += '<div style="margin:8px 0;display:flex;gap:6px"><input type="button" id="iped-open-panel" class="menu_button" value="打开 IPE 小面板"><input type="button" id="iped-reset-entry" class="menu_button" value="重置入口位置"></div>';
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
    h += '<div class="ipe-anchor-guide"><div class="ipe-anchor-guide-title">内置锚点规则（会自动随请求发送）</div>以下角色锚点仅为候选资料库，不是强制全部使用。提取时请严格根据正文当前场景按需调用：<br>1. 只调用正文中明确出场、且当前画面确实需要入镜的角色。<br>2. 未出场、仅被提及、仅存在于回忆/对话/电话/聊天记录中的角色，不要加入当前画面。<br>3. 单人场景只输出单人描述，双人场景只输出双人描述；只有正文明确存在多人同场互动时，才输出多人描述。若多个主角并不处于同一场景、同一空间或同一时间片段，不需要强行生成同框互动图，此时可根据正文内容选择单人图，或输出拼图/分镜图。<br>4. 若正文只出现某一个角色，例如只出char，则只调用char锚点；其他角色（包括NPC、{{user}}）若未实际出场，一律忽略。<br>5. 这些角色锚点只用于校准已出场角色的外貌，不用于凭空增加角色，不用于强行拼成双人图或多人图。<br>6. 如果当前段落没有明确描写某个角色的入镜需求，就不要因为锚点里有这个人而主动生成他/她。<div style="margin-top:6px;color:#8a8a8a">下方文本框只需要填写具体角色外貌锚点内容，不必再把这段规则重复粘贴到每个预设。</div></div>';
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
    h += '</div><div style="margin-top:8px;color:#666;font-size:11px;text-align:right">by ' + IPE_CREDITS + '</div></div></div></div>';

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

/*
 *  Image Prompt Extractor v2
 *  SillyTavern 1.18 — SillyTavern.getContext() + fetch API
 */

const EXT_NAME = "image-prompt-extractor";
const DEFAULTS = {
    enabled: true,
    autoInject: false,
    autoInjectDelay: 1800,
    requestTimeout: 0,
    apiEndpoint: "", apiKey: "", model: "",
    systemPrompt: "", baseTemplate: "", characterAnchors: "", extractionRules: "",
    activeBaseTemplate: "slot1",
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
let autoTimer = null, pendingAutoIdx = -1;

function ctx() { return SillyTavern.getContext(); }

function loadSettings() {
    try {
        const es = ctx().extensionSettings;
        if (!es[EXT_NAME]) es[EXT_NAME] = {};
        for (const [k, v] of Object.entries(DEFAULTS)) {
            if (es[EXT_NAME][k] === undefined) es[EXT_NAME][k] = v;
        }

        // 兼容旧版：如果以前只用单一 baseTemplate，则迁移到预设1
        if (!es[EXT_NAME].baseTemplateSlot1 && es[EXT_NAME].baseTemplate) {
            es[EXT_NAME].baseTemplateSlot1 = es[EXT_NAME].baseTemplate;
        }
        if (!es[EXT_NAME].activeBaseTemplate) {
            es[EXT_NAME].activeBaseTemplate = "slot1";
        }
    } catch(e) { console.error("[IPE] loadSettings:", e); }
}
function cfg() {
    try { return ctx().extensionSettings[EXT_NAME]; }
    catch(e) { return {...DEFAULTS}; }
}
function save(key, val) {
    try { ctx().extensionSettings[EXT_NAME][key] = val; ctx().saveSettingsDebounced(); } catch(e) {}
}

function esc(s) {
    if (!s) return "";
    var d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}
function q(s) { return document.querySelector(s); }

function ipeTemplateSlotKey(slot) {
    return "baseTemplate" + String(slot || "slot1").replace(/^slot/, "Slot");
}

function ipeTemplateNameKey(slot) {
    var n = String(slot || "slot1").replace(/^slot/, "");
    return "baseTemplateName" + n;
}

function ipeGetActiveTemplateSlot() {
    var c = cfg();
    var slot = c.activeBaseTemplate || "slot1";
    if (["slot1","slot2","slot3","slot4"].indexOf(slot) < 0) slot = "slot1";
    return slot;
}

function ipeGetTemplateValue(slot) {
    var c = cfg();
    var key = ipeTemplateSlotKey(slot || ipeGetActiveTemplateSlot());
    var val = c[key];
    if (!val && slot === "slot1" && c.baseTemplate) val = c.baseTemplate;
    return String(val || "");
}

function ipeSetTemplateValue(slot, val) {
    var key = ipeTemplateSlotKey(slot || ipeGetActiveTemplateSlot());
    save(key, val || "");
    if ((slot || ipeGetActiveTemplateSlot()) === "slot1") save("baseTemplate", val || "");
}

function ipeGetTemplateName(slot) {
    var c = cfg();
    var key = ipeTemplateNameKey(slot || ipeGetActiveTemplateSlot());
    return String(c[key] || (slot || ipeGetActiveTemplateSlot()));
}

function ipeSetTemplateName(slot, val) {
    var key = ipeTemplateNameKey(slot || ipeGetActiveTemplateSlot());
    save(key, val || "");
}

function ipeRefreshTemplateEditors() {
    var slot = ipeGetActiveTemplateSlot();
    var name = ipeGetTemplateName(slot);
    var value = ipeGetTemplateValue(slot);

    ["ipe-template-slot","iped-template-slot"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = slot;
    });
    ["ipe-template-name","iped-template-name"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = name;
    });
    ["ipe-base-template","iped-base-template"].forEach(function(id){
        var el = q("#" + id); if (el) el.value = value;
    });
    [
        ["#ipe-template-slot option[value=\"slot1\"]", cfg().baseTemplateName1 || "预设1"],
        ["#ipe-template-slot option[value=\"slot2\"]", cfg().baseTemplateName2 || "预设2"],
        ["#ipe-template-slot option[value=\"slot3\"]", cfg().baseTemplateName3 || "预设3"],
        ["#ipe-template-slot option[value=\"slot4\"]", cfg().baseTemplateName4 || "预设4"],
        ["#iped-template-slot option[value=\"slot1\"]", cfg().baseTemplateName1 || "预设1"],
        ["#iped-template-slot option[value=\"slot2\"]", cfg().baseTemplateName2 || "预设2"],
        ["#iped-template-slot option[value=\"slot3\"]", cfg().baseTemplateName3 || "预设3"],
        ["#iped-template-slot option[value=\"slot4\"]", cfg().baseTemplateName4 || "预设4"]
    ].forEach(function(pair){
        var el = q(pair[0]); if (el) el.textContent = pair[1];
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

    var controller = new AbortController();
    var timer = setTimeout(function() {
        try { controller.abort(); } catch(e) {}
    }, timeoutMs);

    options = options || {};
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

            var first = document.createElement("option");
            first.value = "";
            first.textContent = "请选择模型";
            first.disabled = true;
            sel.appendChild(first);

            models.forEach(function(id) {
                var opt = document.createElement("option");
                opt.value = id;
                opt.textContent = id;
                if (id === c.model) opt.selected = true;
                sel.appendChild(opt);
            });

            if (c.model && models.indexOf(c.model) >= 0) {
                sel.value = c.model;
            } else if (models.length > 0) {
                sel.value = models[0];
                save("model", models[0]);
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

    if (c.characterAnchors) user += "【角色外貌锚点】\n" + c.characterAnchors + "\n\n";
    if (c.extractionRules) user += "【提取规则】\n" + c.extractionRules + "\n\n";

    user += "【正文内容】\n" + ipeTrimSourceText(text);

    if (supplement) user += "\n\n【补充指令】\n" + supplement;

    user += "\n\n任务：把正文转成英文生图 Description。\n";
    user += "要求：只输出最终英文 Description；不要解释；不要标题；不要代码块；不要中文；不要复述任务。\n";
    user += "优先写可见画面：人物数量、姿态、表情、服装、环境、光线、氛围、镜头距离。";

    return user;
}

async function callAPI(text, supplement) {
    var c = cfg();
    if (!c.apiEndpoint) throw new Error("请先配置 API 地址");
    if (!c.model) throw new Error("请先加载并选择模型");

    var url = buildChatUrl(c.apiEndpoint);
    var headers = { "Content-Type": "application/json" };
    if (c.apiKey) headers["Authorization"] = "Bearer " + c.apiKey;

    var systemPrompt = c.systemPrompt || "You extract concise visual image-generation descriptions from Chinese roleplay text. Output only the final English Description. Do not think aloud. Do not explain.";

    var body = {
        model: c.model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildVisionUserPrompt(text, supplement || "") }
        ],
        temperature: 0.4,
        stream: false
    };

    var res = await ipeFetchWithTimeout(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
    }, Number(cfg().requestTimeout || 0));

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
}

function createUI() {
    createBall();
    createPanel();
    createDrawer();
    bindAll();
}

function createBall() {
    if (q("#ipe-ball")) return;

    var ball = document.createElement("div");
    ball.id = "ipe-ball";
    ball.className = "ipe-ball";
    ball.title = "图像提示词提取器";
    ball.innerHTML = "🎨";

    // 手机端强显兜底：不依赖 CSS，避免被主题、底栏、透明背景吞掉
    ball.style.position = "fixed";
    ball.style.right = "18px";
    ball.style.bottom = "92px";
    ball.style.width = "46px";
    ball.style.height = "46px";
    ball.style.minWidth = "46px";
    ball.style.minHeight = "46px";
    ball.style.borderRadius = "50%";
    ball.style.zIndex = "999999";
    ball.style.display = "flex";
    ball.style.alignItems = "center";
    ball.style.justifyContent = "center";
    ball.style.fontSize = "22px";
    ball.style.lineHeight = "1";
    ball.style.background = "rgba(60, 45, 35, 0.82)";
    ball.style.color = "#fff";
    ball.style.boxShadow = "0 4px 16px rgba(0,0,0,.35)";
    ball.style.border = "1px solid rgba(255,255,255,.55)";
    ball.style.cursor = "pointer";
    ball.style.userSelect = "none";
    ball.style.webkitUserSelect = "none";
    ball.style.touchAction = "manipulation";

    ball.addEventListener("click", function(){
        var p = q("#ipe-panel");
        if (p) p.classList.toggle("visible");
    });

    document.body.appendChild(ball);
}

function createPanel() {
    if (q("#ipe-panel")) return;
    var c = cfg();
    var panel = document.createElement("div");
    panel.id = "ipe-panel"; panel.className = "ipe-panel";

    var h = '<div class="ipe-panel-header">';
    h += '<span class="ipe-panel-title">图像提示词提取器</span>';
    h += '<label class="ipe-toggle"><input type="checkbox" id="ipe-enabled"'+(c.enabled?' checked':'')+'><span class="ipe-toggle-slider"></span></label>';
    h += '</div><div class="ipe-sections">';

    h += secHTML("api-config","API 配置", true,
        '<label>API 地址<input type="text" id="ipe-api-endpoint" value="'+esc(c.apiEndpoint)+'" placeholder="https://api.openai.com/v1"></label>'+
        '<label>API 密钥<input type="password" id="ipe-api-key" value="'+esc(c.apiKey)+'" placeholder="sk-..."></label>'+
        '<label>模型</label><select id="ipe-model"><option value="'+esc(c.model)+'">'+(c.model?esc(c.model)+' (已保存)':'请先加载模型')+'</option></select>'+
        '<div class="ipe-preview-actions" style="margin-top:6px"><button id="ipe-btn-models" class="ipe-btn">加载模型</button><button id="ipe-btn-test" class="ipe-btn">测试连接</button></div>');

    h += secHTML("system-prompt","系统提示", true,
        '<textarea id="ipe-system-prompt" rows="5" placeholder="你是一个专精中文文学场景视觉化的提示词专家…">'+esc(c.systemPrompt)+'</textarea>');

    h += secHTML("base-template","基础模板", true,
        '<label>模板预设<select id="ipe-template-slot">'+
            '<option value="slot1">'+esc(c.baseTemplateName1 || "预设1")+'</option>'+
            '<option value="slot2">'+esc(c.baseTemplateName2 || "预设2")+'</option>'+
            '<option value="slot3">'+esc(c.baseTemplateName3 || "预设3")+'</option>'+
            '<option value="slot4">'+esc(c.baseTemplateName4 || "预设4")+'</option>'+
        '</select></label>'+
        '<label>预设名称<input type="text" id="ipe-template-name" value="'+esc(ipeGetTemplateName(c.activeBaseTemplate || "slot1"))+'" placeholder="例如：乙游CG"></label>'+
        '<textarea id="ipe-base-template" rows="6" placeholder="image###...{Description}...###">'+esc(ipeGetTemplateValue(c.activeBaseTemplate || "slot1"))+'</textarea>'+
        '<div class="ipe-hint">四套模板可切换。用 {Description} 标记描述文本的插入位置</div>');

    h += secHTML("char-anchors","角色锚点", true,
        '<textarea id="ipe-char-anchors" rows="5" placeholder="陆冀北：a man, early 30s, tall…">'+esc(c.characterAnchors)+'</textarea>');

    h += secHTML("extract-rules","提取规则", true,
        '<textarea id="ipe-extract-rules" rows="5" placeholder="先写场景1-2句，再按在场人数逐人描述…">'+esc(c.extractionRules)+'</textarea>');

    h += secHTML("preview","预览", false,
        '<div style="margin-bottom:6px;color:#888;font-size:12px"><label style="display:flex;align-items:center;gap:6px;flex-direction:row">自动注入 <input type="checkbox" id="ipe-auto-inject"'+(c.autoInject?' checked':'')+'></label></div>'+
        '<div id="ipe-status" class="ipe-preview-status">等待新消息…</div>'+
        '<textarea id="ipe-preview-text" rows="6" placeholder="生成的 Description 将显示在这里…"></textarea>'+
        '<label>补充指令<input type="text" id="ipe-supplement" placeholder="例：这段是冷战不是撒娇"></label>'+
        '<div class="ipe-preview-actions">'+
        '<button id="ipe-btn-extract" class="ipe-btn">手动提取</button>'+
        '<button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>'+
        '<button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button></div>');

    h += '</div>';
    panel.innerHTML = h;
    document.body.appendChild(panel);
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
    h += '<div style="margin-bottom:6px"><label>自动注入 <input type="checkbox" id="iped-auto-inject"'+(c.autoInject?' checked':'')+'></label></div>';
    h += '<hr><small><b>API 配置</b></small>';
    h += '<label>API 地址</label><input type="text" id="iped-api-endpoint" class="text_pole" value="'+esc(c.apiEndpoint)+'" placeholder="https://api.openai.com/v1">';
    h += '<label>API 密钥</label><input type="password" id="iped-api-key" class="text_pole" value="'+esc(c.apiKey)+'" placeholder="sk-...">';
    h += '<label>模型</label><select id="iped-model" class="text_pole"><option value="'+esc(c.model)+'">'+(c.model?esc(c.model)+' (已保存)':'请先加载模型')+'</option></select>';
    h += '<div style="display:flex;gap:6px;margin-top:6px"><input type="button" id="iped-btn-models" class="menu_button" value="加载模型"><input type="button" id="iped-btn-test" class="menu_button" value="测试连接"></div>';
    h += '<hr><small><b>系统提示</b></small>';
    h += '<textarea id="iped-system-prompt" class="text_pole" rows="4" placeholder="你是一个专精中文文学场景视觉化的提示词专家…">'+esc(c.systemPrompt)+'</textarea>';
    h += '<hr><small><b>基础模板</b></small>';
    h += '<label>模板预设</label><select id="iped-template-slot" class="text_pole">'+
        '<option value="slot1">'+esc(c.baseTemplateName1 || "预设1")+'</option>'+
        '<option value="slot2">'+esc(c.baseTemplateName2 || "预设2")+'</option>'+
        '<option value="slot3">'+esc(c.baseTemplateName3 || "预设3")+'</option>'+
        '<option value="slot4">'+esc(c.baseTemplateName4 || "预设4")+'</option>'+
    '</select>';
    h += '<label>预设名称</label><input type="text" id="iped-template-name" class="text_pole" value="'+esc(ipeGetTemplateName(c.activeBaseTemplate || "slot1"))+'" placeholder="例如：乙游CG">';
    h += '<textarea id="iped-base-template" class="text_pole" rows="5" placeholder="image###...{Description}...###">'+esc(ipeGetTemplateValue(c.activeBaseTemplate || "slot1"))+'</textarea>';
    h += '<small style="color:#888">四套模板可切换。用 {Description} 标记插入位置</small>';
    h += '<hr><small><b>角色锚点</b></small>';
    h += '<textarea id="iped-char-anchors" class="text_pole" rows="4" placeholder="陆冀北：a man, early 30s, tall…">'+esc(c.characterAnchors)+'</textarea>';
    h += '<hr><small><b>提取规则</b></small>';
    h += '<textarea id="iped-extract-rules" class="text_pole" rows="4" placeholder="先写场景1-2句，再按在场人数逐人描述…">'+esc(c.extractionRules)+'</textarea>';
    h += '<hr><small><b>预览</b></small>';
    h += '<div id="iped-status" style="color:#888;font-size:12px;margin:4px 0">等待新消息…</div>';
    h += '<textarea id="iped-preview-text" class="text_pole" rows="5" placeholder="生成的 Description 将显示在这里…"></textarea>';
    h += '<label>补充指令</label><input type="text" id="iped-supplement" class="text_pole" placeholder="例：这段是冷战不是撒娇">';
    h += '<div style="display:flex;gap:6px;margin-top:6px">';
    h += '<input type="button" id="iped-btn-extract" class="menu_button" value="手动提取">';
    h += '<input type="button" id="iped-btn-reroll" class="menu_button" value="重新生成" disabled>';
    h += '<input type="button" id="iped-btn-inject" class="menu_button" value="确认注入" disabled>';
    h += '</div></div></div></div>';

    var target = jQuery("#extensions_settings2");
    if (target.length) { target.append(h); console.log("[IPE] 抽屉已挂载"); }
}

function bindAll() {
    document.querySelectorAll(".ipe-section-header").forEach(function(h){
        h.addEventListener("click", function(){ h.parentElement.classList.toggle("collapsed"); });
    });

    var fields = [
        ["apiEndpoint","ipe-api-endpoint","iped-api-endpoint"],
        ["apiKey","ipe-api-key","iped-api-key"],
        ["systemPrompt","ipe-system-prompt","iped-system-prompt"],
        ["characterAnchors","ipe-char-anchors","iped-char-anchors"],
        ["extractionRules","ipe-extract-rules","iped-extract-rules"]
    ];
    fields.forEach(function(arr){
        var key=arr[0], id1=arr[1], id2=arr[2];
        [id1,id2].forEach(function(id){
            var el=q("#"+id); if(!el) return;
            el.addEventListener("input", function(){
                save(key, el.value);
                var o=q("#"+(id===id1?id2:id1));
                if(o&&o!==el) o.value=el.value;
            });
        });
    });

    ["ipe-template-slot","iped-template-slot"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("activeBaseTemplate", el.value);
            var o=q("#"+(id==="ipe-template-slot"?"iped-template-slot":"ipe-template-slot"));
            if(o) o.value=el.value;
            ipeRefreshTemplateEditors();
        });
    });

    ["ipe-template-name","iped-template-name"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            var slot = ipeGetActiveTemplateSlot();
            ipeSetTemplateName(slot, el.value);
            var o=q("#"+(id==="ipe-template-name"?"iped-template-name":"ipe-template-name"));
            if(o&&o!==el) o.value=el.value;
            ipeRefreshTemplateEditors();
        });
    });

    ["ipe-base-template","iped-base-template"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("input", function(){
            var slot = ipeGetActiveTemplateSlot();
            ipeSetTemplateValue(slot, el.value);
            var o=q("#"+(id==="ipe-base-template"?"iped-base-template":"ipe-base-template"));
            if(o&&o!==el) o.value=el.value;
        });
    });

    ["ipe-model","iped-model"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("model", el.value);
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

    ["ipe-auto-inject","iped-auto-inject"].forEach(function(id){
        var el=q("#"+id); if(!el) return;
        el.addEventListener("change", function(){
            save("autoInject", el.checked);
            var o=q("#"+(id==="ipe-auto-inject"?"iped-auto-inject":"ipe-auto-inject"));
            if(o) o.checked=el.checked;
        });
    });

    ["ipe","iped"].forEach(function(p){
        var be=q("#"+p+"-btn-extract"); if(be) be.addEventListener("click", onExtract);
        var br=q("#"+p+"-btn-reroll"); if(br) br.addEventListener("click", onReroll);
        var bj=q("#"+p+"-btn-inject"); if(bj) bj.addEventListener("click", onInject);
        var bm=q("#"+p+"-btn-models"); if(bm) bm.addEventListener("click", fetchModels);
        var bt=q("#"+p+"-btn-test"); if(bt) bt.addEventListener("click", testConnection);
    });

    try {
        var c = ctx();
        if (c.eventSource && c.event_types && c.event_types.MESSAGE_RECEIVED) {
            c.eventSource.on(c.event_types.MESSAGE_RECEIVED, onMsgReceived);
            console.log("[IPE] 已绑定消息事件");
        }
    } catch(e) { console.log("[IPE] 消息事件绑定跳过"); }

    ipeRefreshTemplateEditors();
}

function buildInjectTag(desc) {
    var tpl = ipeGetTemplateValue(ipeGetActiveTemplateSlot()) || cfg().baseTemplate || "image###{Description}###";
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

    var el=document.querySelector('#chat .mes[mesid="'+idx+'"] .mes_text');
    if(el && el.innerHTML.indexOf(esc(tag)) < 0) el.innerHTML += "<p>"+esc(tag)+"</p>";

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

async function runExtract(text, supplement, autoInjectNow, targetIdx) {
    processing = true;
    var ball = q("#ipe-ball"); if(ball)ball.classList.add("processing");
    setStatus("正在提取…","#6ec577"); setBtns(false,false);
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
        var msg = e && e.name === "AbortError" ? "请求超时：自动注入已跳过，你可以稍后手动重试或换更快模型" : e.message;
        setStatus("失败: "+msg,"#d4726a");
        setBtns(true,false); if(ball)ball.classList.remove("processing");
    }
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
    try { loadSettings(); createUI(); initialized=true; console.log("[IPE] ✓ 已加载"); }
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

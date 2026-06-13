/*
 * ============================================================
 *  Image Prompt Extractor (图像提示词提取器)
 *  SillyTavern 第三方扩展
 *
 *  功能：从 RP 正文提取场景，通过独立 API 生成 image### 标签，
 *        注入正文消息供生图插件读取。主 API 不感知此过程。
 * ============================================================
 */

import { extension_settings, getContext } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChatConditional,
} from "../../../../script.js";

/* ────────────────────────────────────────────
   常量与默认设置
   ──────────────────────────────────────────── */

const EXT_NAME = "image-prompt-extractor";

const DEFAULT_SETTINGS = {
    enabled: true,
    apiEndpoint: "",
    apiKey: "",
    model: "",
    systemPrompt: "",
    baseTemplate: "",
    characterAnchors: "",
    extractionRules: "",
};

/* ────────────────────────────────────────────
   运行时状态
   ──────────────────────────────────────────── */

let currentDescription = "";
let currentMessageIndex = -1;
let isProcessing = false;

/* ────────────────────────────────────────────
   设置管理
   ──────────────────────────────────────────── */

function loadSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXT_NAME][key] === undefined) {
            extension_settings[EXT_NAME][key] = val;
        }
    }
}

function s() {
    return extension_settings[EXT_NAME];
}

function save(key, value) {
    extension_settings[EXT_NAME][key] = value;
    saveSettingsDebounced();
}

/* ────────────────────────────────────────────
   工具函数
   ──────────────────────────────────────────── */

function esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function $(sel) {
    return document.querySelector(sel);
}

/* ────────────────────────────────────────────
   UI 创建
   ──────────────────────────────────────────── */

function createUI() {
    // —— 悬浮球 ——
    const ball = document.createElement("div");
    ball.id = "ipe-ball";
    ball.className = "ipe-ball";
    ball.title = "图像提示词提取器";
    ball.addEventListener("click", togglePanel);
    document.body.appendChild(ball);

    // —— 主面板 ——
    const panel = document.createElement("div");
    panel.id = "ipe-panel";
    panel.className = "ipe-panel";
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    bindEvents();
    restoreCollapsedState();
}

function buildPanelHTML() {
    const c = s();
    return `
    <div class="ipe-panel-header">
        <span class="ipe-panel-title">图像提示词提取器</span>
        <label class="ipe-toggle">
            <input type="checkbox" id="ipe-enabled" ${c.enabled ? "checked" : ""}>
            <span class="ipe-toggle-slider"></span>
        </label>
    </div>
    <div class="ipe-sections">

        ${section("api-config", "API 配置", `
            <label>API 地址
                <input type="text" id="ipe-api-endpoint"
                       value="${esc(c.apiEndpoint)}"
                       placeholder="https://api.openai.com/v1/chat/completions">
            </label>
            <label>API 密钥
                <input type="password" id="ipe-api-key"
                       value="${esc(c.apiKey)}"
                       placeholder="sk-...">
            </label>
            <label>模型
                <input type="text" id="ipe-model"
                       value="${esc(c.model)}"
                       placeholder="gpt-4o-mini">
            </label>
        `)}

        ${section("system-prompt", "系统提示", `
            <textarea id="ipe-system-prompt" rows="5"
                placeholder="你是一个专精中文文学场景视觉化的提示词专家…"
            >${esc(c.systemPrompt)}</textarea>
        `)}

        ${section("base-template", "基础模板", `
            <textarea id="ipe-base-template" rows="6"
                placeholder="image###Premium otome game CG illustration...{Description}...###"
            >${esc(c.baseTemplate)}</textarea>
            <div class="ipe-hint">用 {Description} 标记描述文本的插入位置</div>
        `)}

        ${section("char-anchors", "角色锚点", `
            <textarea id="ipe-char-anchors" rows="5"
                placeholder="陆冀北：a man, early 30s, tall with broad shoulders, deep-set eyes…"
            >${esc(c.characterAnchors)}</textarea>
        `)}

        ${section("extract-rules", "提取规则", `
            <textarea id="ipe-extract-rules" rows="5"
                placeholder="先写场景1-2句，再按在场人数逐人描述…"
            >${esc(c.extractionRules)}</textarea>
        `)}

        ${section("preview", "预览", `
            <div id="ipe-preview-status" class="ipe-preview-status">等待新消息…</div>
            <textarea id="ipe-preview-text" rows="6"
                placeholder="生成的 Description 将显示在这里…"></textarea>
            <label>补充指令
                <input type="text" id="ipe-supplement"
                       placeholder="例：这段是冷战不是撒娇">
            </label>
            <div class="ipe-preview-actions">
                <button id="ipe-btn-extract" class="ipe-btn">手动提取</button>
                <button id="ipe-btn-reroll" class="ipe-btn" disabled>重新生成</button>
                <button id="ipe-btn-inject" class="ipe-btn ipe-btn-primary" disabled>确认注入</button>
            </div>
        `, false)}

    </div>`;
}

function section(id, title, body, collapsed = true) {
    return `
    <div class="ipe-section ${collapsed ? "collapsed" : ""}" id="ipe-section-${id}">
        <div class="ipe-section-header" data-section="${id}">
            <span>${title}</span>
            <span class="ipe-collapse-icon">▾</span>
        </div>
        <div class="ipe-section-body">${body}</div>
    </div>`;
}

/* ────────────────────────────────────────────
   UI 交互
   ──────────────────────────────────────────── */

function togglePanel() {
    const panel = $("#ipe-panel");
    panel.classList.toggle("visible");
}

function restoreCollapsedState() {
    // 预览区默认展开，其余默认折叠（已在 HTML 中设置）
}

function setStatus(text, type = "") {
    const el = $("#ipe-preview-status");
    if (!el) return;
    el.textContent = text;
    el.className = "ipe-preview-status" + (type ? ` ${type}` : "");
}

function setBallState(state) {
    const ball = $("#ipe-ball");
    if (!ball) return;
    ball.classList.remove("processing", "has-result");
    if (state) ball.classList.add(state);
}

function setButtonsEnabled(reroll, inject) {
    const br = $("#ipe-btn-reroll");
    const bi = $("#ipe-btn-inject");
    if (br) br.disabled = !reroll;
    if (bi) bi.disabled = !inject;
}

/* ────────────────────────────────────────────
   事件绑定
   ──────────────────────────────────────────── */

function bindEvents() {
    // 折叠区块切换
    document.querySelectorAll(".ipe-section-header").forEach((header) => {
        header.addEventListener("click", () => {
            header.parentElement.classList.toggle("collapsed");
        });
    });

    // 开关
    $("#ipe-enabled")?.addEventListener("change", (e) => {
        save("enabled", e.target.checked);
    });

    // 设置项自动保存
    const bindings = [
        ["ipe-api-endpoint", "apiEndpoint"],
        ["ipe-api-key", "apiKey"],
        ["ipe-model", "model"],
        ["ipe-system-prompt", "systemPrompt"],
        ["ipe-base-template", "baseTemplate"],
        ["ipe-char-anchors", "characterAnchors"],
        ["ipe-extract-rules", "extractionRules"],
    ];
    for (const [elId, key] of bindings) {
        const el = $(`#${elId}`);
        if (el) {
            el.addEventListener("input", () => save(key, el.value));
        }
    }

    // 按钮
    $("#ipe-btn-extract")?.addEventListener("click", onManualExtract);
    $("#ipe-btn-reroll")?.addEventListener("click", onReroll);
    $("#ipe-btn-inject")?.addEventListener("click", onConfirmInject);

    // 监听 ST 新消息事件
    if (typeof eventSource !== "undefined" && event_types?.MESSAGE_RECEIVED) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    }
}

/* ────────────────────────────────────────────
   API 调用
   ──────────────────────────────────────────── */

async function callExtractionAPI(rpText, supplement = "") {
    const c = s();

    if (!c.apiEndpoint || !c.model) {
        throw new Error("请先配置 API 地址和模型");
    }

    // 组装 user 消息：角色锚点 + 提取规则 + 正文 + 补充指令
    let userContent = "";

    if (c.characterAnchors) {
        userContent += `【角色外貌锚点】\n${c.characterAnchors}\n\n`;
    }
    if (c.extractionRules) {
        userContent += `【提取规则】\n${c.extractionRules}\n\n`;
    }

    userContent += `【正文内容】\n${rpText}`;

    if (supplement) {
        userContent += `\n\n【补充指令】\n${supplement}`;
    }

    userContent += `\n\n请根据以上正文内容，按照提取规则，输出一段英文 Description。只输出 Description 本身，不要附加任何解释或格式标记。`;

    // 构建请求（OpenAI 兼容格式）
    const headers = {
        "Content-Type": "application/json",
    };
    if (c.apiKey) {
        headers["Authorization"] = `Bearer ${c.apiKey}`;
    }

    const body = {
        model: c.model,
        messages: [
            { role: "system", content: c.systemPrompt || "You are an expert at extracting visual scene descriptions from Chinese literary roleplay text and writing them as English image generation prompts." },
            { role: "user", content: userContent },
        ],
        max_tokens: 600,
        temperature: 0.7,
    };

    const response = await fetch(c.apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`API 返回 ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();

    // 兼容 OpenAI 和 Anthropic 响应格式
    let result = "";
    if (data.choices?.[0]?.message?.content) {
        // OpenAI 格式
        result = data.choices[0].message.content.trim();
    } else if (data.content?.[0]?.text) {
        // Anthropic 格式
        result = data.content[0].text.trim();
    } else {
        throw new Error("无法解析 API 响应");
    }

    return result;
}

function assembleTag(description) {
    const template = s().baseTemplate || "image###{Description}###";

    if (template.includes("{Description}")) {
        return template.replace("{Description}", description);
    }

    // 如果模板里没有占位符，追加到末尾（兜底）
    return template + description;
}

/* ────────────────────────────────────────────
   消息处理
   ──────────────────────────────────────────── */

async function onMessageReceived(messageIndex) {
    if (!s().enabled || isProcessing) return;

    const context = getContext();
    const msg = context.chat?.[messageIndex];

    // 只处理 AI 回复（非用户消息）
    if (!msg || msg.is_user) return;

    currentMessageIndex = messageIndex;
    await runExtraction(msg.mes);
}

async function onManualExtract() {
    if (isProcessing) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    // 找最后一条 AI 消息
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) {
            currentMessageIndex = i;
            await runExtraction(chat[i].mes);
            return;
        }
    }

    setStatus("未找到 AI 消息", "error");
}

async function runExtraction(rpText, supplement = "") {
    isProcessing = true;
    setBallState("processing");
    setStatus("正在提取…", "active");
    setButtonsEnabled(false, false);

    try {
        const description = await callExtractionAPI(rpText, supplement);

        currentDescription = description;

        // 显示在预览区
        const previewEl = $("#ipe-preview-text");
        if (previewEl) {
            previewEl.value = description;
            previewEl.disabled = false;
        }

        setStatus("提取完成 — 可编辑后确认注入", "active");
        setButtonsEnabled(true, true);
        setBallState("has-result");

        // 展开预览区
        const previewSection = $("#ipe-section-preview");
        if (previewSection) previewSection.classList.remove("collapsed");
    } catch (err) {
        console.error("[IPE] 提取失败:", err);
        setStatus(`提取失败: ${err.message}`, "error");
        setButtonsEnabled(false, false);
        setBallState("");
    }

    isProcessing = false;
}

async function onReroll() {
    if (isProcessing || currentMessageIndex < 0) return;

    const context = getContext();
    const msg = context.chat?.[currentMessageIndex];
    if (!msg) return;

    const supplement = $("#ipe-supplement")?.value || "";
    await runExtraction(msg.mes, supplement);
}

async function onConfirmInject() {
    if (currentMessageIndex < 0) return;

    // 取预览区的内容（用户可能已手动编辑）
    const previewEl = $("#ipe-preview-text");
    const description = previewEl?.value || currentDescription;

    if (!description) {
        setStatus("没有可注入的内容", "error");
        return;
    }

    const tag = assembleTag(description);

    try {
        injectTag(currentMessageIndex, tag);
        setStatus("已注入 ✓", "active");
        setButtonsEnabled(false, false);
        setBallState("");

        // 清空补充指令
        const supEl = $("#ipe-supplement");
        if (supEl) supEl.value = "";
    } catch (err) {
        console.error("[IPE] 注入失败:", err);
        setStatus(`注入失败: ${err.message}`, "error");
    }
}

/* ────────────────────────────────────────────
   标签注入
   ──────────────────────────────────────────── */

function injectTag(messageIndex, tag) {
    const context = getContext();
    const msg = context.chat?.[messageIndex];

    if (!msg) {
        throw new Error("消息不存在");
    }

    // 追加标签到消息末尾（换行分隔）
    msg.mes = msg.mes.trimEnd() + "\n\n" + tag;

    // 保存聊天记录
    if (typeof saveChatConditional === "function") {
        saveChatConditional();
    }

    // 更新 DOM 显示
    // 注意：不同 ST 版本的 DOM 结构可能不同，
    // 如果下面的选择器不生效，请根据你的 ST 版本调整
    const mesEl = document.querySelector(
        `#chat .mes[mesid="${messageIndex}"] .mes_text`
    );
    if (mesEl) {
        // 追加标签文本到 DOM（触发生图插件重新扫描）
        mesEl.innerHTML = mesEl.innerHTML + `<p>${esc(tag)}</p>`;
    }

    // 尝试触发 ST 的消息更新事件，让生图插件重新扫描
    if (typeof eventSource !== "undefined" && event_types?.MESSAGE_UPDATED) {
        eventSource.emit(event_types.MESSAGE_UPDATED, messageIndex);
    }

    console.log(`[IPE] 标签已注入到消息 #${messageIndex}`);
}

/* ────────────────────────────────────────────
   初始化
   ──────────────────────────────────────────── */

jQuery(async () => {
    loadSettings();
    createUI();
    console.log("[IPE] 图像提示词提取器已加载");
});

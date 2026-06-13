# Image Prompt Extractor（图像提示词提取器）

SillyTavern 第三方扩展。从 RP 正文自动提取场景描述，通过独立 API 生成 `image###` 标签，注入正文供生图插件读取。主 API 不感知此过程。

## 安装

在 SillyTavern 中打开扩展面板 → 点击「Install extension」→ 粘贴本仓库地址：

```
https://github.com/你的用户名/image-prompt-extractor
```

或手动克隆到 `public/scripts/extensions/third-party/` 目录。

## 功能

- 🔵 白色半透明悬浮球，点击展开设置面板
- 📝 六个配置区：API 配置 / 系统提示 / 基础模板 / 角色锚点 / 提取规则 / 预览确认
- 🔄 新消息到达时自动提取，预览后确认注入
- ✏️ 可编辑生成结果、添加补充指令、一键重 roll
- 📱 支持 iOS / 移动端访问

## 使用方法

1. 点击右下角悬浮球打开面板
1. 在「API 配置」填入你的第二 API 地址、密钥和模型名
1. 在「系统提示」写给提取模型的角色设定
1. 在「基础模板」粘贴完整的 `image###...{Description}...###` 模板，用 `{Description}` 标记插入位置
1. 在「角色锚点」填入当前卡片角色的外貌描述
1. 在「提取规则」填入 Description 的撰写规范
1. 开始对话，新 AI 消息到达后自动提取并显示在预览区
1. 确认或编辑后点击「确认注入」

## 注意

- API 调用使用 OpenAI 兼容格式，同时兼容 Anthropic 响应格式
- 需配合正则过滤（如酒馆的 Regex 扩展）防止标签进入主 API 上下文
- 生图插件需能识别 `image###...###` 格式标签

## 许可

MIT
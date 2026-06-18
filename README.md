# Image Prompt Extractor

SillyTavern 生图辅助插件。它会从 RP 正文中提取场景描述，调用独立 API 生成英文生图提示词，并可注入回正文。

## 功能

- 读取聊天正文并提取生图提示词
- 支持独立 API Endpoint、API Key、模型名
- 支持基础模板、角色锚点、提取规则、双 System Prompt 预设
- 支持悬浮入口与移动端显示
- 支持请求超时与手动打断
- 支持自动注入

## 版本

当前版本：`1.8.5.2`

本版修复：

- 修复 `ipeDoc()` 未定义导致 iframe 顶层挂载逻辑失效的问题
- 修复打断按钮未绑定导致 API 请求无法手动中止的问题
- 修复请求超时包装层覆盖手动 abort signal 的问题
- 将 `innerHTML +=` 调整为 `insertAdjacentHTML`，避免未来 DOM 事件被重建冲掉

## 文件结构

```text
index.js
manifest.json
style.css
README.md
```

## 安装

把本仓库作为 SillyTavern 扩展安装，或将文件放入对应扩展目录后重启/刷新 SillyTavern。

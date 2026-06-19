# Image Prompt Extractor

SillyTavern 生图辅助插件。它会从 RP 正文中提取场景描述，调用独立 API 生成英文生图提示词，并可注入回正文。

## 功能

- 读取聊天正文并提取生图提示词
- 支持独立 API Endpoint、API Key、模型名
- 支持保存多个 API 预设，一键切换地址、key 和模型
- API 提取失败时弹窗提醒，并在 10 秒后自动重试一次
- 支持基础模板、角色锚点、提取规则、双 System Prompt 预设
- 支持悬浮入口与移动端显示
- 支持请求超时与手动打断
- 支持自动注入

## 版本

当前版本：`1.8.6`

本版更新：

- 新增 API 多预设：可保存多个 API 地址、key 与模型，例如 DeepSeek / Flash 3.5 来回切换
- 新增 API 失败弹窗：提取请求失败时立即提醒用户
- 新增一次性自动重试：API 提取失败后 10 秒自动二次触发；手动打断不会触发重试
- 保留 v1.8.5.2 的打断键、abort signal、iframe 顶层挂载和 DOM 注入稳固修复

## 文件结构

```text
index.js
manifest.json
style.css
README.md
```

## 安装

把本仓库作为 SillyTavern 扩展安装，或将文件放入对应扩展目录后重启/刷新 SillyTavern。

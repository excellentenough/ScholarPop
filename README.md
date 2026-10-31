# ScholarPop for Zotero

在 Zotero 的 PDF 阅读器里划词，点一下图标，AI 结合论文上下文解释；公式、图表用矩形框选截图识别。支持追问对话、多服务商（Kimi / DeepSeek / OpenAI / 自定义 OpenAI 兼容 API）。

适用：**Zotero 7–10**（已在 Zotero 10.0.7 实测通过；Zotero 7–9 可安装，但尚未完整测试）

## 下载与安装

1. 到 [Releases](../../releases/latest) 下载 **`scholarpop-0.2.3.xpi`**（不要下载 Source code 源码压缩包）
2. Zotero → **工具 → 插件 → 右上角齿轮 → Install Plugin From File…** → 选择 xpi
3. **重启 Zotero**
4. 菜单 **工具 → ScholarPop设置**：选择服务商，粘贴对应平台的 API Key，保存

> API Key 需自行在服务商平台申请（如 Kimi 在 [platform.moonshot.cn](https://platform.moonshot.cn)）。Key 只保存在你本机 Zotero 配置中，插件仅向你设置的服务商接口发请求。

## 功能

| 功能 | 用法 |
|---|---|
| 划词解释 | 划选文字 → 点选区上方的 **AI** 图标 |
| 截图识别（公式/图表/符号） | 点 **📷** → 拖出矩形框选区域 → 松开后视觉模型结合上下文解释，Esc 取消 |
| 追问对话 | 弹窗底部输入框，Enter 发送，Shift+Enter 换行，保留最近 20 条记录 |
| 清晰显示回答 | 自动清理多余的 Markdown 符号，将常见 LaTeX 公式符号、上下标和分式转为易读文本 |
| 窗口操作 | 标题栏拖动位置；◢ / ◣ 双角落调整大小；"—" 收起、"＋" 展开；✕ 关闭 |
| 多服务商 | Moonshot（Kimi）/ DeepSeek / OpenAI / 自定义，模型名可改 |
| 可调设置 | 联网搜索、深度思考、上下文字符数（前后独立）、截图按钮开关、视觉模型 |

**推荐组合**
- 快速查词：联网关 + 思考关 + 上下文 1000/1500
- 深入理解：联网开 + 思考开 + 上下文 3000/4000

## 文档

完整使用说明、常见问题、以及**给 AI 的自动安装指南**见 [使用说明书.md](./使用说明书.md)（人看在前，AI 看在后）。

## 技术要点

- Bootstrap 插件，无外部依赖，监听 PDF 阅读器内嵌 iframe 的划词事件
- 上下文来自 Zotero 全文索引（`Zotero.FullText.getItemContent`），按划词位置智能节选
- 截图从 PDF.js 页面 canvas 按框选矩形裁剪，走 OpenAI 多模态消息格式
- 联网搜索使用 Moonshot 内置 `$web_search`（其他服务商自动忽略）

## License

[MIT](./LICENSE)

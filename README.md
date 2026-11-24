# DSH 底栏终端

独立插件 `@local/dsh-bottom-terminal`。在 DSH 窗口底部点击「终端」打开。拖动面板上沿可调整高度，使用工具栏添加标签、向右或向下分屏，拖动分隔线可调整比例。

## 安装

1. 在 DSH 打开「插件 → 添加插件」，填入 `local-dsh-bottom-terminal-1.1.0.tgz` 的本机绝对路径。
2. 按界面提示安装并启用，重启后底部会出现「终端」按钮。安装包已包含运行时依赖，可以离线安装。

已配置 GitHub SSH 访问时，也可以在「添加插件」中输入 `git+ssh://git@github.com/lesliejackson/dsh-bottom-terminal.git#v1.1.0` 安装。

## 设置与快捷键

在底栏的齿轮菜单里可选择 Graphite、Dracula、Solarized Dark、Paper，填写字体或字体回退列表，以及调整 9–32 px 字号。设置保存在当前 DSH 客户端，可选择自动渲染或 DOM 模式。Shell 菜单用于新建终端，支持系统默认、PowerShell、CMD、WSL、Bash、Zsh 和 Fish，具体可执行文件由 DSH 宿主环境解析。

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 展开或收起底栏 | Ctrl + Shift + &#96; | ⌘ + ⇧ + &#96; |
| 新建终端标签 | Ctrl + Shift + 反斜杠 | ⌘ + ⇧ + 反斜杠 |
| 全屏 / 恢复高度 | Ctrl + Shift + 单引号 | ⌘ + ⇧ + 单引号 |
| 上一个 / 下一个标签 | Ctrl + Shift + [ / ] | ⌘ + ⇧ + [ / ] |
| 上一个 / 下一个分屏 | Ctrl + Shift + , / . | ⌘ + ⇧ + , / . |

快捷键可在 DSH 的「设置 → 通用 → 快捷键 → 编辑快捷键」中调整。Linux 网页端的展开、全屏、新建和切换标签保留表中的内置组合，通过设置可以添加该平台支持的其他组合。

全屏会让底栏占满 DSH 工作区。再按一次快捷键或点击工具栏的恢复按钮，即可回到原高度。

双击终端标签、聚焦标签后按 `F2`，或点击工具栏的重命名按钮，可以修改标签名称。`Enter` 保存，`Esc` 取消，保存空名称会恢复默认编号。名称跟随当前标签，打开分屏或切换标签时会保留。

## 会话与性能

- 新终端从当前 DSH 会话的工作目录与执行环境启动。没有活动会话时使用宿主默认工作目录。每个分屏有独立的 PTY。
- 同一窗口切换 DSH 会话、终端标签或折叠底栏时，进程与滚动记录保持。一个宿主最多打开 8 个底栏 PTY。关闭标签或分屏、刷新页面、退出窗口时，对应的 PTY 会终止。
- 宿主通过经过 DSH 浏览器所有者认证的 WebSocket 传输原始 PTY 字节。客户端直接交给 xterm 解析，按确认进度做背压。WebGL 可用时使用 GPU 渲染，遇到不支持或上下文丢失时回落到 DOM。
- 底栏使用 DSH 的 `shell.bottom` 插槽。该槽一次容纳一个插件。

## 开发

```sh
npm install
npm run build
npm test
npm pack
```

版本标签中已包含运行文件。克隆后执行 `npm pack` 即可生成离线安装包。

运行时面向 DSH 0.2.2-rc 系列，已在 Windows 桌面端 0.2.2-rc.5 和 Linux Web 宿主 0.2.2-rc.1 验证。第三方组件授权见 `lib/THIRD-PARTY-LICENSES.txt`。

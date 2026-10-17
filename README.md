# Crisp File Explorer

Crisp File Explorer adds an animated rail, a draggable spring orb, and an optional lightweight dual-pane browser to Obsidian's native file explorer. It keeps Obsidian's own file tree and adds motion on top of it.

Crisp File Explorer 给 Obsidian 原生文件树加一条动效轨道和一个可以拖动的弹簧小球，另有可选的轻量双栏浏览。文件树本身仍是 Obsidian 原生的，插件只在旁边加轨道和交互。

当前版本 `0.5.2`，更新记录见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

### 轨道与小球

- 文件树左侧一条竖向轨道，每个可见条目对应一个刻度，当前文件所在的刻度会亮起。
- 小球可以沿轨道拖动，经过的刻度按高斯波浪展开；松开时打开最近的文件，或展开 / 收起最近的文件夹。
- 拖动时在文件夹上停留会自动展开；拖到侧栏边缘会自动滚动。
- 智能磁吸点：固定文件优先，其余按近期使用和打开频率给出轻微的磁吸。
- 今日轨迹：在轨道上用淡点标出今天打开过的文件。
- 小球造型 40 多种，也可以选「每日随机」。

### 文件排序

- 把文件或文件夹拖到两行之间放下，即可调整顺序；也能跨文件夹拖到指定位置。拖到文件夹中间仍是 Obsidian 原生的移入文件夹。
- 右键「在文件列表置顶」，条目固定在所在文件夹最前；右键「恢复文件夹默认顺序」清除该文件夹的自定义顺序。
- 改名、移动、删除后顺序自动跟随；没排过的新条目可设为放在最前或最后。
- 用过 Flexplorer 的话，停用它后会自动导入一次它的顺序和置顶，也可以在设置里手动导入。Flexplorer 启用期间本插件不接管排序。
- 顺序存在插件的 `data.json` 里，仅桌面端生效。

### 音效

- 拖动经过刻度时播放短促的滴答声，可关闭。
- 8 种音色（轻型切音、八音盒音阶、木鱼、机械青轴、水滴、8-Bit、发条、气泡），或选「跟随小球造型」。
- 音高滑动：沿文件树向下拖，音高随之升高。
- 落定音效：小球停在某个条目上时播放确认音。

### 轻量双栏浏览

- 左栏浏览文件夹，右栏显示当前目录。用文件浏览器顶栏按钮或命令切换。
- 左右 / 上下 / 自动三种布局，侧栏较窄时自动改成上下排列。
- 准星定位当前文件，可选自动跟随当前文件。
- 键盘操作：方向键移动、`Tab` 跨栏、`Enter` 打开、`⌘/Ctrl + Enter` 在新标签页打开、`F2` 重命名、`⌘ + Backspace` / `Delete` 调用 Obsidian 原生的删除确认。
- 右键菜单、在当前目录新建、单文件跨栏拖动（同名冲突会拦下）。
- 子文件夹平铺汇总模式，包含 `.canvas` 白板文件。

## 命令

| 命令 | 作用 |
| --- | --- |
| 切换轻量双栏浏览 | 打开或关闭双栏 |
| 切换文件夹刻度 | 轨道上是否显示文件夹行 |
| 切换拖动音效 | 打开或关闭滴答声 |

## 安装

### BRAT（推荐）

1. 在 Obsidian 社区插件中安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 运行 **BRAT: Add a beta plugin for testing**，输入 `letschips/crisp-file-explorer`。
3. 在「第三方插件」中启用 **Crisp File Explorer**。

### 手动安装

1. 从 [Releases](https://github.com/letschips/crisp-file-explorer/releases) 下载 `main.js`、`manifest.json`、`styles.css`。
2. 放进 `<你的库>/.obsidian/plugins/crisp-file-explorer/`。
3. 重启 Obsidian，在「第三方插件」中启用。

## 激活

插件需要激活后才能使用。未激活时不挂载轨道、小球和双栏，设置页只显示授权区，命令会提示先激活。

在 **设置 → Crisp File Explorer** 粘贴 Crisp Suite 授权码即可，粘贴有效授权码后立即生效。

## 授权校验与隐私

- 授权码先在本地做 Ed25519 签名校验。
- 激活和重新验证时，插件会向 `https://license.letschips.xyz/api/verify-device` 发送授权码、设备标识和插件 ID，用来核对设备数量。结果在当前会话缓存 15 分钟。
- 网络不可用或服务暂时不可达时，按本地签名结果继续使用；只有服务端明确拒绝时才停用。
- 除授权校验外不发起网络请求，不收集笔记内容，没有统计或遥测。
- 设置和授权码只存在当前库的插件 `data.json`。`data.json` 损坏读不出来时，会先备份为 `data.json.unreadable-<时间>` 再用默认设置；保存后会读回核对，没写进磁盘会提示。

## 兼容性

- 最低 Obsidian `1.6.0`，仅桌面端。
- 主要在 macOS 上测试，包括半透明窗口。Windows 上没有 macOS 那样的系统级透明效果。

## License

Crisp Proprietary License © 2026 letschips. See [LICENSE](LICENSE).

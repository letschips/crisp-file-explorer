# Changelog

## [0.2.63] - 2026-09-02 (Cold Open Smooth Transition & Fast Startup)

### Fixed
- 初次打开新 Markdown 文档时，小球采用独立的 GPU 硬件平滑滑动（220ms），消除 CodeMirror 6 编辑器冷构建与排版造成的动画掉帧和跳字感。
- 修复 Obsidian 冷启动时侧边栏尺寸初始化死锁导致的 3 秒挂载延迟，现在随侧边栏同步毫秒级呈现小球与刻度线。
- 在已有标签页之间切换和手动拖拽小球时，继续保持原有极致丝滑的物理弹簧与惯性手感。

## [0.2.62] - 2026-09-02 (Drag Sound Style Preservation)

### Fixed
- 开启“音高滑动”后，拖动音效继续保留所选音色，不再将所有风格替换成同一种八音盒音阶。
- 所选拖动音色仍会随文件树位置升高音高，落定确认音效保持原有行为。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（82/82）。
- ANKS 实际重载后确认不同拖动音色保持不同波形，音高滑动继续生效且无新增运行错误。

## [0.2.61] - 2026-08-31 (Empty-State Folder Label Offset)

### Fixed
- 没有文件打开时，orb 所在文件夹标题会继续为横线留出空间，避免横线与文件夹名称重叠。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（81/81）。
- 未修改横线宽度、小球动画、弹簧、拖动、磁吸或音效参数。

## [0.2.60] - 2026-08-30 (Sidebar Resize Stability)

### Fixed
- 调整左侧文件栏宽度时，活动标题不再反复清除并恢复横向位移，避免选中标题持续闪动。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（80/80）。
- 在真实 Obsidian 中连续重新测量文件树，活动标题位移保持稳定。

## [0.2.59] - 2026-08-24 (Drag Release State Polish)

### Fixed
- 关闭“松开打开项目”后，拖动结束会回到当前活动文件，不再将 orb 和高亮停留在未打开的项目上。
- 文件浏览器在主窗口与独立窗口间迁移时，拖动监听器会从原绑定窗口正确清理。

## [0.2.58] - 2026-08-13 (Folder Target Label Offset)

### Fixed
- 当 orb 定位到文件夹时，文件夹标题复用活动文件的横向位移，避免刻度线与文件名重叠。
- 覆盖两类路径：当前文件不可见时回退到可见父文件夹，以及拖动后停留在文件夹但未打开该文件夹。

### Verification
- 已通过回归测试。
- 未修改文件夹刻度长度、弹簧、拖动、磁吸或音效参数。

## [0.2.57] - 2026-08-12 (Smart Magnet Stations)

### Added
- 文件右键菜单新增“固定到 Crisp Rail / 从 Crisp Rail 取消固定”，最多固定 8 个文件。
- 固定文件使用 5px 高实度圆点，继续复用现有轨道、刻度和拖动磁吸逻辑。

### Changed
- 高频磁吸升级为近期加权排序：14 天半衰期，近期使用占主要权重，超过 90 天未打开的非固定文件退出候选。
- 固定点优先占位，智能推荐补齐剩余位置，总有效磁吸点限制为 8 个。
- 文件或文件夹重命名、移动、删除时同步迁移或清理固定路径。

### Fixed
- 关闭“智能磁吸点”后，已固定文件的右键菜单仍能正确显示并执行“取消固定”。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（75/75）。
- 未修改小球弹簧、拖动采样、磁吸半径、磁吸强度和音效参数。

## [0.2.56] - 2026-08-12 (Settings & Documentation Maintenance)

### Fixed
- 设置页分组标题、描述和两条命令名称完成汉化。
- 授权说明修正为“本地签名验证与在线设备校验”，不再误写为纯离线校验。
- 维护文档明确 `assets/` 是内联素材的源文件，运行与分享包均不依赖该目录。

## [0.2.55] - 2026-08-09 (Suite Compatibility & Maintenance Guard)

### Fixed
- Crisp 系列授权产品名单补齐 Crisp Organize 与 Crisp Base，保持跨插件授权兼容。
- 修复测试清单与运行时版本不一致的问题。

## [0.2.54] - 2026-08-08 (Chinese Settings UI)

### Changed
- 设置页全面汉化：分组标题、设置项与描述改为中文；小球素材名称保持英文。

## [0.2.53] - 2026-08-08 (Fix Inline SVG Class Stripping)

### Fixed
- 修复内联 SVG 时误删子元素 class 导致 character4 / Captain America Shield / Mercedes 等素材变纯黑的问题：现在只规范化根 `<svg>` 标签，保留元素级 class 与 `<style>` 填充定义。

## [0.2.52] - 2026-08-08 (Inline Orb Assets)

### Changed
- 全部 orb 素材改为内联（26 个 SVG 直接嵌入 + character1-3 以 base64 data URL 内嵌），BRAT / 社区市场安装不再依赖 `assets/` 文件夹，付费小球在任意安装方式下都能正常显示。

## [0.2.51] - 2026-08-07 (Multi-Window Audio & Drag Safety)

### Fixed
- CrispAudio 改为按 owner window 创建独立 AudioContext（WeakMap 缓存，单独维护待关闭 context 列表），修复 popout 独立窗口拖动 orb 时音效可能不播放的问题（主窗口 AudioContext 在后台被 Electron 挂起时）；关闭的 popout 窗口不再被强引用保留。
- 拖动事件处理器（handlePointerMove / handlePointerUp）增加 `destroyed` 守卫，防止控制器销毁后事件队列中残留的 pointer 事件触发异常访问。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（66/66，新增 2 项：多窗口 AudioContext 隔离、destroyed 控制器忽略拖动事件）

## [0.2.50] - 2026-08-05 (Click Spring Tuning)

### Changed
- 点击切换文件时的小球弹簧改为临界阻尼（stiffness 700 / damping 53）：消除过冲回弹，快速单调到位；拖拽路径与拖动行为不变。

### Verification
- JavaScript 语法检查与完整自动回归测试通过（64/64）

## [0.2.49] - 2026-08-04 (License Verification Hardening)

### Changed
- 授权在线校验修复：服务端吊销或设备数超限的拒绝现在会被客户端采信（仅网络异常时降级为离线验签）。

### Verification
- JavaScript 语法检查与完整自动回归测试通过

## [0.2.48] - 2026-08-04 (Expanded Character Library)

### Added
- 新增 Character 4、Character 5 两种静态人物 Orb（SVG 素材）

### Verification
- JavaScript 语法检查与完整自动回归测试通过

## [0.2.47] - 2026-08-04 (Character Orb Size Tuning)

### Changed
- Spider-Man 保持 24px；其余静态人物 Orb（Character 1-3、Snorlax、Pikachu、Snorlax Face、Batman、Superman）缩小至 20px，避免左侧超出窗口被遮挡

### Verification
- JavaScript 语法检查与完整自动回归测试通过
- 在真实 Obsidian 中逐样式测量 orb 尺寸与窗口左缘位置

## [0.2.46] - 2026-08-04 (Character Orb Alignment)

### Changed
- 静态人物 Orb（Character 1-3、Snorlax、Pikachu、Snorlax Face、Batman、Superman、Spider-Man）放大至 24px，并左移居中到轨道竖线

### Verification
- JavaScript 语法检查与完整自动回归测试通过
- 在真实 Obsidian 中测量 orb 中心与竖线中心一致

## [0.2.45] - 2026-08-04 (Orb Asset Polish)

### Changed
- Batman、Superman、Spider-Man 三个 Orb 素材去除白色背景与白色高光，仅保留图案主体，透明背景直接贴合轨道

### Verification
- JavaScript 语法检查与完整自动回归测试通过

## [0.2.44] - 2026-08-04 (Expanded Orb Library)

### Added
- 新增 Angry、Squint、Face Mask、Poker Face、Captain America Shield 五种可旋转表情/盾牌 Orb
- 新增 Batman、Superman、Spider-Man 三种静态人物 Orb，沿用 Pikachu 的直立静态与悬停呼吸逻辑

### Verification
- JavaScript 语法检查与完整自动回归测试通过

## [0.2.43] - 2026-07-31 (License Verification Update)

### Changed
- 授权校验机制更新：此版本仅接受新版授权码，旧版授权码需联系重新签发。

### Verification
- JavaScript 语法检查与完整自动回归测试通过。

## [0.2.42] - 2026-07-31 (Online License Check Fix)

### Changed
- 在线设备校验改用 Obsidian requestUrl（与 ASR/Annotations 一致），修复 Electron/CSP 环境下 fetch 校验失败静默降级的问题。

### Verification
- JavaScript 语法检查与完整自动回归测试通过。

## [0.2.41] - 2026-07-31 (License Check Upgrade)

### Changed
- 授权校验升级：启用双公钥过渡机制，存量授权码不受影响。

### Verification
- JavaScript 语法检查与完整自动回归测试通过。

## [0.2.40] - 2026-07-29 (About & Attribution)

### Added
- 设置页底部新增 `About Crisp File Explorer`，说明插件最核心的文件导航价值。
- 作者统一标注为“小红书 letschips”，并链接到作者主页。

### Verification
- JavaScript 语法检查与 64 项自动回归测试通过。

## [0.2.39] - 2026-07-28 (Reduced Motion Completeness)

### Fixed
- 系统启用“减少动态效果”时，设置页折叠卡片现在会同时关闭内容、箭头和容器过渡，不再只停用文件轨道动画。

### Verification
- JavaScript 语法检查与 63 项自动回归测试通过。

## [0.2.38] - 2026-07-28 (Activity Rail Stability)

### Fixed
- 点击切换文档并刷新 Activity / Heatmap 状态时，保留当前刻度的动态 class 与 GPU transform，不再先清空横线再于下一帧恢复
- 仅在文件树层级或刻度结构真正变化时重置动态刻度，折叠、展开后仍能正确清理旧状态
- 文件树结构变化后的首帧改为同一刷新任务内立即绘制，重建期间也不会短暂露出空白轨道
- Activity / Heatmap 更新改为增量切换插件自有 class，避免整段覆盖 `className` 引发重复样式计算

### Verification
- JavaScript 语法检查与 62 项自动回归测试通过
- 在真实 Obsidian 文件切换链路中验证刷新前后均保留活动横线与最近刻度

## [0.2.37] - 2026-07-28 (No Vertical Active Marker)

### Changed
- 删除活动文件与活动文件夹左侧的主题色竖线，避免它与横向轨道组成十字
- 保留主题色横线、端点圆点、标题背景和 v0.2.36 的主题兼容层

### Verification
- JavaScript 语法检查与 60 项自动回归测试通过
- 在 Baseline（ALL）与 Border（YS）中验证文件和文件夹均不再生成活动竖线

## [0.2.36] - 2026-07-28 (Theme Compatibility)

### Fixed
- 活动文件的背景、强调线、圆点和过渡改由插件作用域统一控制，不再被 Baseline、Border 等主题的活动项样式覆盖
- 清除主题仅在活动标题上增加的 padding、背景和伪元素，避免切换文件时行高变化后触发重新测量
- 拖动中和系统“减少动态效果”状态下，活动反馈与标题位移动画使用确定的插件过渡，不受主题通用 transition 影响

### Compatibility
- 轨道、活动标记和反馈颜色继续读取 Obsidian 运行时 `--interactive-accent`，自动跟随当前主题实际生效的强调色
- 字体、文件图标、基础行高和文件树间距仍由主题控制，避免插件破坏主题本身的排版

### Verification
- JavaScript 语法检查与 60 项自动回归测试通过
- 在 Baseline（ALL）和 Border（YS）中验证活动行不再改变高度，插件运动参数未修改

## [0.2.35] - 2026-07-28 (Path & Pop-out Hardening)

### Fixed
- 文件或文件夹重命名时同步迁移今日轨迹与常用文件统计；删除后清除对应路径，不再积累失效磁吸记录
- 多个旧路径合并到同一新路径时合并打开次数并保留最新时间，今日轨迹保持去重后的最近顺序
- 独立窗口中释放拖动时，使用目标文件树所在窗口创建 `mousedown`、`mouseup` 与 `click` 事件

### Verification
- JavaScript 语法检查与 58 项自动回归测试通过
- 未修改弹簧参数、orb 视觉、拖动手感或音效映射

## [0.2.34] - 2026-07-27 (Multi-Window Maintenance)

### Fixed
- 文件浏览器控制器改用所在窗口的 `ownerDocument` 与 `defaultView` 创建节点、调度动画、监听拖动和判断挂载状态
- 从所有文件浏览器 leaves 发现主窗口与独立窗口中的容器，并为各自文档添加插件样式作用域
- 插件卸载或独立窗口关闭时，正确清理对应控制器、动画帧、计时器和事件监听

### Maintenance
- 删除已由独立资源替代的 Soccer、Basketball、Tennis 内联 SVG
- 删除 Bear、Cow、Elk、Lion 等未引用旧素材及系统元数据文件
- 更新优化说明和测试清单，移除已经取消的键盘导航说明

### Verification
- JavaScript 语法检查与 56 项自动回归测试通过
- 未修改视觉样式、弹簧参数、拖动手感或音效映射

## [0.2.33] - 2026-07-22 (Shut Up Rotation)

### Changed
- Shut Up 改用与 Devil 相同的固定中心旋转逻辑，不再使用静态人物定位和悬停呼吸

### Verification
- 自动回归测试与 JavaScript 语法检查通过

## [0.2.32] - 2026-07-22 (Expanded Orb Library)

### Added
- 新增 Shut Up、Snorlax、Pikachu、Poke Ball、Bracelet、Snorlax Face 六种内置 SVG
- Poke Ball 与 Bracelet 使用固定中心旋转；人物与表情类保持正向静态

### Changed
- Soccer、Basketball、Tennis 替换为新的独立 SVG 资源
- 三种球类移除旧白色外圈、背景和阴影，仅显示 SVG 本体

### Verification
- 自动回归测试、JavaScript 语法检查及全部 SVG XML 校验通过

## [0.2.31] - 2026-07-15 (Interaction Edge Cases)

### Fixed
- 文件侧边栏隐藏时清除尚未执行的定位请求，避免切回文件列表后被旧请求意外滚动
- 活动文件定位成功后同时取消剩余计时器和动画帧，避免后台恢复时重复定位
- 系统启用“减少动态效果”时彻底关闭小球按压缩放和阴影过渡

### Improved
- 小球补充触控手势隔离，减少 Windows 触控设备拖动时被系统滚动手势打断

### Verification
- 自动回归测试、JavaScript 语法检查及全部 SVG XML 校验通过

## [0.2.25] - 2026-07-12 (Gear Orb)

### Added
- 新增内置 `Gear` SVG 球体，并加入 `Random per day` 选池
- Gear 使用与 Fear、Devil、Ventilation fan 相同的固定中心旋转层
- `Match orb` 模式下 Gear 使用 Digital 音效

### Improved
- Gear 图片在 22px 旋转盒内保留 1px 安全边距，避免齿轮贴边

### Verification
- 48 项自动回归测试通过
- `main.js` 语法检查及 Gear SVG XML 校验通过

## [0.2.24] - 2026-07-11 (Interaction State Hardening)

### Fixed
- 活动文件短暂为空时保留小球当前位置，避免切换文档时先向顶部移动再折返
- 文件树在拖动过程中变空时立即结束拖动并清理旧位置，避免隐藏状态下持续请求动画帧
- 仅允许主指针和鼠标左键开始拖动，右键及额外触点不再误触发小球
- Obsidian 窗口在拖动过程中失焦时主动清理指针捕获、滚动帧、自动展开计时器和全局监听器

### Verification
- 47 项自动回归测试通过
- `main.js` 语法检查及所有内置 SVG XML 校验通过

## [0.2.23] - 2026-07-11 (Unified External SVG Rotation)

### Fixed
- Fear、Devil、Ventilation fan 改用独立的固定中心旋转层，不再直接旋转替换型 `<img>` 元素
- 三种新增 SVG 的 22px 运动盒、轨道中心和按压反馈与 Dragon Ball / Christmas Ball 完全一致
- 图片内容与位移、旋转变换分层，避免拖动时出现绕点公转或偏离竖线的视觉

### Verification
- 43 项自动回归测试通过
- `main.js` 语法检查通过

## [0.2.22] - 2026-07-11 (Deep Performance and Rotating SVG Orbs)

### Added
- 新增 `Fear`、`Devil`、`Ventilation fan` 三种内置 SVG 球体
- 三种新球体沿用 Dragon Ball 的原地旋转逻辑，并加入 `Random per day`
- 素材加载失败时自动回退到默认球体，不留下破损图片

### Performance
- 动画帧改为二分定位后只更新小球附近的刻度和标题，不再遍历整棵文件树
- 普通滚动不再触发全树测量；插件自身 rail DOM 变化不再反向触发刷新
- 拖动指针每次只读取一次布局，active 状态只更新前后两行
- 频繁文件磁吸点、今日轨迹集合和文件统计排序改为缓存或按需更新
- 竖线渐变改为固定 192px 图层做 GPU 位移，不再逐帧重建渐变字符串

### Fixed
- 标题位移改用独立 `translate` 属性，不再覆盖主题或其他插件的 `transform`
- 切换到搜索/书签等页面时清理临时位移，返回文件列表不会残留偏移
- Workspace 监听器和根观察器延后到 `onLayoutReady()` 后注册
- active reveal 的旧动画帧可取消，已展开文件夹不再重复写入展开状态
- 活动记录改为真正 debounce，减少连续切文档时的设置写盘
- 弹簧首帧立即开始移动，减少文档切换时的一帧迟滞
- Fear / Devil / Ventilation fan 不再误触发人物悬停呼吸动画

### Verification
- 42 项自动回归测试通过
- 素材与用户提供的三个 SVG 源文件逐字节一致

## [0.2.21] - 2026-07-10 (Balanced Motion Polish)

### Improved
- 刻度形变改为固定宽度配合 `scaleX()`，拖动帧不再修改 width
- 文件标题直接使用 `translate3d()`，移除逐帧 CSS 变量和动态宽度写入
- 拖动中的 active 文件反馈即时切换，松手后恢复 110ms 强 ease-out
- 球体新增轻微 `0.97` 按压反馈，并缩小拖动阴影范围
- 人物呼吸仅在精确指针悬停时运行，不再与拖动动作竞争
- 磁吸点保留颜色和圆点，移除持续发光阴影

### Fixed
- 文件定位不再同时运行 DOM 平滑滚动和小球弹簧
- 远距离文件切换会保留小球原视口位置，再由弹簧移动到目标
- 文件夹拖动自动展开后，重新测量仍以当前指针位置作为目标
- `pointercancel` 不再误触发文件打开或释放音效
- 多指操作时，额外指针不会接管已有拖动
- 卸载控制器时清理残留拖动态 class

### Verification
- 自动回归测试由 9 项扩展到 23 项
- 保持 v0.2.20 的设置结构、球体资源、音效和弹簧参数不变

## [0.2.20] - 2026-07-10 (Stability and Motion Audit)

### Fixed
- 文档切换定位成功后立即取消剩余重试，避免重复平滑滚动和焦点跳动
- 插件卸载后不再执行排队中的刷新，避免轨道被意外重新创建
- 空文件树不再残留孤立小球
- 小球旋转改为依据视口内位移，滚动文件树时不再无故自转
- 插件卸载时释放 AudioContext

### Improved
- 最近刻度查找从线性扫描改为二分查找
- 远离小球的标题与刻度不再每帧重复写入相同样式
- 移除标题位移上的二次 CSS 延迟，让 JS 弹簧直接控制运动
- 快速切换文档时合并活动记录写盘，并串行化设置保存，减少 I/O 和竞态
- 初始化文件树轨道延后到 Obsidian layout ready
- 新增 9 项自动回归测试，覆盖定位、拖动性能、卸载和持久化生命周期

## [0.2.19] - 2026-07-08 (Active Reveal Retry)

### Improved
- 顶部 tab / 冷 tab 切换时，active file reveal 改为短窗口多次重试
  - 立即下一帧执行一次
  - 之后在 120ms、300ms、700ms 再各执行一次
- 新的 active reveal 会取消旧的未执行重试，避免旧 tab 的任务覆盖新 tab 状态
- 不改拖拽、球体视觉或文件树折叠逻辑

## [0.2.18] - 2026-07-08 (Collapsed Active Target)

### Fixed
- 当前 active 文件被折叠隐藏时，小球不再停留在旧的深层文件位置
- 如果 active 文件不可见，小球会优先落到当前可见的最近父文件夹
- 如果找不到可见父文件夹，则把当前位置限制在当前可见文件树首尾范围内

## [0.2.17] - 2026-07-08 (Ball Fit Tuning)

### Improved
- 足球/篮球样式从 20px 调整为 18px
- 足球/篮球球心向右微调 2px，避免贴近 Obsidian 左侧边界时被裁切
- 不改变默认小球、rail 线或拖动逻辑

## [0.2.16] - 2026-07-08 (SVG Repo Ball Assets)

### Changed
- 足球和篮球样式改用用户提供的 SVG Repo 图标
- SVG 以内联方式打包进 `main.js`，插件仍然不依赖外部文件路径
- 篮球线条颜色统一为黑色，以匹配当前黑白线稿风格

## [0.2.15] - 2026-07-08 (Ball Visual Polish)

### Improved
- 重画足球和篮球内置 SVG
  - 足球更接近黑白五边形线稿
  - 篮球改为更干净的黑白弧线结构
- 球体尺寸从 18px 微调到 20px，提高小尺寸下的可读性

## [0.2.14] - 2026-07-08 (Ball Orb Styles)

### Added
- 设置页新增 `Orb style`
  - `Default`：保留原主题色小球
  - `Soccer`：用内置 SVG 足球替代小球
  - `Basketball`：用内置 SVG 篮球替代小球
- 足球/篮球样式会随小球纵向移动轻微旋转
  - 遵守 `prefers-reduced-motion`，系统减少动态时不旋转

## [0.2.13] - 2026-07-07 (Active Fallback Smoothing)

### Fixed
- 切换文档时，如果文件树还没来得及标记新的 active 文件，圆球不再临时回到第一个 item
- 已有圆球位置时，active item 暂时找不到会保持当前位置，等待下一次 reveal/refresh 对齐到真实文件
- 只修正 active fallback 逻辑，不改拖拽、tick、弹簧或卸载流程

## [0.2.12] - 2026-07-07 (CrispToc Follow-up, Conservative)

### Changed
- 保留 `0.2.11` 的首尾短 tick 和 180ms interaction lock
- 移除 `0.2.11` 的 `offsetTop / offsetHeight` 测量实验
  - 恢复为 `0.2.10` 的批量 `getBoundingClientRect()` 测量
  - 避免 Obsidian 文件树复杂 DOM 下出现位置不稳或拖动不丝滑

## [0.2.11] - 2026-07-07 (CrispToc Follow-up)

### 🎨 Improved
- 借鉴原始 CrispToc 的首尾短刻度
  - 在第一个文件/文件夹前、最后一个文件/文件夹后补短 tick
  - rail 起止更自然，不再显得刻度突然断开
- 增加拖拽释放后的短交互锁
  - release 打开文件后的 180ms 内不主动 reveal active file
  - 减少拖拽打开后被 `file-open` / `active-leaf-change` 立即抢焦点、跳动的概率
- 文件树测量优先使用 `offsetTop / offsetHeight`
  - 对 offsetParent 的 rect 做缓存
  - 特殊 DOM 情况仍 fallback 到 `getBoundingClientRect()`
  - 不改变 `0.2.x` 的直接拖拽手感

## [0.2.10] - 2026-07-07 (Stable Hybrid)

### ⚡ Improved
- 以 `0.2.9` 稳定拖拽手感为基线，只合并 `0.3.x` 的低风险优化
  - 不引入拖拽阻尼、吸附、拖拽节流，避免复现 `0.3.3` 卡顿
  - refresh 阶段改为批量读取 rect，再批量写入 class，减少 layout thrashing
  - previous item 清理改为 `Set` 判断，避免每次循环 `some()`
  - MutationObserver 增加 80ms debounce，合并展开/折叠时的密集刷新
  - 从隐藏状态恢复时自动 refresh，避免侧边栏折叠后不启动

### 🐛 Fixed
- 隐藏/卸载 rail 时释放 pointer capture，并清理拖拽监听
- 修复 pointer release 顺序，避免拖拽结束后偶发残留状态
- 空 rail 不再阻止默认 pointer 事件
- 将拖动滚动的非标准 `behavior: "instant"` 改为标准 `auto`
- 移除 active 小点无限 pulse 动画和标题常驻 `will-change`

## [0.2.9] - 2026-07-06

### 🐛 Fixed
- 修复 file explorer rail 在 Search / Bookmarks 等侧边栏页面上继续占层的问题
  - 只在真实可见的 file explorer 容器里启用 rail
  - file explorer 被切到后台或不可见时，隐藏 rail 并停止动画/拖拽监听
  - 降低 rail 层级，避免覆盖 Obsidian 其他侧边栏视图
- 移除全局捕获 `Cmd+E` 的兜底逻辑
  - 避免在 Search / Bookmarks 页面仍然拦截 Obsidian 原生快捷键
  - active file 定位只在当前 active leaf 是 Markdown 时执行

## [0.2.8] - 2026-07-06

### 🎨 Improved
- rail 主线改为真实 DOM 元素 `.crisp-fe-line`，不再依赖 `::before + CSS calc()`
  - JS 直接设置线段 `top/height/background`
  - 避免浏览器对负数渐变 stop 或主题覆盖造成渐变失效
- 在插件容器内隐藏 Obsidian/主题自带的文件树缩进 guide
  - 防止原生缩进线继续显示成整栏高度
  - 只保留 Crisp File Explorer 自己计算出的短线段

---

## [0.2.7] - 2026-07-06

### 🎨 Improved
- 竖向 rail 主线不再撑满整个文件浏览器滚动高度
  - 根据当前渲染出的文件/文件夹首尾中心点计算线段范围
  - 线条结束位置对齐最后一个文件/文件夹，而不是继续延伸到面板底部
- rail 主线增加基于当前小球位置的透明度渐变
  - 小球附近最实
  - 向上、向下逐步变弱
  - 保持原本的 `text-faint` 线条色系，只调整透明度强弱

---

## [0.2.6] - 2026-07-06 (Hotfix v6)

### 🐛 Fixed
- 为 `Cmd+E` 增加窄范围兜底处理
  - 只捕获 `Cmd+E`，不恢复方向键、Enter、空格等键盘导航
  - 在当前文件是 Markdown 时，直接执行 Obsidian 的 `markdown:toggle-preview`
  - 避免插件定位/侧边栏焦点导致 Obsidian 原生快捷键没有触发

---

## [0.2.5] - 2026-07-06 (Hotfix v5)

### 🐛 Fixed
- 进一步修复 `Cmd+E` 的 active leaf 焦点问题
  - active 文件定位后调用 `workspace.setActiveLeaf(activeLeaf, { focus: true })`
  - 再调用 Markdown editor/container focus，确保 Obsidian 热键 scope 回到当前文章

---

## [0.2.4] - 2026-07-06 (Hotfix v4)

### 🐛 Fixed
- 继续修复 `Cmd+E` 焦点丢失问题
  - 将拖拽球从可聚焦的 `button` 改成不可交互聚焦的 `div`
  - active 文件定位完成后，把焦点还给当前 Markdown 视图/编辑器
  - 避免文件树定位逻辑结束后，Obsidian 快捷键 scope 停留在文件管理器或插件元素上

---

## [0.2.3] - 2026-07-06 (Hotfix v3)

### 🐛 Fixed
- 修复 `Cmd+E` 仍然失效的问题
  - 移除切换文件后对 Obsidian 内置 `file-explorer:reveal-active-file` 命令的调用
  - 该命令会把焦点带到文件管理器，导致编辑器快捷键不再触发
  - 保留插件自己的父文件夹展开与 active 文件滚动定位逻辑
- 删除未使用的 `handleKeyDown()` 代码，避免后续误恢复键盘拦截

---

## [0.2.2] - 2026-07-06 (Hotfix v2)

### 🐛 Fixed
- **完全移除键盘导航功能**，彻底解决 Cmd+E 等快捷键冲突问题
  - 将 `tabIndex` 设为 -1，禁用 Tab 键聚焦
  - 移除 `keydown` 事件监听器
  - 键盘导航虽然是好功能，但对文件浏览器来说不是核心需求，引入的快捷键冲突风险太高
  - 保留了核心的拖动导航和实时预览功能

### 📝 Notes
- 键盘导航功能已从 v0.2.0 的优化列表中移除
- 如果未来需要，可以考虑用 Obsidian 命令而非直接键盘事件实现

---

## [0.2.1] - 2026-07-06 (Hotfix)

### 🐛 Fixed
- **关键修复**：键盘导航拦截了所有快捷键，导致 Cmd+E 等 Obsidian 全局快捷键失效
  - `handleKeyDown` 现在会检查修饰键（metaKey/ctrlKey/shiftKey/altKey）
  - 只处理纯方向键/Enter/空格键，让带修饰键的快捷键正常传递给 Obsidian
  - 修复后 Cmd+E（切换编辑/预览模式）、Cmd+P（命令面板）等全部恢复

---

## [0.2.0] - 2026-07-06

### 🎯 优化重点
基于 CrispToc 原版对比，进行了 6 大方向的精细打磨：

### ✨ Added
- **键盘导航**：球现在可以用 Tab 键聚焦，支持方向键（上/下）、Home/End 移动，Enter/空格键打开文件
- **拖动实时预览**：拖动球时目标文件会实时滚动到视野中心，提供即时视觉反馈
- **文件/文件夹视觉差异**：
  - 文件夹的刻度更淡（opacity: 0.35）、更短（18px）
  - 文件刻度保持原样，信息层级更清晰

### 🎨 Improved
- **音效触发逻辑精准化**：
  - 只在**拖动时**穿越刻度才播放音效，点击跳转**不播放**
  - 使用 `TICK_SIDE_HYSTERESIS = 0.75` 精准滞后判断，避免抖动时反复触发
  - 避免快速跳转时的刺耳连续爆音
- **弹簧参数微调**：
  - `stiffness: 360 → 380`（响应更快）
  - `restSpeed: 0.08 → 0.5`（让球更彻底地滑到位，不会过早停止）
- **视觉 Polish**：
  - 球的光泽：修复 radial-gradient 语法，添加 3D 高光效果
  - 拖动时阴影平滑过渡（`transition: box-shadow 150ms ease`）
  - 激活项右侧小圆点增加微妙脉动动画（2s 周期）

### 🔧 Technical
- 音效状态管理：非拖动时清空 `tickSideMap`，避免下次拖动触发错误的音效
- 代码注释：添加关键逻辑说明，便于后续维护

### 📝 Notes
- 完整备份保存在 `crisp-file-explorer-backup-2026-07-06/`
- 灵感来源：[BubblePtr/ZenBlog CrispToc](https://github.com/BubblePtr/ZenBlog/blob/main/src/shared/components/navigation/CrispToc.client.tsx)

---

## [0.1.1] - Initial Release
- 基础弹簧物理动画
- 可拖动的球体导航
- 刻度标记系统
- 波浪膨胀效果
- 音效支持（可选）

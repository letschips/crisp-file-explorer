import { clearLicenseVerificationCache, UNLICENSED_STATUS, describeLicenseStatus } from "./license.js";
import { PluginSettingTab, Setting, Notice } from "./obsidian.js";
import { normalizeOrbStyle, normalizeSoundStyle } from "./orb/styles.js";
import { normalizeExplorerOrder } from "./order/helpers.js";

function renderAboutCard(container, pluginName, description) {
  const document = container.ownerDocument;
  const card = document.createElement("section");
  card.className = "crisp-fe-about";

  const title = document.createElement("h3");
  title.className = "crisp-fe-about__title";
  title.textContent = `关于 ${pluginName}`;

  const copy = document.createElement("p");
  copy.className = "crisp-fe-about__description";
  copy.textContent = description;

  const byline = document.createElement("p");
  byline.className = "crisp-fe-about__author";
  const label = document.createElement("span");
  label.textContent = "作者：";
  const author = document.createElement("a");
  author.className = "crisp-fe-about__author-link";
  author.textContent = "小红书 letschips";
  author.href = "https://xhslink.cn/m/3MwtKu4822b";
  author.target = "_blank";
  author.rel = "noopener noreferrer";
  byline.append(label, author);

  card.append(title, copy, byline);
  container.append(card);
}

export class CrispFileExplorerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Crisp File Explorer" });

    const createGroup = (title, description, open = false) => {
      const details = containerEl.createEl("details", {
        cls: `crisp-fe-setting-card${open ? " is-open" : ""}`,
      });
      if (open) {
        details.open = true;
      }
      const summary = details.createEl("summary", {
        cls: "crisp-fe-setting-card__header",
      });

      const titleEl = summary.createDiv("crisp-fe-setting-card__title-group");
      titleEl.createDiv({ cls: "crisp-fe-setting-card__title", text: title });
      if (description) {
        titleEl.createDiv({ cls: "crisp-fe-setting-card__desc", text: description });
      }

      summary.createDiv({ cls: "crisp-fe-setting-card__chevron" });

      const contentWrapper = details.createDiv("crisp-fe-setting-card__content-wrapper");
      const body = contentWrapper.createDiv("crisp-fe-setting-card__body");

      summary.addEventListener("click", (evt) => {
        evt.preventDefault();
        details.open = !details.open;
        details.classList.toggle("is-open", details.open);
      });

      return body;
    };

    const licenseGroup = createGroup(
      "软件授权",
      "本地 Ed25519 签名验证与在线设备校验",
      true,
    );

    const statusSetting = new Setting(licenseGroup)
      .setName("当前激活状态")
      .setDesc("正在验证授权状态...");

    if (this.plugin.settings.licenseCode) {
      const wasLicensed = this.plugin.licensed;
      this.plugin.refreshLicense({ online: true }).then((verifyRes) => {
        if (wasLicensed !== this.plugin.licensed) {
          this.display();
          return;
        }
        statusSetting.setDesc(describeLicenseStatus(verifyRes));
      }).catch(() => {
        statusSetting.setDesc("❌ 未激活（授权状态读取失败，请重新验证）");
      });
    } else {
      statusSetting.setDesc(UNLICENSED_STATUS);
    }

    new Setting(licenseGroup)
      .setName("输入授权码")
      .setDesc("粘贴购买获取的 Crisp Suite 授权码。激活时会联网校验设备数量，网络不可用时降级为本地签名验证；结果在当前会话缓存 15 分钟。")
      .addText((text) => text
        .setPlaceholder("粘贴 Crisp 授权码...")
        .setValue(this.plugin.settings.licenseCode)
        .onChange(async (value) => {
          clearLicenseVerificationCache();
          this.plugin.settings.licenseCode = value.trim();
          await this.plugin.saveSettings();
          const wasLicensed = this.plugin.licensed;
          await this.plugin.refreshLicense({ online: false });
          if (wasLicensed !== this.plugin.licensed) this.display();
        }))
      .addButton((button) => button
        .setButtonText("激活 / 重新验证")
        .setCta()
        .onClick(async () => {
          clearLicenseVerificationCache();
          const result = await this.plugin.refreshLicense({ online: true });
          if (result.valid && result.payload) {
            new Notice(result.payload.userName
              ? `🎉 Crisp File Explorer 激活成功！欢迎使用，${result.payload.userName}`
              : "🎉 Crisp File Explorer 激活成功！");
            this.display();
          } else {
            new Notice(`❌ 激活失败: ${result.reason}`);
            this.display();
          }
        }));

    if (!this.plugin.licensed) {
      renderAboutCard(
        containerEl,
        "Crisp File Explorer",
        "用更清晰、更有质感的文件导航，让笔记库浏览轻快而有序。"
      );
      return;
    }

    // 1. Orb & Visual Appearance Group (Open by default)
    const orbBody = createGroup(
      "小球与视觉",
      "选择人物、运动球、表情或齿轮等小球样式。",
      true,
    );

    new Setting(orbBody)
      .setName("小球样式")
      .setDesc("选择可拖动小球的样式。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "默认")
          .addOption("randomDaily", "每日随机")
          .addOption("soccer", "Soccer")
          .addOption("basketball", "Basketball")
          .addOption("redball", "Red ball")
          .addOption("tennis", "Tennis")
          .addOption("clown", "Clown")
          .addOption("dragonball", "Dragon Ball")
          .addOption("christmasball", "Christmas Ball")
          .addOption("orangeball", "Orange Ball")
          .addOption("blueball", "Blue Ball")
          .addOption("character1", "Character 1")
          .addOption("character2", "Character 2")
          .addOption("character3", "Character 3")
          .addOption("character4", "Character 4")
          .addOption("character5", "Character 5")
          .addOption("character6", "Character 6 (Labubu Chucky)")
          .addOption("character7", "Character 7 (Hello Kitty)")
          .addOption("character8", "Character 8 (Stitch)")
          .addOption("character9", "Character 9 (Labubu)")
          .addOption("character10", "Character 10 (Grey Labubu)")
          .addOption("shutup", "Shut Up")
          .addOption("snorlax", "Snorlax")
          .addOption("pikachu", "Pikachu")
          .addOption("pokeball", "Poke Ball")
          .addOption("bracelet", "Bracelet")
          .addOption("snorlaxface", "Snorlax Face")
          .addOption("fear", "Fear")
          .addOption("devil", "Devil")
          .addOption("fan", "Ventilation fan")
          .addOption("gear", "Gear")
          .addOption("alfresco", "Alfresco")
          .addOption("mercedes", "Mercedes-Benz")
          .addOption("taiga", "Taiga")
          .addOption("angry", "Angry")
          .addOption("squint", "Squint")
          .addOption("facemask", "Face Mask")
          .addOption("pokerface", "Poker Face")
          .addOption("captainshield", "Captain America Shield")
          .addOption("batman", "Batman")
          .addOption("superman", "Superman")
          .addOption("spiderman", "Spider-Man")
          .addOption("dizzy", "Dizzy Emoji")
          .addOption("vinyl", "Vinyl")
          .setValue(normalizeOrbStyle(this.plugin.settings.orbStyle))
          .onChange(async (value) => {
            const selectedStyle = normalizeOrbStyle(value);
            this.plugin.settings.orbStyle = selectedStyle;
            this.plugin.updateOrbStyles();
            await this.plugin.saveSettings();
          })
      );

    // 2. Audio & Sound Feedback Group
    const audioBody = createGroup(
      "音效反馈",
      "设置小球经过轨道刻度和落定时的声音。",
      false,
    );

    new Setting(audioBody)
      .setName("拖动音效")
      .setDesc("小球经过文件树标记点时播放短促滴答声。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.soundEnabled).onChange(async (value) => {
          this.plugin.settings.soundEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(audioBody)
      .setName("音效风格")
      .setDesc("选择拖动与落定确认音效。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("soft", "Soft tick (经典轻型切音)")
          .addOption("scale", "Marimba Music Box Scale (八音盒音阶)")
          .addOption("wooden", "Crisp Muyu Wooden Block (清脆木鱼)")
          .addOption("mechanical", "Mechanical Blue Switch (机械青轴)")
          .addOption("raindrop", "Crystal Water Drop (清透水滴)")
          .addOption("retro8bit", "Retro 8-Bit Game (8-Bit 像素风)")
          .addOption("watchgear", "Vintage Watch Gear (名表发条)")
          .addOption("bubble", "Bubble Pop (轻柔气泡)")
          .addOption("matchOrb", "Match orb (跟随小球造型)")
          .setValue(normalizeSoundStyle(this.plugin.settings.soundStyle))
          .onChange(async (value) => {
            this.plugin.settings.soundStyle = normalizeSoundStyle(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(audioBody)
      .setName("音高滑动")
      .setDesc("沿文件树向下拖动时，音高随之升高。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pitchScaleEnabled).onChange(async (value) => {
          this.plugin.settings.pitchScaleEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(audioBody)
      .setName("落定音效")
      .setDesc("小球落在某个项目上时播放确认音。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.releaseSoundEnabled).onChange(async (value) => {
          this.plugin.settings.releaseSoundEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    // 3. Activity & Heatmap Group
    const activityBody = createGroup(
      "活动与磁吸",
      "显示今日使用轨迹，并为固定或近期常用文件提供磁吸。",
      false,
    );

    new Setting(activityBody)
      .setName("今日轨迹")
      .setDesc("在轨道上用淡点标记今日打开过的文件。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.todayTrailEnabled).onChange(async (value) => {
          this.plugin.settings.todayTrailEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );

    new Setting(activityBody)
      .setName("智能磁吸点")
      .setDesc("固定文件优先，其余根据近期使用和打开频率提供轻柔磁吸。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.frequentMagnetsEnabled).onChange(async (value) => {
          this.plugin.settings.frequentMagnetsEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );

    // 4. Drag & File Tree Interaction Group
    const interactionBody = createGroup(
      "拖动与文件树",
      "设置轨道项目显示、松开行为和文件夹自动展开。",
      false,
    );

    new Setting(interactionBody)
      .setName("包含文件夹")
      .setDesc("在动效轨道中同时显示文件夹行。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeFolders).onChange(async (value) => {
          this.plugin.settings.includeFolders = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );

    new Setting(interactionBody)
      .setName("树形连接线")
      .setDesc("用连接线标出文件夹层级，轨道作为最外一层。只用于原生文件树，双栏浏览中不显示。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.treeGuidesEnabled).onChange(async (value) => {
          this.plugin.settings.treeGuidesEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );

    new Setting(interactionBody)
      .setName("松开打开项目")
      .setDesc("松开小球时打开最近的文件，或展开/收起最近的文件夹。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openOnDragRelease).onChange(async (value) => {
          this.plugin.settings.openOnDragRelease = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(interactionBody)
      .setName("自动展开文件夹")
      .setDesc("拖动时小球停留在文件夹上自动展开。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoExpandFoldersOnDrag).onChange(async (value) => {
          this.plugin.settings.autoExpandFoldersOnDrag = value;
          await this.plugin.saveSettings();
        })
      );

    const orderBody = createGroup(
      "文件排序",
      "拖到两行之间调整顺序，右键可以置顶。",
      false,
    );
    const order = this.plugin.explorerOrder;
    order.sync();
    const orderData = this.plugin.settings.explorerOrder;

    if (order.isFlexplorerEnabled()) {
      orderBody.createDiv({
        cls: "setting-item-description",
        text: "Flexplorer 还在启用，文件顺序暂由它管理。在「第三方插件」里停用 Flexplorer 后，这里会自动接管，并导入一次它的顺序和置顶。",
      });
    }

    new Setting(orderBody)
      .setName("拖动调整顺序")
      .setDesc("拖到两行之间放下即可调整顺序；拖到文件夹中间仍是移入文件夹。关闭后恢复 Obsidian 默认排序，已保存的顺序会保留。")
      .addToggle((toggle) =>
        toggle.setValue(orderData.enabled).onChange(async (value) => {
          this.plugin.settings.explorerOrder = normalizeExplorerOrder({ ...this.plugin.settings.explorerOrder, enabled: value });
          order.requestSort();
          await this.plugin.saveSettings();
        })
      );

    new Setting(orderBody)
      .setName("新条目位置")
      .setDesc("还没排过的新文件和新文件夹放在哪一端。")
      .addDropdown((dropdown) => dropdown
        .addOption("top", "最前")
        .addOption("bottom", "最后")
        .setValue(orderData.newItems)
        .onChange(async (value) => {
          this.plugin.settings.explorerOrder = normalizeExplorerOrder({ ...this.plugin.settings.explorerOrder, newItems: value });
          order.requestSort();
          await this.plugin.saveSettings();
        }));

    const folderCount = Object.keys(orderData.folders).length;
    new Setting(orderBody)
      .setName("从 Flexplorer 导入")
      .setDesc(`当前保存了 ${folderCount} 个文件夹的顺序、${orderData.pinned.length} 个置顶。导入会用 Flexplorer 的顺序和置顶替换这些。`)
      .addButton((button) => button
        .setButtonText("导入")
        .onClick(async () => {
          button.setDisabled(true);
          try {
            await order.importFromFlexplorer();
          } finally {
            this.display();
          }
        }));

    new Setting(containerEl)
      .setName("轻量双栏浏览")
      .setDesc("左侧浏览文件夹，右侧显示当前目录。也可用文件浏览器顶栏按钮切换。")
      .addToggle(toggle => toggle
        .setValue(Boolean(this.plugin.settings.dualPaneEnabled))
        .onChange(value => this.plugin.setDualPaneEnabled(value)));

    renderAboutCard(
      containerEl,
      "Crisp File Explorer",
      "用更清晰、更有质感的文件导航，让笔记库浏览轻快而有序。"
    );
  }
}

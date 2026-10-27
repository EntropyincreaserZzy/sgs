# 三国杀 · 军争（网页版）v1.1.5

作者：张宗耀（游戏账号：开发者_熵增反应）

> 版本：**1.1.5** · 更新日志：[CHANGELOG.md](CHANGELOG.md) · 启动：`npm start` 或 `node server.js`（Windows 可双击 `start.bat`）

> **备案状态**：已提交 ICP 备案，审核通过后可在 <https://sjsgs.xyz/> 游玩；审核期间临时地址：<http://47.117.135.24/>。

一个可联机的三国杀军争完整网页版：五人 / 八人、房间码、随机匹配、机器人补位、  
主公选将、三选一、五秒换牌、军争牌堆、32 名武将、牌堆 / 武将图鉴；  
现在带 **账号注册 / 登录**、跨设备会话、个人战绩，以及 Docker / Caddy 公网部署。

## 1.1.5 安全公告

- 全站 API / 登录注册限流，SSE 每 IP 并发限制；
- CSP、X-Frame-Options、nosniff 等安全响应头；
- Cookie 改为 `SameSite=Strict`，HTTPS 下自动 `Secure`；
- 静态文件路径穿越、畸形 URL、超大请求体防护；
- 完整服务器加固步骤见 [SECURITY.md](SECURITY.md)：低权限运行、systemd 沙箱、Caddy HTTPS、防火墙、SSH、fail2ban、备份、防篡改。

## 1.1.4 更新公告

- **军八主忠内联动**：主忠内优先联合打反贼；主动进攻主公的人会被主忠内标记为极高敌意；
- **观看 / 展示手牌**：观看类只给观看者和被观看者看，展示类所有人可见；刘协【天命】、火攻已接入；
- **拼点**：不能选没有手牌的人拼点；
- **回合标识**：当前行动角色座位显示“行动中”高亮；
- **技能动画**：发动主动技能时主界面有动画提示；
- **音乐设置**：顶栏“设置”可随时开关音乐、调音量；主界面和对局使用不同曲目；
- **扳机阶段**：新增卡牌使用 / 结算 / 结算后，以及六个阶段的开始 / 结束通用扳机。

## 1.1.3 更新公告

- **12 个性格 bot**：卧龙 / 凤雏 / 公瑾（谨慎）、云长 / 翼德 / 奉先（激进）、玄德 / 仲谋 / 献帝（防守）、孟德 / 仲达 / 文和（收割）；
- 添加人机时从 12 个 bot 中随机抽取，房间内不重复；模拟也从 12 个中随机抽取；
- **主公击杀忠臣**：主公误杀忠臣后弃置所有手牌；
- 各性格的具体行为、思考时间已写入 CHANGELOG。

## 1.1.2 更新公告

- **丈八蛇矛**：装备后技能栏可直接发动；选两张手牌 / 装备牌（不能含丈八本身）当【杀】，主动出杀或响应【南蛮入侵】【决斗】都能用；
- **马超【铁骑】**：对方不交同花色牌时，可先弃置其一张装备牌；
- **华佗 bot**：优先用黑色牌进攻，保留红牌用于【疗毒】；
- **貂蝉【离间】**：可弃置装备牌发动，没有手牌也能离间；
- **司马懿【鬼才】**：X 改为当前体力值；
- **周瑜【反间】**：每回合每种花色限扣置一次。

## 启动网址

### 已经部署的地址

- 临时访问：<http://47.117.135.24/>
- 正式域名：<https://sjsgs.xyz/>（已提交 ICP 备案，审核通过后启用）
- 服务器更新：`cd /opt/sgs && git pull && systemctl restart sgs`，账号数据在 `/opt/sgs/data`。

### 公网部署

- **阿里云（当前）**：Ubuntu + systemd，代码在 `/opt/sgs`，`systemctl restart sgs`；账号数据 `/opt/sgs/data`。
- **Railway**：GitHub → New Project → 选中仓库（Dockerfile）→ Volume 挂载 `/data` → `DATA_DIR=/data`、`NODE_ENV=production`。
- **Render**：New Blueprint → `render.yaml`（Docker + 1GB 磁盘；磁盘需要付费实例）。
- **自己的 VPS**：`DOMAIN=game.example.com docker compose up -d --build`，Caddy 自动 HTTPS，`./data` 持久化。
- **临时**：本机 `node server.js` + `cloudflared tunnel --url http://localhost:3000`；电脑要一直开着，URL 会变。

### 账号与数据

- 注册 / 登录后昵称和战绩绑定账号；密码 scrypt 加盐哈希；HttpOnly Cookie 30 天。
- 数据在 `DATA_DIR/db.json`（默认 `sgs/data/db.json`），`data/` 已 gitignore；对局结束自动记录战绩。
- 房间仍在内存里，服务重启会清空当前房间；账号和战绩不会丢。
- 公网请用 HTTPS，不要把 3000 直接暴露到公网；定期备份 `data/db.json`。

## 文件结构

```
sgs/
  data.js            武将、卡牌定义、牌堆生成
  engine.js          规则引擎：回合、判定、伤害、濒死、无懈、铁索、胜负
  skills.js          32 名武将的技能触发 / 主动技能
  rooms.js           房间、选将、身份、机器人、SSE 广播
  accounts.js        账号、会话、战绩持久化
  server.js          HTTP + SSE 服务 + 账号 API
  public/
    index.html
    style.css
    app.js           前端渲染与交互
    portraits/       32 名武将的立绘（从上传的武将卡裁切）
  screenshots/       界面截图
  data/              账号数据（默认 db.json，已 gitignore）
  Dockerfile / docker-compose.yml / Caddyfile / render.yaml
  start.bat          Windows 一键局域网启动
  test.js            全机器人对局自测（引擎层）
  http-test.js       HTTP / SSE 流程测试（需服务运行）
```

## 自测

```bash
# 全机器人八人局 / 五人局（引擎层）
node test.js 8
node test.js 5

# 需要先启动 server.js
node http-test.js

# 账号 / 登录：启动后浏览器注册；或直接调用
# POST /api/auth/register  {username, password, displayName}
# POST /api/auth/login     {username, password}
# GET  /api/auth/me
# POST /api/auth/logout
```

## 计划实现

- 把 160 张牌堆插画接入手牌（目前是 SVG 徽记水印；提供按牌名命名的图片目录即可自动接入）。
- 补完丈八蛇矛两牌“打出”、诈降“使用”、章武 / 励众、天命观看看牌等细节。
- 手机竖屏布局（当前对局界面偏桌面）。
- 房间持久化、断线重连提示、聊天、观战。
- 账号：邮箱找回 / 管理员后台 / 更严格限流（公开运营前）。

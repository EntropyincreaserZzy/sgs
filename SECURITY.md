# 安全加固清单

面向公网开放（小红书 / B 站引流）前，至少完成本清单的 **应用层 + 服务器层** 两部分。

## 一、应用层（已写入代码）

`server.js` 已内置：

- 安全响应头：`CSP`、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Permissions-Policy`；
- 登录 / 注册：每 IP 每分钟 10 次；全站 `/api/` 每 IP 每分钟 300 次；
- SSE 每 IP 最多 5 条并发连接；
- 请求体上限 1 MB，超时 / 请求头数量限制；
- Session Cookie：`HttpOnly` + `SameSite=Strict`，HTTPS 下自动 `Secure`；
- 静态文件路径穿越防护；
- 密码 scrypt 加盐哈希、会话 token 32 字节随机；
- 反向代理场景通过 `TRUST_PROXY=1` 读取真实 IP（只应在 Caddy / Nginx 后面开启）。

## 二、服务器层（在阿里云 Workbench 执行）

### 1. 先改 root 密码

```bash
passwd
```

设置一个强密码（16 位以上，大小写 + 数字 + 符号），不要和任何其他账号复用。

### 2. 创建低权限运行用户

```bash
useradd --system --home /opt/sgs --shell /usr/sbin/nologin sgs
chown -R root:root /opt/sgs
chown -R sgs:sgs /opt/sgs/data
chmod -R go-w /opt/sgs
```

代码归 root 只读，只有 `data/` 归 `sgs` 可写；这样即使 Node 进程被攻破，也改不了代码。

### 3. systemd 加固

```bash
mkdir -p /etc/systemd/system/sgs.service.d
cat > /etc/systemd/system/sgs.service.d/hardening.conf <<'EOF'
[Service]
User=sgs
Group=sgs
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=NODE_ENV=production
Environment=DATA_DIR=/opt/sgs/data
Environment=COOKIE_SECURE=true
Environment=TRUST_PROXY=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/sgs/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
MemoryMax=800M
EOF
systemctl daemon-reload
systemctl restart sgs
systemctl status sgs --no-pager
```

> `COOKIE_SECURE=true` 只有在 HTTPS 配好后才能用；如果暂时还是 HTTP，先删掉这一行，否则登录 Cookie 不会发送。

### 4. 反向代理 + HTTPS

不要把 3000 直接暴露到公网。装 Caddy：

```bash
apt update
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

有域名时（推荐，HTTPS 才安全）：

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
game.example.com {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }
}
EOF
systemctl restart caddy
```

把 `game.example.com` 换成你的域名，并在域名 DNS 里加一条 A 记录指向 `47.117.135.24`。Caddy 会自动申请 Let's Encrypt 证书。

**没有域名时**，至少先用 Caddy 监听 80 端口做反代：

```bash
cat > /etc/caddy/Caddyfile <<'EOF'
:80 {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
EOF
systemctl restart caddy
```

### 5. 阿里云安全组 + 本机防火墙

阿里云控制台 → 安全组 → 入方向，只保留：

- 22/tcp（SSH，最好限制来源 IP）
- 80/tcp
- 443/tcp

删除 3000 的入方向规则。

本机：

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

### 6. SSH 加固

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
```

建议创建普通用户 + SSH 密钥，确认能用密钥登录后，再改：

```bash
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
MaxAuthTries 3
LoginGraceTime 20
EOF
systemctl restart ssh
```

> 改 SSH 前一定先开另一个终端确认密钥能登录，避免把自己锁在外面。
> 阿里云 Workbench 网页终端走的是控制台通道，一般不受 SSH 配置影响，但仍要先确认。

### 7. 系统更新

```bash
apt update
apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

看到 `*** System restart required ***` 时，选一个没人的时间：

```bash
reboot
```

### 8. 数据备份

```bash
mkdir -p /opt/backups
cat > /opt/backups/backup.sh <<'EOF'
#!/bin/bash
set -e
D=$(date +%F)
tar -czf /opt/backups/sgs-data-$D.tar.gz -C /opt/sgs data
find /opt/backups -name 'sgs-data-*.tar.gz' -mtime +14 -delete
EOF
chmod +x /opt/backups/backup.sh
( crontab -l 2>/dev/null; echo "20 4 * * * /opt/backups/backup.sh" ) | crontab -
```

定期把 `/opt/backups` 里的文件下载到本地或阿里云 OSS；只留服务器上不算备份。

### 9. 代码防篡改检查

```bash
cd /opt/sgs
git status --short
sha256sum engine.js server.js rooms.js skills.js data.js > /opt/sgs/.sha256
```

出问题时可对比：

```bash
cd /opt/sgs && sha256sum -c .sha256
```

部署流程固定为：`git pull`（root）→ `systemctl restart sgs`；不要用 `chmod 777`，不要让 Node 以 root 跑。

## 三、上线前最后检查

- [ ] `curl -I https://你的域名/` 返回 200，且能看到 `Strict-Transport-Security`；
- [ ] `http://IP:3000` 从公网打不开；
- [ ] 登录 / 注册连续点 20 次会被 429；
- [ ] `systemctl status sgs` 显示 `User=sgs`，且 `ProtectSystem=strict`；
- [ ] 备份脚本已跑过一次，能生成 tar.gz；
- [ ] root 密码已改，SSH 密钥登录可用；
- [ ] 阿里云安全组只开 22 / 80 / 443。

## 四、被攻击时的应急

```bash
systemctl stop sgs
# 保留现场
cp /opt/sgs/data/db.json /opt/backups/incident-$(date +%s).json
# 查看异常连接
ss -tunp | head -50
journalctl -u sgs --no-pager -n 200
```

先停服、备份数据、看日志，再决定恢复哪个备份；不要直接删 `data/`。

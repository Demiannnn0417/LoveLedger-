# onetwonono 中文版云部署

下面的方案使用一台 Linux 云服务器、Docker Compose 和项目自带的 Caddy 反向代理。Caddy 会为域名自动申请和续期 HTTPS 证书。

## 1. 准备服务器和域名

- 准备一台带公网 IP 的 64 位 Linux 云服务器；Ubuntu 24.04 LTS 是一个省心的选择。
- 在域名控制台添加 `A` 记录，将要使用的子域名（例如 `cards.example.com`）指向服务器的公网 IPv4 地址；有 IPv6 时再添加 `AAAA` 记录。
- 在云厂商安全组和服务器防火墙中放行 TCP 端口 `80`、`443`，以及仅供管理使用的 SSH 端口 `22`。不要向公网开放应用内部端口 `3000`。
- 按 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)安装 Docker Engine 和 Docker Compose 插件。
- 如果服务器位于中国大陆，使用域名提供非经营性互联网信息服务前通常需要完成 ICP 备案；请通过云厂商的备案入口办理，并以[工业和信息化部现行规定](https://www.miit.gov.cn/gyhxxhb/jgsj/cyzcyfgs/bmgz/xxtxl/art/2024/art_84a0cfa0ebd049bbbe751dca9a008e56.html)为准。

## 2. 上传中文版压缩包

在 Windows PowerShell 中执行，把地址和用户名替换为你的服务器信息：

```powershell
scp D:\program\artifacts\onetwonono-source.zip root@服务器公网IP:/tmp/
```

随后登录服务器并解压：

```bash
ssh root@服务器公网IP
sudo apt update
sudo apt install -y unzip openssl
sudo mkdir -p /opt/onetwonono
sudo unzip /tmp/onetwonono-source.zip -d /opt/onetwonono
cd /opt/onetwonono
```

## 3. 设置域名和密钥

```bash
cp .env.example .env
openssl rand -base64 48
```

编辑 `.env`，至少填写下面两项。域名不要带 `https://`，密钥使用上一条命令生成的随机值：

```dotenv
SESSION_SECRET=粘贴随机密钥
CADDY_DOMAIN=cards.example.com
SEED_LOCALE=zh
ENABLE_DEMO_ACCOUNT=0
ENABLE_REGISTRATION=0
```

数据库目录必须允许容器内的非 root 用户（UID/GID 999）写入：

```bash
mkdir -p var
sudo chown -R 999:999 var
```

## 4. 启动并检查

```bash
docker compose -f deploy/caddy/docker-compose.caddy.yml up -d --build
docker compose -f deploy/caddy/docker-compose.caddy.yml ps
docker compose -f deploy/caddy/docker-compose.caddy.yml logs --tail=100
```

DNS 生效后，打开 `https://cards.example.com`。首次使用的管理员账号是：

- 用户名：`couplecards`
- 临时密码：`changeme`

第一次登录会强制修改密码。进入管理后台后，在“用户”中分别创建你和伴侣的普通账号；初始密码只显示一次，请立即妥善保存并让各自账号首次登录时修改。

## 5. 手机使用

你们可以直接用手机浏览器访问 HTTPS 域名。Chrome/Edge 可使用“安装应用”，iPhone Safari 可使用“共享 → 添加到主屏幕”，之后体验接近普通 App。

## 6. 备份与更新

SQLite 数据保存在服务器的 `/opt/onetwonono/var/`。最稳妥的备份方式是短暂停服后复制数据库：

```bash
cd /opt/onetwonono
docker compose -f deploy/caddy/docker-compose.caddy.yml down
cp var/couplecards.db "var/couplecards-$(date +%F).db"
docker compose -f deploy/caddy/docker-compose.caddy.yml up -d
```

更新本地化源码后，重新上传压缩包并执行 `up -d --build` 即可；数据库迁移会在启动时自动运行。覆盖代码前务必先备份 `var/`，不要删除 Caddy 的 Docker 数据卷，否则它需要重新申请证书。

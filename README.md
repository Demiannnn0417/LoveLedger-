# LoveLedger

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

这是一款隐私优先、可自行部署的情侣共享 Web 应用。它能够将情侣日常活动卡与双人库存账本放在一起，可记录洗碗卡、奖励券或任意自定义物品的双方余额及获取/使用流水。

> 数据保存在自己的服务器上；运行时不包含遥测或第三方统计服务因此无隐私安全担忧。

## 主要功能

- **情侣绑定**：两个用户通过邀请码建立情侣关系，每个账号只能加入一段关系。
- **双方独立余额**：同一种物品分别显示两位成员持有的数量。
- **自定义物品**：支持设置名称、Emoji、计量单位和说明，默认提供“**卡”。
- **完整流水**：每次获取或使用都会记录操作者、所属成员、数量、备注和时间。
- **余额保护**：服务端拒绝导致库存变成负数的操作。
- **日常活动卡**：内置居家和户外卡组，支持抽卡、历史记录和个人禁用列表。
- **中文界面**：同时支持英语、法语、德语、意大利语和西班牙语。
- **可安装 PWA**：适配手机、平板和桌面浏览器，可添加到手机主屏幕。
- **自行部署**：提供 Docker、Caddy、nginx 和 Traefik 部署配置。

## 技术栈

- Node.js 24
- Fastify 5
- SQLite（Node.js 内置 `node:sqlite`）
- 原生 HTML、CSS 和 JavaScript ES Modules
- Docker Compose

共享账本以服务器数据为准，必须联网使用，以避免两台设备同时扣减造成余额冲突。活动卡组首次加载后支持离线访问。

## Docker 快速启动

```bash
cp .env.example .env
# 生成随机密钥：openssl rand -base64 48
# 将结果填写到 .env 的 SESSION_SECRET
docker compose up -d --build
```

启动后访问：

```text
http://localhost:3000
```

首次登录请立即修改管理员密码，然后在管理后台为你和伴侣分别创建普通用户账号。具体初始账号及配置方式请查看部署文档。

## 情侣账本使用流程

1. 第一位用户登录后进入“情侣账本”，点击“创建我们的账本”。
2. 将生成的八位邀请码发送给伴侣。
3. 伴侣使用自己的账号登录，在“情侣账本”中输入邀请码。
4. 绑定后即可查看双方的爱爱卡余额，或创建其他自定义物品。
5. 点击某位成员旁边的“获取”或“使用”，填写数量和备注即可生成流水。

解除情侣绑定会同时删除这段关系的共享账本，防止未来的新关系读取旧数据。执行前请确认不再需要历史记录。

## 云部署

推荐使用项目自带的 Caddy 配置，它会为域名自动申请和续期 HTTPS 证书：

```bash
docker compose -f deploy/caddy/docker-compose.caddy.yml up -d --build
```

部署前需要在 `.env` 中设置：

```dotenv
SESSION_SECRET=随机生成的高强度密钥
CADDY_DOMAIN=你的域名
SEED_LOCALE=zh
ENABLE_DEMO_ACCOUNT=0
ENABLE_REGISTRATION=0
```

不要将 `.env` 或运行时数据库提交到 Git 仓库。

## 文档

- [中文云部署指南](./docs/deployment.zh-CN.md)
- [情侣账本使用说明](./docs/ledger.zh-CN.md)
- [配置参考](./docs/configuration.md)
- [管理指南](./docs/administration.md)
- [安全模型](./docs/security.md)
- [系统架构](./docs/architecture.md)
- [国际化说明](./docs/i18n.md)

## 项目来源

LoveLedger 基于 [couplecards](https://github.com/qiaeru/couplecards) 开源项目改进，新增中文本地化、情侣绑定、共享库存、双方余额以及获取/使用流水等功能。原项目及第三方资源的版权和许可信息见 [LICENSE](./LICENSE) 与 [CREDITS.md](./CREDITS.md)。

## 许可证

本项目依照 [MIT License](./LICENSE) 发布。分发或修改源码时，请保留许可证文件中的原版权与许可声明。

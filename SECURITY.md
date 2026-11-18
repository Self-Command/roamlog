# 安全政策

## 支持范围

Roamlog 尚未发布 1.0，不提供长期支持版本。安全修复只保证落在 `main` 和当前最新的发布镜像 tag 上；历史镜像、旧分支和本地实验环境不承诺补丁。

| 版本                              | 支持 |
| --------------------------------- | ---- |
| `main`                            | 是   |
| 最新 release / GHCR image tag     | 是   |
| 旧 release、个人 fork、未合并分支 | 否   |

## 私密报告漏洞

请优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告入口：

<https://github.com/Self-Command/roamlog/security/advisories/new>

如果该入口不可用，请创建一个**不含漏洞细节**的最小 issue，请求维护者提供私密联系渠道；不要在公开 issue、PR、讨论区或聊天中贴 PoC、真实 token、数据库连接或用户数据。

报告中尽量包含：

- 受影响版本、commit SHA 或镜像 digest。
- 环境（local/staging、Web/Admin/API/Worker）。
- 复现步骤、所需角色和前置条件。
- 影响范围：认证绕过、跨 Workspace 访问、对象级权限、数据泄露、RCE、SSRF、限流绕过等。
- 最小化的请求/日志/截图；所有凭据和 PII 必须替换为合成值。
- 你是否已尝试、以及是否计划公开披露。

维护者会尽快确认收到、复现并评估修复方案。修复与披露节奏由影响范围、可利用性和用户风险决定；在修复可用前，请不要公开未协调的细节。

## 研究边界

允许：

- 在你自己的本地环境或明确授权的 staging 环境测试。
- 使用合成账号、演示 Workspace 和测试媒体。
- 以最小请求证明影响，不扩大读取、写入或持久化范围。

禁止：

- 访问、修改或下载他人的 Workspace、媒体、导出、邀请或分享数据。
- 对真实用户发送邮件、触发大量通知、爆破密码/TOTP 或制造拒绝服务。
- 删除、加密、污染数据，或在第三方服务上创建持久化后门。
- 扫描与本项目无关的主机、域名或云资源。
- 公开尚未修复的漏洞细节、真实 token、cookie、数据库 dump 或个人信息。

如果你不确定某个测试是否越界，先停止并通过私密渠道询问。

## 重点攻击面

- Better Auth 注册、登录、OAuth callback、邮箱验证、密码重置与 session。
- 管理员平台角色、强制 TOTP、bootstrap 与危险操作审计。
- Workspace 成员关系、角色矩阵、Trip 可见性和对象级授权。
- 公开分享 token 的 hash、过期、撤销、密码、限流与 `noindex`。
- 媒体 presign/complete、MIME 校验、对象 bucket policy、签名 URL 与 EXIF。
- 导出 ZIP 内容、签名下载、过期清理和跨 Workspace 文件引用。
- CORS/Origin、CSRF、CSP/HSTS、反向代理 XFF/限流、Socket.IO 握手鉴权。
- BullMQ 队列注入、确定性 jobId 冲突、重试/清理权限与审计。
- Tiptap HTML 清洗、存储型 XSS、开放重定向和敏感错误信息泄露。

## 现有安全控制

- Workspace 是强制租户边界；业务查询先校验成员身份。
- 平台角色与 Workspace 角色独立；Admin 强制已验证 TOTP。
- Session 使用 httpOnly、Secure、SameSite=Lax。
- 分享 token 只存 hash，明文仅在创建时返回；可过期、撤销和密码保护。
- 媒体与导出位于私有对象存储，只通过短时签名 URL 读取。
- CORS 使用精确 origin；自定义写接口校验 Origin。
- 认证、分享、上传等关键路径使用 Redis 限流。
- 服务端清洗富文本；未知 500 使用 Problem Details，不返回堆栈。
- Pino/Sentry 日志启用敏感字段 redaction；后台写操作写审计。
- CI 包含 lint、typecheck、测试、契约检查、build 与安全/负载门禁；依赖检查可运行：

```bash
pnpm security:check
```

这些控制不能替代漏洞报告。若发现某项控制未生效，请按上面的私密流程报告。

## 凭据与数据

- 仓库不应包含 `.env`、`.env.local`、`docker/.env.staging`、OAuth secret、Resend key、S3 credential、数据库 dump 或真实用户数据。
- 如果凭据可能泄露，立即停止使用该凭据并通过私密渠道通知维护者；不要在 issue 中粘贴完整值。
- 运维轮换步骤见 [secret rotation](docs/operations/secret-rotation.md)。
- 截图和测试证据必须使用公开演示数据，并移除浏览器扩展、终端历史、连接字符串和审计敏感字段。

## 第三方与基础设施

- MinIO/R2/S3、Resend、Google/GitHub OAuth、PostgreSQL、Redis 和反向代理都属于攻击面的一部分。
- 使用批准的镜像/域名和固定 digest；未知第三方镜像、公共 bucket 或任意代理不得进入 staging/production。
- 依赖升级需要检查安全公告、许可证和供应链影响；不要为了绕过构建错误而关闭 audit gate。

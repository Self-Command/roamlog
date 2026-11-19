import { Inject, Injectable, Optional } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service.js";
import { MailService } from "../email/mail.service.js";
import { MailSettingsConsumer } from "../settings/mail-settings.consumer.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

interface MailUser {
  id?: string;
  email: string;
  name: string;
}

export interface InvitationMailInput {
  to: string;
  workspaceName: string;
  inviterName: string;
  url: string;
}

interface MailInput {
  to: string;
  subject: string;
  template: string;
  html: string;
  text: string;
  userId?: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function emailShell(title: string, body: string): string {
  return [
    '<div style="background:#000;color:#fcfdff;font-family:Georgia,serif;padding:32px">',
    `<h1 style="font-size:28px;font-weight:500;margin:0 0 24px">${escapeHtml(title)}</h1>`,
    body,
    '<p style="color:#8a8f98;font-size:12px;margin-top:32px">Roamlog · 旅行档案</p>',
    "</div>",
  ].join("");
}

/**
 * Transactional templates and the `EmailLog` audit trail.
 *
 * The transport itself lives in `MailService`, which reads the admin `mail.*`
 * settings (DB > env > default). This service only renders templates, records
 * the attempt, and reports the delivery outcome.
 */
@Injectable()
export class EmailDeliveryService {
  private fallbackMail: MailService | undefined;

  constructor(
    @Inject(AppConfigService) _config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    /**
     * Optional so `scripts/bootstrap-admin.ts`, which constructs this service
     * by hand outside Nest, keeps working with an environment-only transport.
     */
    @Optional() @Inject(MailService) private readonly mail?: MailService,
  ) {}

  async sendVerificationEmail(user: MailUser, url: string): Promise<void> {
    const safeUrl = escapeHtml(url);
    await this.send({
      to: user.email,
      ...(user.id ? { userId: user.id } : {}),
      subject: "验证你的 Roamlog 邮箱",
      template: "auth.verify-email",
      text: `验证 Roamlog 邮箱：${url}`,
      html: emailShell(
        "验证你的邮箱",
        `<p style="color:#acb1ba;line-height:1.6">${escapeHtml(user.name)}，点击下方链接完成验证。链接一小时内有效。</p><p><a href="${safeUrl}" style="color:#fff;background:#222;padding:12px 18px;border-radius:8px;text-decoration:none">验证邮箱</a></p>`,
      ),
    });
  }

  async sendPasswordResetEmail(user: MailUser, url: string): Promise<void> {
    const safeUrl = escapeHtml(url);
    await this.send({
      to: user.email,
      ...(user.id ? { userId: user.id } : {}),
      subject: "重置你的 Roamlog 密码",
      template: "auth.reset-password",
      text: `重置 Roamlog 密码：${url}`,
      html: emailShell(
        "重置密码",
        `<p style="color:#acb1ba;line-height:1.6">使用下方链接设置新密码。如果不是你发起的请求，请忽略此邮件。</p><p><a href="${safeUrl}" style="color:#fff;background:#222;padding:12px 18px;border-radius:8px;text-decoration:none">设置新密码</a></p>`,
      ),
    });
  }

  async sendInvitation(input: InvitationMailInput): Promise<void> {
    const safeUrl = escapeHtml(input.url);
    await this.send({
      to: input.to,
      subject: `加入 ${input.workspaceName} 的 Roamlog Workspace`,
      template: "workspace.invitation",
      text: `${input.inviterName} 邀请你加入 ${input.workspaceName}：${input.url}`,
      html: emailShell(
        "一起记录下一趟旅行",
        `<p style="color:#acb1ba;line-height:1.6">${escapeHtml(input.inviterName)} 邀请你加入 <strong style="color:#fff">${escapeHtml(input.workspaceName)}</strong>。邀请链接 7 天内有效。</p><p><a href="${safeUrl}" style="color:#fff;background:#222;padding:12px 18px;border-radius:8px;text-decoration:none">接受邀请</a></p>`,
      ),
    });
  }

  /** True when the admin settings/env resolve to a usable transport. */
  async isConfigured(): Promise<boolean> {
    return this.mailer.isConfigured();
  }

  private get mailer(): MailService {
    if (this.mail) {
      return this.mail;
    }
    // Hand-constructed callers (bootstrap script) get environment-only mail.
    if (!this.fallbackMail) {
      this.fallbackMail = new MailService(
        new MailSettingsConsumer(undefined, this.logger),
        this.logger,
      );
    }
    return this.fallbackMail;
  }

  private async send(input: MailInput): Promise<void> {
    const emailLog = await this.prisma.client.emailLog.create({
      data: {
        userId: input.userId ?? null,
        to: input.to,
        template: input.template,
        subject: input.subject,
        status: "queued",
      },
      select: { id: true },
    });

    try {
      const result = await this.mailer.send({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        // Reuses the EmailLog id so a retry is idempotent at the provider.
        idempotencyKey: emailLog.id,
      });
      await this.prisma.client.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: "sent",
          providerId: result.providerId?.slice(0, 200) ?? null,
        },
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code).slice(0, 64)
          : "UNKNOWN";
      await this.prisma.client.emailLog
        .update({
          where: { id: emailLog.id },
          data: {
            status: "failed",
            error: code === "NOT_CONFIGURED" ? "mail_not_configured" : `mail_${code.toLowerCase()}`,
          },
        })
        .catch(() => undefined);
      this.logger.error(
        {
          event: "email.delivery_failed",
          template: input.template,
          code,
        },
        "email.delivery_failed",
      );
      throw error;
    }
  }
}
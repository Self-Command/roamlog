import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service.js";
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

interface SmtpTransport {
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId?: string }>;
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

@Injectable()
export class EmailDeliveryService {
  private smtpTransport: SmtpTransport | undefined;
  private smtpLoadFailed = false;

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
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

  private async getSmtpTransport(): Promise<SmtpTransport | undefined> {
    if (!this.config.smtpHost || this.smtpLoadFailed) {
      return undefined;
    }
    if (this.smtpTransport) {
      return this.smtpTransport;
    }

    try {
      const packageName = "nodemailer";
      const { createTransport } = (await import(packageName)) as {
        createTransport: (options: Record<string, unknown>) => SmtpTransport;
      };
      this.smtpTransport = createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: false,
        ...(this.config.smtpUser && this.config.smtpPassword
          ? {
              auth: {
                user: this.config.smtpUser,
                pass: this.config.smtpPassword,
              },
            }
          : {}),
      });
      return this.smtpTransport;
    } catch (error) {
      this.smtpLoadFailed = true;
      this.logger.warn(
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "email.smtp_adapter_unavailable",
      );
      return undefined;
    }
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
      const providerId = await this.deliver(input, emailLog.id);
      await this.prisma.client.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: "sent",
          providerId: providerId?.slice(0, 200) ?? null,
        },
      });
    } catch (error) {
      await this.prisma.client.emailLog
        .update({
          where: { id: emailLog.id },
          data: {
            status: "failed",
            error: "Email delivery failed",
          },
        })
        .catch(() => undefined);
      this.logger.error(
        {
          template: input.template,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorCode:
            typeof error === "object" && error !== null && "code" in error
              ? String(error.code).slice(0, 64)
              : undefined,
        },
        "email.delivery_failed",
      );
      throw new Error("Email delivery failed", { cause: error });
    }
  }

  private async deliver(input: MailInput, deliveryId: string): Promise<string | undefined> {
    const smtp = await this.getSmtpTransport();
    if (smtp) {
      const result = await smtp.sendMail({
        from: this.config.emailFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return result.messageId;
    }

    const apiKey = this.config.resendApiKey;
    if (!apiKey || apiKey.includes("placeholder")) {
      throw new Error("No email delivery provider is configured");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": deliveryId,
      },
      body: JSON.stringify({
        from: this.config.emailFrom,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend rejected the email with status ${response.status}`);
    }

    const payload = (await response.json()) as { id?: unknown };
    return typeof payload.id === "string" ? payload.id : undefined;
  }
}

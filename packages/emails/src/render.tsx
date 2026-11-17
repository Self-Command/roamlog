import type { ReactElement } from "react";
import { render } from "@react-email/render";
import {
  InvitationEmail,
  MentionEmail,
  PasswordResetEmail,
  ReminderEmail,
  VerificationEmail,
  type InvitationEmailProps,
  type MentionEmailProps,
  type PasswordResetEmailProps,
  type ReminderEmailProps,
  type VerificationEmailProps,
} from "./templates/index.js";

export const EMAIL_TEMPLATE_IDS = [
  "workspace-invite",
  "verify-email",
  "reset-password",
  "mention",
  "trip-reminder",
] as const;

export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export interface EmailTemplateDataMap {
  "workspace-invite": InvitationEmailProps;
  "verify-email": VerificationEmailProps;
  "reset-password": PasswordResetEmailProps;
  mention: MentionEmailProps;
  "trip-reminder": ReminderEmailProps;
}

export interface RenderedEmail {
  id: EmailTemplateId;
  subject: string;
  html: string;
  text: string;
}

export const DEFAULT_EMAIL_FROM = "Roamlog <hello@roamlog.app>";

function subjectFor<Id extends EmailTemplateId>(id: Id, data: EmailTemplateDataMap[Id]): string {
  switch (id) {
    case "workspace-invite": {
      const invitation = data as InvitationEmailProps;
      return `${invitation.inviterName} 邀请你加入 ${invitation.workspaceName} · Roamlog`;
    }
    case "verify-email":
      return "验证你的 Roamlog 邮箱";
    case "reset-password":
      return "重置你的 Roamlog 密码";
    case "mention": {
      const mention = data as MentionEmailProps;
      return `${mention.actorName} 在 ${mention.tripTitle} 中提到了你 · Roamlog`;
    }
    case "trip-reminder": {
      const reminder = data as ReminderEmailProps;
      return `${reminder.tripTitle} 还有 ${reminder.daysUntilDeparture} 天出发 · Roamlog`;
    }
  }
}

function elementFor<Id extends EmailTemplateId>(
  id: Id,
  data: EmailTemplateDataMap[Id],
): ReactElement {
  switch (id) {
    case "workspace-invite":
      return <InvitationEmail {...(data as InvitationEmailProps)} />;
    case "verify-email":
      return <VerificationEmail {...(data as VerificationEmailProps)} />;
    case "reset-password":
      return <PasswordResetEmail {...(data as PasswordResetEmailProps)} />;
    case "mention":
      return <MentionEmail {...(data as MentionEmailProps)} />;
    case "trip-reminder":
      return <ReminderEmail {...(data as ReminderEmailProps)} />;
  }
}

export async function renderEmailTemplate<Id extends EmailTemplateId>(
  id: Id,
  data: EmailTemplateDataMap[Id],
): Promise<RenderedEmail> {
  const element = elementFor(id, data);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  return {
    id,
    subject: subjectFor(id, data),
    html,
    text,
  };
}

export const emailTemplateSamples = {
  "workspace-invite": {
    workspaceName: "North Star Studio",
    inviterName: "Mei Lin",
    role: "editor",
    inviteUrl: "https://app.roamlog.app/invite/sample-token",
    expiresInDays: 7,
  },
  "verify-email": {
    recipientName: "Jonas",
    verificationUrl: "https://app.roamlog.app/verify-email?token=sample-token",
    expiresInHours: 24,
  },
  "reset-password": {
    recipientName: "Mei Lin",
    resetUrl: "https://app.roamlog.app/reset-password?token=sample-token",
    expiresInMinutes: 30,
  },
  mention: {
    recipientName: "Jonas",
    actorName: "Mei Lin",
    workspaceName: "North Star Studio",
    tripTitle: "首尔，慢一点",
    entryTitle: "雨后的北村与一杯热茶",
    excerpt: "你上次说的那家茶室，我补进第三天的行程了。",
    commentUrl: "https://app.roamlog.app/trips/sample/entries/sample#comment-sample",
  },
  "trip-reminder": {
    recipientName: "Mei Lin",
    tripTitle: "京都，沿着鸭川散步",
    destination: "日本 · 京都",
    departureDate: "2026 年 11 月 24 日",
    daysUntilDeparture: 7,
    tripUrl: "https://app.roamlog.app/trips/sample",
  },
} as const satisfies EmailTemplateDataMap;

export async function renderSampleEmails(): Promise<RenderedEmail[]> {
  return Promise.all([
    renderEmailTemplate("workspace-invite", emailTemplateSamples["workspace-invite"]),
    renderEmailTemplate("verify-email", emailTemplateSamples["verify-email"]),
    renderEmailTemplate("reset-password", emailTemplateSamples["reset-password"]),
    renderEmailTemplate("mention", emailTemplateSamples.mention),
    renderEmailTemplate("trip-reminder", emailTemplateSamples["trip-reminder"]),
  ]);
}

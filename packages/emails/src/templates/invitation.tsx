import {
  EmailButton,
  EmailCallout,
  EmailFallbackLink,
  EmailLayout,
  EmailMeta,
  EmailParagraph,
} from "./layout.js";

export interface InvitationEmailProps {
  workspaceName: string;
  inviterName: string;
  role: "admin" | "editor" | "viewer";
  inviteUrl: string;
  expiresInDays?: number;
}

const roleLabel = {
  admin: "管理员",
  editor: "编辑者",
  viewer: "查看者",
} satisfies Record<InvitationEmailProps["role"], string>;

export function InvitationEmail({
  workspaceName,
  inviterName,
  role,
  inviteUrl,
  expiresInDays = 7,
}: InvitationEmailProps) {
  return (
    <EmailLayout
      preview={`${inviterName} 邀请你加入 ${workspaceName}`}
      eyebrow="Workspace invitation"
      title={`加入 ${workspaceName}`}
      footerNote="如果你不认识邀请人，可以安全地忽略这封邮件。"
    >
      <EmailParagraph>
        {inviterName} 邀请你以{roleLabel[role]}身份加入协作空间，一起维护旅行、日志与行程。
      </EmailParagraph>
      <EmailCallout>
        <EmailMeta label="空间" value={workspaceName} />
        <EmailMeta label="角色" value={roleLabel[role]} />
        <EmailMeta label="有效期" value={`${expiresInDays} 天`} />
      </EmailCallout>
      <EmailButton href={inviteUrl} label="接受邀请" />
      <EmailFallbackLink href={inviteUrl} />
    </EmailLayout>
  );
}

export default InvitationEmail;

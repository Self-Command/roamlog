import { EmailButton, EmailFallbackLink, EmailLayout, EmailParagraph } from "./layout.js";

export interface VerificationEmailProps {
  recipientName: string;
  verificationUrl: string;
  expiresInHours?: number;
}

export function VerificationEmail({
  recipientName,
  verificationUrl,
  expiresInHours = 24,
}: VerificationEmailProps) {
  return (
    <EmailLayout preview="验证你的 Roamlog 邮箱" eyebrow="Email verification" title="确认你的邮箱">
      <EmailParagraph>
        {recipientName}，你好。验证邮箱后，你才能完整使用邀请、评论提醒和旅行通知。
      </EmailParagraph>
      <EmailButton href={verificationUrl} label="验证邮箱" />
      <EmailFallbackLink href={verificationUrl} />
      <EmailParagraph>
        此链接将在 {expiresInHours} 小时后失效。如果不是你创建的账户，请忽略这封邮件。
      </EmailParagraph>
    </EmailLayout>
  );
}

export default VerificationEmail;

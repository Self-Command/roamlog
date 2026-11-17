import { EmailButton, EmailFallbackLink, EmailLayout, EmailParagraph } from "./layout.js";

export interface PasswordResetEmailProps {
  recipientName: string;
  resetUrl: string;
  expiresInMinutes?: number;
}

export function PasswordResetEmail({
  recipientName,
  resetUrl,
  expiresInMinutes = 30,
}: PasswordResetEmailProps) {
  return (
    <EmailLayout
      preview="重置你的 Roamlog 密码"
      eyebrow="Password reset"
      title="设置一个新密码"
      footerNote="安全通知：Roamlog 不会通过邮件向你索要密码或验证码。"
    >
      <EmailParagraph>{recipientName}，你好。我们收到了重置 Roamlog 密码的请求。</EmailParagraph>
      <EmailButton href={resetUrl} label="重置密码" />
      <EmailFallbackLink href={resetUrl} />
      <EmailParagraph>
        链接将在 {expiresInMinutes}{" "}
        分钟后失效，并且只能使用一次。如果你没有发起此请求，无需采取任何操作，现有密码不会被更改。
      </EmailParagraph>
    </EmailLayout>
  );
}

export default PasswordResetEmail;

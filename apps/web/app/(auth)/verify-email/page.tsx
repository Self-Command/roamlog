import type { Metadata } from "next";

import { AuthPageFrame } from "@/components/auth/auth-shell";
import { EmailLinkForm } from "@/components/auth/email-link-form";

export const metadata: Metadata = {
  title: "验证邮箱",
};

export default function VerifyEmailPage() {
  return (
    <AuthPageFrame
      eyebrow="EMAIL VERIFICATION"
      title="验证你的邮箱"
      description="使用邮箱和密码注册的账号需要先完成验证，才能创建工作区或接受邀请；通过第三方登录的邮箱视为已验证。"
      footer={
        <p className="text-center text-xs text-muted">
          验证完成后{" "}
          <a href="/login" className="text-ink underline-offset-4 hover:underline">
            返回登录
          </a>
        </p>
      }
    >
      <EmailLinkForm
        submitLabel="重新发送验证邮件"
        successMessage="验证邮件已发送。请检查收件箱并点击邮件中的链接完成验证。"
        intent="verify"
      />
    </AuthPageFrame>
  );
}

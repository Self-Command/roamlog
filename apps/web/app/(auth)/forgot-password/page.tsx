import type { Metadata } from "next";

import { AuthPageFrame } from "@/components/auth/auth-shell";
import { EmailLinkForm } from "@/components/auth/email-link-form";

export const metadata: Metadata = {
  title: "忘记密码",
};

export default function ForgotPasswordPage() {
  return (
    <AuthPageFrame
      eyebrow="ACCOUNT RECOVERY"
      title="找回账号访问"
      description="输入注册邮箱，我们会发送一封带一次性重置链接的邮件。链接 30 分钟内有效，且只能使用一次。"
      footer={
        <p className="text-center text-xs text-muted">
          想起密码了？{" "}
          <a href="/login" className="text-ink underline-offset-4 hover:underline">
            返回登录
          </a>
        </p>
      }
    >
      <EmailLinkForm
        submitLabel="发送重置链接"
        successMessage="如果该邮箱存在，重置链接已发送到收件箱。若几分钟内没有收到，请检查垃圾邮件或稍后重试。"
        intent="reset"
      />
    </AuthPageFrame>
  );
}

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
      description="邮箱密码账号需要先完成验证，才能创建 Workspace 或接受邀请。OAuth 已验证邮箱视为通过。"
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
        successMessage="验证邮件占位已提交。真实邮件发送、退信和重试将在 Worker 接入后启用。"
      />
    </AuthPageFrame>
  );
}

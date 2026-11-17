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
      description="输入注册邮箱。真实环境会发送一次性重置链接，当前仅执行邮箱格式校验。"
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
        successMessage="如果该邮箱存在，重置链接会发送到收件箱。当前为占位状态，不会发送邮件。"
        intent="reset"
      />
    </AuthPageFrame>
  );
}

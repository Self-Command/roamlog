import type { Metadata } from "next";

import { AuthPageFrame } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "重置密码",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthPageFrame
      eyebrow="CHOOSE A NEW PASSWORD"
      title="设置新密码"
      description="重置令牌通常只能使用一次。当前页面只验证两次输入是否一致，不会写回任何账号。"
      footer={
        <p className="text-center text-xs text-muted">
          需要新的链接？{" "}
          <a href="/forgot-password" className="text-ink underline-offset-4 hover:underline">
            重新发送
          </a>
        </p>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthPageFrame>
  );
}

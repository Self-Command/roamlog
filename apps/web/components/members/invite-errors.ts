import { isApiError } from "@/lib/api";

const INVITE_GENERIC_ERROR = "邀请发送失败，请稍后重试。如果持续失败，请联系工作区所有者或管理员。";
const INVITE_NETWORK_ERROR = "无法连接服务器，邀请没有发送。请检查网络连接后重试。";

/**
 * Maps the invitation endpoint's stable problem codes to user-facing guidance.
 * The dialog owns this copy so a failed invite can be explained without exposing
 * SMTP/provider details or keeping the error behind the modal overlay.
 */
export function inviteErrorMessage(cause: unknown): string {
  if (!isApiError(cause)) {
    return cause instanceof TypeError ? INVITE_NETWORK_ERROR : INVITE_GENERIC_ERROR;
  }

  switch (cause.code) {
    case "EMAIL_VERIFICATION_REQUIRED":
      return "请先完成邮箱验证，再邀请成员。";
    case "MEMBER_ALREADY_EXISTS":
      return "这个邮箱已经是工作区成员，无需重复邀请。";
    case "INVITATION_ALREADY_PENDING":
      return "这个邮箱已有一条待接受的邀请。请等待对方接受，或先撤销旧邀请。";
    case "INVITATION_DELIVERY_FAILED":
      return "邮件服务暂时不可用，邀请没有保存，也没有残留待接受邀请。请稍后重试；如果持续失败，请联系管理员检查邮件服务。";
    default:
      break;
  }

  if (cause.status === 403) {
    return "你没有邀请成员的权限。请联系工作区所有者或管理员。";
  }
  if (cause.status === 429) {
    return "邀请发送过于频繁，请稍后再试。";
  }
  if (cause.status === 422) {
    return "邀请信息不完整或不合法，请检查邮箱和角色后重试。";
  }
  if (cause.status === 0) {
    return INVITE_NETWORK_ERROR;
  }
  return INVITE_GENERIC_ERROR;
}

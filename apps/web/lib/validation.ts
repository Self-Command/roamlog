import { EmailSchema } from "@roamlog/contracts";

export function validateEmail(value: string): string | undefined {
  if (value.trim().length === 0) {
    return "请输入邮箱地址";
  }
  if (!EmailSchema.safeParse(value.trim()).success) {
    return "请输入有效的邮箱地址";
  }
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (value.length === 0) {
    return "请输入密码";
  }
  if (value.length < 8) {
    return "密码至少需要 8 位";
  }
  return undefined;
}

export function validateRequired(value: string, message: string): string | undefined {
  return value.trim().length === 0 ? message : undefined;
}

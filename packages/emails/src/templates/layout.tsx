import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

const colors = {
  canvas: "#f3f2ef",
  paper: "#ffffff",
  ink: "#121212",
  muted: "#66645f",
  faint: "#a6a39c",
  line: "#e4e1da",
  soft: "#f7f6f2",
} as const;

const font = {
  body: "Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export interface EmailLayoutProps {
  preview: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  footerNote?: string;
}

export function EmailLayout({ preview, eyebrow, title, children, footerNote }: EmailLayoutProps) {
  return (
    <Html lang="zh-CN">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.wordmark}>ROAMLOG</Text>
            <Text style={styles.headerMeta}>TRAVEL JOURNAL / NOTIFICATION</Text>
          </Section>
          <Hr style={styles.headerRule} />
          <Section style={styles.content}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Heading as="h1" style={styles.heading}>
              {title}
            </Heading>
            {children}
          </Section>
          <Hr style={styles.footerRule} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              {footerNote ?? "这是一封与你的 Roamlog 账户或协作空间相关的通知。"}
            </Text>
            <Text style={styles.footerText}>
              你可以在{" "}
              <Link href="https://app.roamlog.app/settings/notifications" style={styles.footerLink}>
                通知设置
              </Link>{" "}
              中调整邮件偏好。
            </Text>
            <Text style={styles.footerMeta}>Roamlog · 把旅行留在可协作的上下文里</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailButton({ href, label }: { href: string; label: string }) {
  return (
    <Section style={styles.buttonSection}>
      <Button href={href} style={styles.button}>
        {label}
      </Button>
    </Section>
  );
}

export function EmailParagraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

export function EmailFallbackLink({ href }: { href: string }) {
  return (
    <Text style={styles.fallback}>
      如果按钮无法打开，请复制此链接到浏览器：
      <br />
      <Link href={href} style={styles.fallbackLink}>
        {href}
      </Link>
    </Text>
  );
}

export function EmailMeta({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.meta}>
      <span style={styles.metaLabel}>{label}</span>
      <span>{value}</span>
    </Text>
  );
}

export function EmailCallout({ children }: { children: ReactNode }) {
  return <Section style={styles.callout}>{children}</Section>;
}

const styles: Record<string, CSSProperties> = {
  body: {
    margin: 0,
    padding: "32px 12px",
    backgroundColor: colors.canvas,
    color: colors.ink,
    fontFamily: font.body,
  },
  container: {
    width: "100%",
    maxWidth: "600px",
    margin: "0 auto",
    backgroundColor: colors.paper,
    border: `1px solid ${colors.line}`,
  },
  header: {
    padding: "28px 36px 18px",
  },
  wordmark: {
    margin: 0,
    color: colors.ink,
    fontFamily: font.mono,
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.2em",
  },
  headerMeta: {
    margin: "6px 0 0",
    color: colors.faint,
    fontFamily: font.mono,
    fontSize: "9px",
    letterSpacing: "0.08em",
  },
  headerRule: {
    margin: 0,
    borderColor: colors.line,
  },
  content: {
    padding: "32px 36px 36px",
  },
  eyebrow: {
    margin: "0 0 12px",
    color: colors.muted,
    fontFamily: font.mono,
    fontSize: "10px",
    lineHeight: "16px",
    letterSpacing: "0.13em",
    textTransform: "uppercase",
  },
  heading: {
    margin: "0 0 22px",
    color: colors.ink,
    fontFamily: font.serif,
    fontSize: "32px",
    fontWeight: 400,
    lineHeight: "1.18",
    letterSpacing: "-0.02em",
  },
  paragraph: {
    margin: "0 0 16px",
    color: "#35332f",
    fontSize: "15px",
    lineHeight: "24px",
  },
  buttonSection: {
    margin: "26px 0 24px",
  },
  button: {
    display: "inline-block",
    padding: "12px 20px",
    borderRadius: "3px",
    backgroundColor: colors.ink,
    color: colors.paper,
    fontSize: "14px",
    fontWeight: 600,
    lineHeight: "20px",
    textDecoration: "none",
  },
  fallback: {
    margin: "18px 0 20px",
    color: colors.muted,
    fontSize: "12px",
    lineHeight: "20px",
  },
  fallbackLink: {
    color: colors.ink,
    textDecoration: "underline",
    wordBreak: "break-all",
  },
  meta: {
    margin: "0 0 8px",
    color: colors.ink,
    fontSize: "13px",
    lineHeight: "20px",
  },
  metaLabel: {
    display: "inline-block",
    width: "110px",
    color: colors.faint,
    fontFamily: font.mono,
    fontSize: "9px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  callout: {
    margin: "20px 0",
    padding: "16px 18px",
    backgroundColor: colors.soft,
    borderLeft: `2px solid ${colors.ink}`,
  },
  footerRule: {
    margin: 0,
    borderColor: colors.line,
  },
  footer: {
    padding: "22px 36px 28px",
  },
  footerText: {
    margin: "0 0 8px",
    color: colors.muted,
    fontSize: "11px",
    lineHeight: "18px",
  },
  footerLink: {
    color: colors.ink,
    textDecoration: "underline",
  },
  footerMeta: {
    margin: "16px 0 0",
    color: colors.faint,
    fontFamily: font.mono,
    fontSize: "9px",
    lineHeight: "16px",
    letterSpacing: "0.04em",
  },
};

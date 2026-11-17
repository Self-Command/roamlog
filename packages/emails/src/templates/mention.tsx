import {
  EmailButton,
  EmailCallout,
  EmailFallbackLink,
  EmailLayout,
  EmailMeta,
  EmailParagraph,
} from "./layout.js";

export interface MentionEmailProps {
  recipientName: string;
  actorName: string;
  workspaceName: string;
  tripTitle: string;
  entryTitle: string;
  excerpt: string;
  commentUrl: string;
}

export function MentionEmail({
  recipientName,
  actorName,
  workspaceName,
  tripTitle,
  entryTitle,
  excerpt,
  commentUrl,
}: MentionEmailProps) {
  return (
    <EmailLayout
      preview={`${actorName} 在 ${tripTitle} 中提到了你`}
      eyebrow="Mention"
      title={`${actorName} 提到了你`}
    >
      <EmailParagraph>
        {recipientName}，你好。协作空间里有一条新的提及和回复等待你查看。
      </EmailParagraph>
      <EmailCallout>
        <EmailMeta label="空间" value={workspaceName} />
        <EmailMeta label="旅行" value={tripTitle} />
        <EmailMeta label="日志" value={entryTitle} />
        <EmailMeta label="内容" value={excerpt} />
      </EmailCallout>
      <EmailButton href={commentUrl} label="查看评论" />
      <EmailFallbackLink href={commentUrl} />
    </EmailLayout>
  );
}

export default MentionEmail;

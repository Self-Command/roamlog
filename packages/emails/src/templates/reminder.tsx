import {
  EmailButton,
  EmailCallout,
  EmailFallbackLink,
  EmailLayout,
  EmailMeta,
  EmailParagraph,
} from "./layout.js";

export interface ReminderEmailProps {
  recipientName: string;
  tripTitle: string;
  destination: string;
  departureDate: string;
  daysUntilDeparture: number;
  tripUrl: string;
}

export function ReminderEmail({
  recipientName,
  tripTitle,
  destination,
  departureDate,
  daysUntilDeparture,
  tripUrl,
}: ReminderEmailProps) {
  return (
    <EmailLayout
      preview={`${tripTitle} 还有 ${daysUntilDeparture} 天出发`}
      eyebrow="Trip reminder"
      title={`${tripTitle} 即将出发`}
    >
      <EmailParagraph>
        {recipientName}，你好。距离出发还有 {daysUntilDeparture}{" "}
        天，可以检查行程、打包清单和协作伙伴的分工了。
      </EmailParagraph>
      <EmailCallout>
        <EmailMeta label="目的地" value={destination} />
        <EmailMeta label="出发日期" value={departureDate} />
        <EmailMeta label="倒计时" value={`${daysUntilDeparture} 天`} />
      </EmailCallout>
      <EmailButton href={tripUrl} label="打开旅行" />
      <EmailFallbackLink href={tripUrl} />
    </EmailLayout>
  );
}

export default ReminderEmail;

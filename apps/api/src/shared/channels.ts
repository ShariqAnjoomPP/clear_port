import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from '../config';

/** Strategy: one sender per channel. Without credentials, messages are logged instead of sent (local/demo). */
export interface ChannelSender {
  send(msg: { recipient: string; title: string; body: string; link?: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}

const consoleSender = (channel: string): ChannelSender => ({
  async send(m) {
    console.log(JSON.stringify({ level: 'info', channel, to: m.recipient, title: m.title, body: m.body, link: m.link }));
    return { ok: true };
  },
});

class WhatsAppCloudSender implements ChannelSender {
  async send(m: { recipient: string; title: string; body: string; link?: string }) {
    // Production uses approved templates; free-form text works inside the 24 h customer-service window.
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: m.recipient.replace(/[^\d]/g, ''), type: 'text', text: { body: `*${m.title}*\n${m.body}${m.link ? `\n${m.link}` : ''}` } }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ({ ok: true } as const) : ({ ok: false, error: `WhatsApp ${res.status}` } as const);
  }
}

class SesSender implements ChannelSender {
  private ses = new SESv2Client({ region: config.AWS_REGION });
  async send(m: { recipient: string; title: string; body: string; link?: string }) {
    try {
      await this.ses.send(new SendEmailCommand({
        FromEmailAddress: config.SES_FROM_ADDRESS,
        Destination: { ToAddresses: [m.recipient] },
        Content: { Simple: { Subject: { Data: m.title }, Body: { Text: { Data: `${m.body}${m.link ? `\n\n${m.link}` : ''}` } } } },
      }));
      return { ok: true } as const;
    } catch (e) {
      return { ok: false, error: (e as Error).message } as const;
    }
  }
}

export const channels: Record<'WHATSAPP' | 'EMAIL' | 'SMS', ChannelSender> = {
  WHATSAPP: config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID ? new WhatsAppCloudSender() : consoleSender('WHATSAPP'),
  EMAIL: config.SES_FROM_ADDRESS ? new SesSender() : consoleSender('EMAIL'),
  SMS: consoleSender('SMS'),
};

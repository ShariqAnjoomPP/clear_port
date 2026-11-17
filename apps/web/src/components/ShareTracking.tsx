import { Link2, MessageCircle } from 'lucide-react';
import { Button, useSnackbar } from './ui';

/** The one public tracking page every customer uses with their mobile number. */
export const trackingUrl = () => `${window.location.origin}/track`;

/** "Share tracking link": WhatsApp with a ready message, or copy the link. */
export function ShareTracking({ blNo, phone }: { blNo?: string; phone?: string | null }) {
  const snackbar = useSnackbar();
  const text = `${blNo ? `Track your shipment B/L ${blNo}` : 'Track your shipments'} at ${trackingUrl()} using your mobile number.`;
  const wa = `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(trackingUrl());
      snackbar.show('Tracking link copied');
    } catch {
      snackbar.show(trackingUrl());
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-primary-container px-4 text-sm font-medium text-on-primary-container">
        <MessageCircle className="size-4" /> Share tracking
      </a>
      <Button size="sm" variant="ghost" onClick={() => void copy()}><Link2 className="size-4" /> Copy link</Button>
    </div>
  );
}

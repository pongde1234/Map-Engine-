/**
 * Says so when a time command (play, pause, seek, live) cannot be sent because the engine is not
 * connected, instead of the button doing nothing. One toast at a time: a held key does not stack them.
 */
import { useEffect, useRef } from 'react';
import { useToast } from '@faclon-labs/fds';
import { useClient } from '@me/map-react';

export function DroppedCommands() {
  const client = useClient();
  const toast = useToast();
  const last = useRef(0);
  useEffect(
    () =>
      client.onDropped((what) => {
        const now = performance.now();
        if (now - last.current < 2500) return;
        last.current = now;
        toast.show({ color: 'Negative', content: `“${what}” was not sent: the engine is not connected.` });
      }),
    [client, toast],
  );
  return null;
}

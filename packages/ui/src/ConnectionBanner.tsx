/**
 * The link to the engine, said once for every view: connecting on the first load, and, once it
 * has been up and drops, that the picture is held where it stopped (the clock does not run on
 * with no data) and that commands are not being sent. It leaves by itself when the link returns.
 */
import { Alert } from '@faclon-labs/fds';
import { useClient, useClientTick } from '@me/map-react';
import { stamp } from './format.ts';

export function ConnectionBanner() {
  const client = useClient();
  useClientTick(500);
  if (client.conn === 'open') return null;
  const clock = client.scenario?.clock;
  return (
    <div className="bs-conn">
      {client.lost ? (
        <Alert
          color="Negative"
          emphasis="Subtle"
          isFullWidth
          title="Connection to the engine lost"
          description={`Retrying. The picture is held at ${stamp(client.lost.t, clock)}; time and edits are not sent until the link returns.`}
        />
      ) : (
        <Alert color="Information" emphasis="Subtle" isFullWidth title="Connecting to the engine" description="The picture opens as soon as the link is up." />
      )}
    </div>
  );
}

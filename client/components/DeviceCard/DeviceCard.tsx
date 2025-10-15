import { Link } from "@tanstack/react-router";
import styles from "./DeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";
import OrtusIcon from "../../icons/Ortus.tsx/Ortus";
import { client } from "../../lib/apiClient";

type Device = (typeof client.api.allDevices.types.data.devices)[number];

export default function DeviceCard({
  id,
  name,
  created_at,
  mac_address,
  last_seen,
  online,
}: Device) {
  const statusDot = (
    <span
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: online ? "green" : "red",
        marginRight: "6px",
      }}
    />
  );

  const onlineLabel = online
    ? "Online now"
    : last_seen
      ? `Went offline ${formatLastSeen(last_seen)}`
      : "Offline";

  const statusText =
    !online && created_at < Date.now() + 1000 * 60
      ? "Connecting to your wifi..."
      : onlineLabel;

  return (
    <Link
      className={styles.card}
      key={id}
      to="/device/$id"
      viewTransition={{ types: ["slide-left"] }}
      params={{ id: id.toString() }}
    >
      <Group spacing="2xl">
        <OrtusIcon height={100} />
        <Group direction="column" spacing="md">
          <Text size="xs" color="muted">
            {statusDot} {statusText}
          </Text>

          <Group align="center">
            <Text size="lg">{name}</Text>
            <Text size="xs" color="muted">
              ID: {mac_address}
            </Text>
          </Group>
        </Group>
      </Group>
    </Link>
  );
}

function formatLastSeen(last_seen: number): string {
  if (!last_seen) return "at an unknown time";

  const date = new Date(last_seen * 1000);
  const now = new Date();

  // Calculate difference in days
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);

  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfDate.getTime()) / 86400000
  );

  // Time part without seconds
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffDays === 0) return `today at ${time}`;
  if (diffDays === 1) return `yesterday at ${time}`;
  if (diffDays < 7) {
    const weekday = new Intl.DateTimeFormat([], { weekday: "long" }).format(
      date
    );
    return `${weekday} at ${time}`;
  }

  const formattedDate = new Intl.DateTimeFormat([], {
    dateStyle: "medium",
  }).format(date);
  return `${formattedDate} at ${time}`;
}

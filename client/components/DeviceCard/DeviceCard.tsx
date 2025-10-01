import { Link } from "@tanstack/react-router";
import styles from "./DeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";
import OrtusIcon from "../../icons/Ortus.tsx/Ortus";

type Device = {
  id: number;
  name: string;
  mac_address: string;
  last_seen: number | null;
  number_of_plants?: number | null;
};

export default function DeviceCard({
  id,
  name,
  mac_address,
  last_seen,
  number_of_plants,
}: Device) {
  let statusDot = null;

  if (last_seen) {
    const seenDate = new Date(last_seen * 1000);
    const diffMs = Date.now() - seenDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    const isOnline = diffSec <= 30;
    statusDot = (
      <span
        style={{
          display: "inline-block",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: isOnline ? "green" : "red",
          marginRight: "6px",
        }}
      />
    );
  }

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
            {statusDot}{" "}
            {last_seen ? `Online ${formatLastSeen(last_seen)}` : "Offline"}
          </Text>

          <Group align="center">
            <Text size="lg">{name}</Text>
            <Text size="xs"> - {mac_address}</Text>
          </Group>

          <Text size="sm" color="muted">
            {number_of_plants
              ? `${number_of_plants} plant(s)`
              : "No plants added"}
          </Text>
        </Group>
      </Group>
    </Link>
  );
}

function formatLastSeen(last_seen: number): string {
  if (!last_seen) return "Offline";

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

  if (diffDays === 0) return `today ${time}`;
  if (diffDays === 1) return `yesterday ${time}`;
  if (diffDays < 7) {
    const weekday = new Intl.DateTimeFormat([], { weekday: "long" }).format(
      date
    );
    return `${weekday} ${time}`;
  }

  const formattedDate = new Intl.DateTimeFormat([], {
    dateStyle: "medium",
  }).format(date);
  return `${formattedDate} ${time}`;
}

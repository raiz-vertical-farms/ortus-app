import { Link } from "@tanstack/react-router";
import styles from "./DeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";

type Device = {
  id: number;
  name: string;
  unique_id: string;
  light_state: string | null;
  last_seen: string | null;
  number_of_plants?: number | null;
};

export default function DeviceCard({
  id,
  name,
  unique_id,
  light_state,
  last_seen,
  number_of_plants,
}: Device) {
  let statusDot = null;
  let timeAgo = "never";

  if (last_seen) {
    const seenDate = new Date(last_seen);
    const diffMs = Date.now() - seenDate.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    const isOnline = diffSec <= 30;
    statusDot = (
      <span
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: isOnline ? "green" : "red",
          marginRight: "6px",
        }}
      />
    );

    if (diffSec < 60) {
      timeAgo = `${diffSec} second${diffSec !== 1 ? "s" : ""} ago`;
    } else if (diffSec < 3600) {
      const minutes = Math.floor(diffSec / 60);
      timeAgo = `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    } else if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      timeAgo = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    } else {
      const days = Math.floor(diffSec / 86400);
      timeAgo = `${days} day${days !== 1 ? "s" : ""} ago`;
    }
  }

  return (
    <Link
      className={styles.card}
      key={id}
      to="/device/$id"
      params={{ id: id.toString() }}
    >
      <Group align="center" spacing="5">
        <Text size="lg">{name}</Text>
        <Text size="sm" color="muted">
          {statusDot} - {timeAgo}
        </Text>
        <Text size="sm" color="muted">
          {number_of_plants
            ? `${number_of_plants} plant(s)`
            : "No plants added"}
        </Text>
      </Group>
    </Link>
  );
}

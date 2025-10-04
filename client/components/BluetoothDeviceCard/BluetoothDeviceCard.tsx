import styles from "./BluetoothDeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";

export default function BluetoothDeviceCard({
  name,
  deviceId,
  onClick,
}: {
  deviceId: string;
  name: string;
  onClick: () => void;
}) {
  return (
    <div className={styles.card} onClick={onClick}>
      <Group direction="column" spacing="md">
        <Text size="lg">{name || "Unknown Device"}</Text>
        <Text size="xs" color="muted">
          {deviceId}
        </Text>
      </Group>
    </div>
  );
}

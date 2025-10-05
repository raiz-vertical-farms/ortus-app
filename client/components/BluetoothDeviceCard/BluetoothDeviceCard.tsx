import styles from "./BluetoothDeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";

export default function BluetoothDeviceCard({
  name,
  onClick,
}: {
  name: string;
  onClick: () => void;
}) {
  return (
    <button className={styles.card} onClick={onClick}>
      <Group direction="column" spacing="md">
        <Text size="lg">{name || "Unnamed Ortus"}</Text>
        <Text size="sm" color="muted">
          Tap to connect
        </Text>
      </Group>
    </button>
  );
}

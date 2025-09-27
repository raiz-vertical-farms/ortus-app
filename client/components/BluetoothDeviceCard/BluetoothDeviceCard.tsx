import styles from "./BluetoothDeviceCard.module.css";
import { Text } from "../../primitives/Text/Text";
import { Group } from "../../primitives/Group/Group";
import { ScanResult } from "@capacitor-community/bluetooth-le";

export default function BluetoothDeviceCard({
  result,
  onClick,
}: {
  result: ScanResult;
  onClick: () => void;
}) {
  return (
    <div className={styles.card} onClick={onClick}>
      <Group direction="column" spacing="2">
        <Text size="lg">{result.device.name || "Unknown Device"}</Text>
        <Text size="xs" color="muted">
          {result.device.deviceId}
        </Text>
      </Group>
    </div>
  );
}

import { LightbulbIcon } from "@phosphor-icons/react";
import styles from "./LightSwitch.module.css";
import { Text } from "../../primitives/Text/Text";
import { classNames } from "../../utils/classnames";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export default function LightSwitch(props: Props) {
  return (
    <button
      className={classNames(styles.container, {
        [styles.on]: props.checked,
      })}
      onClick={() => props.onChange(!props.checked)}
    >
      <div className={styles.inner}>
        <LightbulbIcon className={styles.icon} weight="fill" size={60} />
        <Text size="sm">{props.checked ? "On" : "Off"}</Text>
      </div>
    </button>
  );
}

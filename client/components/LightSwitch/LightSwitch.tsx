import { LightbulbIcon, PowerIcon } from "@phosphor-icons/react";
import styles from "./LightSwitch.module.css";
import { Text } from "../../primitives/Text/Text";
import { classNames } from "../../utils/classnames";
import { RoundSlider } from "mz-react-round-slider";
import Color from "color";

type Props = {
  brightness: number; // 0–100
  onChange: (value: number) => void;
};

export default function LightSwitch(props: Props) {
  const indicatorColor = Color("#ffbb00ff")
    .alpha(props.brightness / 100)
    .hsl()
    .string();

  const powerIconColor = Color("#ffbb00ff")
    .darken(1 - props.brightness / 100)
    .hex();

  return (
    <div className={styles.wrapper}>
      <RoundSlider
        pathStartAngle={120}
        pathEndAngle={420}
        min={0}
        max={100}
        pathBgColor="rgb(234 232 220)"
        pathThickness={40}
        pointerBorder={4}
        pointerRadius={15}
        hideText
        pointerBorderColor="#fff"
        pointerBgColor="#ffbb00ff"
        pointerBgColorSelected="#ffbb00ff"
        connectionBgColor={indicatorColor}
        pointers={[{ value: props.brightness }]}
        onChange={(val) => {
          val.forEach((v) => {
            if (typeof v.value === "number") {
              console.log(v.value);
              props.onChange(v.value);
            }
          });
        }}
      ></RoundSlider>
      <div className={styles.buttonWrapper}>
        <button
          className={classNames(styles.button, {
            [styles.off]: props.brightness === 0,
            [styles.on]: props.brightness > 0,
          })}
          onClick={(e) => {
            e.stopPropagation();
            console.log("clicked?");
            props.onChange(props.brightness === 0 ? 100 : 0);
          }}
        >
          <div className={styles.inner}>
            <PowerIcon
              className={styles.icon}
              color={powerIconColor}
              size={60}
            />
            <Text size="sm">
              {props.brightness > 0 ? `${props.brightness}%` : "Lights off"}
            </Text>
          </div>
        </button>
      </div>
    </div>
  );
}

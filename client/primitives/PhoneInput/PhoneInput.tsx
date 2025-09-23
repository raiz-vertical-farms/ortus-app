import { PhoneInput, PhoneInputProps } from "react-international-phone";
import "react-international-phone/style.css";
import styles from "./PhoneInput.module.css";

interface Props extends PhoneInputProps {
  label?: string;
}

export default function PhoneInputWrapper(props: Props) {
  return (
    <div style={{ width: "100%" }}>
      {props?.label && <label>{props.label}</label>}
      <PhoneInput
        className={styles.phoneInput}
        countrySelectorStyleProps={{
          buttonStyle: {
            padding: "0 1rem",
          },
        }}
        autoFocus
        style={{ width: "100%" }}
        defaultCountry={window.navigator.language.split("-")[1] || "us"}
        inputStyle={{ width: "100%" }}
        {...props}
      />
    </div>
  );
}

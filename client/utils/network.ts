import { CapacitorWifiConnect } from "@falconeta/capacitor-wifi-connect";

export async function getCurrentSSID() {
  let { value } = await CapacitorWifiConnect.checkPermission();
  if (value === "prompt") {
    const data = await CapacitorWifiConnect.requestPermission();
    value = data.value;
    if (value === "granted") {
      return CapacitorWifiConnect.getDeviceSSID().then((data) => {
        return data.value;
      });
    } else {
      throw new Error("Permission denied");
    }
  }
  if (value === "granted") {
    return CapacitorWifiConnect.getDeviceSSID().then((data) => {
      return data.value;
    });
  }

  throw new Error("Permission denied");
}

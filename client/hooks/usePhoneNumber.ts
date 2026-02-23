import { useUser } from "@clerk/clerk-react";

export default function usePhoneNumber() {
  const { user } = useUser();

  const updatePhone = async (number: string) => {
    await user?.createPhoneNumber({ phoneNumber: number });
  };

  return {
    hasVerifiedPhoneNumber: user?.hasVerifiedPhoneNumber ? true : false,
    updatePhone,
  };
}

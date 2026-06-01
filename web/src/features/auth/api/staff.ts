import { doc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "../../../shared/firebase";
import type { StaffProfileInput } from "../../../shared/types/staff";

export async function saveStaffProfile(
  uid: string,
  profile: StaffProfileInput,
): Promise<void> {
  await setDoc(doc(getFirebaseDb(), "staff", uid), profile, { merge: true });
}

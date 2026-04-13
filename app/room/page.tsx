import { randomUUID } from "crypto";
import { redirect } from "next/navigation";

export default function NewRoomPage() {
  redirect(`/room/${randomUUID()}`);
}

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function NewRoomPage() {
  redirect(`/room/${randomUUID()}`);
}


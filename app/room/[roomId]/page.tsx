import { WatchRoomClient } from "@/components/watch-room-client";

type RoomPageProps = {
  params: Promise<{ roomId: string }>;
};

export default async function RoomByIdPage({ params }: RoomPageProps) {
  const { roomId } = await params;
  return <WatchRoomClient roomId={roomId} />;
}

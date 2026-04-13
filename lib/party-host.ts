export function getPartyKitHost(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PARTYKIT_HOST) {
    return process.env.NEXT_PUBLIC_PARTYKIT_HOST;
  }
  if (typeof window !== "undefined" && (window as unknown as { __PARTYKIT_HOST__?: string }).__PARTYKIT_HOST__) {
    return (window as unknown as { __PARTYKIT_HOST__: string }).__PARTYKIT_HOST__;
  }
  return "127.0.0.1:1999";
}

"use client";

import { Barlow_Condensed } from "next/font/google";
import { useRouter } from "next/navigation";

const logoFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: "700",
  style: "italic",
});

export default function Home() {
  const router = useRouter();

  return (
    <div
      className="relative flex min-h-screen items-center justify-center"
      style={{
        backgroundColor: "#2a0f44",
        backgroundImage: "linear-gradient(135deg, #2a0f44 0%, #5c2a72 52%, #f2a42a 100%)",
      }}
    >
      <div className="absolute left-12 top-8">
        <div className={`relative text-white drop-shadow-md ${logoFont.className}`}>
          <span className="block text-3xl uppercase leading-none tracking-[0.18em]">
            Side
          </span>
          <span className="ml-6 mt-1 block text-3xl uppercase leading-none tracking-[0.18em]">
            By
          </span>
          <span className="ml-12 mt-1 block text-3xl uppercase leading-none tracking-[0.18em]">
            Side
          </span>
          <span className="pointer-events-none absolute left-0 top-1/2 h-[2px] w-[10.5rem] -translate-y-1/2 bg-white/80" />
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          router.push(`/room/${crypto.randomUUID()}`);
        }}
        className="inline-flex cursor-pointer items-center gap-3 rounded-2xl border border-white/35 bg-white/10 px-10 py-5 text-xl font-semibold text-white shadow-2xl backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="text-3xl leading-none">+</span>
        <span>Create new room</span>
      </button>
    </div>
  );
}

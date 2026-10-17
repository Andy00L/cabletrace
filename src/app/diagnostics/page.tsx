import type { Metadata } from "next";
import { MapProbe } from "@/components/diagnostics/MapProbe";
import { SceneProbe } from "@/components/diagnostics/SceneProbe";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "Diagnostics",
  description: "Checks that the CableTrace map and 3D seabed render in this browser, with the graphics renderer and frame time.",
};

export default function DiagnosticsPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 pt-8 pb-16 sm:px-16 sm:pt-14">
      <SiteHeader />
      <section className="flex max-w-[640px] flex-col gap-3">
        <h1 className="text-title">Diagnostics</h1>
        <p className="text-body text-muted">
          CableTrace draws its map and its 3D seabed with WebGL. This page runs both in this browser and reports which graphics
          renderer did the work and how long each frame took.
        </p>
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <MapProbe />
        <SceneProbe />
      </div>
    </main>
  );
}

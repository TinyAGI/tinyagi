"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { usePolling } from "@/lib/hooks";
import { checkConnection } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hideSidebar = pathname === "/setup" || pathname === "/connect";

  const { data: connected, loading } = usePolling(checkConnection, 5000);

  useEffect(() => {
    if (loading) return;
    if (connected === false && pathname !== "/connect") {
      router.replace("/connect");
    }
  }, [connected, loading, pathname, router]);

  return (
    <div className="flex h-screen overflow-hidden">
      {!hideSidebar && <Sidebar />}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

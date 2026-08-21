import { createFileRoute } from "@tanstack/react-router";
import { SafeBuyApp } from "@/components/safebuy/safe-buy-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <SafeBuyApp />;
}

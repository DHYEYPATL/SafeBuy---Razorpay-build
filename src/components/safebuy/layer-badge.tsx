import { Badge } from "@/components/ui/badge";
import type { LayerKind } from "@/lib/safebuy/types";

export function LayerBadge({ layer }: { layer: LayerKind }) {
  return layer === "live" ? <Badge tone="live">Live unique</Badge> : <Badge tone="synth">Synthetic</Badge>;
}

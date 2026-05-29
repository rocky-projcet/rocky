import type { ConnectorState } from "../../../shared/lib/agent-engine-client.js";

export function hasAvailableInstagramPublishCapability(
  state: ConnectorState | null | undefined,
): boolean {
  return (
    state?.capabilities.some(
      (capability) =>
        capability.id === "instagram.media.publish" &&
        capability.action === "write" &&
        capability.status === "available" &&
        capability.requiresApproval === true,
    ) === true
  );
}

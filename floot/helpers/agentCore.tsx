import { enqueueUserMessage } from "./agentCoreUtils";
import { agentTurnStep } from "./agentTurnStep";
import { reactivateStalledAgent } from "./reactivation";

// Indirection layer: the queueTask handler (agentBackgroundStep) and every
// inbound path call agentCore.* so the concrete turn implementation can be
// swapped (e.g. a different model) without renaming the stable queueTask name.
export const agentCore = {
  enqueueUserMessage,
  agentBackgroundStep: agentTurnStep,
  reactivateStalledAgent,
};

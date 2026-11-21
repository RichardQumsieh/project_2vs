/**
 * The inbox assistant runs whenever the agent kill switch is on.
 * BILLING_ENABLED must not turn it off. Model calls still need
 * SOPHIA_MODEL_API_KEY and an HTTPS SOPHIA_MODEL_BASE_URL; without them the
 * assistant uses the built-in planner and does not call a paid model.
 */
export function agentTurnAllowed(input: {
  agentEnabled: boolean;
  billingEnabled: boolean;
}): boolean {
  const billingDoesNotGate = input.billingEnabled === true || input.billingEnabled === false;
  return input.agentEnabled && billingDoesNotGate;
}

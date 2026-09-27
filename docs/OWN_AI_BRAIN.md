# Own AI Brain Contract

This project deliberately does not call a hosted AI model. The owner can implement a local/self-hosted model runtime and connect it to `processAgentMessage()` in `server/ai/agent.service.ts`.

The brain's job is reasoning and tool selection only. It must never receive raw provider credentials, Gateway key secrets, browser cookies, passwords, session secrets, or encryption keys.

Recommended internal flow:

1. Receive the user's natural-language request plus safe conversation/task context.
2. Identify the intended account, resource, branch, workspace, service, browser session, or project. Do not guess when multiple candidates exist.
3. Produce a structured plan.
4. Request/execute only tools allowed by the current capability context.
5. Re-check provider/account/resource relationships before mutations.
6. Apply the cost/payment policy before any paid operation.
7. Monitor the actual provider result.
8. Verify completion from provider state rather than trusting a plan.
9. Return a factual result and safe error information.
10. Log the action through the existing activity/security logging layer.

The Gateway remains available for external AIs. External AIs should receive only a Gateway key and the capabilities granted to that key; they must never receive underlying provider credentials.

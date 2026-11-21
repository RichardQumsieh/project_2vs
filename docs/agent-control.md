# Sophia agent control

Sophia can run the app from the inbox command bar. The owner asked for full control, so that mode is the default. Ask first is available on the same bar.

## Where the agent runs

The plan loop runs in the signed-in browser. Sending and reading chat messages uses the keys already on that device. The server does not decrypt chats, and it does not execute tools.

`POST /sophia/agent/complete` only asks the model for the next step. The API key stays on the server. The browser then performs the tool with the signed-in session.

End-to-end chat plaintext is not included in that request unless the person turns on **Allow Sophia to read my chats**. That checkbox starts off. The purpose text says decrypted messages from this browser can be sent to the model as untrusted data. Turning it off again stops attaching those excerpts. The server also strips any `<untrusted source="chat">` block when the grant is missing, so a modified client cannot sneak a chat excerpt through.

Email, web, calendar, and chat text are wrapped as `<untrusted source="...">` data. The system prompt tells the model that text inside those tags is data, not instructions.

## What Sophia can do

Typed tools cover chats and groups (create, send, rename, add or remove a member, promote, demote, leave), files selected on this device, theme, density, draft voice, language and reduced motion, safety-number status, workspaces (create, invite, revoke, role, remove), the current plan, an upgrade link, mail draft and send, calendar create, reschedule, and decline, the daily brief, and the activity log.

Marking a safety number verified is not a tool. That comparison stays a person-on-the-device ceremony. A model request to mark one verified is refused.

File sends use a file the person picked in the bar. The filename has to match. Sophia does not read a path supplied by the model.

Mail and calendar writes go through the existing approval helpers. They run without a second tap only when both of these are true:

- the person's autonomy is Full control
- `INTEGRATIONS_WRITE_ENABLED` is true for that account

If the write flag is off, the action is refused and nothing is sent. Ask first still runs read-only tools (file list, safety status, plan, daily brief, activity) and waits before anything that changes state.

## Autonomy, stop, and undo

- **Full control** is the default when the person has no saved preference. Sophia executes tool calls without a confirmation step.
- **Ask first** shows a Confirm button on the step before a change runs.
- **Stop** aborts the plan in this browser and sets a halt on the account. The next command clears the halt.
- `SOPHIA_AGENT_ENABLED=false` turns the agent off for the whole server. Unset, empty, and `true` leave it on. `GET /health` reports `sophiaAgent`.

Every finished step is written to the activity log: tool name, a short summary with bodies, tokens, and secrets removed, and the result. Reversible steps keep Undo:

- a sent message or file is deleted for everyone when the send returned a message id
- a rename, membership change, role, theme, density, draft voice, setting, workspace role, invite, calendar reschedule, created event, or brief time is put back

Leaving a group, removing a workspace member, a sent email, and opening a billing link are not silently undone.

## Model

Without `SOPHIA_MODEL_API_KEY` and an HTTPS `SOPHIA_MODEL_BASE_URL`, the complete route uses the mock planner. No outbound model call is made. `SOPHIA_MODEL_NAME` defaults to `grok-4`.

The real client speaks OpenAI-compatible chat completions, including tool calls and streaming. It retries transient failures, bounds the prompt by a token estimate, and times out.

## Eval and the Experimental label

CI runs:

```bash
cd frontend && npm run eval:assistant -- --mode=mock
```

That checks the harness only. It does not clear the label.

To score a hosted model:

```bash
cd frontend
SOPHIA_MODEL_API_KEY=... SOPHIA_MODEL_BASE_URL=https://... npm run eval:assistant -- --mode=real
npm run eval:score
```

`--mode=real` exits with an error if the average is under 0.8. A passing real run writes `frontend/lib/ai/assistant-quality-record.json`. The Experimental badge stays until that file records `passed: true` and an average of at least 0.8. A mock run does not write the record.

## Database

There is no migration folder. After pulling this change, generate the client and push the schema:

```bash
cd backend
npx prisma generate
npx prisma db push
```

That adds `SophiaAgentPreference` and the activity actions `AGENT_ACTION` and `AGENT_UNDONE`.

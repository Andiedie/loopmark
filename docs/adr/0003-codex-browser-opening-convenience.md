# ADR 0003: Codex Browser Opening Convenience

Status: accepted.

Loopmark may use Codex Desktop's already-available in-app browser controls as a browser opening convenience: after creating a session, an agent should open the Fill URL in Codex Desktop when the tool is available, still provide the Fill URL as a fallback, and then end the turn until the Human pastes Answer Text. Non-Codex agents continue sending the Fill URL normally, and secret sessions use the same opening behavior because the agent does not inspect the page or receive secret plaintext. This is an agent skill behavior rather than CLI runtime detection, does not require page inspection or screenshots, does not create a Codex-specific transport, does not change the CLI, and deliberately rejects automatic continuation through MCP, app-server, hooks, polling, or browser submit callbacks because current Codex Desktop behavior does not reliably append externally created turns to the visible chat.

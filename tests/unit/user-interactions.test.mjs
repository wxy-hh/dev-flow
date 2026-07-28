import assert from "node:assert/strict";
import test from "node:test";
import { loadSource } from "../helpers/load-source.mjs";

const interactions = await loadSource("plugins/dev-flow/src/core/user-interactions.ts");

test("one-time interaction tokens bind action, require feedback, and cannot be replayed", () => {
  const state = { interactions: {} };
  const interaction = interactions.createInteraction(state, {
    kind: "gate",
    target: "gate:requirement_confirmation",
    basisHash: "basis",
    options: [
      { id: "confirm", label: "确认需求" },
      { id: "request-changes", label: "提出修改意见", requiresComment: true },
    ],
  });
  assert.match(interactions.fallbackHint(interaction), /^确认需求: DF-/);
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, "DF-NOT-THE-TOKEN confirm", "codex", "event-1"),
    (error) => error.code === "INTERACTION_TOKEN_MISMATCH",
  );
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, `${interaction.fallbackToken} request-changes`, "codex", "event-2"),
    (error) => error.code === "INTERACTION_COMMENT_REQUIRED",
  );
  const response = interactions.resolveTokenInteraction(
    state, interaction.id, `${interaction.fallbackToken} request-changes 补充离线场景`, "codex", "event-3",
  );
  assert.equal(response.comment, "补充离线场景");
  const published = interactions.interactionResponse(state, interaction.id);
  assert.deepEqual(published, response);
  assert.equal(Object.isFrozen(published), true);
  assert.throws(
    () => interactions.resolveTokenInteraction(state, interaction.id, `${interaction.fallbackToken} confirm`, "codex", "event-4"),
    (error) => error.code === "INTERACTION_ALREADY_RESOLVED",
  );
});

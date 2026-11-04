import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { ControlPlaneAccessError, assertControlPlaneAccess } from "./control-fns.ts";

function fakeSql(owner: string | null) {
  const sql = (async () => owner ? [{ user_id: owner }] : []) as unknown as {
    <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  };
  return sql;
}

describe("Somnus control-plane allowlist", () => {
  test("rejects a non-permitted signed-in user with a clear error", async () => {
    const previous = process.env.SOMNUS_ALLOWED_USERS;
    process.env.SOMNUS_ALLOWED_USERS = "owner@example.com";
    try {
      await assert.rejects(
        () => assertControlPlaneAccess(fakeSql(null) as never, "other-user", "other@example.com"),
        (error: unknown) => error instanceof ControlPlaneAccessError && /private/.test(error.message),
      );
    } finally {
      if (previous === undefined) delete process.env.SOMNUS_ALLOWED_USERS;
      else process.env.SOMNUS_ALLOWED_USERS = previous;
    }
  });
});

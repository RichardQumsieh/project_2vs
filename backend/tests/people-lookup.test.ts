import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { personLikePattern, rankPeople } from "../src/people-lookup.js";

const ben = {
  id: "22222222-2222-4222-8222-222222222222",
  username: "benjoe",
  displayName: "Ben Joe",
};

const other = {
  id: "33333333-3333-4333-8333-333333333333",
  username: "ada",
  displayName: "Ada Lovelace",
};

describe("people lookup", () => {
  it("resolves @username and a display name", () => {
    const people = [other, ben];
    assert.equal(rankPeople(people, "@benjoe")[0]?.username, "benjoe");
    assert.equal(rankPeople(people, "Ben Joe")[0]?.username, "benjoe");
    assert.equal(rankPeople(people, "ben")[0]?.username, "benjoe");
    assert.equal(rankPeople(people, "Ada Lovelace")[0]?.username, "ada");
    assert.equal(rankPeople(people, "@").length, 0);
  });

  it("escapes LIKE wildcards in the search pattern", () => {
    assert.equal(personLikePattern("ben_joe"), "%ben\\_joe%");
    assert.equal(personLikePattern("@benjoe"), "%benjoe%");
    assert.equal(personLikePattern("a"), null);
  });
});

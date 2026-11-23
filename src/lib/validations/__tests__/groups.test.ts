import { describe, expect, it } from "vitest";
import {
  computeTargetGroupCount,
  generateUniqueGroupNames,
} from "@/lib/groups/group-set-service";
import {
  createAssessmentSchema,
  updateAssessmentSchema,
  upsertAssessmentScoresSchema,
} from "@/lib/validations/grading";
import {
  autoAssignGroupsSchema,
  createGroupSetSchema,
  groupPatchSchema,
} from "@/lib/validations/groups";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_SET_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const ENROLL_ID = "44444444-4444-4444-8444-444444444444";

describe("Group Mode validations and helpers", () => {
  it("validates group set creation and auto-generation options", () => {
    expect(
      createGroupSetSchema.safeParse({
        name: "Lab Groups",
        autoGenerate: { mode: "count", value: 4, shuffle: true },
      }).success
    ).toBe(true);

    expect(
      createGroupSetSchema.safeParse({
        name: "A",
      }).success
    ).toBe(false);
  });

  it("validates group patch actions and auto-assign payloads", () => {
    expect(
      groupPatchSchema.safeParse({
        action: "move_member",
        enrollmentId: ENROLL_ID,
        targetGroupId: null,
      }).success
    ).toBe(true);

    expect(
      groupPatchSchema.safeParse({
        action: "rename",
        groupId: GROUP_ID,
        name: "Team Alpha",
      }).success
    ).toBe(true);

    expect(
      autoAssignGroupsSchema.safeParse({
        scope: "unassigned",
        mode: "count",
      }).success
    ).toBe(false);

    expect(
      autoAssignGroupsSchema.safeParse({
        scope: "all",
        mode: "size",
        value: 3,
      }).success
    ).toBe(true);
  });

  it("requires groupSetId when assessment isGroupMode is enabled", () => {
    expect(
      createAssessmentSchema.safeParse({
        categoryId: CATEGORY_ID,
        title: "Group Project",
        maxScore: 100,
        isGroupMode: true,
      }).success
    ).toBe(false);

    expect(
      createAssessmentSchema.safeParse({
        categoryId: CATEGORY_ID,
        title: "Group Project",
        maxScore: 100,
        isGroupMode: true,
        groupSetId: GROUP_SET_ID,
      }).success
    ).toBe(true);

    expect(
      updateAssessmentSchema.safeParse({
        isGroupMode: true,
        groupSetId: null,
      }).success
    ).toBe(false);
  });

  it("accepts groupScores and memberScores in upsertAssessmentScoresSchema", () => {
    expect(
      upsertAssessmentScoresSchema.safeParse({
        groupScores: [
          {
            groupId: GROUP_ID,
            status: "GRADED",
            rawScore: 45,
            remarks: "Well presented",
          },
        ],
        memberScores: [
          {
            enrollmentId: ENROLL_ID,
            isGroupOverride: true,
            status: "EXCUSED",
            rawScore: null,
            remarks: "Medical excuse",
          },
        ],
      }).success
    ).toBe(true);

    expect(upsertAssessmentScoresSchema.safeParse({}).success).toBe(false);
  });

  it("computes group counts and generates non-colliding group names", () => {
    expect(computeTargetGroupCount(14, "size", 4)).toBe(4);
    expect(computeTargetGroupCount(14, "count", 5)).toBe(5);
    expect(
      generateUniqueGroupNames(
        3,
        "Group",
        new Set(["group 1", "group 3"])
      )
    ).toEqual(["Group 2", "Group 4", "Group 5"]);
  });
});

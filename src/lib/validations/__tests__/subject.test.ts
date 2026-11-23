import { describe, expect, it } from "vitest";
import { bulkDeleteStudentsSchema } from "../auth";
import {
  addCoTeachersSchema,
  bulkUnenrollRosterSchema,
  createSubjectMaterialSchema,
  createSubjectSchema,
  duplicateSubjectSchema,
  generateInviteCode,
  hasValidSubjectDateRange,
  isSameSectionName,
  normalizeInviteCodeInput,
  parseRosterEntries,
  updateSubjectMaterialSchema,
  updateSubjectSchema,
} from "../subject";

describe("subject validation helpers", () => {
  it("generates uppercase alphanumeric invite codes of requested length", () => {
    const code = generateInviteCode(8);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("extracts invite codes from raw strings and join URLs", () => {
    expect(normalizeInviteCodeInput(" cs101sec ")).toBe("CS101SEC");
    expect(
      normalizeInviteCodeInput("https://app.example.com/join?code=it204sec")
    ).toBe("IT204SEC");
  });

  it("parses deduplicated student emails and IDs from CSV/multiline text", () => {
    const entries = parseRosterEntries(
      "email,student_id\nstudent1@classpulse.local, 2026-0002\nSTUDENT1@CLASSPULSE.LOCAL;2026-0003"
    );
    expect(entries).toEqual([
      "student1@classpulse.local",
      "2026-0002",
      "2026-0003",
    ]);
  });

  it("validates optional subject startDate and endDate ranges", () => {
    expect(
      createSubjectSchema.safeParse({
        code: "CS 101",
        title: "Intro to Computing",
        section: "BSCS-1A",
        startDate: "2026-08-10",
        endDate: "2026-12-18",
      }).success
    ).toBe(true);

    expect(
      createSubjectSchema.safeParse({
        code: "CS 101",
        title: "Intro to Computing",
        section: "BSCS-1A",
        startDate: "2026-12-18",
        endDate: "2026-08-10",
      }).success
    ).toBe(false);

    const cleared = updateSubjectSchema.safeParse({
      startDate: "",
      endDate: null,
    });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.startDate).toBeNull();
      expect(cleared.data.endDate).toBeNull();
    }

    expect(
      hasValidSubjectDateRange(new Date("2026-08-10"), new Date("2026-08-10"))
    ).toBe(true);
    expect(
      hasValidSubjectDateRange(new Date("2026-08-10"), new Date("2026-08-09"))
    ).toBe(false);
  });

  it("validates duplicateSubjectSchema and compares section names case-insensitively", () => {
    const valid = duplicateSubjectSchema.safeParse({ section: "  BSCS-1B  " });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.section).toBe("BSCS-1B");
    }

    expect(duplicateSubjectSchema.safeParse({ section: "   " }).success).toBe(
      false
    );
    expect(
      duplicateSubjectSchema.safeParse({ section: "A".repeat(41) }).success
    ).toBe(false);

    expect(isSameSectionName("BSCS-1A", "  bscs-1a ")).toBe(true);
    expect(isSameSectionName("BSCS-1A", "BSCS-1B")).toBe(false);
  });

  it("validates bulkUnenrollRosterSchema and bulkDeleteStudentsSchema UUID lists", () => {
    const validId = "11111111-1111-4111-8111-111111111111";

    expect(
      bulkUnenrollRosterSchema.safeParse({ enrollmentIds: [validId] }).success
    ).toBe(true);
    expect(
      bulkUnenrollRosterSchema.safeParse({ enrollmentIds: [] }).success
    ).toBe(false);
    expect(
      bulkUnenrollRosterSchema.safeParse({ enrollmentIds: ["not-a-uuid"] })
        .success
    ).toBe(false);

    expect(
      bulkDeleteStudentsSchema.safeParse({ studentIds: [validId] }).success
    ).toBe(true);
    expect(
      bulkDeleteStudentsSchema.safeParse({ studentIds: [] }).success
    ).toBe(false);
    expect(
      bulkDeleteStudentsSchema.safeParse({ studentIds: ["bad"] }).success
    ).toBe(false);
  });

  it("validates addCoTeachersSchema and subject material schemas", () => {
    expect(
      addCoTeachersSchema.safeParse({ rawText: "teacher2@classpulse.local" })
        .success
    ).toBe(true);
    expect(addCoTeachersSchema.safeParse({ rawText: "   " }).success).toBe(
      false
    );

    const validMaterial = createSubjectMaterialSchema.safeParse({
      title: "Week 1 Lecture Slides",
      topic: "Week 1",
      description: "Introductory slides",
      driveUrl:
        "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view",
    });
    expect(validMaterial.success).toBe(true);
    if (validMaterial.success) {
      expect(validMaterial.data.requirePublicLink).toBe(true);
    }

    expect(
      createSubjectMaterialSchema.safeParse({
        title: "A",
        driveUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view",
      }).success
    ).toBe(false);

    expect(
      updateSubjectMaterialSchema.safeParse({
        title: "Updated Lecture Slides",
        requirePublicLink: false,
      }).success
    ).toBe(true);
  });

  it("accepts optional pointsEnabled boolean on createSubjectSchema and updateSubjectSchema", () => {
    const createDisabled = createSubjectSchema.safeParse({
      code: "CS 102",
      title: "Discrete Math",
      section: "BSCS-1B",
      pointsEnabled: false,
    });
    expect(createDisabled.success).toBe(true);
    if (createDisabled.success) {
      expect(createDisabled.data.pointsEnabled).toBe(false);
    }

    const updateToggle = updateSubjectSchema.safeParse({
      pointsEnabled: false,
    });
    expect(updateToggle.success).toBe(true);
    if (updateToggle.success) {
      expect(updateToggle.data.pointsEnabled).toBe(false);
    }
  });
});
